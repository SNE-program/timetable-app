/**
 * 布局检查。加 ?diag=1 打开。
 *
 * 无头浏览器在 Windows 上有最小窗口宽度限制（约 504px），靠 --window-size 测不了窄屏；
 * 而只约束容器宽度又骗不过媒体查询（媒体查询看的是真实视口）。
 * 所以这里用 iframe：iframe 的视口就是它的尺寸，媒体查询会正确生效。
 *
 * 用法：?diag=1            在当前视口测
 *       ?diag=1&w=360,390  在 360 / 390 宽的 iframe 里分别测
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import WidgetPreview from '../ui/WidgetPreview';
import {
  getState, historyEntries, openHistory, openOverride, patchTheme, setData, setTab, storeEmitCount, toggleTask, undo,
  undoTo, upsertOverride,
} from './store';
import { dayOfWeekOf, parseISODate, todayISO, weekLimitOf, weekMatches, weekOfDate } from '../core/engine';
import { renderCounts } from './renderCount';
import { UPCOMING_MAX, buildWidgetPayload, widgetBoundaryMs } from '../platform/widget';
import { WIDGET_PRESETS, planForPreset, previewRows } from '../platform/widgetLayout';
import { renderTimetableImage } from '../ui/timetableImage';
import { platformName } from '../platform/nativeBridge';

/**
 * 角色行为检查（?behavecheck=秒数）。
 *
 * 回答的问题："它到底是不是一直在做同一个动作？"
 *
 * 做法：每 200ms 读一次 `.mascot-inner` 上的 data-behavior / data-reaction，
 * 记录**状态切换**（不是逐次采样），最后报出：做过哪几种动作、各占几次、
 * 最长的一次动作持续了多久、这段时间里反应了几次，以及切换序列本身。
 *
 * 顺带还从 `.mascot` 上读 data-phase / data-stir，数出**睡了几次、半醒了几轮** ——
 * "久等之后不会一直卡在同一个动画上"这条要求只有靠这个才验得了
 * （配合 ?doze= 把打盹节奏压短，见 Mascot.tsx 的 readDozeDev）。
 *
 * 为什么要专门做这个：动作的"随机感"是主观的，但"30 秒里只有一种动作"是客观的 ——
 * 上一版就是两条固定周期的正弦，看三秒就知道它在循环。
 */
function runBehaviorCheck(seconds: number): void {
  /** 与 Mascot.tsx 里的 EDGE 保持一致：锚点必须留在距边缘这么多像素以内 */
  const EDGE_MARGIN = 6;
  const started = Date.now();
  const seq: string[] = [];
  const counts: Record<string, number> = {};
  let last = '';
  let lastChangeAt = started;
  let longestRun = 0;
  let reactions = 0;
  let lastReaction = '';
  let samples = 0;
  const reactionKinds: string[] = [];
  /* 走动是否越界：直接量角色的包围盒（它包含走动的位移） */
  let minLeft = Infinity;
  let maxRight = -Infinity;
  /** 锚点（底部中心）的活动范围 —— 走动是否越界看的是它，不是整个身体 */
  let minAnchor = Infinity;
  let maxAnchor = -Infinity;
  let walkSamples = 0;
  /** 走动时累计走了多少像素（相邻采样的锚点位移）—— "步子有没有真的迈出去"就看这个 */
  let walkPx = 0;
  let lastAnchorX: number | null = null;
  /** 反应由谁演：素材（data-state=react）/ 我们的程序化动作（rx-* 类） */
  let reactionByAsset = 0;
  let reactionByProc = 0;
  /*
   * ★ 反应"播完了没有"。
   *
   * 这一版的核心判据。素材是逐帧图时界面会把它从第 0 帧播到最后一帧、
   * 然后停在那一帧（data-once=1），所以**采样到过最后一帧 = 完整播完**；
   * 反过来，如果这次反应从头到尾都没走到最后一帧，它就是被切掉的。
   *
   * 同时记下每次反应实际持续了多久，跟 data-rx-hold 上写的期望值对账 ——
   * "时间可能不一样"这件事因此变成一个能读出来的数，而不是感觉。
   */
  let rxStartAt = 0;
  let rxWantMs = 0;
  let rxFrames = 0;
  let rxLastSeen = -1;
  let rxOnce = false;
  let rxComplete = 0;
  let rxCut = 0;
  const rxSeen: number[] = [];
  const rxWant: number[] = [];
  /** 走动时实际用的是哪张素材（data-state）—— "走路与休息有没有区分开"就看它 */
  const walkStates: Record<string, boolean> = {};
  /** 走动时有没有在跑"迈步"动作（没有 walk 素材时才应该有） */
  let gaitSamples = 0;
  /** 走动时镜像（翻面）与未镜像的采样数 —— 用来验证"朝左走时翻面" */
  let mirrorSamples = 0;
  let normalSamples = 0;
  /* 打盹循环：睡了几次、半醒了几轮、半醒占了多久 */
  let sleeps = 0;
  let stirs = 0;
  let stirSamples = 0;
  let sleepSamples = 0;
  let lastPhase = '';
  let lastStir = '';
  const phaseSeq: string[] = [];

  const tick = window.setInterval(function () {
    const el = document.querySelector('.mascot-inner') as HTMLElement | null;
    if (!el) return;
    const host = el.closest('.mascot') as HTMLElement | null;
    samples++;
    const b = el.getAttribute('data-behavior') || '?';
    const rx = el.getAttribute('data-reaction') || '';
    /* 相位与"是不是正处在半醒那一小段" —— 都在宿主节点上 */
    const ph = (host && host.getAttribute('data-phase')) || '?';
    const stir = (host && host.getAttribute('data-stir')) === '1';
    if (ph !== lastPhase) {
      if (ph === 'sleep') sleeps++;
      phaseSeq.push(ph);
      lastPhase = ph;
    }
    if (stir) {
      stirSamples++;
      if (lastStir !== '1') stirs++;
      lastStir = '1';
    } else {
      lastStir = '0';
    }
    if (ph === 'sleep') sleepSamples++;
    if (b !== last) {
      if (last !== '') {
        const run = Date.now() - lastChangeAt;
        if (run > longestRun) longestRun = run;
      }
      last = b;
      lastChangeAt = Date.now();
      seq.push(b);
      counts[b] = (counts[b] || 0) + 1;
    }
    const state = host && host.getAttribute('data-state');
    /** 逐帧素材现在露的是第几帧 / 一共几帧 / 是不是"只播一遍" */
    const sheetEl = document.querySelector('.mascot-sheet') as HTMLElement | null;
    const frameNow = sheetEl ? Number(sheetEl.getAttribute('data-frame') || -1) : -1;
    if (rx !== lastReaction) {
      if (lastReaction) {
        /* 上一次反应到这里结束：结算它的时长与"有没有播完" */
        rxSeen.push(Date.now() - rxStartAt);
        rxWant.push(rxWantMs);
        if (rxOnce && rxFrames >= 2) {
          if (rxLastSeen >= rxFrames - 1) rxComplete++; else rxCut++;
        }
      }
      if (rx) {
        reactions++;
        reactionKinds.push(rx);
        /* 新的一次：从这一刻起重新记账 */
        rxStartAt = Date.now();
        rxWantMs = host ? Number(host.getAttribute('data-rx-hold') || 0) : 0;
        rxFrames = sheetEl ? Number(sheetEl.getAttribute('data-frames') || 0) : 0;
        rxOnce = !!sheetEl && sheetEl.getAttribute('data-once') === '1';
        rxLastSeen = frameNow;
        /*
         * 这个反应是谁在演？
         *   素材 —— 角色包自带 react 素材，界面切到了 data-state=react，且没有 rx-* 类
         *   程序 —— 我们叠的那套 rx-* transform
         * 这一版的要求是"变化多基于给定动画"，所以这两个数要能分开看。
         */
        const byProc = el.className.indexOf('rx-') >= 0;
        if (state === 'react' && !byProc) reactionByAsset++;
        else if (byProc) reactionByProc++;
      }
      lastReaction = rx;
    } else if (rx && frameNow > rxLastSeen) {
      rxLastSeen = frameNow;
    }
    if (b === 'walk') {
      walkSamples++;
      walkStates[(host && host.getAttribute('data-state')) || '?'] = true;
      if (el.getAttribute('data-gait') === '1') gaitSamples++;
      /*
       * 镜像：走动往左时角色应当翻面。
       * 计算出来的 transform 是个矩阵，第一个分量是 -1 就说明翻过来了 ——
       * 这是判断"有没有真的镜像"最直接的办法（几何尺寸看不出来）。
       */
      const m = window.getComputedStyle(host || el).transform;
      if (m && m.indexOf('matrix') === 0) {
        const a = parseFloat(m.slice(m.indexOf('(') + 1));
        if (a < 0) mirrorSamples++; else normalSamples++;
      }
    }
    const box = document.querySelector('.mascot');
    if (box) {
      const r = box.getBoundingClientRect();
      if (r.width > 0) {
        if (r.left < minLeft) minLeft = r.left;
        if (r.right > maxRight) maxRight = r.right;
        const ax = r.left + r.width / 2;
        if (ax < minAnchor) minAnchor = ax;
        if (ax > maxAnchor) maxAnchor = ax;
        /* 走动期间累计里程：相邻两次采样的锚点位移之和 */
        if (b === 'walk' && lastAnchorX !== null) walkPx += Math.abs(ax - lastAnchorX);
        lastAnchorX = ax;
      }
    }
  }, 200);

  window.setTimeout(function () {
    window.clearInterval(tick);
    /* 结束时如果还在演，也把它结算掉（否则最后一次反应不会出现在报告里） */
    if (lastReaction) {
      rxSeen.push(Date.now() - rxStartAt);
      rxWant.push(rxWantMs);
      if (rxOnce && rxFrames >= 2) {
        if (rxLastSeen >= rxFrames - 1) rxComplete++; else rxCut++;
      }
    }
    const finalRun = Date.now() - lastChangeAt;
    if (finalRun > longestRun) longestRun = finalRun;
    const kinds = Object.keys(counts);
    const dur = Math.round((Date.now() - started) / 100) / 10;
    const text = 'BEHAVE ' + dur + 's 采样' + samples + '次 动作种类=' + kinds.length
      + ' 切换' + Math.max(0, seq.length - 1) + '次 最长同动作=' + (longestRun / 1000).toFixed(1) + 's'
      + ' 反应=' + reactions + '次' + (reactionKinds.length ? '[ ' + reactionKinds.join(' ') + ' ]' : '')
      + ' | 反应来源: 素材' + reactionByAsset + '/程序' + reactionByProc
      + ' | ' + (reactions === 0
        ? '反应完整: 这段里没被点过'
        : (rxComplete + rxCut === 0
          ? '反应完整: 不适用（这几次是程序化动作演的，没有逐帧素材）'
          : '反应完整: ' + rxComplete + '/' + (rxComplete + rxCut)
            + (rxCut > 0 ? '(!!) 被切掉' + rxCut + '次' : '(末帧都到了)'))
          + ' 实测[' + rxSeen.join(',') + ']ms 期望[' + rxWant.join(',') + ']ms')
      + ' | 睡' + sleeps + '次 半醒' + stirs + '轮(采样' + stirSamples + '/' + samples + ')'
      + ' 睡着采样' + sleepSamples + '/' + samples
      + ' | 相位: ' + phaseSeq.join(' → ')
      + ' | 分布: ' + kinds.map(function (k) { return k + '×' + counts[k]; }).join(' ')
      + ' | 序列: ' + seq.join(' → ')
      + ' | ' + (isFinite(minLeft)
        ? (function () {
          /*
           * 判据是**锚点**（底部中心），不是整个身体。
           *
           * 身体允许挂在屏幕外 —— 那是 v0.15.5 明确要的（"允许移出边界，
           * 只要中心点在边界里即可"）。会出问题的是锚点跑出可用区域，
           * 那才是"拖不回来 / 走到屏幕外"。所以这里量锚点的活动范围。
           */
          const vw = window.innerWidth;
          return '锚点 x∈[' + Math.round(minAnchor) + ',' + Math.round(maxAnchor) + ']'
            + ' 可用区[' + EDGE_MARGIN + ',' + (vw - EDGE_MARGIN) + ']'
            + ' 锚点越界=' + (minAnchor < EDGE_MARGIN - 1 || maxAnchor > vw - EDGE_MARGIN + 1 ? '是(!!)' : '否')
            + ' 本体 x∈[' + Math.round(minLeft) + ',' + Math.round(maxRight) + ']（可挂屏幕外）'
            + ' 走动采样' + walkSamples + '/' + samples + ' 走动里程' + Math.round(walkPx) + 'px'
            + (walkSamples > 0
              ? ' 走动时素材=' + Object.keys(walkStates).join('/') + ' 迈步动作采样' + gaitSamples
                + ' 翻面' + mirrorSamples + '/正常' + normalSamples
              : '');
        })()
        : '没量到角色盒');

    const pre = document.createElement('pre');
    pre.id = 'behavecheck';
    pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;font:10px monospace;white-space:pre-wrap;'
      + 'background:#000;color:#0f0;margin:0;padding:4px;max-width:100%;';
    pre.textContent = text;
    document.body.appendChild(pre);

    let send = function (_t: string): void { /* 默认不回传 */ };
    try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }
    send(text);
  }, Math.max(4000, seconds * 1000));
}

