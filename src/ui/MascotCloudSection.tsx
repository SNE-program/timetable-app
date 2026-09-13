import React from 'react';
import { Icon } from './icons';
import { describeSize } from '../cloud/backup';
import { MAX_MASCOT_BYTES, estimateMascotBytes, formatMb, isMine } from '../cloud/mascots';
import {
  cloudDeleteMascot, cloudLoadMascots, cloudQuotaLine, cloudSetMascotPublic, cloudShareMascot,
  cloudUploadMascot, cloudUseMascot, cloudUseShareCode, useApp,
} from '../app/store';

/**
 * 云端角色（放在右上角那个云弹层里）。
 *
 * ## 四条产品决定，写在这里免得以后被「优化」掉
 *
 * 1. **没有账号也能用**：拿到分享码的人不需要注册 —— 云备份是可选功能，
 *    不该因为「想用同学做的角色」而被迫注册。
 * 2. **配额写在数据库里**：这里显示的 "2 / 2" 只是提前提醒；真正拦住的是触发器。
 * 3. **上传的是「当前这个角色」**：不做多选、不做批量 —— 一个人最多存两个。
 * 4. **分享靠分享码，不靠「公开」**：公开是把角色挂到一个谁都能翻的列表里，
 *    而实际需求几乎都是「发给某个同学」。所以默认的分享方式是**码**：
 *    6–12 位、只有拿到的人能用、随时可以作废。「公开」这个开关只留给
 *    额度不设限的账号（也就是项目作者自己）。
 */
