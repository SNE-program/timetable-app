import React from 'react';
import {
  applyPreset, exportThemeNow, importThemeFromFile, patchPrefs, patchTheme, patchWallpaper, resetTheme,
  showToast, useApp,
} from '../app/store';
import { THEME_PRESETS, type ThemePreset } from '../theme/presets';
import { WALLPAPERS, wallpaperSrc } from '../theme/wallpaper';
import { resolvePalette } from '../theme/palette';
import { dataUriBytes, formatBytes, readFileAsDataUri } from '../theme/image';
import WallpaperCrop from './WallpaperCrop';
import type { CardStyle, Density, FontKey, ModePref } from '../theme/tokens';
import { ColorField, Panel, Segmented, SliderRow, SwitchRow } from './common';
import MascotPanel from './MascotPanel';
import type { WallpaperFit } from '../theme/tokens';

const ACCENTS = ['#2F6BFF', '#6D4AFF', '#C2478E', '#E0524A', '#E07B2E', '#B8A02E', '#3F9A54', '#0F766E', '#2AA0A8', '#1B1D21', '#8A6A4B', '#5B6B7C'];

function PresetCard(props: { preset: ThemePreset; active: boolean; onPick: () => void }) {
  const theme = React.useMemo(function () { return props.preset.build(); }, [props.preset.id]);
  const palette = resolvePalette(theme, false);
  const wp = theme.wallpaper.kind === 'preset' ? wallpaperSrc(theme.wallpaper.presetId) : '';
  const bg = wp ? 'url("' + wp + '")' : undefined;
  return (
    <button
      className={props.active ? 'preset-card active' : 'preset-card'}
      onClick={props.onPick}
      title={props.preset.name}
    >
      <div
        className="preset-thumb"
        style={{ backgroundImage: bg, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: theme.lightBg }}
      >
        {[0, 1, 2, 3].map(function (i) {
          const h = 22 - i * 2;
          return (
            <div
              key={i}
              className="bar"
              style={{
                background: palette[(i * 3) % 12],
                left: 9 + i * 24,
                top: 12 + (i % 2) * 22,
                width: 18,
                height: h,
                borderRadius: theme.radius > 16 ? 7 : 3,
                opacity: 0.92,
              }}
            />
          );
        })}
      </div>
      <div className="preset-meta">
        <div className="preset-name">{props.preset.name}</div>
        <div className="preset-hint">{props.preset.hint}</div>
      </div>
    </button>
  );
}