/**
 * 逐帧播放检查（?framecheck=1）。
 *
 * 它回答一个**只能靠时间采样回答**的问题：角色播放时，有没有走到网格里
 * 那些全透明的空格子上？走到的每一次，用户看到的就是"角色闪了一下"。
 *
 * 做法：每 40ms 读一次精灵元素的 background-position（计算值已经是 px），
 * 按元素自身宽高折回格号，再和"真实帧数"比。判据很硬：
 *
 *   BAD > 0            → 播到了空格子（会闪）—— ?mascot=5 就是这个状态
 *   BAD = 0 且采样到多格 → 正常循环          —— ?mascot=4 就是这个状态
 *
 * ## 结果怎么读回来
 *
 * 无头浏览器里拿不到页面内部状态（这台机器上 --dump-dom 不吐东西），所以结果
 * 被画成**能按像素读的色块**：上面一块大的判定色（绿=过、红=不过、蓝=没测到），
 * 下面一条 320×20 的采样条，每一段代表一次采样（绿=合法帧、红=空格子）。
 * 外部脚本只要数红色像素，就知道有没有闪、闪了多少次。
 * 色块位置是写死的：box 内边距 2，判定块 320×40，条子再往下 2 —— 于是
 * 判定色在 (162,22)，采样条在 y=54、x=2..322。
 */
/**
 * 检查结果的回传通道（只在带 ?report=端口 时启用）。
 *
 * 为什么需要它：无头浏览器里"页面内部状态"拿不出来 —— 这台机器上 --dump-dom
 * 不吐东西，截图又只能靠像素猜。所以在检查里留一个**只写不读**的出口：
 * 把结果当成 query 发给本机一个临时 HTTP 服务，那边打印出来。
 * 不带 report 参数时一行都不会发，产物里也永远不会联网（这条底线不能破）。
 */
function makeReporter(port: string): (text: string) => void {
  const n = Number(port);
  if (!isFinite(n) || n <= 0) return function () { /* 没配端口就什么都不做 */ };
  const url = 'http://127.0.0.1:' + Math.round(n) + '/r?m=';
  /*
   * 用一张 1×1 的图片当信标，而不是 fetch。
   *
   * 图片请求不受 CORS 约束、也不会被 no-cors 的规则吃掉 —— 只要服务在监听就一定收得到。
   * 这条通道只在带 ?report= 时启用（默认什么都不发），产物里不会联网。
   */
  return function (text: string): void {
    try {
      const img = new Image();
      img.src = url + encodeURIComponent(text) + '&t=' + Date.now();
    } catch (e) { /* 忽略 */ }
  };
}

function runFrameCheck(): void {
  const CAP = 80;
  const samples: boolean[] = [];
  /** 整圈里访问到过哪些格子 —— 集合比逐次采样稳，不会被采样节拍和帧节拍"打拍子"骗到 */
  const visited: Record<number, boolean> = {};
  let gridCols = 0;
  let gridRows = 0;
  let realFrames = 0;
  /** 显示出来的格子 ≠ 当前帧号 的次数：位移算错时它会立刻变成非 0 */
  let misaligned = 0;
  let skipped = '';

  const box = document.createElement('div');
  box.id = 'framecheckbox';
  box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;padding:2px;';
  const verdict = document.createElement('div');
  verdict.style.cssText = 'width:320px;height:40px;background:#2962ff;';
  const strip = document.createElement('div');
  strip.style.cssText = 'display:flex;width:320px;height:20px;margin-top:2px;background:#222;';
  const text = document.createElement('pre');
  text.id = 'framecheck';
  text.style.cssText = 'font:10px monospace;color:#0f0;margin:2px 0 0;white-space:pre-wrap;width:320px;';
  text.textContent = 'FRAMECHECK 采样中…';
  box.appendChild(verdict);
  box.appendChild(strip);
  box.appendChild(text);
  document.body.appendChild(box);

  let report = function (_text: string): void { /* 默认不回传 */ };
  try {
    report = makeReporter(new URLSearchParams(window.location.search).get('report') || '');
  } catch (e) { /* 忽略 */ }

  /* 心跳：每秒把"页面现在长什么样"回传一次，排查"到底是没渲染还是没采到" */
  let beat = 0;
  const hb = window.setInterval(function () {
    beat++;
    const rootEl = document.getElementById('root');
    report('BEAT ' + beat + ' root=' + (rootEl ? rootEl.innerHTML.length : -1)
      + ' mascot=' + !!document.querySelector('.mascot')
      + ' sheet=' + !!document.querySelector('.mascot-sheet')
      + ' tabs=' + document.querySelectorAll('.tab').length
      + ' samples=' + samples.length);
    if (beat >= 6) window.clearInterval(hb);
  }, 1000);

  const startedAt = Date.now();
  /*
   * 可选延迟：`?fcdelay=3000` 表示"等 3 秒再开始采样"。
   * 用处很具体 —— 老角色包的自动修帧数是在启动后 1.5 秒跑的，
   * 不把这段排除掉，采样里就会混进"修好之前"的帧，结论永远像没修好。
   */
  let delay = 0;
  try {
    const d = Number(new URLSearchParams(window.location.search).get('fcdelay') || 0);
    if (isFinite(d) && d > 0) delay = Math.min(8000, Math.round(d));
  } catch (e) { /* 忽略 */ }

  const tick = window.setInterval(function () {
    if (Date.now() - startedAt < delay) return;
    if (samples.length >= CAP) { finish(); return; }
    const host = document.querySelector('.mascot') as HTMLElement | null;
    const wrapper = document.querySelector('.mascot-sheet') as HTMLElement | null;
    const sheetImg = document.querySelector('.mascot-sheet-img') as HTMLElement | null;
    if (!host || !wrapper || !sheetImg) {
      if (Date.now() - startedAt > 5000) { skipped = '没找到逐帧图的容器（要用 ?mascot=2/4/5 才测得到）'; finish(); }
      return;
    }
    const cols = Number(host.getAttribute('data-cols') || 0);
    const rows = Number(host.getAttribute('data-rows') || 0);
    const frames = Number(host.getAttribute('data-frames') || 0);
    /*
     * 从**真实几何**反推"现在露出的是哪一格"：
     *   容器左上角 − 整图左上角 = 平移量 = col·cellW
     * 这条路不依赖任何"我以为 CSS 会怎么算"的假设 —— 上一版就是栽在
     * "以为 background-position: -100% 会往左推一格"上（实际把图推出了容器，
     * 只剩第 0 帧能看见，于是角色一闪一闪）。现在改成直接量。
     */
    const wr = wrapper.getBoundingClientRect();
    const ir = sheetImg.getBoundingClientRect();
    if (!cols || !rows || !frames || !wr.width || !wr.height) return;
    const col = Math.round((wr.left - ir.left) / wr.width);
    const row = Math.round((wr.top - ir.top) / wr.height);
    const cell = row * cols + col;
    /* 显示的格子必须是"这一帧该显示的那一格"，否则就是位移算错了 */
    const want = Number(wrapper.getAttribute('data-frame') || 0);
    const aligned = cell === want;
    const ok = aligned && cell >= 0 && cell < frames;
    samples.push(ok);
    if (!aligned) misaligned++;
    gridCols = cols; gridRows = rows; realFrames = frames;
    if (cell >= 0 && cell < cols * rows) visited[cell] = true;
  }, 40);

  function finish(): void {
    window.clearInterval(tick);
    window.clearInterval(hb);
    const good = samples.filter(function (s) { return s; }).length;
    const bad = samples.length - good;
    const pass = !skipped && bad === 0 && misaligned === 0 && good > 1;

    verdict.style.background = skipped ? '#2962ff' : (pass ? '#00c853' : '#d50000');
    for (let i = 0; i < samples.length; i++) {
      const seg = document.createElement('div');
      seg.style.cssText = 'flex:1 1 0;background:' + (samples[i] ? '#00ff00' : '#ff0000') + ';';
      strip.appendChild(seg);
    }
    text.textContent = 'FRAMECHECK ' + (delay ? '(延迟 ' + delay + 'ms) ' : '') + (skipped ? 'SKIP ' + skipped
      : (misaligned > 0 ? 'FAIL 显示出来的格子与帧号对不上 ' + misaligned + ' 次（位移算错了）'
        : (pass ? 'PASS' : 'FAIL 播到了 ' + bad + ' 次空格子（会闪）')))
      + '\n  采样 ' + samples.length + ' 次  合法 ' + good + '  空白 ' + bad + '  位移错 ' + misaligned
      + '\n  判定色=' + (skipped ? 'blue' : (pass ? 'green' : 'red')) + '（绿=修好了 / 红=还在闪）';
    document.body.appendChild(box);

    /*
     * 走到的格子集合 → "这一圈里有多少格是空的"。
     * 这个数比逐次采样稳得多：采样节拍和帧节拍很容易锁相，
     * 逐次计数会低估空白比例（实测只抓到 3/80，而真实空白占比是 7/16）。
     */
    const cellList = Object.keys(visited).map(Number).sort(function (a, b) { return a - b; });
    const blankVisited = cellList.filter(function (c) { return c >= realFrames; }).length;
    const blankShare = cellList.length ? Math.round(100 * blankVisited / cellList.length) : 0;

    /* 把结论连同"页面到底有没有渲染出来"一起回传，免得只看一条结论误判 */
    const host = document.querySelector('.mascot') as HTMLElement | null;
    const rootEl = document.getElementById('root');
    report('FRAMECHECK verdict=' + (skipped ? 'SKIP' : (pass ? 'PASS' : 'FAIL')) + ' delay=' + delay
      + ' samples=' + samples.length + ' good=' + good + ' bad=' + bad
      + ' cols=' + (host ? host.getAttribute('data-cols') : '-')
      + ' rows=' + (host ? host.getAttribute('data-rows') : '-')
      + ' frames=' + (host ? host.getAttribute('data-frames') : '-')
      + ' mascot=' + (host ? Math.round(host.getBoundingClientRect().width) + 'x' + Math.round(host.getBoundingClientRect().height) : 'none')
      + ' root=' + (rootEl ? rootEl.innerHTML.length : -1)
      + ' grid=' + (gridCols * gridRows) + ' visited=' + cellList.length
      + ' blankVisited=' + blankVisited + ' blankShare=' + blankShare + '%'
      + ' misaligned=' + misaligned
      + ' note=' + (skipped || '-'));
    if (!host) report('PAGE tabs=' + document.querySelectorAll('.tab').length
      + ' topbar=' + !!document.querySelector('.topbar')
      + ' privacyText=' + ((document.body.textContent || '').slice(0, 60)));
    else report('MASCOTART sheet=' + !!document.querySelector('.mascot-sheet')
      + ' img=' + !!document.querySelector('.mascot-img')
      + ' opacity=' + window.getComputedStyle(host).opacity);
  }
}

