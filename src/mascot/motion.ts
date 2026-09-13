import type { MascotMotion, MascotState } from './types';

/**
 * 角色的状态机。
 *
 * ## 三个自然状态
 *
 * 没人管它的时候，它只在**三种样子**之间切换：
 *
 *   待机（breathe）—— 站着，播角色包自己的待机动画（呼吸与浮动由素材参数决定）
 *   走路（walk）—— 在"家"附近挪几步；角色包里有 walk 素材就用那张，没有就用程序化的迈步
 *   休息（sleep 相位）—— 睡着；有 sleep 素材就用那张
 *
 * 这是一次**减法**：更早的版本里还有抖一下 / 伸懒腰 / 抬起头 / 打哈欠 / 东张西望 / 点头
 * 这几样自己编的小动作，以及"没人点也会自己蹦一下"的自发反应。它们的问题不在于难看，
 * 而在于**它们和角色包本身的动画打架** —— 作者画好的动作被一堆 transform 盖住，
 * 看起来像一张被推来推去的贴纸。所以：
 *
 *   - 自然状态只剩三个；一次性的反应**只有真的点它才会播**；
 *   - 有 `react` 素材的包，点一下直接播素材，我们那层动作完全不叠加；
 *   - 左右摇摆（rotate）在任何情况下都不会被放大（见 motionVars）。
 *
 * ## 两层结构
 *
 *   外层是**相位**（phase）：idle / react / sleep / drag —— 表达"用户能对它做什么"，
 *   只有四个，切换条件都是硬的（有人点、有人在拖、多久没人理）。
 *
 *   内层是**当前动作**（behavior）：待机还是走路。随机的是**什么时候换、走多久**，
 *   而不是"再变出几种动作来"。
 *
 * ## 随机数必须注入
 *
 * 这个文件里**没有一处调用 Math.random** —— 随机源由调用方通过 `rng` 传进来
 * （生产用 Math.random，测试传固定种子）。于是状态机是纯函数：
 * 同一个种子 + 同一串时间戳 = 完全相同的动作序列，可复现、可单测。
 */

export type MascotPhase = 'idle' | 'react' | 'sleep' | 'drag';

/**
 * 自然动作。**只有两个** —— 休息不是动作，是相位（见文件开头）。
 */
export type MascotBehavior = 'breathe' | 'walk';

/**
 * 被点一下时的反应变体。
 *
 * 角色包**自带 react 素材**时，反应直接播那一张（`assetKeyFor` 会切过去）；
 * 没有素材才退回这里的程序化动作。
 * 这些反应**只会在真的点它时播**，不会自己冒出来。
 */
export type MascotReaction = 'hop' | 'startle' | 'peek';

/** 注入的随机源：返回 [0,1) */
export type Rng = () => number;

export interface MascotRuntime {
  phase: MascotPhase;
  /** 当前相位是从什么时候开始的 */
  since: number;
  /** 上一次被用户碰是什么时候 */
  lastTouch: number;
  /** 相位开始前的状态，react 结束后要回到它 */
  before: MascotPhase;
  /** 内层：当前动作（待机 / 走路） */
  behavior: MascotBehavior;
  /** 这个动作做到什么时候 */
  behaviorUntil: number;
  /** 最近两次做过的动作（越靠前越近），用来避免连着重复 */
  recent: MascotBehavior[];
  /** 这次动作的抖动系数：同样的动作每次的快慢幅度都略有不同 */
  jitter: { speed: number; amp: number };
  /** 正在播的一次性反应；没有就是 null */
  reaction: MascotReaction | null;
  reactionUntil: number;
  /** 最近两次播过的反应 */
  recentReactions: MascotReaction[];
  /** 反应序号：每播一次反应 +1，界面靠它可靠地重启动画 */
  reactionSeq: number;
  /** 「半醒」到什么时候（0 = 没在半醒），见下面的打盹循环 */
  stirUntil: number;
  /** 睡着时，下一次"醒一下"安排在什么时候（0 = 不适用） */
  nextStirAt: number;
}

