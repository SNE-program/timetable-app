import React from 'react';
import { openManual, patchMascotPrefs, resetMascotPosition, setTab, showToast, useApp } from '../app/store';
import {
  STIR_MAX_MS, STIR_MIN_MS, STIR_WAKE_MAX_MS, STIR_WAKE_MIN_MS,
  advance, assetKeyFor, energyOf, initialRuntime, nextWakeAt, poke, touch, type MascotPhase,
} from '../mascot/motion';

import { BEHAVIORS } from '../mascot/motion';
import { clampAnchor, planWalkStep, walkRoom, type Insets } from '../mascot/placement';
import { nextEvent, todayISO } from '../core/engine';
import MascotArt from './MascotArt';
import { Icon } from './icons';
import { frameCount, type MascotAsset, type MascotState } from '../mascot/types';

/**
 * 课表界面上的「角色」。
 *
 * 这里只管**位置、手势、状态机**；"画出来"那部分在 `MascotArt` 里，
 * 因为编辑器里的预览要用同一段代码。
 *
 * ## 几条必须守住的约束
 *
 *   1. **不参与布局**：`position: fixed` 浮层。它一旦进文档流，
 *      320px 窄屏上的排版立刻会变（这个坑我们踩过好几次）。
 *   2. **默认不挡任何可点控件**：外层 `pointer-events: none`，
 *      只有角色本体是 auto。这样即使它飘在某个按钮上面，点下去还是按钮。
 *   3. **只动 transform / opacity**：改 width/height/margin 会让整页重排。
 *   4. **只在安全区里活动**：上不钻顶栏、下不压标签栏，横竖屏换算后重新钳制。
 *   5. **尊重"减弱动态效果"**，页面不可见就停。
 */

/** 位移小于这个像素数就算"点了一下"，不算拖动 */
const TAP_SLOP = 6;
/** 按住多久弹快捷菜单。和课程卡的长按（600ms）保持一致 */
const LONG_PRESS_MS = 600;
/** 课前多久开始"招手" */
const GREET_WINDOW_MS = 10 * 60 * 1000;
/** 招手的间隔范围：随机取值，固定间隔会变成准点报时 */
const GREET_MIN_MS = 18 * 1000;
const GREET_MAX_MS = 32 * 1000;
/** 互动次数的统计窗口：这段时间内被逗过几次，会短暂影响它的"精神头" */
const INTERACTION_WINDOW_MS = 3 * 60 * 1000;

/** 顶栏 / 标签栏都测不到时的兜底值（贴着常见尺寸，宁可保守） */
const FALLBACK_INSETS: Insets = { top: 96, bottom: 60 };

/**
 * 检查用的打盹快进：`?doze=<秒>`。
 *
 * 正常的打盹节奏是"睡 45–150 秒 → 醒 4–14 秒"，一条 60 秒的自检最多只等到一轮。
 * 传了这个参数之后：多久算睡着 = 参数秒数，醒与睡那两段按同一比例压短 ——
 * 于是 "睡 → 醒 → 走两步 → 打哈欠 → 再睡" 这条路径在无头浏览器里也能验。
 * 不带参数时它返回 null，正常节奏一个字节都不改。
 */
interface DozeDev {
  sleepAfterMs: number;
  stirMs: { min: number; max: number };
  wakeMs: { min: number; max: number };
}

function readDozeDev(): DozeDev | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('doze');
    const sec = raw === null ? NaN : Number(raw);
    if (!isFinite(sec) || sec <= 0) return null;
    /* 以 60 秒为基准缩放：doze=6 就是"睡 6 秒"，睡/醒两段缩到十分之一 */
    const f = Math.max(0.03, Math.min(1, sec / 60));
    return {
      sleepAfterMs: Math.max(3000, Math.round(sec * 1000)),
      stirMs: {
        min: Math.max(1000, Math.round(STIR_MIN_MS * f)),
        max: Math.max(1200, Math.round(STIR_MAX_MS * f)),
      },
      wakeMs: {
        min: Math.max(1500, Math.round(STIR_WAKE_MIN_MS * Math.max(0.4, f))),
        max: Math.max(2000, Math.round(STIR_WAKE_MAX_MS * Math.max(0.4, f))),
      },
    };
  } catch (e) {
    return null;
  }
}

