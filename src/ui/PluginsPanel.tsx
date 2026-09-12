import React from 'react';
import { Panel } from './common';
import { showToast } from '../app/store';
import {
  grantPermissions, installPlugin, listPlugins, setPluginEnabled, uninstallPlugin,
} from '../plugins/host';
import { PERMISSION_LABEL, type InstalledPlugin, type PluginPermission } from '../plugins/types';

/**
 * 插件管理。
 *
 * 界面上刻意把"这个插件能做什么"写得比"它叫什么"更显眼 —— 用户装插件时
 * 真正需要判断的是后者。权限逐项列出来并且要手动勾，勾了才生效。
 */
export default function PluginsPanel() {
  const [tick, setTick] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const list = listPlugins();

  function refresh(): void { setTick(tick + 1); }

  function toggleEnabled(p: InstalledPlugin): void {
    setPluginEnabled(p.manifest.id, !p.enabled);
    refresh();
  }

  function togglePerm(p: InstalledPlugin, perm: PluginPermission): void {
    const has = p.granted.indexOf(perm) >= 0;
    const next = has
      ? p.granted.filter(function (x) { return x !== perm; })
      : p.granted.concat([perm]);
    grantPermissions(p.manifest.id, next);
    refresh();
  }

  async function install(file: File): Promise<void> {
    setBusy(true);
    try {
      const text = await file.text();
      /* 先干跑一遍校验，好把"这个插件要读你的课表"提前告诉用户 */
      const probe = installPlugin(text, []);
      if (!probe.ok) { showToast('装不上：' + probe.error, 'error'); return; }
      const granted: PluginPermission[] = ['read:timetable'];
      installPlugin(text, granted);
      showToast('已安装插件，默认已授权读取课表（可在下面关掉）', 'ok');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="插件"
      sub={list.length + ' 个'}
      collapsible
      desc="插件只提供「声明式」的扩展（目前只有导出格式）：它告诉应用导出哪些列、导出哪一段，不会执行任何第三方代码。"
    >
      {list.map(function (p) {
        const active = p.enabled && p.manifest.permissions.every(function (n) { return p.granted.indexOf(n) >= 0; });
        return (
          <div className="plugin-card" key={p.manifest.id}>
            <div className="plugin-head">
              <div className="plugin-title">
                {p.manifest.name}
                {p.builtin ? <span className="plugin-badge">内置</span> : null}
              </div>
              <div className={p.enabled ? 'switch on' : 'switch'} onClick={function () { toggleEnabled(p); }} />
            </div>
            {p.manifest.description ? <div className="plugin-desc">{p.manifest.description}</div> : null}
            <div className="plugin-meta">
              {p.manifest.author ? p.manifest.author + ' · ' : ''}
              {p.manifest.capabilities.length} 项能力
              {p.manifest.pluginVersion ? ' · v' + p.manifest.pluginVersion : ''}
              {!active && p.enabled ? ' · 权限未授予，暂不生效' : ''}
            </div>

            {p.manifest.permissions.length > 0 ? (
              <div className="plugin-perms">
                {p.manifest.permissions.map(function (perm) {
                  const on = p.granted.indexOf(perm) >= 0;
                  return (
                    <div className="plugin-perm" key={perm} onClick={function () { if (!p.builtin) togglePerm(p, perm); }}>
                      <span className={on ? 'task-check on' : 'task-check'} style={{ width: 18, height: 18 }}>
                        {on ? '✓' : ''}
                      </span>
                      <span className="plugin-perm-text">{PERMISSION_LABEL[perm]}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="plugin-caps">
              {p.manifest.capabilities.map(function (c) {
                return <span className="chip" key={c.id}>{c.type === 'export' ? (c.format === 'csv' ? 'CSV' : 'Markdown') + ' · ' + c.name : c.name}</span>;
              })}
            </div>

            {!p.builtin ? (
              <button
                className="btn sm ghost plugin-remove"
                onClick={function () {
                  uninstallPlugin(p.manifest.id);
                  showToast('已卸载「' + p.manifest.name + '」', 'ok');
                  refresh();
                }}
              >卸载</button>
            ) : null}
          </div>
        );
      })}

      <div className="check-actions">
        <button className="btn sm" disabled={busy} onClick={function () { if (fileRef.current) fileRef.current.click(); }}>
          {busy ? '安装中…' : '从文件安装插件'}
        </button>
        <input
          ref={fileRef} type="file" accept=".json,.tbplugin,application/json" style={{ display: 'none' }}
          onChange={function (e) {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) void install(f);
          }}
        />
      </div>

      <div className="panel-desc" style={{ paddingTop: 4 }}>
        插件包是一个 <b>.json</b> 文件，开头写着 <code>format: "timetable-plugin"</code>。
        这个版本不支持执行第三方代码 —— 那需要真正的沙箱，而不是在主进程里 eval，
        是另一个量级的工程。
      </div>
    </Panel>
  );
}