/** 点一下的反应持续多久（会在此基础上随机） */
export const REACT_MS = 900;
/** 多久没人理就打瞌睡 */
export const SLEEP_AFTER_MS = 3 * 60 * 1000;
/** 睡着之后每隔多久醒一下（区间，每次现掷） */
export const STIR_MIN_MS = 45 * 1000;
export const STIR_MAX_MS = 150 * 1000;
/** 每次"醒一下"持续多久（区间）—— 太短看不见走动，太长就不像在睡 */
export const STIR_WAKE_MIN_MS = 4000;
export const STIR_WAKE_MAX_MS = 14000;

/** 眨眼间隔的随机范围 —— 固定节奏会显得像机器 */
export const BLINK_MIN_MS = 2600;
export const BLINK_MAX_MS = 6200;

/**
 * 两个自然动作的时长与动画乘数。
 *
 * `amp` **都不超过 1** —— 这是有意的：素材作者在角色包里设的呼吸 / 浮动 / 摇摆
 * 就是他要的幅度，我们只压不放大。动作之间的区别靠**素材**（走路那张、睡觉那张），
 * 而不是靠把同一张图拧得更用力。
 */
export const BEHAVIORS: Record<MascotBehavior, {
  minMs: number; maxMs: number; speed: number; amp: number; label: string;
}> = {
  /** 待机：慢呼吸，占的时间最多 */
  breathe: { minMs: 5200, maxMs: 13000, speed: 1, amp: 1, label: '待机' },
  /**
   * 走来走去：围绕"家"（用户放它的地方）左右踱几步。
   *
   * 时长 4.5–10 秒，要**容得下一整趟步子**（34–72px ÷ 9–14px/s ≈ 2.4–8 秒）——
   * 更早的版本里动作窗口比一趟步子还短，每趟都被打断，看起来就是"迈了半天还在原地"。
   */
  walk: { minMs: 4500, maxMs: 10000, speed: 1.35, amp: 0.9, label: '来回走走' },
};

/** 反应变体的时长（毫秒），与 CSS 里的动画时长一一对应 */
export const REACTIONS: Record<MascotReaction, { ms: number; label: string }> = {
  hop: { ms: 520, label: '蹦一下' },
  startle: { ms: 420, label: '被吓一跳' },
  peek: { ms: 460, label: '凑过来看' },
};

export const ALL_BEHAVIORS: MascotBehavior[] = ['breathe', 'walk'];
export const ALL_REACTIONS: MascotReaction[] = ['hop', 'startle', 'peek'];

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 取范围内的随机值 */
function pick(rng: Rng, lo: number, hi: number): number {
  return lo + clamp01(rng()) * (hi - lo);
}

/**
 * "能量"：0 = 困得不行，1 = 精神得很。
 *
 * 它不改变相位（那由用户操作决定），也不改变动作种类（只有两个），
 * 只影响**走路的频率**：精力中等偏上时最想走，深夜或长时间没人理就懒得动。
 */
export interface EnergyInput {
  /** 0..23 */
  hour: number;
  /** 距离下一节课还有几分钟；没有下一节课就是 null */
  minutesToClass: number | null;
  /** 已经多久没人碰过它 */
  idleForMs: number;
  /** 最近几分钟内的互动次数 */
  interactions: number;
}

export function energyOf(i: EnergyInput): number {
  let e = 0.5;
  const h = i.hour;
  /* 清晨和白天精神，深夜和午饭后困 */
  if (h >= 6 && h < 10) e += 0.15;
  else if (h >= 10 && h < 13) e += 0.12;
  else if (h >= 13 && h < 15) e -= 0.15;   /* 午后 */
  else if (h >= 15 && h < 22) e += 0.08;
  else if (h >= 23 || h < 6) e -= 0.35;    /* 深夜 */

  /* 快上课了会很精神（也符合"提醒你"的定位） */
  if (i.minutesToClass !== null && i.minutesToClass >= 0 && i.minutesToClass <= 10) e += 0.25;
  else if (i.minutesToClass !== null && i.minutesToClass <= 30) e += 0.1;

  /* 长时间没人理就蔫下去 */
  if (i.idleForMs > 10 * 60 * 1000) e -= 0.25;
  else if (i.idleForMs > 3 * 60 * 1000) e -= 0.15;

  /* 刚被逗过会更活泼一点，但很快衰减（调用方传"最近几分钟的互动次数"） */
  e += Math.min(4, Math.max(0, i.interactions)) * 0.06;

  return clamp01(e);
}