/**
 * 性能自检（`?perf=秒数`）。
 *
 * 回答的问题："这一版比上一版更轻还是更重？"
 *
 * 做法：在指定秒数内数四件事，全是可以横向对比的量：
 *   1. **各视图渲染次数** —— 无关状态变化引起的重渲染在这里藏不住；
 *   2. **store 通知次数** —— 一次通知不等于一次重渲染，两个数一起看才有意义；
 *   3. **长任务**（PerformanceObserver 的 longtask）—— 主线程被占住超过 50ms 的次数与总时长，
 *      这是"卡一下"最接近客观的定义；
 *   4. **首屏时间** —— FCP（有的话）与首次渲染时刻。
 *
 * 计数本身在运行时几乎不要钱（对象自增），所以这几个计数器留在代码里没有负担。
 */
function runPerfCheck(seconds: number): void {
  const startedAt = Date.now();
  const longTasks: number[] = [];
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) { longTasks.push(e.duration); });
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { /* 不支持就不记 */ }

  let send = function (_t: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }

  window.setTimeout(function () {
    const counts = renderCounts();
    const names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    const longTotal = longTasks.reduce(function (a, b) { return a + b; }, 0);
    let fcp: number | null = null;
    try {
      const e = performance.getEntriesByName('first-contentful-paint')[0];
      if (e) fcp = Math.round(e.startTime);
    } catch (err) { /* 忽略 */ }
    const label = new URLSearchParams(window.location.search).get('label') || '';
    const text = 'PERF' + (label ? '[' + label + ']' : '') + ' ' + Math.round((Date.now() - startedAt) / 1000) + 's'
      + ' | 渲染: ' + names.map(function (n) { return n + '×' + counts[n]; }).join(' ')
      + ' | store 通知 ' + storeEmitCount() + ' 次'
      + ' | 长任务 ' + longTasks.length + ' 个 共 ' + Math.round(longTotal) + 'ms'
      + (longTasks.length ? '（最长 ' + Math.round(Math.max.apply(null, longTasks)) + 'ms）' : '')
      + ' | FCP ' + (fcp === null ? '—' : fcp + 'ms')
      + ' | DOM ' + document.getElementsByTagName('*').length + ' 节点';

    const pre = document.createElement('pre');
    pre.id = 'perfcheck';
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;font:10px monospace;'
      + 'background:#000;color:#0f0;margin:0;padding:4px;';
    pre.textContent = text;
    document.body.appendChild(pre);
    send(text);
  }, Math.max(3000, seconds * 1000));
}

/**
 * 小组件自检（`?widgetcheck=1`）。
 *
 * 回答的问题："应用到底往桌面推了什么，桌面又会在什么时候自己翻页？"
 *
 * 应用与桌面隔着两个进程，出了问题很难说清是哪一头 —— 所以把**推过去的那份数据**
 * 与**下一次自动刷新的时刻**直接打出来，和手机上的小组件对一眼就知道。
 */
function runWidgetCheck(): void {
  const st = getState();
  const now = Date.now();
  const p = buildWidgetPayload(st.data, new Date(now));
  const next = p.upcoming.filter(function (it) { return it.endMs > now; })[0] || null;
  const remain = p.today.filter(function (it) { return it.endMs > now; });
  const boundary = widgetBoundaryMs(p, now);
  const hm = function (ms: number): string {
    const d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  };
  const lines = [
    'WIDGET 学期=' + (p.term || '(空)'),
    'todayIso=' + p.todayIso,
    '今天还剩=' + remain.length + ' 节',
    'upcoming=' + p.upcoming.length + ' 节（上限 ' + UPCOMING_MAX + '）',
    next
      ? '下一节=' + next.dayLabel + ' ' + next.title + ' ' + next.start + '-' + next.end + ' ' + next.period
        + '（' + (next.startMs > now
          ? '还有 ' + Math.round((next.startMs - now) / 60000) + ' 分钟开始'
          : '正在上，' + Math.round((next.endMs - now) / 60000) + ' 分钟后下课') + '）'
      : '下一节=（没有更多课了）',
    '桌面下次自刷新=' + hm(boundary) + '（距现在 ' + Math.round((boundary - now) / 60000) + ' 分钟）',
  ];
  /*
   * 四个尺寸各自会显示几行 —— 与原生侧 WidgetSize 同一套判据。
   * 这一行是"拉大之后到底会不会多显示"的答案：用户在桌面上看到的行数，
   * 应该与这里写的一模一样，对不上就是两边判据漂了。
   */
  for (const preset of WIDGET_PRESETS) {
    const plan = planForPreset(preset);
    const view = previewRows(p, now, 6);
    lines.push('WIDGET ' + preset.label + '（' + plan.widthDp + 'x' + plan.heightDp + 'dp）'
      + ' 列=' + (preset.kind === 'next' ? plan.extraRows : plan.listRows)
      + (preset.kind === 'next' ? ' 节（拉高才出现）' : ' 节')
      + (plan.narrow ? ' 窄：收起地点列' : '')
      + ' —— 实际可列 ' + view.rows.length + ' 节'
      + (view.next ? '，顶上=' + view.next.title : '，顶上=（没有下一节）'));
  }
  const text = lines.join(' | ');
  const pre = document.createElement('pre');
  pre.id = 'widgetcheck';
  pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;font:10px monospace;'
    + 'background:#000;color:#0f0;margin:0;padding:4px;white-space:pre-wrap;';
  pre.textContent = lines.join(String.fromCharCode(10));
  document.body.appendChild(pre);
  let send = function (_t: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }
  send(text);
}

/**
 * 操作历史面板的自检（?histcheck=3）。
 *
 * 为什么需要：面板里列的是"栈里已经有的改动"，空栈时它只有一句"还没有可撤销的改动"，
 * 行排版（标签 + 时间 + 右侧动作）根本量不到。所以这里用**公开的 store 动作**真做几笔可撤销的改动
 * （改主色、改字号、勾一个任务），再打开面板，把行数、最宽的行、有没有溢出量出来。
 *
 * 顺带核对一件事：面板正文里不许出现没渲染的 `**` 标记 —— 这一版的说明文字里有加粗，
 * 而普通 JSX 文本不会当 Markdown 渲染，写错了就是屏幕上两个星号。
 */
