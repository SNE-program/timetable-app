import React from 'react';
import { Panel } from './common';
import { showToast } from '../app/store';
import {
  HOST_API_VERSION, grantPermissions, installPlugin, lastLoadIssues, listPlugins, parseManifest,
  resolveExportColumns, resolveExportFileName, setPluginEnabled, settingsCapability, uninstallPlugin,
} from '../plugins/host';
import {
  PERMISSION_LABEL, type InstalledPlugin, type PluginPermission, type SettingField, type SettingValue,
} from '../plugins/types';
import { readSettings, resetSettings, writeSetting } from '../plugins/settings';
import { APP_VERSION } from '../app/version';
import { reloadPluginCommands } from '../app/builtinCommands';
import { COLUMN_LABEL, SCOPE_LABEL, type ExportColumn } from '../core/exporters';

/** 格式的中文名（插件面板上显示用） */
const FORMAT_LABEL: Record<string, string> = {
  csv: 'CSV 表格', markdown: 'Markdown', json: 'JSON', text: '纯文本',
};

/**
 * 一个插件的设置表单。
 *
 * 渲染**全部由宿主负责**：插件只声明字段，控件、校验、存储都是应用自己的东西。
 * 这样插件不可能做出"一个看起来像系统弹窗的输入框"这种事 ——
 * 而这正是"插件是纯数据"能兑现的界面层承诺。
 */