/** 挑动作时的几个开关（都缺省为"醒着、能走"） */
export interface BehaviorOpts {
  /** 有没有地方走。给 false 时"走走"的权重是 0，永远不会被掷到 */
  allowWalk?: boolean;
  /** 睡着时：只会呼吸，不会走动 */
  dozing?: boolean;
  /**
   * "走走"的权重倍数，缺省 1。
   *
   * 角色包**自带 walk 素材**时调用方会给 2 倍上下：作者自己画了走路，
   * 那就多走两步 —— 有素材的动作优先演。
   */
  walkBias?: number;
}

/**
 * 行为权重：只有两项，而且刚做过的那一项会被降权，避免连着重复。
 *
 * "走走"的曲线在 e=0.7 附近取峰值：精力好的时候爱走动，深夜（e→0）几乎不动。
 */
export function behaviorWeights(
  energy: number, recent: MascotBehavior[], opts?: BehaviorOpts
): { behavior: MascotBehavior; w: number }[] {
  const o: BehaviorOpts = opts || {};
  const e = clamp01(energy);
  const bias = o.walkBias && o.walkBias > 0 ? o.walkBias : 1;
  const base: Record<MascotBehavior, number> = {
    breathe: o.dozing ? 1.2 : 1.6,
    walk: (o.allowWalk === false || o.dozing)
      ? 0
      : 0.9 * Math.max(0, 1 - Math.abs(e - 0.7) * 2.2) * bias,
  };
  return ALL_BEHAVIORS.map(function (b) {
    /* 最近一次 ×0.15，再上一次 ×0.45：偶尔还是允许重复，只是不连着来 */
    let w = base[b];
    const i = recent.indexOf(b);
    if (i === 0) w *= 0.15;
    else if (i === 1) w *= 0.45;
    return { behavior: b, w: w };
  });
}

/** 按权重掷一个 */
export function pickWeighted<T>(items: { behavior: T; w: number }[], rng: Rng): T {
  let total = 0;
  for (const it of items) total += Math.max(0, it.w);
  if (!(total > 0)) return items[0].behavior;
  let r = clamp01(rng()) * total;
  for (const it of items) {
    r -= Math.max(0, it.w);
    if (r <= 0) return it.behavior;
  }
  return items[items.length - 1].behavior;
}

/**
 * 掷下一个动作：待机还是走路、这个动作做多久、这次快慢幅度抖多少。
 *
 * 硬保证（不只是降权）：掷出来如果正好是上一次做过的动作，就重掷一次。
 * 只有两个动作时这条不总能成功（重掷还是它），但降权已经把重复压到很低。
 */
export function rollBehavior(
  energy: number, recent: MascotBehavior[], rng: Rng, opts?: BehaviorOpts
): { behavior: MascotBehavior; until: number; jitter: { speed: number; amp: number } } {
  let b = pickWeighted(behaviorWeights(energy, recent, opts), rng);
  if (recent.length > 0 && b === recent[0]) {
    const again = pickWeighted(behaviorWeights(energy, recent, opts), rng);
    if (again !== recent[0]) b = again;
  }
  const cfg = BEHAVIORS[b];
  return {
    behavior: b,
    until: Math.round(pick(rng, cfg.minMs, cfg.maxMs)),
    /* 每次都快慢幅度各抖 ±15%：同样的动作不会永远同一个节奏 */
    jitter: { speed: pick(rng, 0.85, 1.18), amp: pick(rng, 0.86, 1.14) },
  };
}

/**
 * 掷一个反应变体，尽量不和上两次重复。
 *
 * 反应现在**只有用户点它的时候**才会掷到（自发的那些已经删掉了）。
 */
export function rollReaction(recent: MascotReaction[], rng: Rng, pool?: MascotReaction[]): MascotReaction {
  const all = pool && pool.length > 0 ? pool : ALL_REACTIONS;
  const free = all.filter(function (r) { return recent.indexOf(r) < 0; });
  const list = free.length > 0 ? free : all;
  return list[Math.min(list.length - 1, Math.floor(clamp01(rng()) * list.length))];
}

