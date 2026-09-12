import React from 'react';
import { Icon } from './icons';
import { describeSize } from '../cloud/backup';
import { isMine } from '../cloud/mascots';
import {
  cloudDeleteMascot, cloudLoadMascots, cloudQuotaLine, cloudSetMascotPublic, cloudUploadMascot, cloudUseMascot, useApp,
} from '../app/store';

/**
 * 云端角色（放在右上角那个云弹层里）。
 *
 * 三条产品决定，都写在这里免得以后被"优化"掉：
 *
 * 1. **没有角色也能看**：公开的角色对任何人可见（连没登录的人也能看），
 *    这是"把自己的设计公开给别人用"的另一半 —— 只给登录用户看等于没公开。
 * 2. **配额写在数据库里**：这里显示的 "2 / 2" 只是提前提醒；真正拦住的是触发器。
 * 3. **上传的是"当前这个角色"**：不做多选、不做批量 —— 一个人最多存两个，
 *    多选界面纯属给自己找麻烦。
 */
export default function MascotCloudSection() {
  const s = useApp();
  const c = s.cloud;
  const me = c.session ? c.session.user.id : null;
  const [name, setName] = React.useState('');
  const [pub, setPub] = React.useState(false);
  const busy = c.mascotsBusy;

  React.useEffect(function () {
    if (!c.mascotsLoaded) void cloudLoadMascots();
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 只在没数据时拉一次 */
  }, []);

  const mine = c.mascots.filter(function (m) { return isMine(m, me); });
  const others = c.mascots.filter(function (m) { return m.is_public && !isMine(m, me); });
  const localPack = s.mascot;

  return (
    <div>
      <div className="list-row">
        <div className={'dot ' + (c.quota && c.quota.unlimited ? 'ok' : 'warn')} />
        <div>
          <div className="lr-label">云端角色</div>
          <div className="lr-sub">{c.session ? (cloudQuotaLine() || '正在读取配额…') : '未登录：可以看公开角色，登录后才能上传自己的'}</div>
        </div>
        <div className="lr-right">
          <button className="btn sm" disabled={busy} onClick={function () { void cloudLoadMascots(); }}>
            {busy ? '…' : '刷新'}
          </button>
        </div>
      </div>

      {/* 上传 */}
      <div className="list-row">
        <div>
          <div className="lr-label">把当前角色传到云端</div>
          <div className="lr-sub">
            {localPack
              ? '当前：' + localPack.name + '（含素材一起传，换设备直接就能用）'
              : '本机还没有角色：先到 外观 → 角色 里做一个或导入一个'}
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
          className="btn sm primary" disabled={busy || !localPack || !c.session}
          onClick={function () { void cloudUploadMascot(name || (localPack ? localPack.name : ''), pub); }}
        >{busy ? '上传中…' : '上传'}</button>
      </div>
      <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { setPub(!pub); }}>
        <div>
          <div className="lr-label">公开这个角色</div>
          <div className="lr-sub">公开后任何人都能在「公开角色」里看到并使用它；随时可以取消</div>
        </div>
        <div className="lr-right">{pub ? '已设为公开' : '仅自己可见'}</div>
      </div>

      {c.mascotsError ? (
        <div className="panel-desc" style={{ color: 'var(--c-danger)' }}>{c.mascotsError}</div>
      ) : null}

      {/* 我的角色 */}
      <div className="panel-desc" style={{ paddingTop: 8, fontWeight: 700 }}>我的角色（{mine.length}）</div>
      {mine.length === 0 ? (
        <div className="panel-desc">{c.session ? '云端还没有你的角色。' : '登录之后就能把自己做的角色存到这里。'}</div>
      ) : mine.map(function (m) {
        return (
          <div className="list-row" key={m.id}>
            <div>
              <div className="lr-label">{m.name}{m.is_public ? ' · 公开' : ''}</div>
              <div className="lr-sub">{describeSize(m.size_bytes)}</div>
            </div>
            <div className="lr-right" style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" disabled={busy} onClick={function () { void cloudUseMascot(m); }}>使用</button>
              <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudSetMascotPublic(m, !m.is_public); }}>
                {m.is_public ? '取消公开' : '公开'}
              </button>
              <button className="btn sm ghost" disabled={busy} onClick={function () { void cloudDeleteMascot(m); }}>删除</button>
            </div>
          </div>
        );
      })}

      {/* 公开角色 */}
      <div className="panel-desc" style={{ paddingTop: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="globe" size={14} /> 公开角色（{others.length}）
      </div>
      {others.length === 0 ? (
        <div className="panel-desc">还没有别人公开的角色。你可以在上面把自己的设为公开，让别人也能用。</div>
      ) : others.map(function (m) {
        return (
          <div className="list-row" key={m.id}>
            <div>
              <div className="lr-label">{m.name}</div>
              <div className="lr-sub">{describeSize(m.size_bytes)}</div>
            </div>
            <div className="lr-right">
              <button className="btn sm primary" disabled={busy} onClick={function () { void cloudUseMascot(m); }}>使用</button>
            </div>
          </div>
        );
      })}

      <div className="panel-desc" style={{ paddingTop: 8 }}>
        角色包只包含图片素材与动作参数，**不会执行任何代码**；用别人的角色等于把那份素材存到本机。
        别人公开的角色，只有你点「使用」时才会下载。
      </div>
    </div>
  );
}