function runHistoryCheck(count: number): void {
  const n = isFinite(count) && count > 0 ? Math.min(8, Math.round(count)) : 3;
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }

  setTimeout(function () {
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) patchTheme({ accent: i === 0 ? '#4C8DFF' : '#FF7D00' }, false, 'theme:accent');
      /* 只动颜色，不动字号与间距 —— 免得自检自己把排版改掉，量出来的就不是产品本来的样子 */
      else if (i % 3 === 1) patchTheme({ colorBlind: i > 1 }, false, 'theme:cb');
      else {
        const tasks = getState().data.tasks;
        if (tasks.length > 0) toggleTask(tasks[0].id);
      }
    }
    openHistory();
    setTimeout(function () {
      const st = getState();
      const body = document.querySelector('.sheet-body');
      const rows = body ? body.querySelectorAll('.list-row') : [];
      let maxRight = 0;
      let widest = '';
      for (let i = 0; i < rows.length; i++) {
        const el = rows[i] as HTMLElement;
        const r = el.getBoundingClientRect();
        if (r.right > maxRight) { maxRight = r.right; widest = (el.textContent || '').slice(0, 20); }
      }
      const text = body ? (body.textContent || '') : '';
      send('HISTCHECK w=' + window.innerWidth
        + ' sheet=' + (body ? 'yes' : 'no')
        + ' rows=' + rows.length
        + ' 历史 undo=' + st.history.undo + ' redo=' + st.history.redo
        + ' 最宽行右边缘=' + Math.round(maxRight) + '/' + window.innerWidth
        + ' 溢出=' + (maxRight > window.innerWidth + 1 ? 'YES' : 'no')
        + ' 未渲染的星号=' + (text.indexOf('**') >= 0 ? 'YES' : 'no')
        + ' 最宽行="' + widest + '"');
      /* 顺手验一次"退回某一步"：撤销两笔，看栈深有没有真的减少 */
      const before = st.history.undo;
      const list = historyEntries(3);
      const back = list.length > 1 ? undoTo(list[list.length - 1].id) : 0;
      send('HISTCHECK undoTo 撤销了=' + back + ' 步，栈 ' + before + ' -> ' + getState().history.undo
        + '，重做可选=' + getState().history.redo);
    }, 700);
  }, 1200);
}

/**
 * 「调整某一次课」面板 + 恢复按钮的自检（?ovcheck=1）。
 *
 * 这一版把"已调整的 N 次"挪到了面板最上面、按钮改成「恢复」，今日页上被停掉的那一节
 * 也要能就地恢复。这几件事只能用真数据量：
 *
 *   1. 按公开接口做一次停课 → 打开调整面板 → 量首行标题与「恢复」按钮 → **真的点一下** →
 *      看调整记录是否消失、历史栈是否多了一笔可撤销的记录；
 *   2. 挑一节"今天本来就该上"的课停掉 → 切到今日页 → 看「今天被停课的」那一块有没有出现、
 *      点它的「恢复」之后这节课是否回到今天的安排里。
 */
function runOverrideCheck(): void {
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }
  setTimeout(function () {
    const st = getState();
    const s0 = st.data.sessions[0];
    if (!s0) { send('OVCHECK 没有课，跳过'); return; }
    const before = st.data.overrides.length;
    upsertOverride({ sessionId: s0.id, date: todayISO(), action: 'cancel', reason: '自检' });
    openOverride(s0.id);
    setTimeout(function () {
      const body = document.querySelector('.sheet-body');
      if (!body) { send('OVCHECK 面板没打开'); return; }
      const title = body.querySelector('.section-title');
      const buttons = body.querySelectorAll('button');
      let restore: HTMLButtonElement | null = null;
      for (let i = 0; i < buttons.length; i++) {
        if ((buttons[i].textContent || '').trim() === '恢复') restore = buttons[i] as HTMLButtonElement;
      }
      const r = restore ? restore.getBoundingClientRect() : null;
      const undoBefore = getState().history.undo;
      send('OVCHECK w=' + window.innerWidth
        + ' 首行标题="' + (title ? (title.textContent || '').slice(0, 20) : '无') + '"'
        + ' 恢复按钮=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : '没有')
        + ' 调整条目=' + body.querySelectorAll('.list-row').length
        + ' 点击前 overrides=' + getState().data.overrides.length + '/' + before);
      if (restore) restore.click();
      setTimeout(function () {
        const now = getState();
        send('OVCHECK 点「恢复」之后 overrides=' + now.data.overrides.length
          + '，历史 ' + undoBefore + ' -> ' + now.history.undo
          + '（多了一笔=' + (now.history.undo > undoBefore ? 'yes' : 'no') + '）');
        runTodayCancelCheck(send);
      }, 500);
    }, 800);
  }, 1200);
}

/**
 * 第二阶段：把"今天本来就该上"的一节课停掉，切到今日页，验证「今天被停课的」那一块。
 *
 * 为什么挑"今天本来就该上"的：引擎会按周次判断这节课今天是否真的存在，
 * 随便挑一节停掉的话，它可能本来就不在今天 —— 那就验不到这条路径。
 */
function runTodayCancelCheck(send: (text: string) => void): void {
  const st = getState();
  const today = todayISO();
  const dow = dayOfWeekOf(parseISODate(today));
  const limit = weekLimitOf(st.data.term);
  const wk = weekOfDate(st.data.term, today);
  let sess = st.data.sessions.filter(function (x) {
    return x.dayOfWeek === dow && weekMatches(x.weeks, wk, limit);
  })[0];
  /*
   * 今天本来没课（周末、或者不在学期内）时，临时造一节出来。
   *
   * 不这么做的话，一周里有五天这个自检都是"跳过"，等于没验 —— 而它验的正是
   * "停错了能不能从今日页直接恢复"。临时课在检查结束后**立刻删掉**（连同它的调整记录），
   * 数据回到原样；这份自检只在 ?ovcheck=1 时才会跑。
   */
  let tempId = '';
  if (!sess) {
    const baseSess = st.data.sessions[0];
    if (!baseSess) { send('OVCHECK 今日页：没有任何课可以做样本，跳过'); return; }
    tempId = 'selfcheck-' + Date.now();
    sess = Object.assign({}, baseSess, {
      id: tempId,
      dayOfWeek: dow,
      weeks: { type: 'range', from: wk, to: wk },
    });
    setData(Object.assign({}, st.data, { sessions: st.data.sessions.concat([sess]) }), '自检：临时加一节');
    send('OVCHECK 今日页：今天本来没有课，临时加了一节来验（跑完会删掉）');
  }
  const before = getState().data.overrides.length;
  upsertOverride({ sessionId: sess.id, date: today, action: 'cancel', reason: '自检停课' });
  setTab('today');
  setTimeout(function () {
    /* 找到那一块里属于自检的那一行（按原因文字定位，别靠顺序） */
    const rows = Array.prototype.slice.call(document.querySelectorAll('.list-row')) as HTMLElement[];
    let mine: HTMLElement | null = null;
    for (const el of rows) if ((el.textContent || '').indexOf('自检停课') >= 0) mine = el;
    if (!mine) { send('OVCHECK 今日页：没找到「今天被停课的」那一行'); return; }
    let btn: HTMLButtonElement | null = null;
    const bs = mine.querySelectorAll('button');
    for (let i = 0; i < bs.length; i++) if ((bs[i].textContent || '').trim() === '恢复') btn = bs[i] as HTMLButtonElement;
    const r = btn ? btn.getBoundingClientRect() : null;
    send('OVCHECK 今日页 w=' + window.innerWidth + ' 行文本="' + (mine.textContent || '').slice(0, 26) + '"'
      + ' 恢复按钮=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : '没有'));
    if (btn) btn.click();
    setTimeout(function () {
      const now = getState();
      const stillThere = Array.prototype.slice.call(document.querySelectorAll('.list-row'))
        .filter(function (el) { return ((el as HTMLElement).textContent || '').indexOf('自检停课') >= 0; }).length;
      send('OVCHECK 今日页点「恢复」之后 overrides=' + now.data.overrides.length + '/' + before
        + '，那一行还在=' + (stillThere > 0 ? 'yes' : 'no'));
      if (tempId) {
        setData(Object.assign({}, now.data, {
          sessions: now.data.sessions.filter(function (x) { return x.id !== tempId; }),
          overrides: now.data.overrides.filter(function (o) { return o.sessionId !== tempId; }),
        }), '自检：删掉临时课');
        send('OVCHECK 今日页：临时课已删除，现在 sessions=' + getState().data.sessions.length);
      }
    }, 500);
  }, 900);
}

/**
 * 插件设置的自检（?plugcheck=1）。
 *
 * 这条检查回答的问题：**用户在设置页勾的那几下，真的改变了导出的结果吗？**
 *
 * 这是"可配置"整套设计里最容易假成功的一环：勾选框渲染出来了、值也存进去了，
 * 但导出时读的是另一份数据（或者读的是缓存），界面看着一切正常，
 * 导出的文件却还是老样子。所以这里不看代码，只做端到端：
 *
 *   1. 找到内置插件「当前周 CSV」的设置表单，记下"这次导出会用哪些列"；
 *   2. 把其中一列的勾去掉（合成一次点击）；
 *   3. 看那行结果**有没有跟着变**；
 *   4. 点「恢复默认」，看它有没有变回去。
 *
 * 全程只碰 DOM 与存储，走的正是用户会走的那条路。
 */
function runPluginCheck(): void {
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }
  setTimeout(function () {
    const cards = document.querySelectorAll('.plugin-card');
    if (cards.length === 0) { send('PLUGCHECK 没有插件卡片（要在设置页且面板展开）'); return; }
    const card = cards[0] as HTMLElement;
    const outcomeOf = function (): string {
      const el = card.querySelector('.plugin-outcome');
      return el ? (el.textContent || '').trim() : '';
    };
    /** 每次重新取一次节点：React 重渲染之后旧引用不该再被信任 */
    const optionAt = function (i: number): HTMLElement | null {
      const list = card.querySelectorAll('.plugin-settings .plugin-perm');
      return (list[i] as HTMLElement) || null;
    };
    /*
     * ★ 每次点击之后必须**等一帧**再读。
     *
     * 第一版这里是同步读的，于是永远得到"点完没变化"—— 而那不是应用的 bug，
     * 是 React 的更新是异步的（点击 → 事件处理 → 状态更新 → 重渲染）。
     * 这条教训值得留在代码里：**自检里的等待不是拖延，是测量的一部分**。
     */
    const wait = function (ms: number): Promise<void> {
      return new Promise(function (r) { window.setTimeout(r, ms); });
    };

    const run = async function (): Promise<void> {
      const before = outcomeOf();
      const count = card.querySelectorAll('.plugin-settings .plugin-perm').length;
      if (!before || count === 0) {
        send('PLUGCHECK 第一个插件没有设置表单（用法：?tab=settings&expand=1&plugcheck=1）');
        return;
      }
      const first = optionAt(count - 1);
      const wasOn = !!first && !!first.querySelector('.task-check.on');

      /* ① 点掉一列 */
      if (first) first.click();
      await wait(160);
      const uncheckStillOn = !!optionAt(count - 1)?.querySelector('.task-check.on');
      const afterUncheck = outcomeOf();
      let stored = '';
      try { stored = String(localStorage.getItem('timetable.pluginsettings.v1') || ''); } catch (e) { stored = '(读不到)'; }
      const wroteSetting = stored.indexOf('builtin.csv-week') >= 0;

      /* ② 再点回来 */
      const again = optionAt(count - 1);
      if (again) again.click();
      await wait(160);
      const afterRecheck = outcomeOf();

      /* ③ 改一下再点「恢复默认」 */
      const third = optionAt(count - 1);
      if (third) third.click();
      await wait(160);
      const changedAgain = outcomeOf() !== before;
      const resetBtn = card.querySelector('.plugin-field-actions .btn') as HTMLElement | null;
      if (resetBtn) resetBtn.click();
      await wait(160);
      const afterReset = outcomeOf();

      const changed = afterUncheck !== before;
      const restored = afterRecheck === before;
      const defaulted = afterReset === before;
      const pass = changed && restored && defaulted && !uncheckStillOn && wroteSetting;
      send('PLUGCHECK verdict=' + (pass ? 'PASS' : 'FAIL')
        + ' 选项数=' + count + ' 原本勾着=' + (wasOn ? 'yes' : 'no')
        + ' 勾选态跟着变=' + (uncheckStillOn ? 'no' : 'yes') + ' 存进去了=' + (wroteSetting ? 'yes' : 'no')
        + ' 改动生效=' + (changed ? 'yes' : 'no')
        + ' 再勾回来一致=' + (restored ? 'yes' : 'no')
        + ' 恢复默认前确实被改过=' + (changedAgain ? 'yes' : 'no')
        + ' 恢复默认一致=' + (defaulted ? 'yes' : 'no')
        + ' | 前「' + before + '」后「' + afterUncheck + '」');
    };
    /* 自检自己抛异常时必须说出来 —— 静默的检查比没有检查更坏（看起来像通过了） */
    run().catch(function (e) { send('PLUGCHECK 自检自身出错：' + String(e && (e as Error).message || e)); });
  }, 1500);
}