export function initialRuntime(now: number, rng?: Rng): MascotRuntime {
  const r = rng || Math.random;
  const rolled = rollBehavior(0.5, [], r, { allowWalk: false });
  return {
    phase: 'idle',
    since: now,
    lastTouch: now,
    before: 'idle',
    behavior: rolled.behavior,
    behaviorUntil: now + rolled.until,
    recent: [rolled.behavior],
    jitter: rolled.jitter,
    reaction: null,
    reactionUntil: 0,
    recentReactions: [],
    reactionSeq: 0,
    stirUntil: 0,
    nextStirAt: 0,
  };
}

export interface AdvanceOpts {
  /** 覆盖"多久没人理就打瞌睡"。深夜或今天没课时调小，它会睡得更早 */
  sleepAfterMs?: number;
  /** 当前能量，0..1（见 energyOf）。缺省 0.5 */
  energy?: number;
  /** 随机源。缺省 Math.random */
  rng?: Rng;
  /**
   * 允不允许"来回走走"。缺省允许。
   *
   * 两种情况必须传 false：
   *   1. 睡着了 —— 睡着了还踱步就不叫睡了；
   *   2. **它贴边站着、横向没地方走** —— 这时候走一定会越界，
   *      而"不越过边界"是这功能的前提（半径由 placement.ts 的 walkRoom 算）。
   */
  allowWalk?: boolean;
  /**
   * 打盹循环的节奏覆盖（毫秒区间）。只给单测与自检用：正常是"睡 45–150 秒 → 醒 4–14 秒"，
   * 想在一分钟里看到好几轮，就得把这两段压短。
   */
  stirMs?: { min: number; max: number };
  wakeMs?: { min: number; max: number };
  /** "走走"的权重倍数（自带 walk 素材的角色包会给 2 倍上下），见 BehaviorOpts.walkBias */
  walkBias?: number;
}

/** 下一次"醒一下"安排在什么时候 */
function nextStirTime(now: number, rng: Rng, opts?: AdvanceOpts): number {
  const r = (opts && opts.stirMs) || { min: STIR_MIN_MS, max: STIR_MAX_MS };
  return now + Math.round(pick(rng, Math.max(1000, r.min), Math.max(1200, r.max)));
}

/** 这一次"醒一下"持续多久 */
function stirWakeMs(rng: Rng, opts?: AdvanceOpts): number {
  const r = (opts && opts.wakeMs) || { min: STIR_WAKE_MIN_MS, max: STIR_WAKE_MAX_MS };
  return Math.round(pick(rng, Math.max(1500, r.min), Math.max(2000, r.max)));
}

/**
 * "刚醒那一下"的精神头。
 *
 * 为什么需要它：`energyOf` 会因为"十几分钟没人理"把能量压到 0.2 上下，
 * 而"走走"的权重在低能量时几乎为 0 —— 直接用原值的话，半醒那一小段只会站着不动，
 * 看起来跟没醒一样。刚睁眼总比躺着有精神，这是事实层面的修正。
 */
const WAKING_ENERGY = 0.62;

/**
 * 纯函数地推进状态。调用方**排程在下一个事件时刻调用**即可，
 * 不需要每几百毫秒轮询一次（轮询既费电，也做不出"下一个动作在 3.4 秒后"这种节奏）。
 */
