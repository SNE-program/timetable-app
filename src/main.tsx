import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

import { runDiagnostics } from './app/diagnostics';
import { initStorage } from './storage';
import {
  hydrateAssetsIntoState, hydrateMascotIntoState, hydrateStorageIntoState, migrateInlineAssets,
  repairMascotFrames,
} from './app/store';
import ErrorBoundary from './ui/ErrorBoundary';

/*
 * 几个检查入口都从这里进：布局（?diag=1）、逐帧播放（?framecheck=1）、
 * 角色行为（?behavecheck=秒数）。
 * **每个参数都要显式放行** —— 曾经只认 diag=1，于是 ?framecheck=1 静默地什么都没跑，
 * 而在无头浏览器里"什么都没跑"和"跑了但没问题"看起来一模一样。
 */
if (typeof window !== 'undefined'
  && (window.location.search.indexOf('diag=1') >= 0
    || window.location.search.indexOf('framecheck=1') >= 0
    || window.location.search.indexOf('perf') >= 0
    || window.location.search.indexOf('widgetcheck') >= 0
    || window.location.search.indexOf('behavecheck') >= 0
    /* 后加的几个检查也要在这里放行：漏掉的话，它们在**子框架里**（窄屏测量用的 iframe）
       根本不会跑 —— 而"没跑"和"跑了没问题"在无头环境下看起来一模一样。 */
    || window.location.search.indexOf('dragcheck') >= 0
    || window.location.search.indexOf('histcheck') >= 0
    || window.location.search.indexOf('ovcheck') >= 0
    || window.location.search.indexOf('clipcheck') >= 0
    || window.location.search.indexOf('wp=1') >= 0
    || window.location.search.indexOf('plugcheck') >= 0
    || window.location.search.indexOf('expand=1') >= 0)) {
  runDiagnostics();
}

/**
 * 启动顺序：先读资产库，再挂载。
 *
 * 读资产是异步的（SQLite），但**结构化课表数据仍然是同步读的** ——
 * 所以首屏不会等它：store 在模块求值时就已经拿到课表，这里只是把壁纸
 * 和课程配图补上，补完触发一次重渲染。
 *
 * initStorage 失败不会抛：它会降级到 localStorage，应用照常起来。
 */
void (async function boot() {
  try {
    await initStorage();
    /* 先补课表数据，再还原图片引用 —— 反过来的话图片会挂在旧的那份数据上 */
    hydrateStorageIntoState();
    hydrateAssetsIntoState();
    /* 角色素材也在资产库里，和主题同一时机还原 */
    hydrateMascotIntoState();
    /* 老用户升级上来时，把已经有的大图从 localStorage 搬进资产库，把配额还回去 */
    const moved = migrateInlineAssets();
    if (moved > 0) console.info('已把 ' + moved + ' 张图片移入资产库，释放本地存储配额');
  } catch (e) {
    /* 资产库出问题不该拦住应用启动 */
    console.warn('资产库初始化失败：', e);
  }

  /*
   * 老角色包补一次真实帧数。
   *
   * 它要解码一张逐帧图再数格子 —— 那是启动路径上唯一一处图像解码，
   * 所以放在**空闲时**做（requestIdleCallback，退化到 2.5 秒后）。
   * `repairMascotFrames` 自己会判断"要不要改"：新包、静态图、量不到都原地返回，
   * 一个字节都不写。
   */
  const repair = function (): void { void repairMascotFrames(); };
  try {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(repair, { timeout: 4000 });
    else window.setTimeout(repair, 2500);
  } catch (e) { window.setTimeout(repair, 2500); }

  const el = document.getElementById('root');
  if (el) {
    createRoot(el).render(
      <React.StrictMode>
        {/* 顶层围栏：任何一处渲染异常都表现为一张能读的错误卡片，而不是白屏 */}
        <ErrorBoundary label="课表助手" full={true}>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  }
})();