/**
 * 小组件尺寸预览的自检（?wp=1）。
 *
 * 那个预览面板只在 **Android 版**渲染（网页版没有桌面小组件），
 * 而无头检查跑的是网页产物 —— 所以这里把它单独挂出来量一次：
 * 四个尺寸的框是不是真的 110×110 / 110×180 / 250×110 / 250×180，
 * 里面的行数是不是与判据一致，有没有横向溢出。
 */
/** 本地日期 → YYYY-MM-DD（自检里拼合成数据用，避免又引入一个依赖） */
function toIsoLocal(d: Date): string {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function runWidgetPreviewCheck(): void {
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }
  setTimeout(function () {
    const host = document.createElement('div');
    host.id = 'wpcheck';
    host.style.cssText = 'position:relative;z-index:9999;background:#fff;padding:10px;width:290px;';
    document.body.appendChild(host);
    const payload = buildWidgetPayload(getState().data, new Date());
    /*
     * 真实数据今天可能一节课都没有（周末、假期），那行排版就量不到 ——
     * 所以**再挂一份合成数据**：顶上有一节正在上的课，后面还排着两节。
     * 两份都量，报出来时能看出"是没数据"还是"有数据但排版不对"。
     */
    const nowMs = Date.now();
    const iso = toIsoLocal(new Date(nowMs));
    const mk = function (title: string, minutes: number, loc: string) {
      return {
        courseId: 'c-' + title, title: title, start: '09:00', end: '09:45', location: loc,
        period: '第 1 节', dayLabel: '周一', date: iso,
        startMs: nowMs + minutes * 60000, endMs: nowMs + (minutes + 45) * 60000,
      };
    };
    const fake = {
      term: '自检用示例学期', todayIso: iso,
      today: [mk('高等数学 A', -20, '一教 A101'), mk('程序设计基础', 60, '机房 302'), mk('大学英语 III', 180, '外语楼 205')],
      upcoming: [mk('高等数学 A', -20, '一教 A101'), mk('程序设计基础', 60, '机房 302'), mk('大学英语 III', 180, '外语楼 205')],
    };
    createRoot(host).render(React.createElement(WidgetPreview, { payload: payload }));
    setTimeout(function () {
      const frames = host.querySelectorAll('.wgt-frame');
      const caps: string[] = [];
      let overflow = false;
      for (let i = 0; i < frames.length; i++) {
        const el = frames[i] as HTMLElement;
        const r = el.getBoundingClientRect();
        const rows = el.querySelectorAll('.wgt-row').length;
        caps.push(el.getAttribute('data-size') + '=' + Math.round(r.width) + 'x' + Math.round(r.height) + '/' + rows + '行');
        if (r.right > window.innerWidth + 1) overflow = true;
      }
      const text = host.textContent || '';
      send('WPCHECK 真实数据 框架=' + caps.join(' ') + ' 溢出=' + (overflow ? 'YES' : 'no')
        + ' 未渲染的星号=' + (text.indexOf('**') >= 0 ? 'YES' : 'no'));
      /* 第二份：合成数据（保证今天有课），量的是行本身的排版 */
      const host2 = document.createElement('div');
      host2.id = 'wpcheck2';
      host2.style.cssText = 'position:relative;z-index:9999;background:#fff;padding:10px;width:290px;';
      document.body.appendChild(host2);
      createRoot(host2).render(React.createElement(WidgetPreview, { payload: fake }));
      setTimeout(function () {
        const f2 = host2.querySelectorAll('.wgt-frame');
        const caps2: string[] = [];
        let over2 = false;
        for (let i = 0; i < f2.length; i++) {
          const el = f2[i] as HTMLElement;
          const r = el.getBoundingClientRect();
          const rows = el.querySelectorAll('.wgt-row').length;
          /* 行里的课程名有没有被挤没：宽度小于 8px 就是被挤没了 */
          const titles = el.querySelectorAll('.wgt-title');
          let minTitle = 999;
          for (let j = 0; j < titles.length; j++) minTitle = Math.min(minTitle, (titles[j] as HTMLElement).getBoundingClientRect().width);
          caps2.push(el.getAttribute('data-size') + '=' + Math.round(r.width) + 'x' + Math.round(r.height)
            + '/' + rows + '行' + (minTitle === 999 ? '' : ' 最窄课程名=' + Math.round(minTitle) + 'px'));
          if (r.right > window.innerWidth + 1) over2 = true;
        }
        send('WPCHECK 合成数据 框架=' + caps2.join(' ') + ' 溢出=' + (over2 ? 'YES' : 'no'));
      }, 500);
    }, 700);
  }, 1200);
}

/**
 * 拖动改课的自检（?dragcheck=1）。
 *
 * 拖动是"手指/鼠标动作"，无头浏览器里没人能替它拖 —— 所以这里**合成指针事件**：
 * 在一张课程卡上按下、移动两格、松手，然后看数据里有没有真的多出一条调整记录，
 * 以及那条记录的目标（换到哪天、第几节）是不是我们预期的。
 *
 * 为什么值得写：拖动的接线特别容易"看起来做了但其实没生效"
 * （事件挂在卡片上、坐标算成 0、松手时目标没变所以不写库……），
 * 光靠代码审查看不出来，而用户在桌面上拖一下就会发现"拖了没反应"。
 */
function runDragCheck(): void {
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }

  /** 合成一次指针事件（React 的合成事件同样吃 pointerdown/move/up） */
  function fire(el: Element, type: string, x: number, y: number): void {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1,
    });
    el.dispatchEvent(ev);
  }

  setTimeout(function () {
    void (async function () {
      const grid = (document.querySelector('.days') as HTMLElement).getBoundingClientRect();
      const days = Number(getComputedStyle(document.querySelector('.days') as HTMLElement).getPropertyValue('--cols')) || 5;
      const colW = grid.width / days;
      const rowH = grid.height / 12;
      const cards = Array.prototype.slice.call(document.querySelectorAll('.days .ev')) as HTMLElement[];
      if (cards.length === 0) { send('DRAGCHECK 课表里没有课，跳过'); return; }

      /** 挑一张右边还有列、上下都留了空位的卡（否则目标会被夹住，看起来像"没生效"） */
      function pickCard(): HTMLElement | null {
        const ok = cards.filter(function (c) {
          const r = c.getBoundingClientRect();
          return Number(c.getAttribute('data-day')) < days
            && r.top - grid.top > grid.height * 0.12 && grid.bottom - r.bottom > grid.height * 0.12;
        });
        return ok[0] || cards[0] || null;
      }

      /**
       * 跑一次拖动。centerY 决定抓哪儿：
       *   卡片垂直中点 → 整块移动（期望：换了天 / 换了节次）
       *   卡片上边缘   → 拉伸（期望：只改开始节次，天不变）
       */
      async function dragOnce(label: string, grab: 'middle' | 'top-edge'): Promise<void> {
        const card = pickCard();
        if (!card) { send('DRAGCHECK ' + label + '：没有可用的样本'); return; }
        const before = getState().data.overrides.length;
        const beforeAttrs = '周' + card.getAttribute('data-day') + ' 第' + card.getAttribute('data-start')
          + '-' + card.getAttribute('data-end') + ' 节';
        const r = card.getBoundingClientRect();
        const sx = r.left + r.width / 2;
        const sy = grab === 'middle' ? r.top + r.height / 2 : r.top + 4;
        fire(card, 'pointerdown', sx, sy);
        fire(card, 'pointermove', sx + 8, sy + 6);
        fire(card, 'pointermove', sx + colW * 1.5, sy + 6);
        const tx = sx + colW * 2;
        const ty = sy + rowH;
        fire(card, 'pointermove', tx, ty);
        /* 让 React 把预览画出来再读（状态更新是异步的，立刻读只会读到上一帧） */
        await new Promise(function (res) { requestAnimationFrame(function () { res(null); }); });
        const ghost = document.querySelector('.ev-drag-ghost');
        const ghostText = ghost ? (ghost.textContent || '') : '';
        fire(card, 'pointerup', tx, ty);
        await new Promise(function (res) { setTimeout(res, 350); });

        const st = getState();
        const added = st.data.overrides.length - before;
        const last = st.data.overrides[st.data.overrides.length - 1];
        send('DRAGCHECK【' + label + '】样本 ' + beforeAttrs + '，抓' + (grab === 'middle' ? '中间' : '上边缘')
          + ' → 预览=' + (ghostText ? '"' + ghostText + '"' : '（没出现）')
          + '，新增调整=' + added
          + (added > 0 && last ? ' patch=' + JSON.stringify(last.patch) : '')
          + '，计算=' + JSON.stringify((window as unknown as { __lastDrag?: unknown }).__lastDrag || null));
        /* 撤销回去：自检不该把用户的课表改了还留着 */
        if (added > 0) {
          undo();
          send('DRAGCHECK【' + label + '】撤销后 overrides=' + getState().data.overrides.length + '（应与拖动前一致）');
        }
      }

      await dragOnce('整块移动', 'middle');
      await dragOnce('拖上边缘改节数', 'top-edge');
    })();
  }, 1600);
}