export function advance(rt: MascotRuntime, now: number, dragging: boolean, opts?: AdvanceOpts): MascotRuntime {
  const rng = (opts && opts.rng) || Math.random;
  const energy = opts && opts.energy !== undefined ? clamp01(opts.energy) : 0.5;
  const stirUntil = rt.stirUntil || 0;
  /** 半醒：睡着之后那一小段"醒着" */
  const stirring = stirUntil > 0 && now < stirUntil;
  /* 睡着了永远不走；调用方还可以因为"没地方走"而关掉它（半醒时是醒着的，所以能走） */
  const walkOk = rt.phase === 'sleep' ? false : !(opts && opts.allowWalk === false);
  /* 半醒那一小段用"刚醒"的精神头，否则它只会站着不动 */
  const rollEnergy = stirring ? Math.max(energy, WAKING_ENERGY) : energy;
  const biasOpts: BehaviorOpts = {
    allowWalk: walkOk,
    dozing: rt.phase === 'sleep',
    walkBias: opts && opts.walkBias,
  };

  if (dragging !== (rt.phase === 'drag')) {
    /* 拖动开始 / 结束，优先级最高，直接切。拖完给一次"待机"，像是被放稳了 */
    const end = {
      phase: (dragging ? 'drag' : 'idle') as MascotPhase,
      since: now,
      lastTouch: now,
      before: dragging ? rt.before : ('idle' as MascotPhase),
    };
    const rolled = rollBehavior(energy, rt.recent, rng, { allowWalk: false });
    return Object.assign({}, rt, end, {
      behavior: rolled.behavior,
      behaviorUntil: now + rolled.until,
      recent: [rolled.behavior].concat(rt.recent).slice(0, 2),
      jitter: rolled.jitter,
      /* 被人抓起来就等于醒了：打盹循环整个清掉，松手之后从头计时 */
      stirUntil: 0,
      nextStirAt: 0,
      reaction: null,
      reactionUntil: 0,
    });
  }
  if (rt.phase === 'drag') return rt;

  /* 一次性反应播完了就清掉 */
  let reaction = rt.reaction;
  let recentReactions = rt.recentReactions;
  if (reaction && now >= rt.reactionUntil) reaction = null;

  if (rt.phase === 'react' && now - rt.since >= REACT_MS) {
    return Object.assign({}, rt, {
      phase: rt.before === 'sleep' ? 'sleep' : 'idle',
      since: now,
      before: 'idle',
      reaction: reaction,
      recentReactions: recentReactions,
    });
  }

  /* ------------------------- 打盹循环 ------------------------- */

  /*
   * (a) 睡到点了：醒一小会儿。
   *
   * 这是"等了几分钟之后不要一直显示同一种动画"那条要求的落点：
   * 醒来这一小段走的是**醒着**的池子（会走动），而不是睡姿那一张 ——
   * 于是长时间挂着能看到 休息 → 走两步 → 休息 这样的来回。
   */
  if (rt.phase === 'sleep' && (rt.nextStirAt || 0) > 0 && now >= (rt.nextStirAt || 0)) {
    const rolled = rollBehavior(Math.max(energy, WAKING_ENERGY), rt.recent, rng, {
      allowWalk: !(opts && opts.allowWalk === false),
      walkBias: opts && opts.walkBias,
    });
    return Object.assign({}, rt, {
      phase: 'idle' as MascotPhase,
      since: now,
      before: 'idle' as MascotPhase,
      behavior: rolled.behavior,
      behaviorUntil: now + rolled.until,
      recent: [rolled.behavior].concat(rt.recent).slice(0, 2),
      jitter: rolled.jitter,
      stirUntil: now + stirWakeMs(rng, opts),
      nextStirAt: 0,
      reaction: null,
      reactionUntil: 0,
    });
  }

  /* (b) 半醒结束：睡回去，并把下一次"醒一下"排上 */
  if (rt.phase !== 'sleep' && stirUntil > 0 && now >= stirUntil) {
    return Object.assign({}, rt, {
      phase: 'sleep' as MascotPhase,
      since: now,
      before: 'idle' as MascotPhase,
      behavior: 'breathe' as MascotBehavior,
      behaviorUntil: now + Math.round(pick(rng, BEHAVIORS.breathe.minMs, BEHAVIORS.breathe.maxMs)),
      recent: ['breathe'].concat(rt.recent).slice(0, 2),
      jitter: { speed: pick(rng, 0.85, 1.18), amp: pick(rng, 0.86, 1.14) },
      stirUntil: 0,
      nextStirAt: nextStirTime(now, rng, opts),
      reaction: null,
      reactionUntil: 0,
    });
  }

  const sleepAfter = opts && opts.sleepAfterMs !== undefined ? Math.max(3000, opts.sleepAfterMs) : SLEEP_AFTER_MS;
  const idleFor = now - rt.lastTouch;
  if (rt.phase !== 'sleep' && !stirring && idleFor >= sleepAfter) {
    /*
     * 睡着的这一刻**不再播一个哈欠** —— 只把相位切到 sleep。
     * 有 sleep 素材的角色包会换成睡姿那张；没有的就把动作放慢（CSS 的 .sleeping）。
     * 这一版的原则是"自然状态只有三个"，不再自己加戏。
     */
    return Object.assign({}, rt, {
      phase: 'sleep',
      since: now,
      before: 'idle',
      behavior: 'breathe' as MascotBehavior,
      behaviorUntil: now + Math.round(pick(rng, BEHAVIORS.breathe.minMs, BEHAVIORS.breathe.maxMs)),
      recent: ['breathe'].concat(rt.recent).slice(0, 2),
      jitter: { speed: pick(rng, 0.85, 1.18), amp: pick(rng, 0.86, 1.14) },
      stirUntil: 0,
      nextStirAt: nextStirTime(now, rng, opts),
      reaction: null,
      reactionUntil: 0,
    });
  }

  /* 动作做完了就掷下一个（睡着时只会呼吸，半醒时能走动） */
  if (now >= rt.behaviorUntil) {
    const rolled = rollBehavior(rollEnergy, rt.recent, rng, biasOpts);
    return Object.assign({}, rt, {
      behavior: rolled.behavior,
      behaviorUntil: now + rolled.until,
      recent: [rolled.behavior].concat(rt.recent).slice(0, 2),
      jitter: rolled.jitter,
      reaction: reaction,
      recentReactions: recentReactions,
    });
  }

  if (reaction !== rt.reaction) return Object.assign({}, rt, { reaction: reaction, recentReactions: recentReactions });
  return rt;
}

