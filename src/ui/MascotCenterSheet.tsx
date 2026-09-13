import React from 'react';
import { Sheet, Segmented } from './common';
import { Icon } from './icons';
import MascotArt from './MascotArt';
import MascotThumb from './MascotThumb';
import { describeSize } from '../cloud/backup';
import { isMine } from '../cloud/mascots';
import { cloudConfigured } from '../cloud/config';
import { providedStates } from '../mascot/pack';
import { STATE_LABEL, type MascotPack } from '../mascot/types';
import { exportMascotPackFile, importMascotMedia, importMascotPackFile, pickFile } from './mascotImport';
import {
  closeMascotCenter, cloudDeleteMascot, cloudLoadMascots, cloudQuotaLine, cloudShareCurrent,
  cloudSetMascotPublic, cloudShareMascot, cloudUnshareMascot, cloudUploadMascot, cloudUseMascot, cloudUseShareCode,
  copyShareText, forgetRecentShareCode, importMascotPack, mascotLibrary, openCloudSheet, openMascotEditor, openManual,
  pushRecentShareCode, recentShareCodes, removeMascotFromLibrary, renameMascotFromLibrary,
  saveCurrentMascotToLibrary, setMascotCenterTab, showToast, useMascotFromLibrary, useApp,
} from '../app/store';

/**
 * 角色中心：**选取 / 制作 / 分享与获取**三页。
 *
 * ## 为什么要把入口收成一处
 *
 * 在这之前，和角色有关的操作散在三个地方：
 *   1. 外观 → 角色面板里的「更多功能」（导入、导出、编辑器、粘贴、说明书）；
 *   2. 右上角云弹层里的「云端角色」（上传、用分享码获取、公开）；
 *   3. 文件管理器里直接点开的 .json。
 * 于是"我想换一个角色"要先猜"这件事属于哪一块" —— 这正是用户说的"混乱"。
 * 现在按**他想干什么**分页：换一个（pick）/ 做一个（make）/ 和同学互相传（share）。
 *
 * ## 每页只留一条主路
 *
 * 每页顶上是一句话说明，下面是可点的行 —— 不做折叠、不做"更多"，
 * 因为这一页本身就是"更多"。
 */