/**
 * 文字被截断的普查（?clipcheck=1）。
 *
 * 与布局自检里那条 CLIPPED 不同：那条只看"设了 ellipsis / overflow:hidden"的元素，
 * 于是**行数限制（-webkit-line-clamp）被裁掉的内容根本不在统计里** ——
 * 而课表上那些课名正是这么被裁的。这个检查把两种情况都算上：
 *
 *   1. 单行溢出：scrollWidth > clientWidth（内容比盒子宽）
 *   2. 多行裁剪：设了 -webkit-line-clamp，且 scrollHeight > clientHeight（第 N 行之后被吃掉）
 *
 * 输出按"控件形态"聚合（谁、几处、最严重的一处的实际宽度与字号），
 * 并且带上两层祖先，便于直接定位到是哪一块面板。
 */
function runClipCheck(): void {
  let send = function (_text: string): void { /* 默认不回传 */ };
  try { send = makeReporter(new URLSearchParams(window.location.search).get('report') || ''); } catch (e) { /* 忽略 */ }

  setTimeout(function () {
    const all = Array.prototype.slice.call(document.querySelectorAll('body *')) as HTMLElement[];
    type Hit = { key: string; why: string; text: string; w: number; need: number; font: string; overflow: string; where: string };
    const hits: Hit[] = [];

    function pathOf(el: HTMLElement): string {
      const cls = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return el.tagName.toLowerCase() + cls;
    }
    function parentChain(el: HTMLElement): string {
      const out: string[] = [];
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i++) { out.push(pathOf(p)); p = p.parentElement; }
      return out.join(' < ');
    }

    for (const el of all) {
      /* 只统计直接带文字的叶子元素：容器的溢出由它的孩子体现，重复统计没意义 */
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      /* 横向滚动容器（课表本身就是可以横滑的）不算截断 */
      if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      const clamp = st.getPropertyValue('-webkit-line-clamp');
      const clamped = clamp && clamp !== 'none';
      /*
       * 扣掉"可点区域"伪元素的贡献：它是绝对定位、往外扩的，不占布局，
       * 却会被算进 scrollWidth —— 不扣的话每一个按钮都会被报成"溢出"（假阳性）。
       */
      let grow = 0;
      for (const p of ['::after', '::before']) {
        const a = getComputedStyle(el, p);
        if (!a || a.content === 'none' || a.position !== 'absolute') continue;
        const parts = a.inset.split(' ');
        const h = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
        if (!isNaN(h) && h < 0) grow += -h * 2;
      }
      const needPx = Math.max(0, el.scrollWidth - grow);
      const wide = needPx > el.clientWidth + 1 && el.clientWidth > 0;
      const tall = clamped && el.scrollHeight > el.clientHeight + 1;
      if (!wide && !tall) continue;
      /*
       * 分两种，别混为一谈：
       *   截断 —— 盒子真的把文字吃掉了（overflow hidden / ellipsis / 行数限制），用户看不到完整内容；
       *   溢出 —— 内容比盒子宽，但没被吃掉（overflow visible），视觉上是"字跑出边框外面"。
       * 前者是这一轮要修的"文字被截断"，后者是排版没对齐，也要修但不该算进同一个数字。
       */
      const eats = st.overflowX === 'hidden' || st.overflowX === 'clip'
        || st.textOverflow === 'ellipsis' || (st.overflow === 'hidden') || clamped;
      hits.push({
        key: pathOf(el),
        why: (tall ? '多行裁剪' : (eats ? '截断' : '溢出可见')),
        text: txt.slice(0, 18),
        w: Math.round(el.clientWidth),
        need: Math.max(needPx, el.clientWidth),
        font: parseFloat(st.fontSize).toFixed(1) + 'px',
        overflow: st.overflowX + (st.textOverflow === 'ellipsis' ? '/ellipsis' : ''),
        where: parentChain(el),
      });
    }

    /* 聚合：同一形态归一条，附最严重的那处 */
    const byKey = new Map<string, { n: number; worst: Hit }>();
    for (const h of hits) {
      const k = h.key + '|' + h.why;
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { n: 1, worst: h });
      else { cur.n++; if (h.need - h.w > cur.worst.need - cur.worst.w) cur.worst = h; }
    }
    const sorted = Array.from(byKey.entries()).sort(function (a, b) { return b[1].n - a[1].n; });
    const eaten = hits.filter(function (h) { return h.why !== '溢出可见'; });
    send('CLIPCHECK 视口=' + window.innerWidth + 'x' + window.innerHeight
      + ' 真正被截断=' + eaten.length + ' 处，溢出但可见=' + (hits.length - eaten.length) + ' 处，共 ' + sorted.length + ' 类');
    for (const [k, v] of sorted.slice(0, 14)) {
      const w = v.worst;
      send('CLIPCHECK ' + k.split('|')[0] + ' ×' + v.n + ' [' + w.why + '] overflow=' + w.overflow
        + ' 实宽=' + w.w + ' 需=' + w.need + ' 字号=' + w.font + ' 文本="' + w.text + '" 位置=' + w.where);
    }
    /* 顺带把最宽的几处列出来，便于判断"是不是整体太窄" */
    const widest = eaten.slice().sort(function (a, b) { return (b.need - b.w) - (a.need - a.w); }).slice(0, 6);
    for (const w of widest) send('CLIPCHECK 最严重 ' + w.key + ' 差=' + (w.need - w.w) + 'px 文本="' + w.text + '"');
  }, 1800);
}