/** 下一次需要被唤醒的时刻：调用方拿它排 setTimeout，不用轮询 */
export function nextWakeAt(rt: MascotRuntime, opts?: AdvanceOpts): number {
  const times = [rt.behaviorUntil];
  if (rt.reaction) times.push(rt.reactionUntil);
  if (rt.phase === 'react') times.push(rt.since + REACT_MS);
  const stirUntil = rt.stirUntil || 0;
  if (rt.phase === 'sleep') {
    /* 睡着时排的是"下一次醒一下"；醒了之后才需要睡点 */
    if ((rt.nextStirAt || 0) > 0) times.push(rt.nextStirAt);
  } else if (stirUntil > 0) {
    /* 半醒中：到点要睡回去 */
    times.push(stirUntil);
  } else if (opts && opts.sleepAfterMs !== undefined) {
    times.push(rt.lastTouch + Math.max(3000, opts.sleepAfterMs));
  } else {
    times.push(rt.lastTouch + SLEEP_AFTER_MS);
  }
  return Math.min.apply(null, times);
}

/**
 * 用户点了一下：唤醒 + 掷一个反应变体。
 *
 * 这是**唯一**会产生反应动画的入口 —— 自发小动作已经删掉了。
 */
export function poke(
  rt: MascotRuntime, now: number, rng?: Rng,
  /**
   * 反应至少播多久（毫秒）。缺省 0 = 用 REACTIONS 里那个固定时长。
   *
   * 给**自带 react 素材**的角色用：那张素材往往是逐帧动画（0.5–1.5 秒），
   * 按程序化反应那 0.4–0.5 秒切掉会把作者的动画拦腰砍断。
   */
  holdMs?: number
): MascotRuntime {
  const r = rng || Math.random;
  const kind = rollReaction(rt.recentReactions, r);
  const hold = Math.max(REACTIONS[kind].ms, holdMs && holdMs > 0 ? holdMs : 0);
  return Object.assign({}, rt, {
    phase: 'react' as MascotPhase,
    since: now,
    lastTouch: now,
    before: rt.phase === 'sleep' ? ('sleep' as MascotPhase) : ('idle' as MascotPhase),
    reaction: kind,
    reactionUntil: now + hold,
    reactionSeq: rt.reactionSeq + 1,
    /* 被点等于醒了：半醒那一小段取消；如果本来在睡，睡回去之后重新排"醒一下" */
    stirUntil: 0,
    recentReactions: [kind].concat(rt.recentReactions).slice(0, 2),
    /* 被点之后立刻抖一下，接着才回到待机 */
    behavior: 'breathe' as MascotBehavior,
    behaviorUntil: now + hold + 120,
    recent: ['breathe'].concat(rt.recent).slice(0, 2),
    jitter: { speed: pick(r, 0.85, 1.18), amp: pick(r, 0.86, 1.14) },
  });
}