function PluginSettings(props: {
  plugin: InstalledPlugin;
  /** 值变了之后让外层重算（导出预览要跟着变） */
  onChange: () => void;
}) {
  const cap = settingsCapability(props.plugin.manifest);
  /*
   * 停用或未授权时**不显示表单**：插件此刻不生效，让用户去改一组不起作用的参数
   * 只会制造"我改了怎么没反应"。
   */
  if (!cap) return null;
  const values = readSettings(props.plugin.manifest.id, cap);

  function set(f: SettingField, v: SettingValue): void {
    if (writeSetting(props.plugin.manifest.id, f, v)) props.onChange();
  }

  return (
    <div className="plugin-settings">
      <div className="plugin-settings-title">{cap.name || '设置'}</div>
      {cap.hint ? <div className="plugin-desc">{cap.hint}</div> : null}
      {cap.fields.map(function (f) {
        const v = values[f.key];
        if (f.type === 'bool') {
          return (
            <div className="plugin-field" key={f.key}>
              <div className="plugin-field-text">
                <div className="plugin-field-label">{f.label}</div>
                {f.hint ? <div className="plugin-field-hint">{f.hint}</div> : null}
              </div>
              <div className={v ? 'switch on' : 'switch'} onClick={function () { set(f, !v); }} />
            </div>
          );
        }
        if (f.type === 'text') {
          return (
            <div className="plugin-field column" key={f.key}>
              <div className="plugin-field-text">
                <div className="plugin-field-label">{f.label}</div>
                {f.hint ? <div className="plugin-field-hint">{f.hint}</div> : null}
              </div>
              <input
                className="input"
                value={String(v)}
                placeholder={f.placeholder}
                maxLength={f.maxLength || 200}
                onChange={function (e) { set(f, e.target.value); }}
              />
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <div className="plugin-field column" key={f.key}>
              <div className="plugin-field-text">
                <div className="plugin-field-label">{f.label}</div>
                {f.hint ? <div className="plugin-field-hint">{f.hint}</div> : null}
              </div>
              <input
                className="input" type="number" value={Number(v)}
                min={f.min} max={f.max} step={f.step}
                onChange={function (e) {
                  const n = Number(e.target.value);
                  if (isFinite(n)) set(f, n);
                }}
              />
            </div>
          );
        }
        /* multi：一行一项的勾选，和权限那一排同一种控件（用户不用学第二套） */
        const picked = Array.isArray(v) ? v : [];
        return (
          <div className="plugin-field column" key={f.key}>
            <div className="plugin-field-text">
              <div className="plugin-field-label">{f.label}</div>
              <div className="plugin-field-hint">
                {f.hint || '勾选的会按这里的顺序出现在导出里'}
                {f.max ? '（最多 ' + f.max + ' 项）' : ''}
              </div>
            </div>
            <div className="plugin-perms">
              {f.options.map(function (opt) {
                const on = picked.indexOf(opt) >= 0;
                /* 选项是列 id 时显示中文列名；不是列（插件自定义的键）就原样显示 */
                const text = (COLUMN_LABEL as Record<string, string>)[opt] || opt;
                return (
                  <div
                    className="plugin-perm" key={opt}
                    onClick={function () {
                      if (on) set(f, picked.filter(function (x) { return x !== opt; }));
                      else if (!f.max || picked.length < f.max) set(f, picked.concat([opt]));
                    }}
                  >
                    <span className={on ? 'task-check on' : 'task-check'} style={{ width: 18, height: 18 }}>
                      {on ? '✓' : ''}
                    </span>
                    <span className="plugin-perm-text">{text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="plugin-field-actions">
        <button
          className="btn sm ghost"
          onClick={function () {
            resetSettings(props.plugin.manifest.id);
            props.onChange();
          }}
        >恢复默认</button>
      </div>
    </div>
  );
}

/**
 * "这次导出会怎么做" —— 把设置的结果**当场算出来给用户看**。
 *
 * 为什么要有它：设置里的勾选与"导出成什么样"之间隔着一段逻辑（哪几列、什么文件名），
 * 光看勾选框用户判断不了自己改对了没有。这里直接显示最终结果，
 * 顺带也是这套功能的**自证**：显示的和导出的必须是同一个函数算出来的。
 */
function ExportOutcome(props: { plugin: InstalledPlugin }) {
  const rows = props.plugin.manifest.capabilities.filter(function (c) { return c.type === 'export'; });
  const cap = rows[0];
  if (!cap || cap.type !== 'export') return null;
  if (!cap.columnsFrom && !cap.fileNameFrom) return null;
  const cols = resolveExportColumns(props.plugin.manifest, cap);
  const name = resolveExportFileName(props.plugin.manifest, cap);
  return (
    <div className="plugin-outcome">
      这次导出会用：
      {cols.map(function (c) { return (COLUMN_LABEL as Record<string, string>)[c as ExportColumn] || c; }).join(' · ')}
      {name ? '，文件名 ' + name : ''}
    </div>
  );
}

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
  /* 读取时被丢掉的畸形记录（篡改、旧版残留）—— 读取时是复校验的，这里如实告诉用户 */
  const issues = React.useMemo(function () { return lastLoadIssues(); }, [tick]);

  function refresh(): void { setTick(tick + 1); }

  /** 版本号比较：'1.10' > '1.9'（按段比数字，不做字符串比较） */
  function compareVersion(a: string, b: string): number {
    const pa = a.split('.').map(function (x) { return Number(x) || 0; });
    const pb = b.split('.').map(function (x) { return Number(x) || 0; });
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function toggleEnabled(p: InstalledPlugin): void {
    setPluginEnabled(p.manifest.id, !p.enabled);
    /* 停用/启用会改变"这个插件提供哪些命令"，命令表要跟着重算 */
    reloadPluginCommands();
    refresh();
  }

  function togglePerm(p: InstalledPlugin, perm: PluginPermission): void {
    const has = p.granted.indexOf(perm) >= 0;
    const next = has
      ? p.granted.filter(function (x) { return x !== perm; })
      : p.granted.concat([perm]);
    grantPermissions(p.manifest.id, next);
    /* 撤权之后这个插件的命令不该再能被触发 */
    reloadPluginCommands();
    refresh();
  }

  async function install(file: File): Promise<void> {
    setBusy(true);
    try {
      const text = await file.text();
      /*
       * 先**只校验不安装**。
       *
       * 这里原来调的是 installPlugin(text, []) —— 名字叫"干跑"，其实是真安装：
       * 它已经把插件写进 localStorage 了，后面那句"装不上"只对校验失败的情况成立。
       * 于是用户点了一次、界面上什么都没说，重启之后却多出一个插件。
       * 现在改用 parseManifest：纯函数、不碰存储。
       */
      const probe = parseManifest(text);
      if (!probe.ok) { showToast('装不上：' + probe.error, 'error'); return; }
      /*
       * 默认**不授予任何权限**。
       *
       * 原来这里写死 granted = ['read:timetable']，与插件契约里"默认未授予、勾了才生效"
       * 的说法直接矛盾 —— 用户以为自己在控制权限，其实装上的那一刻就已经放行了。
       * 现在装上是"已安装但未生效"，下面权限那一行勾上才开始工作。
       */
      const r = installPlugin(text, []);
      if (!r.ok) { showToast('装不上：' + r.error, 'error'); return; }
      showToast('已安装「' + probe.manifest.name + '」。它还不能读取课表 —— 在下面勾上权限才会生效', 'ok');
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
              {' · 接口 v' + (p.manifest.apiVersion || 1)}
              {!active && p.enabled ? ' · 权限未授予，暂不生效' : ''}
            </div>
            {/*
              最低应用版本：插件声明它需要多新的应用。
              不满足时**明说**而不是让它装上去表现异常 —— 那种"装了但列不对"最难查。
            */}
            {p.manifest.minAppVersion && compareVersion(APP_VERSION, p.manifest.minAppVersion) < 0 ? (
              <div className="plugin-desc" style={{ color: 'var(--c-danger)' }}>
                这个插件要求应用版本 ≥ {p.manifest.minAppVersion}，当前是 {APP_VERSION || '未知'} —— 升级应用后再用。
              </div>
            ) : null}

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
                /*
                 * 能力的标签要把"导出什么、导成什么"说全：
                 * 只看名字（"导出本周"）看不出它是 CSV 还是 JSON、是课表还是任务清单。
                 */
                if (c.type === 'settings') return <span className="chip" key={c.id}>设置 · {c.name}</span>;
                if (c.type !== 'export') return <span className="chip" key={c.id}>命令 · {c.name}</span>;
                const fmt = FORMAT_LABEL[c.format] || c.format;
                const scope = SCOPE_LABEL[c.scope] || c.scope;
                return <span className="chip" key={c.id}>{fmt} · {scope} · {c.name}</span>;
              })}
            </div>

            {/*
               * 设置表单只在插件真的生效时出现 —— 停用/未授权时改参数没有任何意义，
               * 显示出来只会让人以为"改了没反应"。
             */}
            {active ? <PluginSettings plugin={p} onChange={refresh} /> : null}
            {active ? <ExportOutcome plugin={p} /> : null}

            {!p.builtin ? (
              <button
                className="btn sm ghost plugin-remove"
                onClick={function () {
                  uninstallPlugin(p.manifest.id);
                  reloadPluginCommands();
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

      {issues.length > 0 ? (
        <div className="panel-desc" style={{ color: 'var(--c-danger)' }}>
          有 {issues.length} 条插件记录读不出来（已跳过）：{issues.slice(0, 2).join('；')}
          {issues.length > 2 ? ' 等' : ''}
        </div>
      ) : null}

      <div className="panel-desc" style={{ paddingTop: 4 }}>
        插件包是一个 <b>.json</b> 文件，开头写着 <code>format: "timetable-plugin"</code>。
        当前支持的<b>插件接口是 v{HOST_API_VERSION}</b> —— 按更新接口写的插件装不上（会明确说原因）。
        这个版本不支持执行第三方代码：那需要真正的沙箱，而不是在主进程里 eval，是另一个量级的工程。
      </div>
    </Panel>
  );
}
