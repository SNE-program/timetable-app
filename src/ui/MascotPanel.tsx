import React from 'react';
import {
  closeSheets, confirmDanger, importMascotImage, importMascotPack, importMascotSheet, mascotExportText,
  openCloudSheet, openManual, openMascotEditor, patchMascotPrefs, patchPrefs, removeMascot, repairMascotFrames,
  resetMascotPosition, showToast, useApp,
} from '../app/store';
import { prepareMascotImage } from '../theme/image';
import { describeVideoSheet, isVideoFile, videoToSpriteSheet } from '../theme/videoSheet';
import { inspectMascot, needsFix, type MascotFinding } from '../mascot/inspect';
import { describeAsset, providedStates } from '../mascot/pack';
import { HEIGHT_MAX, HEIGHT_MIN, MASCOT_STATES, STATE_LABEL } from '../mascot/types';
import { saveTextFile } from '../platform/saveFile';
import { Panel, Sheet, SliderRow, SwitchRow } from './common';
import MascotArt from './MascotArt';
import MascotThumb from './MascotThumb';
import { cloudConfigured } from '../cloud/config';


/**
 * 「角色」面板。
 *
 * 设计前提：**默认什么都没有**。所以这个面板大部分时候显示的是一个空状态 ——
 * 它得把"这是什么、怎么弄一个、去哪看教学"三件事说清楚，
 * 而不是摆一堆禁用状态的控件。
 *
 * 这也是它和外观页其它面板的区别：其它面板是"调参数"，这个是"先得有素材"。
 * 不会用的人会卡在第一步，所以教学入口必须显眼。
 */