export default function MascotCenterSheet() {
  const s = useApp();
  const tab = s.mascotCenter;
  const c = s.cloud;
  const me = c.session ? c.session.user.id : null;
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<string[]>(function () { return recentShareCodes(); });
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameText, setRenameText] = React.useState('');
  /* 粘贴角色包内容：相册里没有 .json 时这是唯一的路 */
  const [paste, setPaste] = React.useState(false);
  const [pasted, setPasted] = React.useState('');

  if (!tab) return null;
  const pack = s.mascot;
  const lib = mascotLibrary();
  const mine = c.mascots.filter(function (m) { return isMine(m, me); });
  /* 公开这个开关只对额度不设限的账号有意义（别人的角色只通过分享码流转） */
  const canPublish = !!(c.quota && c.quota.unlimited);
  const stage = c.mascotsStage;
  const stageText = stage === 'list' ? '正在读取云端…' : stage === 'download' ? '正在下载…'
    : stage === 'save' ? '正在保存…' : stage === 'upload' ? '正在上传…'
      : stage === 'share' ? '正在生成分享码…' : stage === 'delete' ? '正在删除…' : '';

  /* 前两页的公共头部：现在用的是哪个角色 */
  const hero = pack ? (
    <div className="mascot-hero">
      <div className="mascot-hero-stage">
        <MascotArt asset={pack.states.idle!} motion={pack.motion} phase="idle" size={64} shadow={pack.shadow} />
      </div>
      <div className="mascot-hero-meta">
        <div className="lr-label">正在用：{pack.name}</div>
        <div className="lr-sub">{pack.author ? pack.author + ' · ' : ''}{providedStates(pack).map(function (k) { return STATE_LABEL[k]; }).join(' / ')}</div>
      </div>
      <div className="lr-right"><MascotThumb asset={pack.states.idle} size={40} /></div>
    </div>
  ) : (
    <div className="panel-desc" style={{ paddingTop: 0 }}>本机还没有角色 —— 到「做一个」页导入或自己做一个。</div>
  );

  function pickLib(id: string): void {
    useMascotFromLibrary(id);
  }

  /** 用图或视频做角色：选文件 → 交给共用管线 → 摘要用提示条说一遍 */
  async function makeFromMedia(): Promise<void> {
    const f = await pickFile('image/*,video/*');
    if (!f) return;
    setBusy(true);
    try {
      const d = await importMascotMedia(f, s.prefs.mascot.size);
      if (d) setCodes(recentShareCodes());
    } finally {
      setBusy(false);
    }
  }

  async function makeFromPack(): Promise<void> {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setBusy(true);
    try {
      await importMascotPackFile(f);
    } finally {
      setBusy(false);
    }
  }

  function doUseCode(): void {
    setBusy(true);
    void cloudUseShareCode(code).then(function (ok) {
      setBusy(false);
      if (ok) {
        pushRecentShareCode(code);
        setCodes(recentShareCodes());
        setCode('');
      }
    });
  }

  return (
    <React.Fragment>
    <Sheet title="角色中心" onClose={closeMascotCenter}>
      <Segmented
        value={tab}
        options={[
          { value: 'pick', label: '换一个' },
          { value: 'make', label: '做一个' },
          { value: 'share', label: '分享与获取' },
        ]}
        onChange={function (v) { setMascotCenterTab(v); }}
      />

      {/* ------------------------------ 换一个 ------------------------------ */}
      {tab === 'pick' ? (
        <React.Fragment>
          {hero}
          <div className="section-title">我的角色库（{lib.length}）</div>
          {lib.length === 0 ? (
            <div className="list-row"><div className="lr-sub">还是空的。导入或从云端取回一个角色之后，点「存进角色库」就会留在这儿，以后一键切换。</div></div>
          ) : lib.map(function (e) {
            const using = !!pack && pack.name === e.name && providedStates(pack).length === providedStates(e.pack).length;
            return (
              <div className="action-item" key={e.id}>
                <div className="ai-head" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <MascotThumb asset={e.pack.states.idle} size={38} />
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  {renaming === e.id ? (
                    <input
                      className="input" style={{ height: 30 }} autoFocus value={renameText}
                      onChange={function (ev) { setRenameText(ev.target.value); }}
                      onBlur={function () { renameMascotFromLibrary(e.id, renameText); setRenaming(null); }}
                    />
                  ) : (
                    <div className="lr-label">{e.name}{using ? ' · 正在用' : ''}</div>
                  )}
                  <div className="ai-meta">{e.from || '本机'} · {new Date(e.addedAt).toLocaleDateString()}</div>
                </div>
                </div>
                <div className="ai-actions">
                  <button className="btn sm primary" disabled={using} onClick={function () { pickLib(e.id); }}>
                    {using ? '使用中' : '用这个'}
                  </button>
                  <button className="btn sm ghost" onClick={function () { setRenaming(e.id); setRenameText(e.name); }}>改名</button>
                  <button className="btn sm ghost" onClick={function () { removeMascotFromLibrary(e.id); setCodes(codes); }}>删除</button>
                </div>
              </div>
            );
          })}

          {pack ? (
            <div className="check-actions" style={{ borderTop: 0, paddingTop: 8 }}>
              <button className="btn sm" onClick={function () {
                const r = saveCurrentMascotToLibrary('本机');
                showToast(r.ok ? '已存进角色库，以后可以一键切回来' : (r.error || '没能存进角色库'), r.ok ? 'ok' : 'warn');
                if (r.ok && r.error) showToast(r.error, 'warn');
              }}>把当前角色存进角色库</button>
              <button className="btn sm ghost" onClick={function () { openMascotEditor('edit'); closeMascotCenter(); }}>调整这个角色</button>
            </div>
          ) : null}

          <div className="section-title">云端（{mine.length}{c.quota ? ' / ' + (c.quota.unlimited ? '不限' : c.quota.limit) : ''}）</div>
          {!cloudConfigured() ? (
            <div className="list-row"><div className="lr-sub">这个版本没有配置云功能，角色可以用角色包文件互传。</div></div>
          ) : !c.session ? (
            <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { closeMascotCenter(); openCloudSheet(); }}>
              <div>
                <div className="lr-label">登录后可以把角色存到云端</div>
                <div className="lr-sub">不登录也能用分享码取别人给的角色 —— 到「分享与获取」页</div>
              </div>
              <div className="lr-right">›</div>
            </div>
          ) : mine.length === 0 ? (
            <div className="list-row"><div className="lr-sub">云端还没有你的角色。到「分享与获取」页可以一键上传并生成分享码。</div></div>
          ) : mine.map(function (m) {
            return (
              <div className="action-item" key={m.id}>
                <div className="ai-head">
                  <div className="ai-title">
                    <span>{m.name}</span>
                    {m.share_code ? <span className="ai-tag on">已分享</span> : null}
                    {m.is_public ? <span className="ai-tag on">公开</span> : null}
                  </div>
                  <div className="ai-meta">
                    {describeSize(m.size_bytes)}
                    {m.share_code ? <span> · 分享码 <b className="ai-code">{m.share_code}</b></span> : null}
                  </div>
                </div>
                <div className="ai-actions">
                  <button className="btn sm primary" disabled={busy} onClick={function () { setBusy(true); void cloudUseMascot(m).then(function () { setBusy(false); }); }}>用这个</button>
                  <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudShareMascot(m); }}>{m.share_code ? '分享码' : '分享'}</button>
                  {/*
                    公开：只有额度不设限的账号会看到（也就是作者自己）。
                    服务端不放宽任何权限，客户端按 profiles.unlimited_mascots 决定显不显示。
                    v1.9.6 把它落在「角色中心」之外了 —— 从新入口进来的人找不到这个开关，
                    于是"公开功能不见了"。这里补回来，和云弹层里那一份是同一个接口。
                  */}
                  {canPublish ? (
                    <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudSetMascotPublic(m, !m.is_public); }}>
                      {m.is_public ? '取消公开' : '公开'}
                    </button>
                  ) : null}
                  <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudDeleteMascot(m); }}>删除</button>
                </div>
              </div>
            );
          })}
          <div className="panel-desc">
            列表看的是服务器上的那一份；「用这个」会把它下载到本机（会先问一句，因为本机那个会被替换）。
            {stageText ? ' ' + stageText : ''}
            {c.mascotsError ? <span style={{ color: 'var(--c-danger)' }}> {c.mascotsError}</span> : null}
          </div>
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 6 }}>
            <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudLoadMascots(true); }}>
              {stage === 'list' ? '读取中…' : '刷新云端列表'}
            </button>
          </div>
        </React.Fragment>
      ) : null}

      {/* ------------------------------ 做一个 ------------------------------ */}
      {tab === 'make' ? (
        <React.Fragment>
          <div className="panel-desc" style={{ paddingTop: 0 }}>
            一个角色就是几张图（待机 / 走路 / 睡觉 / 点击反应）加一点动作参数。
            没有现成素材也行 —— 用一张图就能当角色。
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openMascotEditor('new'); closeMascotCenter(); }}>
            <div>
              <div className="lr-label">从头做一个（推荐）</div>
              <div className="lr-sub">填表：选图、调动作、实时预览，做完直接生效</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void makeFromMedia(); }}>
            <div>
              <div className="lr-label">用一张图或一段视频</div>
              <div className="lr-sub">图片直接当角色；视频（webm / mp4）会自动抽帧做成逐帧动图</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void makeFromPack(); }}>
            <div>
              <div className="lr-label">导入角色包（.json）</div>
              <div className="lr-sub">同学发的角色包文件；相册里找不到 .json 时用下面那条</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { setPaste(true); }}>
            <div>
              <div className="lr-label">粘贴角色包内容</div>
              <div className="lr-sub">把对方发来的整段内容复制进来即可</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          {pack ? (
            <React.Fragment>
              <div className="section-title">已经在用的这个</div>
              <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openMascotEditor('edit'); closeMascotCenter(); }}>
                <div>
                  <div className="lr-label">编辑「{pack.name}」</div>
                  <div className="lr-sub">改素材、动作、大小，改完保存就生效</div>
                </div>
                <div className="lr-right">›</div>
              </div>
            </React.Fragment>
          ) : null}
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { closeMascotCenter(); openManual('mascot'); }}>
            <div>
              <div className="lr-label">使用说明书 · 角色</div>
              <div className="lr-sub">怎么做角色包、视频怎么用、常见错误</div>
            </div>
            <div className="lr-right">›</div>
          </div>
        </React.Fragment>
      ) : null}

      {/* ------------------------------ 分享与获取 ------------------------------ */}
      {tab === 'share' ? (
        <React.Fragment>
          <div className="panel-desc" style={{ paddingTop: 0 }}>
            <b>拿到码的人不需要注册、也不需要知道你是谁</b> —— 码本身就是凭据。
            码是 6–12 位字母数字，可以随时停止分享让它作废。
          </div>

          <div className="section-title">获取别人的角色</div>
          <div style={{ padding: '0 14px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input" style={{ flex: '1 1 auto', textTransform: 'uppercase', letterSpacing: '.08em' }}
              placeholder="粘贴分享码，例如 7KQ2M9XF" maxLength={12} spellCheck={false} autoComplete="off"
              value={code}
              onChange={function (e) { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }}
            />
            <button className="btn sm primary" disabled={busy || code.length < 6} onClick={doUseCode}>
              {stage === 'download' || stage === 'save' ? '获取中…' : '获取'}</button>
          </div>
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 0 }}>
            <button className="btn sm ghost" onClick={function () {
              void (async function () {
                try {
                  const t = await navigator.clipboard.readText();
                  const clean = (t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
                  if (clean.length >= 6) { setCode(clean); showToast('已从剪贴板读入', 'ok'); }
                  else showToast('剪贴板里没有像分享码的内容', 'info');
                } catch (e) { showToast('读不到剪贴板 —— 手动输一下码，或者长按输入框粘贴', 'info'); }
              })();
            }}>从剪贴板读取</button>
          </div>
          {codes.length > 0 ? (
            <React.Fragment>
              <div className="section-title">最近用过的码</div>
              {codes.map(function (x) {
                return (
                  <div className="action-item" key={x}>
                    <div className="ai-head">
                      <div className="ai-title"><span className="ai-code" style={{ letterSpacing: '.12em' }}>{x}</span></div>
                    </div>
                    <div className="ai-actions">
                      <button className="btn sm" disabled={busy} onClick={function () { setCode(x); }}>填到上面</button>
                      <button className="btn sm ghost" onClick={function () { forgetRecentShareCode(x); setCodes(recentShareCodes()); }}>忘掉</button>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ) : null}

          <div className="section-title">把我的角色分享出去</div>
          {hero}
          <div style={{ padding: '0 14px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input" style={{ flex: '1 1 auto' }} maxLength={40}
              placeholder={pack ? pack.name : '先做一个角色'} value={name}
              onChange={function (e) { setName(e.target.value); }}
            />
            <button
              className="btn sm primary" disabled={busy || !pack}
              onClick={function () {
                setBusy(true);
                void cloudShareCurrent(name || (pack ? pack.name : '')).then(function (ok) {
                  setBusy(false);
                  if (ok) { setCodes(recentShareCodes()); showToast('分享码已生成', 'ok'); }
                });
              }}
            >{stage === 'upload' || stage === 'share' ? '处理中…' : '上传并生成分享码'}</button>
          </div>
          <div className="panel-desc">
            {!cloudConfigured()
              ? '这个版本没有配置云功能 —— 用下面的「导出角色包」发文件即可。'
              : !c.session
                ? '上传需要一个账号（用来把角色挂在你名下）。不想注册就导出角色包发文件。'
                : c.quota ? '云端角色：' + cloudQuotaLine() : '正在读取云端状态…'}
          </div>
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 0 }}>
            {!c.session && cloudConfigured() ? (
              <button className="btn sm ghost" onClick={function () { closeMascotCenter(); openCloudSheet(); }}>去登录</button>
            ) : null}
            <button className="btn sm ghost" disabled={!pack} onClick={function () { void exportMascotPackFile(); }}>导出角色包文件</button>
            {pack ? (
              <button className="btn sm ghost" onClick={function () {
                const code2 = (mine.filter(function (m) { return m.name === pack.name && m.share_code; })[0] || {}).share_code || '';
                if (!code2) { showToast('还没有这个角色的分享码 —— 先点上面的「上传并生成分享码」', 'info'); return; }
                void copyShareText(code2, pack.name).then(function (ok) {
                  showToast(ok ? '已复制，粘给同学就行' : '复制失败，长按分享码手动复制', ok ? 'ok' : 'warn');
                });
              }}>复制成一段话</button>
            ) : null}
          </div>
          <div className="panel-desc" style={{ paddingTop: 10 }}>
            角色包只包含图片素材与动作参数，<b>不会执行任何代码</b>；
            用别人的角色等于把那份素材存到本机。想留着自己以后用，点「换一个」页的「存进角色库」。
          </div>
        </React.Fragment>
      ) : null}
    </Sheet>

    {/* 粘贴角色包内容：相册里没有 .json 时唯一的路（与面板里那条是同一个动作） */}
      {paste ? (
        <Sheet className="picker-layer" title="粘贴角色包内容" onClose={function () { setPaste(false); }}>
          <div className="panel-desc" style={{ paddingTop: 0 }}>
            把同学发来的整段内容复制进来。它是角色包（JSON），粘错了会明确告诉你哪里不对。
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <textarea
              className="input" style={{ width: '100%', minHeight: 120, paddingTop: 8, fontFamily: 'monospace', fontSize: 'var(--fs-xs)' }}
              placeholder='{ "format": "timetable-mascot", ... }'
              value={pasted}
              onChange={function (e) { setPasted(e.target.value); }}
            />
          </div>
          <div className="check-actions" style={{ borderTop: 0, paddingTop: 0 }}>
            <button
              className="btn sm primary" disabled={pasted.trim().length < 8}
              onClick={function () {
                const r = importMascotPack(pasted, '粘贴的角色包');
                if (!r.ok) { showToast('没读进来：' + r.error, 'error'); return; }
                setPaste(false);
                setPasted('');
                showToast('角色已就位' + (r.warnings.length ? '（' + r.warnings.length + ' 条提示）' : ''), 'ok');
              }}
            >装到本机</button>
            <button className="btn sm ghost" onClick={function () { setPaste(false); }}>取消</button>
          </div>
        </Sheet>
      ) : null}
    </React.Fragment>
  );
}