export function runDiagnostics(): void {
  const params = new URLSearchParams(window.location.search);

  if (params.get('widgetcheck')) runWidgetCheck();
  if (params.get('perf')) {
    const sec = Number(params.get('perf'));
    runPerfCheck(isFinite(sec) && sec >= 3 ? Math.min(120, sec) : 10);
  }
  if (params.get('framecheck') === '1') runFrameCheck();
  if (params.get('histcheck')) runHistoryCheck(Number(params.get('histcheck')));
  if (params.get('ovcheck') === '1') runOverrideCheck();
  if (params.get('wp') === '1') runWidgetPreviewCheck();
  if (params.get('dragcheck') === '1') runDragCheck();
  if (params.get('plugcheck') === '1') runPluginCheck();
  if (params.get('clipcheck') === '1') runClipCheck();
  if (params.get('behavecheck')) {
    const sec = Number(params.get('behavecheck'));
    runBehaviorCheck(isFinite(sec) && sec >= 5 ? Math.min(180, sec) : 30);
  }

  /* ?img=1 ：渲染课表图片并留在 DOM 里，供外部提取检查 */
  if (params.get('img') === '1') {
    setTimeout(function () {
      void (async function () {
        try {
          const st = getState();
          const days = st.theme.showDays || 7;
          const canvas = renderTimetableImage(st.data, {
            week: st.week, days: days, theme: st.theme, systemDark: st.systemDark,
          });
          const url = canvas.toDataURL('image/png');
          const info = document.createElement('pre');
          info.id = 'imginfo';
          info.style.cssText = 'position:relative;z-index:99999;font:12px monospace;background:#000;color:#0f0;padding:4px;margin:0;';
          info.textContent = 'IMAGE ' + canvas.width + 'x' + canvas.height + ' bytes=' + Math.round(url.length * 0.75) + ' urlLen=' + url.length;
          document.body.appendChild(info);
          const img = document.createElement('img');
          img.id = 'imgout';
          img.src = url;
          img.style.cssText = 'max-width:100%;display:block;';
          document.body.appendChild(img);
        } catch (e) {
          const info = document.createElement('pre');
          info.id = 'imginfo';
          info.textContent = 'IMAGE FAILED: ' + (e as Error).message;
          document.body.appendChild(info);
        }
      })();
    }, 1600);
  }

  const widths = (params.get('w') || '').split(',').map(function (s) { return Number(s.trim()); })
    .filter(function (n) { return n > 0; });

  function describe(el: HTMLElement): string {
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + cls;
  }

  function measure(win: Window, label: string): string[] {
    const doc = win.document;
    const de = doc.documentElement;
    const out: string[] = [];
    const vw = de.clientWidth;
    const vh = de.clientHeight;
    out.push('=== ' + label + ' | viewport ' + vw + 'x' + vh + ' | hscroll ' + (de.scrollWidth - vw) + ' ===');

    const isFixed = function (el: HTMLElement): boolean {
      let n: HTMLElement | null = el;
      while (n && n !== doc.body) {
        if (win.getComputedStyle(n).position === 'fixed') return true;
        n = n.parentElement;
      }
      return false;
    };

    const all = doc.querySelectorAll('body *');
    const wide: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (isFixed(el)) continue;
      /*
       * 横向滚动容器里的内容"超出视口"是**设计如此**：用户滑一下就能看到。
       * 原来这里靠一串选择器逐个豁免（.week-strip / .preset-scroll …），
       * 于是每加一个横向滚动区就得记得回来补一笔 —— 课表主体改成可横滑之后就漏了，
       * 一次报出 16 条假溢出。现在改成按**样式**判断：祖先里有 overflow-x: auto/scroll
       * 的元素一律不算溢出；真正的页面级横滚由 hscroll 那条指标管。
       */
      let scroller: HTMLElement | null = el.parentElement;
      let insideScroller = false;
      while (scroller && scroller !== doc.body) {
        const ox = win.getComputedStyle(scroller).overflowX;
        if (ox === 'auto' || ox === 'scroll') { insideScroller = true; break; }
        scroller = scroller.parentElement;
      }
      if (insideScroller) continue;
      if (el.closest('.tl') || el.closest('.wgt-grid')) continue;
      if (r.width > vw + 1 || r.right > vw + 1 || r.left < -1) {
        wide.push(describe(el) + ' w=' + Math.round(r.width) + ' R=' + Math.round(r.right));
      }
    }
    out.push('OVERFLOW ' + wide.length);
    for (const w of wide.slice(0, 8)) out.push('  ! ' + w);

    const small: string[] = [];
    const clickable = doc.querySelectorAll('button, a, input, select, [role="button"]');
    for (let i = 0; i < clickable.length; i++) {
      const el = clickable[i] as HTMLElement;
      const r = el.getBoundingClientRect();
      const st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      if (r.width === 0 && r.height === 0) continue;
      if (el.getAttribute('type') === 'file') continue;
      const grow = function (pseudo: string) {
        const a = win.getComputedStyle(el, pseudo);
        if (!a || a.content === 'none' || a.position !== 'absolute') return 0;
        const vals = a.inset.split(' ');
        const v = parseFloat(vals[0]);
        return isNaN(v) || v >= 0 ? 0 : -v;
      };
      const g = Math.max(grow('::after'), grow('::before'));
      const w = r.width + g * 2;
      const h = r.height + g * 2;
      /*
       * 判定标准：**两个方向都小于 44** 才算过小。
       *
       * 早先是"任一方向小于 44 就报"，结果 37×134 的课程卡（面积五千多平方像素、
       * 手指随便点）每次都被列进来十一二条 —— 真问题反而被淹掉。
       * 这种假阳性我们在 WRAP 那条指标上吃过一次亏，这里一并改掉。
       */
      if (w < 44 && h < 44) small.push(describe(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (g ? ' tap=' + Math.round(w) + 'x' + Math.round(h) : ''));
    }
    out.push('SMALL_TAP ' + small.length);
    for (const s of small.slice(0, 12)) out.push('  ! ' + s);

    const tiny: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (!el.firstChild || el.firstChild.nodeType !== 3) continue;
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      const st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const fs = parseFloat(st.fontSize);
      if (fs < 11) tiny.push(describe(el) + ' ' + fs.toFixed(1) + 'px');
    }
    out.push('TINY_FONT ' + tiny.length + (tiny.length ? '  (' + tiny.slice(0, 4).join(', ') + ')' : ''));

    const clipped: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (!el.firstChild || el.firstChild.nodeType !== 3) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const st = win.getComputedStyle(el);
        if (st.textOverflow === 'ellipsis' || st.overflow === 'hidden') clipped.push(describe(el));
      }
    }
    out.push('CLIPPED ' + clipped.length);

    /**
     * 断行检测：本该一行放下的文字被挤成了两行。
     *
     * 判据是「元素高度 ÷ 行高」——单个文本节点、没有 <br>、不是 nowrap 的元素，
     * 如果高度超过 1.5 倍行高，那就是换行了。
     * 段落类（.lr-sub / .desc / p 等）本来就该换行，排除掉。
     */
    const ALLOW_WRAP = /(^|\s)(desc|lr-sub|note|hint|body|paragraph|msg|text-block)(\s|$)|^(P|LI|TD)$/;
    /* 说明书/更新日志是**文档**，正文本来就该换行。不排除掉的话，
       一次 320px 的检查会刷出七十多条"本该一行放下"的假阳性。 */
    const PROSE = /(^|\s)(doc-p|doc-lead|doc-note|doc-a|doc-step-d|doc-q|log-text|log-title|panel-desc|check-how)(\s|$)/;
    /**
     * 断行检测：把元素整份克隆到一个 nowrap + max-content 的离屏容器里量一次，
     * 得到"这一行字本需要多宽"，再跟它实际拿到的宽度比。
     * 克隆法能连子元素（图标 + 文字）一起算，比只看单个文本节点准得多。
     */
    const wrapped: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      const txt = (el.textContent || '').trim();
      if (txt.length < 2) continue;
      const st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      if (st.whiteSpace === 'nowrap' || st.whiteSpace === 'pre') continue;
      if (el.tagName === 'PRE' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (ALLOW_WRAP.test(cls) || ALLOW_WRAP.test(el.tagName) || PROSE.test(cls)) continue;
      /* 子元素里还有块级文本的，留给它自己去报，避免重复 */
      const hasBlockChild = Array.prototype.some.call(el.children, function (c: HTMLElement) {
        const d = win.getComputedStyle(c).display;
        return d === 'block' || d === 'flex' || d === 'grid';
      });
      if (hasBlockChild) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) continue;

      /**
       * 克隆必须挂回**原来的父节点**，否则丢掉继承下来的字号 ——
       * 挂到 body 下会按 14px 量，而 .tab 里的文字其实是 11px，
       * 量出来全部偏大、整张表都是假阳性。
       */
      const holder = el.parentElement || doc.body;
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.position = 'absolute';
      clone.style.left = '-9999px';
      clone.style.top = '0';
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      clone.style.whiteSpace = 'nowrap';
      clone.style.visibility = 'hidden';
      clone.style.pointerEvents = 'none';
      holder.appendChild(clone);
      const need = clone.getBoundingClientRect().width;
      clone.remove();

      if (need <= r.width + 0.5) continue;
      const inner = Math.max(1, r.width - (parseFloat(st.paddingLeft) + parseFloat(st.paddingRight)));
      const lines = Math.max(2, Math.round(need / inner));
      const parent = el.parentElement ? describe(el.parentElement) : '?';
      wrapped.push(describe(el) + ' 需' + Math.round(need) + '>实' + Math.round(r.width) +
        ' "' + txt.slice(0, 16) + '" ~' + lines + '行 父=' + parent + ' fs=' + st.fontSize);
    }
    out.push('WRAP ' + wrapped.length);
    for (const w of wrapped.slice(0, 18)) out.push('  ~ ' + w);

    /**
     * 内容比容器高 = 已经撑破或裁切了，这是硬伤。
     * 但要忽略"触控外扩"伪元素 —— 那些 inset 为负的 ::after 本来就会超出边框，
     * 不排除掉的话，每一个外扩控件都会报一次假警。
     */
    const grows = function (el: HTMLElement): boolean {
      for (const pseudo of ['::after', '::before']) {
        const a = win.getComputedStyle(el, pseudo);
        if (!a || a.content === 'none' || a.position !== 'absolute') continue;
        const v = parseFloat(a.inset.split(' ')[0]);
        if (!isNaN(v) && v < 0) return true;
      }
      return false;
    };
    const overY: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (el.scrollHeight <= el.clientHeight + 2 || el.clientHeight <= 0 || el.clientWidth <= 0) continue;
      const st = win.getComputedStyle(el);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll') continue;
      if (el.closest('.sheet-body') || el.closest('.week-scroll')) continue;
      /* 逐帧图的裁剪容器：它**本来就该**把整张雪碧图裁成一格（overflow:hidden），
         报它溢出是假阳性，而且会把真正的溢出淹掉 */
      if (el.classList.contains('mascot-sheet')) continue;
      /*
       * 大号展示数字（今日页那块课时数）：`line-height: 1` 是这类字的常规写法，
       * 而字体自身的墨迹盒（ascent + descent）比 1em 高 —— 实测 34px 的字要占 42px，
       * 于是 scrollHeight 永远大于 clientHeight。但父元素有 14px 下内边距，
       * 字**一点没被裁**。这是度量口径问题，不是布局问题。
       */
      if (el.closest('.hero-count')) continue;
      if (grows(el)) continue;
      /* 子元素里只要有一个带外扩，容器也会被算高 */
      let hasGrowChild = false;
      const kids = el.querySelectorAll('*');
      for (let k = 0; k < kids.length; k++) {
        if (grows(kids[k] as HTMLElement)) { hasGrowChild = true; break; }
      }
      if (hasGrowChild) continue;
      overY.push(describe(el) + ' 内容高' + el.scrollHeight + '>框高' + el.clientHeight);
    }
    out.push('OVERFLOW_Y ' + overY.length);
    for (const o of overY.slice(0, 10)) out.push('  ^ ' + o);

    const metric = function (sel: string, label2: string) {
      const el = doc.querySelector(sel) as HTMLElement | null;
      if (!el) { out.push('M ' + label2 + '=none'); return; }
      const r = el.getBoundingClientRect();
      out.push('M ' + label2 + '=' + Math.round(r.width) + 'x' + Math.round(r.height));
    };
    metric('.axis', 'axis');
    metric('.ev', 'card');
    metric('.topbar', 'topbar');
    metric('.tabbar', 'tabbar');
    metric('.icon-btn', 'iconbtn');
    metric('.week-pill', 'pill');
    metric('.chip', 'chip');
    metric('.btn.sm', 'btnsm');

    /*
     * 角色浮层：两条要守住的底线。
     *   1. 它是 fixed 定位，本来就不该产生任何溢出 —— 一旦参与布局，窄屏必破；
     *   2. 它默认不该盖住可点控件。盖住了也点得到（外层 pointer-events:none），
     *      但视觉上挡着按钮仍然算问题，所以把遮挡数报出来。
     */
    const mascotEl = doc.querySelector('.mascot') as HTMLElement | null;
    if (!mascotEl) {
      out.push('MASCOT none');
    } else {
      const mr = mascotEl.getBoundingClientRect();
      let covered = 0;
      /* 角色处在穿透状态（外观页）时它谁也挡不住，几何重叠不算问题 */
      const passive = win.getComputedStyle(mascotEl).pointerEvents === 'none';
      if (!passive) {
        const clickable2 = doc.querySelectorAll('button, a, input, select, [role="button"]');
        for (let i = 0; i < clickable2.length; i++) {
          const el = clickable2[i] as HTMLElement;
          if (mascotEl.contains(el) || el.contains(mascotEl)) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx >= mr.left && cx <= mr.right && cy >= mr.top && cy <= mr.bottom) covered++;
        }
      }
      /*
       * 除了几何遮挡，还要问一句"它是不是画在最上面"。
       *
       * 几何上不重叠、却依然看不见 —— 这正是类名撞车那次的症状：
       * 一个 position:fixed 的元素盖住了角色，而角色自己的 rect 一切正常。
       * 判法是临时的：把 pointer-events 打开问一次 elementFromPoint，
       * 因为 elementFromPoint 会**跳过 pointer-events:none 的元素**，不问就等于没测。
       */
      let onTop = '?';
      try {
        const saved = mascotEl.style.pointerEvents;
        mascotEl.style.pointerEvents = 'auto';
        const hit = doc.elementFromPoint(mr.left + mr.width / 2, mr.top + mr.height / 2) as HTMLElement | null;
        mascotEl.style.pointerEvents = saved;
        onTop = hit && (hit === mascotEl || mascotEl.contains(hit)) ? 'yes' : ('no(' + (hit ? hit.className || hit.tagName : 'null') + ')');
      } catch (e) {
        onTop = 'error';
      }

      out.push('MASCOT ' + Math.round(mr.width) + 'x' + Math.round(mr.height) +
        ' 位置' + Math.round(mr.left) + ',' + Math.round(mr.top) +
        ' 素材=' + (mascotEl.getAttribute('data-kind') || '?') +
        ' 相位=' + (mascotEl.getAttribute('data-phase') || '?') +
        ' 顶层=' + onTop +
        ' 遮挡可点控件=' + covered + (passive ? '（当前穿透）' : ''));
    }

    /*
     * 外观锁定到底锁住了多少。
     *
     * 这一项是被真实 bug 逼出来的：锁定规则原来只列了 button / input / switch 这些选择器，
     * 而「角色」面板的动作**几乎全是** `list-row tap` —— 于是外观锁着的时候
     * 角色设置整块照样点得动（其中「移除角色」会顺手清掉素材）。
     * 一个"锁了但没锁全"的机制是看不出来的，只能量：
     * 数一遍"锁定时仍然能点的面板控件"，它必须是 0。
     */
    const lockedStudio = doc.querySelector('.studio.locked');
    if (lockedStudio) {
      const cand = lockedStudio.querySelectorAll(
        '.panel button, .panel input, .panel select, .panel .list-row.tap, .panel [role="button"], .panel .switch, .panel .upload-zone'
      );
      const still: string[] = [];
      for (let i = 0; i < cand.length; i++) {
        const el = cand[i] as HTMLElement;
        const st = win.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (st.pointerEvents !== 'none') still.push(describe(el) + '(' + st.pointerEvents + ')');
      }
      /*
       * 解锁入口必须存在，而且必须能点 ——
       * "锁住了但找不到解锁"比不锁更糟。顶部那条是吸顶的，滚到下面时看不见，
       * 所以角色面板里还有一条自带解锁按钮的提示（.studio-lock.inline）。
       */
      const unlockBtns = lockedStudio.querySelectorAll('.studio-lock .btn');
      let usable = 0;
      for (let i = 0; i < unlockBtns.length; i++) {
        if (win.getComputedStyle(unlockBtns[i] as HTMLElement).pointerEvents !== 'none') usable++;
      }
      out.push('LOCK 锁定时仍可点的面板控件=' + still.length + ' 解锁入口=' + unlockBtns.length + '(可用 ' + usable + ')');
      for (const s of still.slice(0, 10)) out.push('  ! ' + s);
    }

    /*
     * 写作标记有没有漏到界面上。
     *
     * 说明书和更新日志的正文是普通字符串，约定里允许用 `**` 标重点，由组件转成加粗；
     * 只要有一处忘了走渲染，用户看到的就是一对裸星号 —— 这种细节光看代码看不出来
     * （写的时候满屏都是 `**`），只能渲染完再扫一遍 DOM。
     */
    let stars = 0;
    const starWhere: string[] = [];
    try {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const txt = node.nodeValue || '';
        if (txt.indexOf('**') < 0) continue;
        stars++;
        const pe = node.parentElement;
        starWhere.push((pe ? describe(pe) : '?') + ' "' + txt.trim().slice(0, 24) + '"');
      }
    } catch (e) { /* 拿不到就算了 */ }
    out.push('MARKDOWN 未渲染的 ** 标记=' + stars);
    for (const s of starWhere.slice(0, 5)) out.push('  ! ' + s);

    /* 标签栏：格子数和实际项数对不上时，多出来的项会掉到第二行并被裁掉 */
    const tabs = doc.querySelectorAll('.tab');
    const tabbarEl = doc.querySelector('.tabbar') as HTMLElement | null;
    if (tabbarEl && tabs.length > 0) {
      const br = tabbarEl.getBoundingClientRect();
      const parts: string[] = [];
      for (let i = 0; i < tabs.length; i++) {
        const r = (tabs[i] as HTMLElement).getBoundingClientRect();
        const inside = r.top >= br.top - 1 && r.bottom <= br.bottom + 1 && r.width > 0;
        parts.push('#' + (i + 1) + (inside ? '✓' : '✗出框') + Math.round(r.top) + '-' + Math.round(r.bottom));
      }
      out.push('TABBAR ' + tabs.length + '项 框' + Math.round(br.top) + '-' + Math.round(br.bottom) + '  ' + parts.join(' '));
    }

    const cs = win.getComputedStyle(de);
    out.push('VARS axis=' + cs.getPropertyValue('--axis-w').trim() + ' pad=' + cs.getPropertyValue('--pad').trim() + ' row=' + cs.getPropertyValue('--row-h').trim());

    /*
     * 应用壳还在不在。
     *
     * React 在渲染期抛异常会**卸载整棵树**，界面上是一片白 —— 没有报错、没有按钮。
     * 这类问题 tsc 和单测都抓不到（v0.13.0 那次 hook 数量不一致就是这么漏出去的），
     * 所以检查里留一条硬信号：root 被清空就是崩了。
     */
    const rootEl = doc.getElementById('root');
    const rootLen = rootEl ? rootEl.innerHTML.length : -1;
    out.push('ROOT ' + (rootLen < 0 ? 'missing'
      : (rootLen < 200 ? 'EMPTY(' + rootLen + ') 渲染崩了' : 'ok(' + rootLen + ')')));
    out.push('PLATFORM ' + platformName());

    /*
     * 电脑布局的实测数据。
     *
     * 宽屏那套样式是"整块只在 .app.wide 下生效"的，靠肉眼看截图分不出
     * "样式没生效" 和 "元素本来就在那儿" —— 所以量出来：
     * 侧边栏多宽、内容区多宽、课表网格多宽、设置页排了几列、弹层是不是居中的方块。
     */
    const wideApp = doc.querySelector('.app.wide');
    if (wideApp) {
      const nav = doc.querySelector('.tabbar') as HTMLElement | null;
      const content = doc.querySelector('.content') as HTMLElement | null;
      const grid = doc.querySelector('.week-grid') as HTMLElement | null;
      const twoCol = doc.querySelector('.content-inner.two-col') as HTMLElement | null;
      const sheet = doc.querySelector('.sheet') as HTMLElement | null;
      const box = function (el: HTMLElement | null): string {
        if (!el) return 'none';
        const r = el.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top);
      };
      /*
       * 列数不能读 columnCount —— 用的是 column-width（写死列数会把窄窗口挤爆），
       * 它算出来永远是 auto。所以数一下直接子元素落在几个不同的左边界上，
       * 那就是真实排出来的列数。
       */
      let cols = '-';
      if (twoCol) {
        /* 分列作用在里面那一层（外层只有一个子 div），所以取的是它的子元素 */
        const flow = (twoCol.children.length === 1 && twoCol.children[0].children.length > 1)
          ? twoCol.children[0] : twoCol;
        const seen: Record<number, boolean> = {};
        for (let i = 0; i < flow.children.length; i++) {
          seen[Math.round((flow.children[i] as HTMLElement).getBoundingClientRect().left)] = true;
        }
        cols = String(Object.keys(seen).length);
        out.push('DESKTOP-COLS panels=' + flow.children.length + ' cols=' + cols);
      }
      out.push('DESKTOP nav=' + box(nav) + ' content=' + box(content)
        + ' grid=' + box(grid) + ' sheet=' + box(sheet)
        + ' panels=' + (twoCol ? twoCol.children.length : 0) + ' cols=' + cols
        + ' brand=' + !!doc.querySelector('.tab-brand')
        + ' get=' + !!doc.querySelector('.tab-get')
        + ' rowH=' + win.getComputedStyle(wideApp).getPropertyValue('--row-h').trim());
    } else {
      out.push('DESKTOP off');
    }

    /*
     * ?text=选择器 —— 把匹配到的可见文字回传。
     *
     * 平台分支（Android / 网页版）是靠 isNativePlatform() 当场选的，静态检查看不出来
     * 到底渲染了哪一支。文案检查又只能看真实渲染结果，所以在检查里留一个取文本的口子：
     * 带上选择器就能读到这一屏上真正写的是什么，而不是猜。
     */
    const textSel = params.get('text');
    if (textSel) {
      try {
        const nodes = doc.querySelectorAll(textSel);
        out.push('TEXT ' + textSel + ' n=' + nodes.length);
        for (let i = 0; i < Math.min(8, nodes.length); i++) {
          const raw = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
          out.push('  #' + i + '[' + Math.round((nodes[i] as HTMLElement).getBoundingClientRect().height)
            + 'px] ' + raw.slice(0, 460));
        }
      } catch (e) {
        out.push('TEXT ' + textSel + ' 选择器无效: ' + (e as Error).message);
      }
    }
    return out;
  }

  /** 把检查文本回传（仅 ?report= 时）。分块发，单条 URL 太长会被浏览器丢掉 */
  function beaconLines(lines: string[]): void {
    let send = function (_t: string): void { /* 默认不回传 */ };
    try { send = makeReporter(params.get('report') || ''); } catch (e) { /* 忽略 */ }
    const text = lines.join(' | ');
    const CHUNK = 600;
    const total = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < total; i++) {
      send('DIAG ' + (i + 1) + '/' + total + ' ' + text.slice(i * CHUNK, (i + 1) * CHUNK));
    }
  }

  function render(lines: string[]): void {
    beaconLines(lines);
    const pre = document.createElement('pre');
    pre.id = 'diag';
    pre.style.cssText = 'position:relative;z-index:99999;font:10px monospace;white-space:pre-wrap;background:#000;color:#0f0;margin:0;padding:4px;';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);
  }

  if (widths.length === 0) {
    setTimeout(function () { render(measure(window, 'current')); }, 1500);
    return;
  }

  const results: string[] = [];
  let idx = 0;
  const base = window.location.pathname + window.location.search.replace(/[?&]diag=1/, '').replace(/[?&]w=[^&]*/, '');

  function next(): void {
    if (idx >= widths.length) { render(results); return; }
    const w = widths[idx];
    idx++;
    const h = Math.round(w * 2.05);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + w + 'px;height:' + h + 'px;border:0;';
    frame.src = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'frame=1';
    document.body.appendChild(frame);
    setTimeout(function () {
      try { results.push.apply(results, measure(frame.contentWindow as Window, w + 'px')); }
      catch (e) { results.push('=== ' + w + 'px | 测量失败: ' + (e as Error).message + ' ==='); }
      frame.remove();
      next();
    }, 2200);
  }
  next();
}