export default function MascotPanel() {
  const s = useApp();
  const pack = s.mascot;
  const mp = s.prefs.mascot;
  const [busy, setBusy] = React.useState(false);
  /** 粘贴角色包：相册里没有 .json，这是没有文件管理器时唯一的路 */
  const [paste, setPaste] = React.useState(false);
  /** 「更多功能」展开状态：默认收起，面板上只留一个主入口 */
  const [more, setMore] = React.useState(false);
  const [pasted, setPasted] = React.useState('');
  /** 滑杆的临时值：拖动时只更新它，停手后才写盘 */
  const [sizeDraft, setSizeDraft] = React.useState(mp.size);
  /** 上一次导入的结果（帧数、单格多大、有没有空白格）—— 只弹一次提示太容易错过 */
  const [report, setReport] = React.useState<{ summary: string; notes: string[] } | null>(null);
  /** 检查结果 */
  const [findings, setFindings] = React.useState<MascotFinding[] | null>(null);
  const [checking, setChecking] = React.useState(false);
  const packRef = React.useRef<HTMLInputElement>(null);
  const imgRef = React.useRef<HTMLInputElement>(null);

  /* 外部（换个角色、恢复默认）改了尺寸要同步回来 */
  React.useEffect(function () { setSizeDraft(mp.size); }, [mp.size]);

  React.useEffect(function () {
    if (sizeDraft === mp.size) return;
    const id = window.setTimeout(function () { patchMascotPrefs({ size: sizeDraft }); }, 400);
    return function () { window.clearTimeout(id); };
  }, [sizeDraft, mp.size]);

  async function onPackFile(file: File): Promise<void> {
    setBusy(true);
    try {
      const text = await file.text();
      const r = importMascotPack(text, file.name);
      if (!r.ok) {
        showToast('角色包导入失败：' + r.error, 'error');
        return;
      }
      showToast('角色已就位' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : '') + '，按住它可以拖到别的位置', 'ok');
      if (r.warnings.length) console.warn('角色包提示：', r.warnings);
    } finally {
      setBusy(false);
    }
  }

  async function onImageFile(file: File): Promise<void> {
    setBusy(true);
    setReport(null);
    const base = file.name.replace(/\.[^.]+$/, '');
    const dpr = window.devicePixelRatio || 1;
    try {
      /*
       * 视频（webm / mp4 …）走另一条管线：抽帧拼成逐帧雪碧图。
       * 二游的动图素材大量是 webm，而 webm 是视频不是图片 ——
       * 老版本直接把它当图片拒了，用户看到的只是"这个文件用不了"。
       *
       * plan.frames 一定要传下去：网格的最后一排常常排不满，
       * 那几格是全透明的，当成帧播就是"角色一闪一闪"（见 MascotArt 里的说明）。
       */
      if (isVideoFile(file)) {
        showToast('正在从视频里抽帧，可能要几秒…', 'info', undefined);
        const v = await videoToSpriteSheet(file);
        importMascotSheet(v.src, base, v.plan.cols, v.plan.rows, v.plan.fps, v.plan.frames);
        const d = describeVideoSheet(v, mp.size, dpr);
        setReport(d);
        showToast(d.summary, d.notes.length ? 'warn' : 'ok');
        return;
      }

      /*
       * 图片：**能原样保留就原样保留**（见 prepareMascotImage）。
       * 重新压一遍是有损的二次编码，而且会把动图拍成静态图。
       * 真的要压时压到 1536 长边 —— 显示高度上限 320px 在 3.5 倍屏上是 1120 物理像素，
       * 老的 1024 其实差一点点。
       */
      const img = await prepareMascotImage(file, 1536, 0.94);
      importMascotImage(img.src, base);
      if (img.lostAnimation) {
        showToast('这张动图太大了（超过 3MB 或 150 万像素），已经压成静态图；'
          + '想保留动效可以先用工具压一下再导入', 'warn');
      } else {
        showToast(img.original
          ? '已把这张图原样设为角色（没有二次压缩），按住它可以拖到别的位置'
          : '已把这张图压到 ' + img.width + '×' + img.height + ' 设为角色', 'ok');
      }
    } catch (e) {
      showToast('这个文件用不了：' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 移除角色：**先问一句**。
   *
   * 这一下会连带把素材从本机清掉（再想要得重新导入），属于不可逆操作；
   * 用户这一轮的要求正是"角色设置也要防误触"，所以除了面板锁定之外，
   * 这里再走一次应用统一的危险操作确认（设置里可以关掉它）。
   */
  async function removeMascotAsk(): Promise<void> {
    const ok = await confirmDanger('移除这个角色？它的素材会一起从本机清掉，重新导入才能恢复。', '移除');
    if (!ok) return;
    removeMascot();
    showToast('已移除角色', 'ok');
  }

  /** 检查：把"每帧多大、真有几帧、会不会虚"量出来给用户看 */
  async function runCheck(): Promise<void> {
    if (!pack) return;
    setChecking(true);
    try {
      setFindings(await inspectMascot(pack, { displayHeight: mp.size, dpr: window.devicePixelRatio || 1 }));
    } finally {
      setChecking(false);
    }
  }

  async function applyFramesFix(): Promise<void> {
    const n = await repairMascotFrames(true);
    if (n === 0) {
      showToast('实测下来这个角色的帧数没问题，不用改', 'info');
    }
    await runCheck();
  }

  async function exportPack(): Promise<void> {
    const out = mascotExportText();
    if (!out) return;
    if (out.hasRefs) {
      showToast('素材还没从资产库读出来，稍后再试', 'warn');
      return;
    }
    const r = await saveTextFile({
      fileName: out.fileName,
      text: out.text,
      mime: 'application/json',
      title: '课表助手角色包 · ' + (pack ? pack.name : ''),
      dialogTitle: '导出角色包',
    });
    if (r === 'shared') showToast('已打开分享面板', 'ok');
    else if (r === 'saved') showToast('已保存到「文档」目录', 'ok');
    else if (r === 'cancelled') showToast('已取消', 'info');
    else showToast('导出失败', 'error');
  }

  const states = pack ? providedStates(pack) : [];

  /*
   * 角色设置也吃外观锁定。
   *
   * 原来这里是**豁免**的，理由是"导入角色是数据操作，不是调样式"；
   * 但豁免以后「移除角色」「替换素材」「放回默认位置」这些**同样能一键改掉已有角色**的行
   * 也跟着敞着 —— 锁着外观的时候照样点得动，其中「移除角色」会连带清掉素材。
   * 现在只有"还没有角色"时不锁（那时唯一的动作就是第一次把它放进来）。
   */
  const locked = s.prefs.studioLocked !== false && !!pack;

  return (
    <React.Fragment>
      {/*
        提示条放在 Panel **外面**：锁定时面板整体会压暗、里面的按钮一律点不动，
        而这条提示自己得是亮的、按钮得能按 —— 否则用户只看到一片点不动的行，
        不知道该去哪解锁（顶部那条锁定栏在面板多的时候早滚出屏幕了）。
      */}
      {locked ? (
        <div className="studio-lock on inline">
          <div className="studio-lock-text">
            <div className="studio-lock-title">角色设置已锁定</div>
            <div className="studio-lock-sub">和外观一样，锁定状态下点不动 —— 防止误触改掉或移除已有角色</div>
          </div>
          <button
            className="btn sm primary"
            onClick={function () {
              patchPrefs({ studioLocked: false });
              showToast('已解锁，可以改角色设置了', 'ok');
            }}
          >解锁</button>
        </div>
      ) : null}
    <Panel
      title="角色"
      sub={pack ? pack.name : '未设置'}
      desc="放在课表界面上的一个小东西：会呼吸、会眨眼，点一下有反应，可以拖着换位置。默认不显示 —— 导入一个角色包才会出现。"
    >
      <input
        ref={packRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={function (e) {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (f) void onPackFile(f);
        }}
      />
      {/*
        accept 里必须带上 video/*：安卓的相册选择器是按 MIME 过滤的，
        只写 image/* 的话，用户相册里的 webm 根本不会出现在待选列表里 ——
        表现就是"想选那个视频，但列表里压根没有它"。
      */}
      <input
        ref={imgRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
        onChange={function (e) {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (f) void onImageFile(f);
        }}
      />

      {/*
        有角色时：左边放一个**活的**角色（和桌面上同一个渲染组件），右边是名字与来源。
        比一行文字说明好看得多，也让人一眼确认这是不是自己想要的那个。
      */}
      {pack ? (
        <div className="mascot-hero">
          <div className="mascot-hero-stage">
            <MascotArt
              asset={pack.states.idle!}
              motion={pack.motion}
              phase="idle"
              size={72}
              shadow={pack.shadow}
            />
          </div>
          <div className="mascot-hero-meta">
            <div className="lr-label">{pack.name}</div>
            <div className="lr-sub">
              {pack.author ? pack.author + ' · ' : ''}
              {states.map(function (k) { return STATE_LABEL[k]; }).join(' / ')}
            </div>
            <div className="lr-sub">{pack.description || (mp.hidden ? '当前已收起来' : '正在课表界面上')}</div>
          </div>
          <div className="lr-right">
            <MascotThumb asset={pack.states.idle} size={44} />
          </div>
        </div>
      ) : null}

      {/*
        四个槽位。空着的时候是虚线加号：它同时干两件事 ——
        告诉用户一个角色由这四部分组成，以及点这里就能开始做。
      */}
      {/* 纯展示，不做成可点 —— 可点的话它就是一排按钮，面板立刻又乱了 */}
      <div className="mascot-slots">
        {MASCOT_STATES.map(function (k) {
          const a = pack ? pack.states[k] : undefined;
          return (
            <div className="mascot-slot" key={k}>
              {a ? <MascotThumb asset={a} />
                : <div className="mascot-thumb is-empty mascot-slot-add" style={{ height: '48px' }}>＋</div>}
              <div className="mascot-slot-name">{STATE_LABEL[k]}</div>
              <div className="mascot-slot-sub">{a ? '已设置' : (k === 'idle' ? '必填' : '留空')}</div>
            </div>
          );
        })}
      </div>

      {/*
        导入结果就地留一份。
        只弹一个 toast 太容易错过：帧数、每帧多大像素、"会不会发虚"这些数字，
        用户想回头再看一眼时 toast 早没了 —— 而它们正是判断"这个角色行不行"的依据。
      */}
      {report ? (
        <div className="warn-bar" style={{ margin: '0 14px 10px' }}>
          <div className="warn-badge">{report.notes.length ? '!' : '✓'}</div>
          <div>
            <div className="warn-item" style={{ color: 'var(--c-text)', marginTop: 0 }}>{report.summary}</div>
            {report.notes.map(function (n, i) {
              return <div className="warn-item" key={i}>{n}</div>;
            })}
          </div>
        </div>
      ) : null}

      {/*
        所有"能改东西"的行都关在这个容器里，由外观锁定统一管（见 components.css）。
        还没有角色时容器带 .unlocked —— 那一步（第一次把角色放进来）不该被锁拦住。
      */}
      <div className={'mascot-rows' + (pack ? '' : ' unlocked')}>
      {/* 只留一个主入口，其余全收进「更多功能」 */}
      <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { if (packRef.current) packRef.current.click(); }}>
        <div>
          <div className="lr-label">导入角色包</div>
          <div className="lr-sub">选一个 .json 文件；内容也支持整段粘贴</div>
        </div>
        <div className="lr-right">›</div>
      </div>
      <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { setMore(!more); }}>
        <div>
          <div className="lr-label">更多功能</div>
          <div className="lr-sub">做一个角色 · 用图或视频 · 粘贴 · 导出 · 位置 · 教学</div>
        </div>
        <div className="lr-right">{more ? '⌃' : '⌄'}</div>
      </div>

      {more ? (
        <React.Fragment>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openMascotEditor(pack ? 'edit' : 'new'); }}>
            <div>
              <div className="lr-label">{pack ? '编辑这个角色' : '做一个角色'}</div>
              <div className="lr-sub">{pack ? '改素材、动作、大小，改完保存就生效' : '填表做一个：选图、调动作、实时预览'}</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { if (imgRef.current) imgRef.current.click(); }}>
            <div>
              <div className="lr-label">用一张图或一段视频</div>
              <div className="lr-sub">图片直接当角色；视频（webm / mp4）会自动抽帧做成逐帧动图</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { setPaste(true); }}>
            <div>
              <div className="lr-label">粘贴角色包内容</div>
              <div className="lr-sub">同学发来的整段内容复制进来即可；相册里找不到 .json 时用这条</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          {pack ? (
            <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void exportPack(); }}>
              <div>
                <div className="lr-label">导出角色包</div>
                <div className="lr-sub">拿到一个内嵌素材的 .json，可以发给别人</div>
              </div>
              <div className="lr-right">›</div>
            </div>
          ) : null}
          {/*
            云端角色的入口也放一条在这里。
            右上角那个云图标是"全局入口"，但用户是在**这一页**做角色的 ——
            做完想存起来的时候，入口应该在手边，而不是让他自己想起右上角。
          */}
          {cloudConfigured() ? (
            <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { closeSheets(); openCloudSheet(); }}>
              <div>
                <div className="lr-label">云端角色</div>
                <div className="lr-sub">把角色存到云端（换设备直接用），也可以公开给同学、或使用别人公开的角色</div>
              </div>
              <div className="lr-right">›</div>
            </div>
          ) : null}
          {pack ? (
            <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void runCheck(); }}>
              <div>
                <div className="lr-label">检查这个角色</div>
                <div className="lr-sub">量一遍：每帧多大、真有几帧、会不会被放大发虚</div>
              </div>
              <div className="lr-right">{checking ? '…' : '›'}</div>
            </div>
          ) : null}
          {/* 「放回默认位置」已经提到面板主区域了（用户明确要"一键重置"），这里不再重复一份 */}
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openManual('mascot'); }}>
            <div>
              <div className="lr-label">使用说明书 · 角色</div>
              <div className="lr-sub">怎么做角色包、视频怎么用、常见错误</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          {pack ? (
            <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void removeMascotAsk(); }}>
              <div>
                <div className="lr-label" style={{ color: 'var(--c-danger)' }}>移除角色</div>
                <div className="lr-sub">素材会一起从本机清掉；重新导入即可恢复</div>
              </div>
              <div className="lr-right">›</div>
            </div>
          ) : null}
        </React.Fragment>
      ) : null}
      </div>

      {pack ? (
        <React.Fragment>
          <div className="panel-desc" style={{ paddingBottom: 6 }}>
            角色只在课表页出现（本周 / 今日 / 任务）—— 外观页和设置页是拿来调东西的，
            那里不摆它。它可以一路拖到只剩落脚点在屏幕里（一半挂在边上也没关系），
            拖到不顺手的地方随时「放回默认位置」。
          </div>
          <div style={{ padding: '0 14px' }}>
            <SliderRow
              label="大小"
              value={sizeDraft}
              min={HEIGHT_MIN}
              max={HEIGHT_MAX}
              step={4}
              format={function (v) { return v + ' px'; }}
              onChange={function (v) {
                /* 拖动过程中只改界面，松手 400ms 后才落盘 —— 否则滑一下就是几十次 localStorage 写入 */
                setSizeDraft(v);
              }}
            />
            {/*
              播放帧率。
              做成"偏好"而不是改角色包：素材是怎么抽的就该记什么，观看快慢是个人的事，
              导出给别人时不该把别人的包带上我的速度。
            */}
            <SliderRow
              label="播放帧率"
              value={mp.fps}
              min={0}
              max={24}
              step={1}
              format={function (v) {
                if (v === 0) {
                  const own = pack.states.idle && pack.states.idle.fps ? pack.states.idle.fps : 8;
                  return '跟随素材（' + own + ' fps）';
                }
                return v + ' fps';
              }}
              onChange={function (v) { patchMascotPrefs({ fps: v }); }}
            />
            <div className="panel-desc" style={{ padding: '2px 0 10px' }}>
              调高它只会<b>播得更快</b>，不会更顺 —— 画面里的帧就那么多。
              想让动作真正更顺，重新导入那段视频即可（现在默认按 18fps 抽帧，以前是 12）。
            </div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { resetMascotPosition(); showToast('已放回默认位置', 'ok'); }}>
            <div>
              <div className="lr-label">放回默认位置</div>
              <div className="lr-sub">拖到边上、拖出屏幕、换了设备之后，点这里一步复位</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          {/*
            朝向。默认按"素材朝右"处理：走动往左时会水平镜像，让它朝着前进方向。
            素材本身朝左的（不少立绘是），勾上这一条基准就正过来了。
          */}
          <SwitchRow
            label="素材本身朝左"
            sub="勾上之后走动时的朝向会反过来；默认按「素材朝右」处理"
            on={mp.facing === 'left'}
            onChange={function (v) { patchMascotPrefs({ facing: v ? 'left' : 'right' }); }}
          />
          <SwitchRow
            label="暂时收起来"
            sub="收起来之后不会再出现，直到你在这里取消勾选"
            on={mp.hidden}
            onChange={function (v) { patchMascotPrefs({ hidden: v }); }}
          />
          <div className="list-row">
            <div>
              <div className="lr-label">交互</div>
              <div className="lr-sub">
                {pack.interactive.click ? '点一下有反应' : '不响应点击'}
                {' · '}
                {pack.interactive.drag ? '可以拖动换位置' : '位置固定'}
                {'（由角色包决定）'}
              </div>
            </div>
          </div>
        </React.Fragment>
      ) : (
        <div className="panel-desc" style={{ paddingTop: 4 }}>
          应用不内置任何角色、也不提供下载渠道。素材从哪来是你自己的事，
          这里只负责在本机把它显示出来 —— 不上传、不联网。
        </div>
      )}

      {/*
        粘贴导入。
        相册里永远不会有 .json —— 手机上只给了相册权限时，"导入角色包"这条路是断的。
        粘贴一段文本就能绕开：同学发到微信里的内容直接复制过来即可。
      */}
      {/* 检查结果：把量到的事实一条条摆出来，需要动手的地方直接给按钮 */}
      {findings ? (
        <Sheet title="角色检查" onClose={function () { setFindings(null); }}>
          <div className="panel-desc" style={{ padding: '0 0 10px' }}>
            下面是这台设备上量出来的事实。判断"清不清楚"的算法很简单：
            显示高度 × 屏幕倍率 = 需要的物理像素（当前 {mp.size}px ×{' '}
            {Math.round((window.devicePixelRatio || 1) * 10) / 10} 倍）。
          </div>
          {findings.map(function (f, i) {
            return (
              <div className="list-row" key={i} style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="lr-label">{f.label}</div>
                  <div
                    className="lr-sub"
                    style={f.level === 'bad' ? { color: 'var(--c-danger)' } : undefined}
                  >{f.text}</div>
                </div>
              </div>
            );
          })}
          {needsFix(findings) ? (
            <button
              className="btn primary block" style={{ marginTop: 10 }}
              disabled={checking}
              onClick={function () { void applyFramesFix(); }}
            >按实测帧数修正</button>
          ) : null}
          <div className="panel-desc" style={{ paddingTop: 10 }}>
            检查只读，不会联网、也不会上传任何东西；点「修正」只会改本机角色包里那个帧数。
          </div>
        </Sheet>
      ) : null}

      {paste ? (
        <Sheet title="粘贴角色包" onClose={function () { setPaste(false); }}>
          <div className="panel-desc" style={{ padding: '0 0 10px' }}>
            把角色包的内容整段粘到下面。以 {'{'} 开头的一大段 JSON 就是，
            多几个换行也没关系。
          </div>
          <textarea
            className="input share-box"
            value={pasted}
            placeholder={'{"format":"timetable-mascot", … }'}
            spellCheck={false}
            autoComplete="off"
            onChange={function (e) { setPasted(e.target.value); }}
          />
          <button
            className="btn primary block" style={{ marginTop: 10 }}
            disabled={pasted.trim().length < 10}
            onClick={function () {
              const r = importMascotPack(pasted, '粘贴的角色');
              if (!r.ok) { showToast('导入失败：' + r.error, 'error'); return; }
              setPaste(false);
              setPasted('');
              showToast('角色已就位，按住它可以拖到别的位置', 'ok');
            }}
          >导入</button>
          <div className="panel-desc" style={{ paddingTop: 10 }}>
            角色包是纯数据，粘进来的内容只会被当成参数读，不会执行任何代码。
          </div>
        </Sheet>
      ) : null}
    </Panel>
    </React.Fragment>
  );
}
