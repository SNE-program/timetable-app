import React from 'react';
import { closeSheets, confirmDanger, setData, setWeek, showToast, useApp } from '../app/store';
import { clampWeek } from '../app/store';
import { todayISO, weekOfDate } from '../core/engine';
import {
  decodeShareCode, decodeThemeCode, encodeShareCode, encodeThemeCode, looksLikeShareCode, looksLikeThemeCode,
} from '../core/shareCode';
import { importThemeObject } from '../app/store';
import { copyText } from '../app/asyncAction';
import { Segmented, Sheet } from './common';

type Kind = 'schedule' | 'theme';

/**
 * 分享码：生成一段可粘贴的文本，或者把别人给的码导入进来。
 *
 * 为什么不做二维码：一份真实课表压完约 1900 字符，二维码要塞进这个量级
 * 得用到版本 33 以上，从手机屏幕上扫非常费劲。粘贴到微信 / QQ 反而更省事，
 * 而且码里带的是完整数据，不经过任何服务器。
 */
export default function ShareCodeSheet(props: { mode: 'export' | 'import' }) {
  const s = useApp();
  const [code, setCode] = React.useState('');
  const [chars, setChars] = React.useState(0);
  const [compressed, setCompressed] = React.useState(false);
  const [pasted, setPasted] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('schedule');

  React.useEffect(function () {
    if (props.mode !== 'export') return;
    let alive = true;
    setCode('');
    setError('');
    const job = kind === 'theme' ? encodeThemeCode(s.theme) : encodeShareCode(s.data);
    void job.then(function (r) {
      if (!alive) return;
      setCode(r.code);
      setChars(r.chars);
      setCompressed(r.compressed);
    }).catch(function (e) {
      if (alive) setError('生成失败：' + (e as Error).message);
    });
    return function () { alive = false; };
  }, [props.mode, kind]);

  async function doCopy(): Promise<void> {
    const ok = await copyText(code);
    showToast(ok ? '分享码已复制，粘给同学就能导入' : '复制失败，请长按上方文本手动选择', ok ? 'ok' : 'warn');
  }

  async function doImport(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      /* 按前缀分流：KBT1 = 外观，KBR1 = 课表。两条路各自校验，不互相猜 */
      if (looksLikeThemeCode(pasted)) {
        const tr = await decodeThemeCode(pasted);
        if (!tr.ok) { setError(tr.error); return; }
        importThemeObject(tr.theme, tr.warnings);
        closeSheets();
        return;
      }

      const r = await decodeShareCode(pasted);
      if (!r.ok) { setError(r.error); return; }
      const n = r.data.courses.length;
      if (!(await confirmDanger(
        '导入会覆盖当前的 ' + s.data.courses.length + ' 门课，换成这份 ' + n + ' 门课的课表。继续吗？',
        '覆盖导入'
      ))) return;
      setData(r.data, '导入分享码', 'import');
      setWeek(clampWeek(weekOfDate(r.data.term, todayISO())));
      showToast('已导入 ' + n + ' 门课' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : ''), 'ok');
      closeSheets();
    } finally {
      setBusy(false);
    }
  }

  if (props.mode === 'export') {
    return (
      <Sheet
        title={kind === 'theme' ? '外观分享码' : '课表分享码'}
        onClose={closeSheets}
        right={<button className="btn sm primary" disabled={!code} onClick={function () { void doCopy(); }}>复制</button>}
      >
        <div style={{ marginBottom: 10 }}>
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[{ value: 'schedule', label: '分享课表' }, { value: 'theme', label: '分享外观' }]}
          />
        </div>
        <div className="panel-desc" style={{ padding: '0 0 10px' }}>
          {kind === 'theme' ? (
            <React.Fragment>
              把下面这段发给同学，他在同一个入口粘贴就能得到一样的外观。
              <b>码里只有配色、字体、排版这些参数，不经过任何服务器</b>；
              壁纸图片体积太大塞不进文本，需要连壁纸一起分享时请用「导出主题包」。
            </React.Fragment>
          ) : (
            <React.Fragment>
              把下面这段发给同学，他在「从分享码导入」里粘贴就能得到一份一样的课表。
              <b>码里只有课表数据，不经过任何服务器</b>，发出去之前也不会离开这台设备。
            </React.Fragment>
          )}
        </div>
        <textarea
          className="input share-box"
          readOnly
          value={code || '正在生成…'}
          onFocus={function (e) { (e.target as HTMLTextAreaElement).select(); }}
        />
        {error ? <div className="cf-warn">{error}</div> : null}
        <div className="share-meta">
          {code ? (chars + ' 个字符' + (compressed ? ' · 已压缩' : ' · 未压缩（当前环境不支持压缩）')) : ''}
        </div>
      </Sheet>
    );
  }

  const isTheme = looksLikeThemeCode(pasted);
  const ready = looksLikeShareCode(pasted) || isTheme;
  return (
    <Sheet
      title="从分享码导入"
      onClose={closeSheets}
      right={
        <button className="btn sm primary" disabled={busy || !ready} onClick={function () { void doImport(); }}>
          {busy ? '导入中…' : '导入'}
        </button>
      }
    >
      <div className="panel-desc" style={{ padding: '0 0 10px' }}>
        把同学发来的分享码整段粘到下面。课表码以 KBR1 开头，外观码以 KBT1 开头，
        多几个换行或空格都没关系。
      </div>
      <textarea
        className="input share-box"
        value={pasted}
        placeholder="KBR1.… 或 KBT1.…"
        spellCheck={false}
        autoComplete="off"
        onChange={function (e) { setPasted(e.target.value); setError(''); }}
      />
      <div className="share-meta">
        {pasted.trim().length === 0
          ? '还没有粘贴内容'
          : isTheme ? '这是一个外观分享码，会替换当前外观'
            : ready ? '这是一个课表分享码，会覆盖当前课表（导入前会再确认一次）'
            : '这不像分享码 —— 课表码以 KBR1 开头，外观码以 KBT1 开头'}
      </div>
      {error ? <div className="cf-warn">{error}</div> : null}
    </Sheet>
  );
}