export default function ThemeStudio() {
  const s = useApp();
  const theme = s.theme;
  const wp = theme.wallpaper;
  const locked = s.prefs.studioLocked !== false;
  const idleRef = React.useRef<number | null>(null);

  /* 解锁后 3 分钟没动过就自动锁回去 */
  React.useEffect(function () {
    if (locked) {
      if (idleRef.current !== null) { window.clearTimeout(idleRef.current); idleRef.current = null; }
      return;
    }
    const bump = function () {
      if (idleRef.current !== null) window.clearTimeout(idleRef.current);
      idleRef.current = window.setTimeout(function () { patchPrefs({ studioLocked: true }); }, 180000);
    };
    bump();
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return function () {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      if (idleRef.current !== null) window.clearTimeout(idleRef.current);
    };
  }, [locked]);
  const palette = resolvePalette(theme, s.systemDark);
  const wpInput = React.useRef<HTMLInputElement>(null);
  const packInput = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [hot, setHot] = React.useState(false);
  const [cropSrc, setCropSrc] = React.useState<string | null>(function () {
    /* 开发用：?crop=1 直接打开剪裁面板并喂一张测试图 */
    try {
      if (new URLSearchParams(window.location.search).get('crop') !== '1') return null;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#FF7A45"/><stop offset=".5" stop-color="#7C5CFF"/>' +
        '<stop offset="1" stop-color="#00D4FF"/></linearGradient></defs>' +
        '<rect width="1600" height="900" fill="url(#g)"/>' +
        '<circle cx="300" cy="200" r="140" fill="#fff" opacity=".35"/>' +
        '<circle cx="1300" cy="700" r="180" fill="#000" opacity=".2"/>' +
        '<text x="800" y="470" font-size="90" fill="#fff" text-anchor="middle" font-family="sans-serif">1600 x 900 横图</text>' +
        '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) { return null; }
  });

  async function handleWallpaperFile(file: File) {
    setBusy(true);
    try {
      if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('请选择图片文件');
      /* 先原样读进来，交给剪裁面板 —— 不剪裁直接铺满，横图会被放大到看不清 */
      const src = await readFileAsDataUri(file);
      setCropSrc(src);
    } catch (e) {
      showToast('图片读取失败：' + (e as Error).message, 'error');
    }
    setBusy(false);
  }

  function onCropped(cropped: string, original: string) {
    setCropSrc(null);
    patchWallpaper({ kind: 'custom', custom: cropped, original: original });
    showToast('壁纸已应用（' + formatBytes(dataUriBytes(cropped)) + '），随时可以重新剪裁', 'ok');
  }

  function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    setHot(false);
    const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    if (f.type.indexOf('image/') === 0) void handleWallpaperFile(f);
    else void importThemeFromFile(f);
  }

  const customBytes = wp.kind === 'custom' && wp.custom ? dataUriBytes(wp.custom) : 0;

  return (
    <div className={locked ? 'studio locked' : 'studio'}>
      {cropSrc ? (
        <WallpaperCrop src={cropSrc} onCancel={function () { setCropSrc(null); }} onDone={onCropped} />
      ) : null}

      <div className={locked ? 'studio-lock on' : 'studio-lock'}>
        <div className="studio-lock-text">
          <div className="studio-lock-title">{locked ? '外观已锁定' : '已解锁'}</div>
          <div className="studio-lock-sub">
            {locked ? '锁定状态下不会误改主题，可以放心滑动查看' : '3 分钟不动或离开本页会自动重新锁上'}
          </div>
        </div>
        <button
          className={locked ? 'btn sm primary' : 'btn sm'}
          onClick={function () {
            patchPrefs({ studioLocked: !locked });
            showToast(locked ? '已解锁，可以修改外观了' : '已重新锁定', 'ok');
          }}
        >{locked ? '解锁' : '锁定'}</button>
      </div>

      <Panel title="一键主题" sub={THEME_PRESETS.length + ' 套内置'} desc="点一下立刻换装。所有主题都带壁纸与配色，可以直接作为起点继续改。">
        <div className="preset-scroll">
          {THEME_PRESETS.map(function (p) {
            return (
              <PresetCard
                key={p.id}
                preset={p}
                active={theme.meta.id === p.id}
                onPick={function () { applyPreset(p.id); }}
              />
            );
          })}
        </div>
      </Panel>

      <Panel title="背景" sub={wp.kind === 'none' ? '纯色' : wp.kind === 'preset' ? '内置图片' : '自定义图片'} desc="可以什么都不放，也可以放一张自己喜欢的图。图片会跟着主题包一起导出。">
        <div className="wp-grid">
          <button
            className={wp.kind === 'none' ? 'wp-item active' : 'wp-item'}
            onClick={function () { patchWallpaper({ kind: 'none' }); }}
          >
            <div className="wp-item none">无</div>
            <div className="wp-name">纯色</div>
          </button>
          {WALLPAPERS.map(function (w) {
            const active = wp.kind === 'preset' && wp.presetId === w.id;
            return (
              <button
                key={w.id}
                className={active ? 'wp-item active' : 'wp-item'}
                onClick={function () { patchWallpaper({ kind: 'preset', presetId: w.id }); }}
              >
                <img src={wallpaperSrc(w.id)} alt={w.name} />
                <div className="wp-name">{w.name}</div>
              </button>
            );
          })}
          {wp.kind === 'custom' && wp.custom ? (
            <button className="wp-item active" onClick={function () { patchWallpaper({ kind: 'custom' }); }}>
              <img src={wp.custom} alt="我的图片" />
              <div className="wp-name">我的</div>
            </button>
          ) : null}
        </div>

        <div
          className={hot ? 'upload-zone hot' : 'upload-zone'}
          onClick={function () { if (wpInput.current) wpInput.current.click(); }}
          onDragOver={function (e) { e.preventDefault(); setHot(true); }}
          onDragLeave={function () { setHot(false); }}
          onDrop={onDrop}
          style={{ cursor: 'pointer' }}
        >
          {busy ? '正在读取图片…' : '点这里选一张图片，或直接把它拖进来 · 选完可以自己剪裁'}
        </div>
        <input
          ref={wpInput} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            if (f) void handleWallpaperFile(f);
            e.target.value = '';
          }}
        />

        {wp.kind === 'custom' && wp.custom ? (
          <div className="asset-line">
            <img className="asset-thumb" src={wp.custom} alt="壁纸" />
            <div>
              <div className="small bold">自定义壁纸</div>
              <div className="tiny muted">{formatBytes(customBytes)} · 会随主题包一起导出</div>
            </div>
            <div className="spacer" />
            {wp.original ? (
              <button className="btn sm" onClick={function () { setCropSrc(wp.original || null); }}>重新剪裁</button>
            ) : null}
            <button className="btn sm ghost" onClick={function () { patchWallpaper({ kind: 'none', custom: '', original: undefined }); }}>移除</button>
          </div>
        ) : null}

        {wp.kind !== 'none' ? (
          <div>
            <div className="slider-row">
              <div className="slider-head"><span className="small">显示方式</span></div>
              <div style={{ marginTop: 6 }}>
                <Segmented<WallpaperFit>
                  value={wp.fit || 'cover'}
                  onChange={function (v) { patchWallpaper({ fit: v }); }}
                  options={[
                    { value: 'cover', label: '填满' },
                    { value: 'contain', label: '完整' },
                    { value: 'repeat', label: '平铺' },
                  ]}
                />
              </div>
              <div className="field-label" style={{ marginTop: 8 }}>
                填满＝铺满屏幕并裁掉多余部分；完整＝整张图都显示、两边留底色；平铺＝小图重复铺开。
              </div>
            </div>
            <SliderRow label="背景模糊" value={wp.blur} min={0} max={30} step={1} format={function (v) { return v + ' px'; }} onChange={function (v) { patchWallpaper({ blur: v }); }} />
            <SliderRow label="背景压暗 / 提亮" value={Math.round(wp.scrim * 100)} min={0} max={90} step={2} format={function (v) { return v + '%'; }} onChange={function (v) { patchWallpaper({ scrim: v / 100 }); }} />
          </div>
        ) : null}
      </Panel>

      <Panel title="主色" sub="课程色由它推导" desc="改一个主色，12 个课程颜色会一起重新生成，保证整体协调。">
        <div className="color-row">
          {ACCENTS.map(function (c) {
            return (
              <button
                key={c}
                className={theme.accent.toLowerCase() === c.toLowerCase() ? 'swatch active' : 'swatch'}
                style={{ background: c }}
                onClick={function () { patchTheme({ accent: c, courseColors: [] }); }}
                title={c}
              />
            );
          })}
          <ColorField
            title="自定义主色"
            value={theme.accent}
            onChange={function (v) { patchTheme({ accent: v, courseColors: [] }); }}
          />
        </div>
        <div className="palette-grid">
          {palette.map(function (c, i) {
            return <div key={i} className="palette-chip" style={{ background: c }} />;
          })}
        </div>
        <SliderRow label="课程色彩饱和" value={Math.round(theme.courseSaturation * 100)} min={0} max={140} step={5} format={function (v) { return v + '%'; }} onChange={function (v) { patchTheme({ courseSaturation: v / 100, courseColors: [] }); }} />
      </Panel>

      <Panel title="课程卡" sub="五种质感" desc="默认的「色条」是工业化做法：颜色只出现在左侧色条上，卡片保持白底描边，一眼就能扫完一整天。">
        <div style={{ padding: '4px 16px 14px' }}>
          <Segmented<CardStyle>
            value={theme.cardStyle}
            onChange={function (v) { patchTheme({ cardStyle: v }); }}
            options={[
              { value: 'line', label: '色条' },
              { value: 'solid', label: '纯色' },
              { value: 'gradient', label: '渐变' },
              { value: 'glass', label: '毛玻璃' },
              { value: 'outline', label: '描边' },
            ]}
          />
        </div>
        <SliderRow label="卡片不透明度" value={Math.round(theme.cardOpacity * 100)} min={30} max={100} step={5} format={function (v) { return v + '%'; }} onChange={function (v) { patchTheme({ cardOpacity: v / 100 }); }} />
        <SliderRow label="圆角" value={theme.radius} min={0} max={24} step={1} format={function (v) { return v <= 6 ? v + ' px · 工业' : v + ' px'; }} onChange={function (v) { patchTheme({ radius: v }); }} />
        <SliderRow label="面板通透度" value={Math.round(theme.panelAlpha * 100)} min={30} max={100} step={5} format={function (v) { return v + '%'; }} onChange={function (v) { patchTheme({ panelAlpha: v / 100, glassBlur: theme.glassBlur || 18 }); }} />
      </Panel>

      <Panel title="文字与排版">
        <div style={{ padding: '4px 16px 14px' }}>
          <Segmented<FontKey>
            value={theme.font}
            onChange={function (v) { patchTheme({ font: v }); }}
            options={[
              { value: 'system', label: '默认' },
              { value: 'serif', label: '衬线' },
              { value: 'rounded', label: '圆体' },
              { value: 'mono', label: '等宽' },
            ]}
          />
        </div>
        <SliderRow label="字号缩放" value={Math.round(theme.fontScale * 100)} min={85} max={130} step={1} format={function (v) { return v + '%'; }} onChange={function (v) { patchTheme({ fontScale: v / 100 }); }} />
        <div style={{ padding: '4px 16px 14px' }}>
          <Segmented<Density>
            value={theme.density}
            onChange={function (v) { patchTheme({ density: v }); }}
            options={[
              { value: 'compact', label: '紧凑' },
              { value: 'comfortable', label: '标准' },
              { value: 'cozy', label: '宽松' },
            ]}
          />
        </div>
        <div style={{ padding: '4px 16px 14px' }}>
          <Segmented<ModePref>
            value={theme.modePref}
            onChange={function (v) { patchTheme({ modePref: v }); }}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'auto', label: '跟随系统' },
            ]}
          />
        </div>
        <SwitchRow label="显示任课教师" on={theme.showTeacher} onChange={function (v) { patchTheme({ showTeacher: v }); }} />
        <SwitchRow
          label="色盲友好配色"
          sub="课程色改为「色相 + 明度」双维度区分，红了绿了都能分清，转成灰度也能认"
          on={theme.colorBlind}
          onChange={function (v) { patchTheme({ colorBlind: v, courseColors: [] }); }}
        />
        <div className="slider-row">
          <div className="slider-head">
            <span className="small">每周显示几天</span>
            <span className="sv">{(theme.showDays || 7) === 5 ? '只显示工作日' : (theme.showDays || 7) === 6 ? '周一到周六' : '整周'}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <Segmented<string>
              value={String(theme.showDays || 7)}
              onChange={function (v) { patchTheme({ showDays: Number(v) }); }}
              options={[
                { value: '5', label: '5 天' },
                { value: '6', label: '6 天' },
                { value: '7', label: '7 天' },
              ]}
            />
          </div>
          <div className="field-label" style={{ marginTop: 8 }}>
            手机竖屏只有 360 来 px 宽。显示 5 天时每列宽将近 60px，课程名能完整显示；7 天时每列只有 44px。
          </div>
        </div>
      </Panel>

      {/* 角色面板不受外观锁定影响：导入角色包是数据操作，不是调样式，
          而"首次设置角色被先解锁挡住"正是最容易被劝退的地方（见 components.css） */}
      <div className="mascot-slot">
        <MascotPanel />
      </div>

      <div className="studio-tail" />

      <Panel
        title="主题包"
        sub="含图片"
        desc="导出的文件里带着壁纸图片本身，发给同学、直接导入就能用，不需要再单独传图。"
      >
        <div style={{ display: 'flex', gap: 10, padding: '2px 16px 14px' }}>
          <button className="btn primary" style={{ flex: 1 }} onClick={function () { void exportThemeNow(); }}>导出主题包</button>
          <button className="btn" style={{ flex: 1 }} onClick={function () { if (packInput.current) packInput.current.click(); }}>导入主题包</button>
        </div>
        <div style={{ padding: '0 16px 14px' }}>
          <button className="btn ghost block" onClick={function () { resetTheme(); }}>恢复默认外观</button>
        </div>
        <input
          ref={packInput} type="file" accept=".json,.timetheme,application/json" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            if (f) void importThemeFromFile(f);
            e.target.value = '';
          }}
        />
        <div className="panel-desc">
          主题包文件也可以直接拖到屏幕上导入。
          想给某门课单独配图，进课程详情里换。
        </div>
      </Panel>
    </div>
  );
}