/** 任何形式的人为接触都算"还醒着"（拖动、点击、换位置） */
export function touch(rt: MascotRuntime, now: number): MascotRuntime {
  if (rt.phase === 'drag') return Object.assign({}, rt, { lastTouch: now });
  return Object.assign({}, rt, {
    phase: rt.phase === 'react' ? 'react' : ('idle' as MascotPhase),
    lastTouch: now,
    /* 人来了就是醒了：打盹循环清掉，睡意从头计时 */
    stirUntil: 0,
    nextStirAt: 0,
  });
}

/** 该用哪张素材：没有对应状态就退回 idle */
export function assetFor(phase: MascotPhase, available: MascotState[]): MascotState {
  if (available.indexOf(phase) >= 0) return phase;
  return 'idle';
}

/**
 * 该用哪张素材 —— 把**动作**与**反应**也算进去。
 *
 * 优先级（这是"变化多基于给定动画"的落点）：
 *   1. 正在播反应，且包里有 `react` 素材 → 用 react；
 *   2. 相位是 idle 且在走路，且包里有 `walk` 素材 → 用 walk；
 *   3. 否则按相位（sleep 有就用 sleep，没有退回 idle）。
 * 没有对应素材时退回 idle，界面层再用程序化动作把区别补出来（迈步 / rx-*）。
 */
export function assetKeyFor(
  phase: MascotPhase, behavior: MascotBehavior, available: MascotState[],
  /** 正在播一次性反应（被点） */
  reacting?: boolean
): MascotState {
  if (reacting && available.indexOf('react') >= 0) return 'react';
  if (phase === 'idle' && behavior === 'walk' && available.indexOf('walk') >= 0) return 'walk';
  return assetFor(phase, available);
}

/**
 * 一次眨眼该等多久。
 *
 * 入参是调用方掷出来的 [0,1) 随机数（不是"种子"）——
 * 上一版这里是 `blinkDelay(seed)` 配一个每次 +1.37 的计数器，算式写得像随机，
 * 实际上是**确定性**的：每个用户、每次启动的眨眼节奏完全一样。
 */
export function blinkDelayFor(t: number): number {
  return Math.round(BLINK_MIN_MS + clamp01(t) * (BLINK_MAX_MS - BLINK_MIN_MS));
}

/**
 * 把动画参数换算成 CSS 自定义属性。
 *
 * 只输出 transform / opacity 相关的变量：这两个属性不触发重排，
 * 是"一个会动的浮层"唯一安全的做法。改 width/height/margin 会让整页重排，
 * 在 320px 的窄屏上就是可见的卡顿。
 *
 * **幅度只减不增**：两个动作的 amp 分别是 1 与 0.9，乘上素材自己的参数之后
 * 不会超过作者设定的值 —— 尤其是左右摇摆（rotate）那条，放大只会变成"歪脖子"。
 */
export function motionVars(
  motion: MascotMotion, phase: MascotPhase, behavior: MascotBehavior,
  jitter: { speed: number; amp: number }, reduced: boolean
): Record<string, string> {
  if (reduced) {
    /* 系统开了"减弱动态效果"：全部归零，只保留静态展示 */
    return { '--m-breathe': '0', '--m-bob': '0', '--m-sway': '0deg', '--m-speed': '0s' };
  }
  const cfg = BEHAVIORS[behavior];
  const phaseSlow = phase === 'sleep' ? 1.6 : 1;
  const phaseAmp = phase === 'sleep' ? 0.75 : 1;
  const factor = phase === 'drag' ? 0 : 1;
  const amp = (cfg.amp * phaseAmp * jitter.amp) * factor;
  const speed = (cfg.speed * phaseSlow * jitter.speed);
  return {
    '--m-breathe': (motion.breathe * amp).toFixed(4),
    '--m-bob': (motion.bob * amp).toFixed(4),
    '--m-sway': (motion.sway * amp).toFixed(2) + 'deg',
    /* 呼吸周期 5.2 秒为基准：慢是"高级感"的主要来源，抖是廉价感的主要来源 */
    '--m-speed': (5.2 * speed).toFixed(2) + 's',
    '--m-bob-speed': (6.8 * speed).toFixed(2) + 's',
    '--m-sway-speed': (7.4 * speed).toFixed(2) + 's',
  };
}