/**
 * 锚点离可用区域边缘的余量。
 *
 * 只留 6px：角色可以一半挂在屏幕外，但"落脚点"要留在能按住的地方。
 * 留太多就等于又把可移动范围收窄回去了 —— 那是上一版的问题。
 */
const EDGE = 6;

export default function MascotOverlay() {
  const s = useApp();
  const pack = s.mascot;
  const mp = s.prefs.mascot;

  /*
   * 随机源只在这里取一次，然后注入状态机。
   *
   * 状态机本身**不调用 Math.random**（见 mascot/motion.ts 的说明）——
   * 这样它在单测里是可复现的，而"真随机"这件事只在这一个地方发生。
   */
  const rngRef = React.useRef<() => number>(function () { return Math.random(); });
  /** 最近几次互动的时刻，用来算"刚被逗过，更活泼一点" */
  const interactionsRef = React.useRef<number[]>([]);

  /** 打盹快进的参数（只有带 ?doze= 时才有值，见 readDozeDev） */
  const dozeDev = React.useMemo(function () { return readDozeDev(); }, []);

  const [rt, setRt] = React.useState(function () { return initialRuntime(Date.now(), rngRef.current); });
  const [dragging, setDragging] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const [pageVisible, setPageVisible] = React.useState(true);
  const [menu, setMenu] = React.useState(false);
  const [dragPos, setDragPos] = React.useState<{ x: number; y: number } | null>(null);
  const [view, setView] = React.useState(function () {
    return { w: window.innerWidth, h: window.innerHeight, stamp: 0 };
  });
  const [clock, setClock] = React.useState(function () { return Date.now(); });

  /*
   * 反应序号：每次被点 +1，让"同一种反应连着两次"也能重新播动画。
   * 自发小动作（没人点也会蹦一下）走的是状态机里那个 reactionSeq ——
   * 两个加起来传给画图那一层，任何一路发起反应都能可靠地重启动画。
   */
  const [reactionSeq, setReactionSeq] = React.useState(0);
  /*
   * 角色的最外层节点。
   *
   * 两处要用：读"走动时的瞬时横向偏移"（拖动时要把这点偏移补进起点，
   * 否则抓着正在走的角色会跳一下），以及自检量它到底走了多远。
   */
  const elRef = React.useRef<HTMLDivElement>(null);
  /*
   * 走动的状态。
   *
   * 模型是「家 + 漂移」：家是用户放它的地方（只有拖动才变），走动是在家附近漂移，
   * **走完不回到原点**（用户明确要的「允许偏离原位」）—— 离家的最大偏离有上限，
   * 越界与离家太远两种情况都在 walkRoom/planWalkStep 里算死。
   * 全部放在 ref 里：走动是多秒级的连续过程，不需要每帧触发 React 重渲染。
   */
  const driftRef = React.useRef(0);            /* 当前漂移（px，相对家） */
  /*
   * 这一趟的落点与时长。
   *
   * 必须放**state**而不是 ref：ref 改了不会重渲染，于是"新的 translate 目标"
   * 永远写不进 DOM —— 走动看起来完全没动（第一次验证就是这么翻的车：
   * 100 秒里锚点只动了 4px，那 4px 还是呼吸缩放带出来的）。
   */
  const [walkPlan, setWalkPlan] = React.useState<{ to: number; ms: number; dir: 1 | -1 } | null>(null);
  const walkRoomRef = React.useRef<{ lo: number; hi: number } | null>(null);
  const dragRef = React.useRef({ active: false, moved: 0, startX: 0, startY: 0, originX: 0, originY: 0 });
  const pressRef = React.useRef<number | null>(null);
  const lastGreet = React.useRef(0);

  /*
   * 只在课表页出现。
   *
   * 外观页和设置页**不放人物模型** —— 那两页是拿来调东西的，屏幕上全是控件，
   * 角色杵在那里既挡视线又容易让人以为某个按钮坏了。它属于课表页。
   */
  const onTimetable = s.tab === 'week' || s.tab === 'today' || s.tab === 'tasks';
  const active = !!pack && !mp.hidden && onTimetable;

  /* 系统"减弱动态效果" */
  React.useEffect(function () {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { mq = null; }
    if (!mq) return;
    const apply = function (): void { setReduced(!!mq && mq.matches); };
    apply();
    mq.addEventListener('change', apply);
    return function () { if (mq) mq.removeEventListener('change', apply); };
  }, []);

  /* 切到后台就停：定时器在后台跑是纯耗电 */
  React.useEffect(function () {
    const onVis = function (): void { setPageVisible(document.visibilityState !== 'hidden'); };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return function () { document.removeEventListener('visibilitychange', onVis); };
  }, []);

  /*
   * 视口变化（转屏、分屏、软键盘）时把位置收回来。
   * 不重算的话，横屏下原本合法的位置可能正好落在标签栏上。
   */
  React.useEffect(function () {
    let timer: number | null = null;
    const onResize = function (): void {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        setView({ w: window.innerWidth, h: window.innerHeight, stamp: Date.now() });
      }, 200);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return function () {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  /* 每 30 秒看一眼下一节课 —— 课前招手 / 深夜早睡的判据都在这里 */
  React.useEffect(function () {
    if (!active || !pageVisible) return;
    const id = window.setInterval(function () { setClock(Date.now()); }, 30000);
    return function () { window.clearInterval(id); };
  }, [active, pageVisible]);

  /*
   * 心情：每 30 秒根据"现在几点、下一节课还有多久"重算一次。
   *
   * 它有三件事要做，别只把它当成"睡觉计时器"：
   *   1. soon    —— 临近上课要招手（角色唯一跟课表有关的行为）
   *   2. sleepy  —— 深夜或今天的课上完了，睡得更早
   *   3. energy  —— **精神头**，直接决定它平时怎么动：能量高就多抖两下、动作快而大，
   *                 能量低就多打哈欠、动作慢而小。这是"性格"能被感觉到的关键。
   */
  const mood = React.useMemo(function () {
    const now = new Date(clock);
    const hour = now.getHours();
    let soon = false;
    let leftToday = false;
    let minutesToClass: number | null = null;
    try {
      const nx = nextEvent(s.data, now);
      if (nx) {
        const ms = nx.startsInMinutes * 60000;
        soon = !nx.ongoing && ms >= 0 && ms <= GREET_WINDOW_MS;
        leftToday = nx.event.date === todayISO();
        if (!nx.ongoing && isFinite(nx.startsInMinutes)) minutesToClass = Math.max(0, Math.round(nx.startsInMinutes));
      }
    } catch (e) { /* 数据有问题就当没有下一节课 */ }

    /* 深夜，或者今天的课上完了又已经入夜 —— 让它睡得更早 */
    const sleepy = hour >= 23 || hour < 6 || (!leftToday && hour >= 21);

    /* 互动次数只算最近三分钟：刚被逗过会更活泼，但很快淡下去 */
    const cutoff = Date.now() - INTERACTION_WINDOW_MS;
    const interactions = interactionsRef.current.filter(function (t) { return t >= cutoff; }).length;
    const energy = energyOf({
      hour: hour,
      minutesToClass: minutesToClass,
      idleForMs: Date.now() - rt.lastTouch,
      interactions: interactions,
    });

    return {
      soon: soon,
      /* 快进参数优先，其次才是"深夜早睡" */
      sleepAfterMs: dozeDev ? dozeDev.sleepAfterMs : (sleepy ? 45000 : undefined),
      energy: energy,
    };
  }, [clock, s.data, rt.lastTouch, dozeDev]);

  /*
   * 状态机：**排到下一个该发生变化的时刻再醒来**，而不是每 400ms 轮询一次。
   *
   * 轮询有两个坏处：一是白耗电（一秒钟被叫醒两次半，什么也没发生），
   * 二是做不出"下一个动作在 3.4 秒后"这种节奏 —— 轮询的粒度就是 400ms，
   * 所有动作都只能落在 400ms 的整数倍上，看久了会有隐约的机械感。
   * 现在每次醒来先推进状态，再问 nextWakeAt "下一次该什么时候叫你"。
   */
  React.useEffect(function () {
    if (!active || !pageVisible) return;
    let timer: number | null = null;
    const step = function (): void {
      const now = Date.now();
      const opts = {
        sleepAfterMs: mood.sleepAfterMs,
        energy: mood.energy,
        rng: rngRef.current,
        /* 贴边站着（没有横向空间）时不要让状态机挑到"走走" */
        allowWalk: !!walkRoomRef.current,
        /* 检查用：把"睡 → 醒 → 睡"的节奏压短（不带 ?doze= 时这两个字段是 undefined） */
        stirMs: dozeDev ? dozeDev.stirMs : undefined,
        wakeMs: dozeDev ? dozeDev.wakeMs : undefined,
      };
      const next = advance(rt, now, dragRef.current.active, opts);
      if (next !== rt) setRt(next);
      const wake = nextWakeAt(next, opts);
      /* 至少 120ms 之后再醒：防抖，也免得状态机把自己饿死在一个紧循环里 */
      const delay = Math.max(120, Math.min(5 * 60 * 1000, wake - Date.now()));
      timer = window.setTimeout(step, delay);
    };
    timer = window.setTimeout(step, 300);
    return function () { if (timer !== null) window.clearTimeout(timer); };
  }, [active, pageVisible, rt, mood.sleepAfterMs, mood.energy, dozeDev]);

  /*
   * 课前招手：只在临近上课的十分钟里。
   *
   * 间隔是**随机**的（18–32 秒），不是固定的 20 秒 —— 固定间隔在课前那十分钟里
   * 会变成一台准点报时的钟。招手同时也是一次反应（会挑一个反应变体），
   * 所以"招手"是看得见的，而不是悄悄改一下内部状态。
   */
  React.useEffect(function () {
    if (!active || !pageVisible || reduced || !mood.soon || rt.phase === 'drag') return;
    const now = Date.now();
    if (now - lastGreet.current < GREET_MIN_MS) return;
    if (rt.phase !== 'idle') return;
    /* 随机一次"下次最早什么时候再招手" */
    lastGreet.current = now + rngRef.current() * (GREET_MAX_MS - GREET_MIN_MS);
    setRt(function (cur) { return poke(cur, Date.now(), rngRef.current); });
    setReactionSeq(function (n) { return n + 1; });
  }, [active, pageVisible, reduced, mood.soon, rt.phase, clock]);

  /*
   * 开发检查用：?poke=N —— 让它自己每 4 秒被"点"一下，共 N 次。
   *
   * 反应动画（蹦一下 / 晃两下 / 被吓一跳 / 凑过来看）只有真的点下去才会播，
   * 而无头浏览器里点不动它 —— 没有这个入口，这条路径就永远是"没验证过"。
   * 配合 ?behavecheck=40 就能看到"反应了几个、都是哪些"。
   */
  React.useEffect(function () {
    if (!active || !pageVisible) return;
    let cap = 0;
    try { cap = Number(new URLSearchParams(window.location.search).get('poke') || 0); } catch (e) { return; }
    if (!isFinite(cap) || cap <= 0) return;
    let n = 0;
    const id = window.setInterval(function () {
      n++;
      if (n > cap) { window.clearInterval(id); return; }
      interactionsRef.current = interactionsRef.current.concat([Date.now()]).slice(-12);
      setRt(function (cur) { return poke(cur, Date.now(), rngRef.current); });
      setReactionSeq(function (k) { return k + 1; });
    }, 4000);
    return function () { window.clearInterval(id); };
  }, [active, pageVisible]);

  /*
   * 开发检查用：?mpos=0.95,0.6 直接把它放到指定锚点。
   *
   * 用来验证"贴边站时走不动"这条规则 —— 手拖没法在无头浏览器里复现，
   * 而"走到屏幕外面去"正是这个功能最容易出的问题。只影响本次渲染，不写盘。
   */
  const devPos = React.useMemo(function () {
    try {
      const v = new URLSearchParams(window.location.search).get('mpos');
      if (!v) return null;
      const p = v.split(',').map(Number);
      if (p.length !== 2 || !isFinite(p[0]) || !isFinite(p[1])) return null;
      return { x: Math.min(1, Math.max(0, p[0])), y: Math.min(1, Math.max(0, p[1])) };
    } catch (e) { return null; }
  }, []);


  /*
   * ★★ 铁律：下面到 `return null` 之间**只能有普通计算，不许再出现任何 hook**。★★
   *
   * v0.13.0 就是在这里翻的车：位置纠正的 useEffect 被写在提前返回之后，
   * 于是"角色可见"时跑 N+1 个 hook、"隐藏"时只跑 N 个 ——
   * React 判定 hook 数量不一致（error #300）**直接卸载整棵树**，
   * 用户点一下「暂时收起来」就白屏。构建通过、单测全绿、布局检查也看不出来。
   *
   * 加新东西时记住：hook 放上面，条件返回放最下面。
   */
  const phase: MascotPhase = rt.phase;
  const avail = pack ? (Object.keys(pack.states) as MascotState[]) : [];
  /*
   * 素材按**相位 + 微动作**一起选：走动时优先用角色的 walk 素材（有的话）。
   * 没有 walk 素材就在界面上把区别补出来（见下面 fakeGait）。
   */
  const stateKey = assetKeyFor(phase, rt.behavior, avail);
  const asset: MascotAsset | undefined = pack ? pack.states[stateKey] : undefined;

  /* -------------------- 位置 -------------------- */

  const insets = measureInsets();
  const hpx = mp.size;
  /*
   * 位置只按**锚点**钳制，不再需要角色的宽高 ——
   * 于是它可以一路拖到只剩落脚点在屏幕里（见 placement.ts 的说明）。
   */
  const anchorOpts = { vw: view.w, vh: view.h, insets: insets, edge: EDGE };
  const raw = dragPos || devPos || { x: mp.x, y: mp.y };
  const pos = clampAnchor(raw.x, raw.y, anchorOpts);

  /*
   * 「来回走走」的半径。
   *
   * 走的是**围绕家的临时位移**，不动存盘的位置：家仍然是你放它的地方，
   * 走完回到原位（CSS 动画的起止都是 0，所以不会在头尾"啪"地跳一下）。
   * 半径由两侧剩余空间决定 —— **贴边站就只往一边走，没地方走就干脆不走**
   * （walkRadius 的返回值 0 会同时把状态机里的 walk 权重清零）。
   */
  /*
   * 这一趟能走到哪：由"两侧留边"和"离家的最大偏离"两个约束的交集决定。
   * 走动允许偏离原位，但**不离家太远**（否则几小时后它会随机游走到屏幕边缘定居）。
   */
  const maxDrift = Math.min(96, Math.round(mp.size * 0.7));
  const room = active && !dragging && !reduced ? walkRoom(pos.x * view.w, driftRef.current, view.w, EDGE, maxDrift) : null;
  const walking = rt.behavior === 'walk' && !!room && rt.phase === 'idle';
  walkRoomRef.current = room;

  /*
   * 走动的一趟：开始与收尾。
   *
   * - **开始**（behavior 变成 walk）：掷一个落点（planWalkStep），记下时长；
   * - **收尾**（不再走 / 被拖 / 页面不可见）：把当前**实际**位移读回来当作家以外的新漂移 ——
   *   读实际值而不是记目标值，是因为这一趟可能被"点一下"打断在半路，
   *   直接采用目标值会让角色"啪"地跳完剩下的距离。
   */
  React.useEffect(function () {
    const r = walkRoomRef.current;
    if (walking && r) {
      if (!walkPlan) setWalkPlan(planWalkStep(r, driftRef.current, 24, 72, 11000, 20000, rngRef.current));
      return;
    }
    if (walkPlan) {
      /*
       * 收尾：以**屏幕上真实的位置**为准，而不是记下来的目标值 ——
       * 这一趟可能被"点一下"打断在半路，直接采用目标值会让角色"啪"地跳完剩下的距离。
       * 允许偏离原位就在这里落地：走完的偏移会成为新的漂移，它不回家。
       */
      const el = elRef.current;
      let now = driftRef.current;
      if (el) {
        try { now = parseFloat(window.getComputedStyle(el).translate) || driftRef.current; } catch (e) { /* 忽略 */ }
      }
      driftRef.current = now;
      setWalkPlan(null);
    }
  }, [walking, walkPlan]);

  /* 存盘里的位置如果已经越界（转屏、改尺寸），悄悄纠正回去 */
React.useEffect(function () {
    if (dragPos) return;
    const c = clampAnchor(mp.x, mp.y, { vw: view.w, vh: view.h, insets: insets, edge: EDGE });
    if (Math.abs(c.x - mp.x) > 0.002 || Math.abs(c.y - mp.y) > 0.002) {
      patchMascotPrefs({ x: c.x, y: c.y });
    }
  }, [view.stamp, mp.x, mp.y, mp.size]);

  /* ↓↓↓ 从这里往下不许再有 hook（见上面的铁律） ↓↓↓ */
  if (!pack || !asset || mp.hidden || !onTimetable) return null;

  /*
   * 位移：走动时朝目标平滑过去（CSS transition，合成层，不触发重排），
   * 不走时就停在当前漂移上 —— 所以走完它会**留在原地**，不会弹回家。
   */
  const drift = walkPlan ? walkPlan.to : driftRef.current;
  /*
   * 朝向：默认朝右（约定）；往左走时水平镜像，让它朝着前进方向。
   * 素材本身是朝左的（用户在外观页勾了）就把基准反过来。
   */
  const goLeft = drift < driftRef.current;
  const mirrored = (mp.facing === 'left') !== goLeft;
  /*
   * 角色包里没有 walk 素材时，用程序化的"迈步"动作把走动和待机区分开。
   * 有 walk 素材就不叠加 —— 那是角色自己会走，再叠一层会打架。
   */
  const fakeGait = stateKey !== 'walk';

  const style: React.CSSProperties = Object.assign(
    {
      left: (pos.x * 100) + '%',
      top: (pos.y * 100) + '%',
      height: hpx + 'px',
      opacity: dragging ? 0.92 : 1,
      translate: drift + 'px 0',
      transform: 'translate(-50%, -100%)' + (mirrored ? ' scaleX(-1)' : ''),
      transition: 'opacity var(--dur) var(--ease), translate ' +
        (walkPlan ? walkPlan.ms + 'ms ease-in-out' : '0ms linear'),
    }
  );

  function clearPress(): void {
    if (pressRef.current !== null) {
      window.clearTimeout(pressRef.current);
      pressRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (!pack) return;
    setMenu(false);
    const d = dragRef.current;
    d.active = true;
    d.moved = 0;
    d.startX = e.clientX;
    d.startY = e.clientY;
    /*
     * 起点要算上"走动中的瞬时偏移"。
     *
     * 角色走动时视觉位置 = 家 + 偏移；手指按下的一瞬间偏移会被撤掉（走动动画停止），
     * 所以起点的归一化坐标必须是**视觉位置**（家 + 偏移），否则它会先跳回家里再跟着手指走。
     */
    let offPx = 0;
    const el = elRef.current;
    if (el) {
      try {
        const t = window.getComputedStyle(el).translate;
        offPx = parseFloat(t) || 0;
      } catch (err) { offPx = 0; }
    }
    d.originX = pos.x + offPx / view.w;
    d.originY = pos.y;
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    clearPress();
    pressRef.current = window.setTimeout(function () {
      pressRef.current = null;
      /* 长按：弹快捷菜单。沿用课程卡长按的约定，用户不用学第二套 */
      d.active = false;
      setDragging(false);
      setDragPos(null);
      setRt(function (cur) { return touch(cur, Date.now()); });
      setMenu(true);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    if (d.moved > TAP_SLOP) {
      clearPress();
      if (!pack || !pack.interactive.drag) return;
      if (!dragging) setDragging(true);
      setDragPos(clampAnchor(d.originX + dx / view.w, d.originY + dy / view.h, anchorOpts));
    }
  }

  function onPointerUp(): void {
    const d = dragRef.current;
    clearPress();
    if (!d.active) { setDragging(false); return; }
    d.active = false;
    setDragging(false);
    const p = dragPos;
    setDragPos(null);

    if (d.moved < TAP_SLOP) {
      if (pack && pack.interactive.click) {
        /* 记一次互动：接下来几分钟它会更活泼（能量值会短暂上升） */
        interactionsRef.current = interactionsRef.current.concat([Date.now()]).slice(-12);
        setRt(function (cur) { return poke(cur, Date.now(), rngRef.current); });
        setReactionSeq(function (n) { return n + 1; });
      }
      return;
    }
    if (p) patchMascotPrefs({ x: p.x, y: p.y });
    setRt(function (cur) { return touch(cur, Date.now()); });
  }

  return (
    <div className="mascot-layer">
      {menu ? <div className="mascot-backdrop" onClick={function () { setMenu(false); }} /> : null}

      <div
        ref={elRef}
        className={'mascot' + (dragging ? ' dragging' : '') + (walking ? ' walking' : '')}
        style={style}
        data-phase={phase}
        /* 打盹循环：1 = 正处在"睡了一觉之后醒一小会儿"的那一段（自检要看它） */
        data-stir={rt.stirUntil > 0 && phase !== 'sleep' ? '1' : '0'}
        data-kind={asset.kind}
        data-state={stateKey}
        /* 检查用：把"网格几格、真实几帧"暴露出来，外部才能判断播到的格子是不是空档 */
        data-cols={asset.cols || 0}
        data-rows={asset.rows || 0}
        data-frames={frameCount(asset)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <MascotArt
          asset={asset}
          motion={pack.motion}
          phase={phase}
          size={hpx}
          shadow={pack.shadow}
          fpsOverride={mp.fps}
          behavior={rt.behavior}
          jitter={rt.jitter}
          reaction={rt.reaction}
          reactionSeq={reactionSeq + (rt.reactionSeq || 0)}
          walking={walking}
          gait={walking && fakeGait}
          paused={reduced || !pageVisible}
        />
      </div>

      {/*
        长按弹出的快捷菜单。
        位置夹在屏幕内（角色能拖到贴着边缘），并且**上下也会翻面**：
        角色停在屏幕上半部分时往下弹，免得菜单顶到状态栏外面去。
      */}
      {menu ? (
        <div
          className={'mascot-menu' + (pos.y < 0.34 ? ' below' : '')}
          role="menu"
          style={{
            left: (Math.min(0.86, Math.max(0.14, pos.x)) * 100) + '%',
            top: pos.y < 0.34
              ? 'calc(' + (pos.y * 100) + '% + 14px)'
              : 'calc(' + (pos.y * 100) + '% - ' + (hpx + 10) + 'px)',
          }}
        >
          <div className="mascot-menu-head">
            <span className="mascot-menu-dot" />
            <span className="mascot-menu-name">{pack.name}</span>
          </div>
          <button
            className="mascot-menu-item" role="menuitem"
            onClick={function () { setMenu(false); patchMascotPrefs({ hidden: true }); showToast('角色已收起来，在外观 → 角色里可以再放出来', 'info'); }}
          >
            <Icon name="archive" size={16} />
            <span className="mmi-text">暂时收起来<span className="mmi-sub">下次打开也不会出现</span></span>
          </button>
          <button
            className="mascot-menu-item" role="menuitem"
            onClick={function () { setMenu(false); resetMascotPosition(); showToast('已放回默认位置', 'ok'); }}
          >
            <Icon name="target" size={16} />
            <span className="mmi-text">回到默认位置<span className="mmi-sub">它走动走远了就用这个</span></span>
          </button>
          <button
            className="mascot-menu-item" role="menuitem"
            onClick={function () { setMenu(false); setTab('studio'); }}
          >
            <Icon name="palette" size={16} />
            <span className="mmi-text">打开外观设置<span className="mmi-sub">换素材、调大小与帧率</span></span>
          </button>
          <button
            className="mascot-menu-item" role="menuitem"
            onClick={function () { setMenu(false); openManual('mascot'); }}
          >
            <Icon name="clipboard" size={16} />
            <span className="mmi-text">怎么做一个角色<span className="mmi-sub">说明书 · 角色这一章</span></span>
          </button>
          <span className="mascot-menu-arrow" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 量出顶栏下沿与标签栏上沿。
 *
 * 不写死常量：安全区（刘海、手势条）、横竖屏、分屏都会改这两个高度，
 * 而"角色压住标签栏"是最容易被一眼看出来的低级问题。
 */
function measureInsets(): Insets {
  try {
    const top = document.querySelector('.topbar');
    const bottom = document.querySelector('.tabbar');
    const topH = top ? top.getBoundingClientRect().bottom : 0;
    const bottomH = bottom ? window.innerHeight - bottom.getBoundingClientRect().top : 0;
    return {
      top: topH > 0 ? topH : FALLBACK_INSETS.top,
      bottom: bottomH > 0 ? bottomH : FALLBACK_INSETS.bottom,
    };
  } catch (e) {
    return FALLBACK_INSETS;
  }
}