export default function MascotCloudSection() {
  const s = useApp();
  const c = s.cloud;
  const me = c.session ? c.session.user.id : null;
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const stage = c.mascotsStage;
  const busy = stage !== '';

  /*
   * 正在忙什么，就说出来是什么。
   *
   * 以前这里只有一个「…」，传一个 3 MB 的角色包时，用户分不清它是在下载、
   * 在存盘、还是已经死了 —— 于是「很卡」里有一部分其实是「不知道在干嘛」。
   */
  const stageText = stage === 'list' ? '正在读取云端列表…'
    : stage === 'download' ? '正在下载角色包…'
      : stage === 'save' ? '正在保存到本机…'
        : stage === 'upload' ? '正在上传角色包…'
          : stage === 'share' ? '正在生成分享码…'
            : stage === 'delete' ? '正在删除…' : '';

  /*
   * 拉列表不在这里发起：右上角的云入口（openCloudSheet）已经发了，
   * 而且 store 里做了并发去重与一分钟缓存 —— 两个入口各发一次是纯粹的浪费。
   */
  React.useEffect(function () {
    if (!c.mascotsLoaded) void cloudLoadMascots();
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 只在没数据时拉一次 */
  }, []);

  const mine = c.mascots.filter(function (m) { return isMine(m, me); });
  /* 公开列表只对「额度不设限」的账号有意义 —— 别人的角色只通过分享码流转 */
  const canPublish = !!(c.quota && c.quota.unlimited);
  const others = canPublish ? c.mascots.filter(function (m) { return m.is_public && !isMine(m, me); }) : [];
  const localPack = s.mascot;

  const localSize = React.useMemo(function () {
    if (!localPack) return null;
    /* 只做加法，不序列化整包 —— 打开面板不该因为「量体积」而顿一下 */
    try { return estimateMascotBytes(localPack); } catch (e) { return null; }
  }, [localPack]);
  const tooBig = !!localSize && localSize.bytes > MAX_MASCOT_BYTES;

  return (
    <div>
      <div className="panel-desc" style={{ paddingTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <b>我的角色（{mine.length}）</b>
        <span style={{ flex: '1 1 auto' }}>
          {stageText
            ? stageText
            : c.session ? (cloudQuotaLine() || '正在读取…') : '未登录也能用分享码；登录后才能传自己的'}
        </span>
        <button className="btn sm" disabled={busy} onClick={function () { void cloudLoadMascots(true); }}>
          {stage === 'list' ? '…' : '刷新'}
        </button>
      </div>

      {/* ------------------------------ 用分享码获取 ------------------------------ */}
      <div className="panel-desc" style={{ paddingTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="globe" size={14} />
        <b>用分享码获取</b>
        <span style={{ flex: '1 1 auto' }}>粘贴对方给的码即可获取</span>
      </div>
      <div style={{ padding: '0 14px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input" style={{ flex: '1 1 auto', textTransform: 'uppercase', letterSpacing: '.08em' }}
          placeholder="例如 7KQ2M9XF" maxLength={12} spellCheck={false} autoComplete="off"
          value={code}
          onChange={function (e) { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }}
        />
        <button
          className="btn sm primary" disabled={busy || code.length < 6}
          onClick={function () { void cloudUseShareCode(code).then(function (ok) { if (ok) setCode(''); }); }}
        >{stage === 'download' || stage === 'save' ? '获取中…' : '获取'}</button>
      </div>

      {/* ------------------------------ 上传 ------------------------------ */}
      <div className="list-row">
        <div>
          <div className="lr-label">把当前角色传到云端</div>
          <div className="lr-sub">
            {!localPack
              ? '本机还没有角色：先到 外观 → 角色 里做一个或导入一个'
              : tooBig
                ? '当前：' + localPack.name + ' · ' + formatMb(localSize!.bytes) + ' —— 超过 ' + formatMb(MAX_MASCOT_BYTES) + ' 上限，先把素材压小一点'
                : '当前：' + localPack.name
                  + (localSize ? ' · ' + formatMb(localSize.bytes) : '')
                  + '（含素材一起传，换设备直接就能用；单个上限 ' + formatMb(MAX_MASCOT_BYTES) + '）'}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 14px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input" style={{ flex: '1 1 auto' }} maxLength={40}
          placeholder={localPack ? localPack.name : '给它起个名字'}
          value={name} onChange={function (e) { setName(e.target.value); }}
        />
        <button
          className="btn sm primary" disabled={busy || !localPack || !c.session || tooBig}
          onClick={function () { void cloudUploadMascot(name || (localPack ? localPack.name : ''), false); }}
        >{stage === 'upload' ? '上传中…' : '上传'}</button>
      </div>

      {c.mascotsError ? (
        <div className="panel-desc" style={{ color: 'var(--c-danger)' }}>{c.mascotsError}</div>
      ) : null}

      {/* ------------------------------ 我的角色列表 ------------------------------ */}
      {mine.length === 0 ? (
        <div className="panel-desc">{c.session ? '云端还没有你的角色。' : '登录之后就能把自己做的角色存到这里。'}</div>
      ) : mine.map(function (m) {
        return (
          <div className="list-row" key={m.id}>
            <div>
              <div className="lr-label">
                {m.name}
                {m.share_code ? ' · 已分享' : ''}
                {m.is_public ? ' · 公开' : ''}
              </div>
              <div className="lr-sub">
                {describeSize(m.size_bytes)}
                {m.share_code ? ' · 分享码 ' + m.share_code : ''}
              </div>
            </div>
            <div className="lr-right" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn sm" disabled={busy} onClick={function () { void cloudUseMascot(m); }}>
                {stage === 'download' ? '下载中' : stage === 'save' ? '保存中' : '使用'}
              </button>
              <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudShareMascot(m); }}>
                {m.share_code ? '分享码' : '分享'}
              </button>
              {canPublish ? (
                <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudSetMascotPublic(m, !m.is_public); }}>
                  {m.is_public ? '取消公开' : '公开'}
                </button>
              ) : null}
              <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudDeleteMascot(m); }}>
                {stage === 'delete' ? '删除中' : '删除'}
              </button>
            </div>
          </div>
        );
      })}

      {/* 公开列表：只有额度不设限的账号会用（他自己放出去的角色） */}
      {canPublish ? (
        <React.Fragment>
          <div className="panel-desc" style={{ paddingTop: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="globe" size={14} /> 公开角色（{others.length}）
          </div>
          {others.length === 0 ? (
            <div className="panel-desc">还没有公开的角色。公开是给「想让所有人都能用」准备的；只想给某个同学，用分享码更省事。</div>
          ) : others.map(function (m) {
            return (
              <div className="list-row" key={m.id}>
                <div>
                  <div className="lr-label">{m.name}</div>
                  <div className="lr-sub">公开的 · {describeSize(m.size_bytes)}</div>
                </div>
                <div className="lr-right">
                  <button className="btn sm primary" disabled={busy} onClick={function () { void cloudUseMascot(m); }}>
                    {stage === 'download' ? '下载中' : stage === 'save' ? '保存中' : '使用'}
                  </button>
                </div>
              </div>
            );
          })}
        </React.Fragment>
      ) : null}

      <div className="panel-desc" style={{ paddingTop: 8 }}>
        角色包只包含图片素材与动作参数，<b>不会执行任何代码</b>；用别人的角色等于把那份素材存到本机。
        <b>分享码</b>是 6–12 位字母数字：只有拿到码的人能取到那一个角色，随时可以停止分享让它作废。
      </div>
    </div>
  );
}
