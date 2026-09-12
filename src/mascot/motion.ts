import type { MascotMotion, MascotState } from './types';

/**
 * 角色的状态机。
 *
 * ## 两层结构
 *
 *   外层是**相位**（phase）：idle / react / sleep / drag —— 它表达的是"用户能对它做什么"，
 *   语义必须稳定，所以只有四个，切换条件也都是硬的（有人点、有人在拖、多久没人理）。
 *
 *   内层是**微动作**（behavior）：呼吸、抖一下、伸展、抬头、打哈欠 ——
 *   它表达的是"它现在像不像活的"。这一层是随机的：每次做完一个动作，
 *   过多久做下一个、做哪一个、幅度和快慢多少，都是当场掷出来的。
 *
 * 只有外层的话，它就是一台节拍器：两条固定周期的正弦（5.2s / 6.8s）永远同相位，
 * 看三秒就知道在循环。加上内层之后，节奏与幅度每次都不一样。
 *
 * ## 为什么随机数要"注入"
 *
 * 这个文件里**没有一处调用 Math.random** —— 随机源由调用方通过 `rng` 传进来
 * （生产用 Math.random，测试传固定种子）。这样：
 *
 *   - 状态机仍然是纯函数：同一个种子 + 同一串时间戳 = 完全相同的动作序列，能单测；
 *   - "偶尔卡在某个动作不动"这类问题可以复现、可以二分；
 *   - 不会出现"测试里跑一次通过、线上跑一次不通过"的随机失败。
 *
 * 反面教材就在上一版：`blinkDelay(seed)` 用一个固定公式 + 每次 +1.37 的计数器假装随机，
 * 结果是**每个用户、每次启动看到的眨眼节奏一模一样**。
 */

export type MascotPhase = 'idle' | 'react' | 'sleep' | 'drag';

/** 微动作。幅度与快慢的乘数也在这里定义，`motionVars` 用它换算 CSS 变量 */
export type MascotBehavior = 'breathe' | 'fidget' | 'stretch' | 'perk' | 'yawn' | 'walk';

/** 被点一下时的反应变体：一次性动画，任何素材形态都看得到 */
export type MascotReaction = 'hop' | 'sway' | 'startle' | 'peek';

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
  /** 内层：当前微动作 */
  behavior: MascotBehavior;
  /** 这个微动作做到什么时候 */
  behaviorUntil: number;
  /** 最近两次做过的微动作（越靠前越近），用来避免连着重复 */
  recent: MascotBehavior[];
  /** 这次微动作的抖动系数：让同样的动作每次的快慢幅度都略有不同 */
  jitter: { speed: number; amp: number };
  /** 正在播的一次性反应；没有就是 null */
  reaction: MascotReaction | null;
  reactionUntil: number;
  /** 最近两次播过的反应 */
  recentReactions: MascotReaction[];
}

/** 点一下的反应持续多久（会在此基础上随机） */
export const REACT_MS = 900;
/** 多久没人理就打瞌睡 */
export const SLEEP_AFTER_MS = 3 * 60 * 1000;
/** 眨眼间隔的随机范围 —— 固定节奏会显得像机器 */
export const BLINK_MIN_MS = 2600;
export const BLINK_MAX_MS = 6200;

/** 每个微动作的持续时长范围（毫秒）与动画乘数 */
export const BEHAVIORS: Record<MascotBehavior, {
  minMs: number; maxMs: number; speed: number; amp: number; label: string;
}> = {
  /** 基础状态：慢呼吸。占的时间最多，用来衬托其它动作 */
  breathe: { minMs: 5200, maxMs: 13000, speed: 1, amp: 1, label: '呼吸' },
  /** 抖一下：快而小的动作，能量高的时候多 */
  fidget: { minMs: 620, maxMs: 1500, speed: 0.42, amp: 1.5, label: '抖一下' },
  /** 伸展：慢而大，能量低或刚睡醒时多 */
  stretch: { minMs: 2200, maxMs: 3800, speed: 1.65, amp: 1.85, label: '伸个懒腰' },
  /** 抬头：中速、幅度偏大，像是"注意到什么了" */
  perk: { minMs: 1200, maxMs: 2300, speed: 0.75, amp: 1.3, label: '抬起头' },
  /** 打哈欠：慢而小，深夜和长时间没人理的时候多 */
  yawn: { minMs: 2000, maxMs: 3400, speed: 2.1, amp: 0.75, label: '打个哈欠' },
  /**
   * 来回走走：围绕"家"（用户放它的地方）左右踱几步。
   *
   * 时长明显更长（5–9 秒），因为它要完成的是一整套
   * "往右 → 回中 → 往左 → 回中"，走完正好回到原位 —— 所以**起止位移都是 0**，
   * 不会在动作开始或结束时"啪"地跳一下。
   * speed 略大于 1：浮动快一点看起来才像在迈步，而不是飘。
   */
  walk: { minMs: 5000, maxMs: 9000, speed: 1.35, amp: 0.9, label: '来回走走' },
};

/** 反应变体的时长（毫秒），与 CSS 里的动画时长一一对应 */
export const REACTIONS: Record<MascotReaction, { ms: number; label: string }> = {
  hop: { ms: 520, label: '蹦一下' },
  sway: { ms: 700, label: '晃两下' },
  startle: { ms: 420, label: '被吓一跳' },
  peek: { ms: 460, label: '凑过来看' },
};

export const ALL_BEHAVIORS: MascotBehavior[] = ['breathe', 'fidget', 'stretch', 'perk', 'yawn', 'walk'];
export const ALL_REACTIONS: MascotReaction[] = ['hop', 'sway', 'startle', 'peek'];

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
 * 它不改变相位（那由用户操作决定），只影响**微动作怎么挑**：
 * 能量高 → 抖一下、抬头多，动作快而大；能量低 → 打哈欠、伸展多，动作慢而小。
 * 这就是"性格"从"能看出来"到"能感觉出来"的那一步。
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

/**
 * 行为权重：能量越低越困，越高越活跃；刚做过的降权，避免连着重复。
 *
 * `allowWalk` 是给"没地方走"和"睡着了"准备的：权重给 0，就永远不会被掷到。
 */
export function behaviorWeights(
  energy: number, recent: MascotBehavior[], allowWalk?: boolean
): { behavior: MascotBehavior; w: number }[] {
  const e = clamp01(energy);
  const base: Record<MascotBehavior, number> = {
    breathe: 1.6,
    fidget: 0.5 + e * 2.2,
    stretch: 0.4 + (1 - e) * 1.3,
    perk: 0.35 + e * 1.5,
    yawn: 0.25 + (1 - e) * 2.4,
    /*
     * 走动：精力中等偏上时最想走（睡意上来就不想动了）。
     * 用一条在 e=0.7 附近取峰值的曲线，而不是线性 —— 深夜（e→0）时它应该接近 0。
     */
    walk: allowWalk === false ? 0 : 0.9 * Math.max(0, 1 - Math.abs(e - 0.7) * 2.2),
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
 * 掷下一个微动作：做什么、做多久、这次快慢幅度抖多少。
 *
 * 规则里有一条是**硬保证**，不只是"降权"：掷出来如果正好是上一次做过的动作，就重掷一次。
 * 只降权的话偶尔还是会连着来两遍 —— 而"连着两次一样的动作"正是"假随机"最容易露馅的地方
 * （单测里 300 次就能复现）。重掷一次只多一次随机调用，代价可以忽略。
 */
export function rollBehavior(
  energy: number, recent: MascotBehavior[], rng: Rng, allowWalk?: boolean
): { behavior: MascotBehavior; until: number; jitter: { speed: number; amp: number } } {
  let b = pickWeighted(behaviorWeights(energy, recent, allowWalk), rng);
  if (recent.length > 0 && b === recent[0]) {
    const again = pickWeighted(behaviorWeights(energy, recent, allowWalk), rng);
    if (again !== recent[0]) b = again;
  }
  const cfg = BEHAVIORS[b];
  return {
    behavior: b,
    until: Math.round(pick(rng, cfg.minMs, cfg.maxMs)),
    /* 每次都快慢幅度各抖 ±15%：同样的"呼吸"，周期不会永远是 5.2 秒 */
    jitter: { speed: pick(rng, 0.85, 1.18), amp: pick(rng, 0.86, 1.14) },
  };
}

/** 掷一个反应变体，尽量不和上两次重复 */
export function rollReaction(recent: MascotReaction[], rng: Rng): MascotReaction {
  const pool = ALL_REACTIONS.filter(function (r) { return recent.indexOf(r) < 0; });
  const list = pool.length > 0 ? pool : ALL_REACTIONS;
  return list[Math.min(list.length - 1, Math.floor(clamp01(rng()) * list.length))];
}

export function initialRuntime(now: number, rng?: Rng): MascotRuntime {
  const r = rng || Math.random;
  const rolled = rollBehavior(0.5, [], r, false);
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
   * 两种情况下必须传 false：
   *   1. 睡着了 —— 睡着了还踱步就不叫睡了；
   *   2. **它贴边站着、横向没地方走** —— 这时候走一定会越界，
   *      而"不越过边界"是这功能的前提（半径由 placement.ts 的 walkRadius 算）。
   */
  allowWalk?: boolean;
}

/**
 * 纯函数地推进状态。调用方**排程在下一个事件时刻调用**即可，
 * 不需要每几百毫秒轮询一次（轮询既费电，也做不出"下一个动作在 3.4 秒后"这种节奏）。
 */
export function advance(rt: MascotRuntime, now: number, dragging: boolean, opts?: AdvanceOpts): MascotRuntime {
  const rng = (opts && opts.rng) || Math.random;
  const energy = opts && opts.energy !== undefined ? clamp01(opts.energy) : 0.5;
  /* 睡着时永远不走；调用方还可以因为"没地方走"而关掉它 */
  const walkOk = rt.phase === 'sleep' ? false : !(opts && opts.allowWalk === false);

  if (dragging !== (rt.phase === 'drag')) {
    /* 拖动开始 / 结束，优先级最高，直接切。拖完给一次"抖一下"，像是被放稳了 */
    const end = {
      phase: (dragging ? 'drag' : 'idle') as MascotPhase,
      since: now,
      lastTouch: now,
      before: dragging ? rt.before : ('idle' as MascotPhase),
    };
    const rolled = rollBehavior(energy, rt.recent, rng, false);
    return Object.assign({}, rt, end, {
      behavior: rolled.behavior,
      behaviorUntil: now + rolled.until,
      recent: [rolled.behavior].concat(rt.recent).slice(0, 2),
      jitter: rolled.jitter,
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

  const sleepAfter = opts && opts.sleepAfterMs !== undefined ? Math.max(3000, opts.sleepAfterMs) : SLEEP_AFTER_MS;
  const idleFor = now - rt.lastTouch;
  if (rt.phase !== 'sleep' && idleFor >= sleepAfter) {
    /* 睡着的那一刻给一个哈欠，比"啪一下不动了"自然 */
    return Object.assign({}, rt, {
      phase: 'sleep',
      since: now,
      before: 'idle',
      behavior: 'yawn' as MascotBehavior,
      behaviorUntil: now + Math.round(pick(rng, BEHAVIORS.yawn.minMs, BEHAVIORS.yawn.maxMs)),
      recent: ['yawn'].concat(rt.recent).slice(0, 2),
      jitter: { speed: pick(rng, 0.85, 1.18), amp: pick(rng, 0.86, 1.14) },
      reaction: null,
      reactionUntil: 0,
    });
  }

  /* 微动作做完了就掷下一个 */
  if (now >= rt.behaviorUntil) {
    const rolled = rollBehavior(energy, rt.recent, rng, walkOk);
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
  if (rt.phase !== 'sleep' && opts && opts.sleepAfterMs !== undefined) {
    times.push(rt.lastTouch + Math.max(3000, opts.sleepAfterMs));
  } else if (rt.phase !== 'sleep') {
    times.push(rt.lastTouch + SLEEP_AFTER_MS);
  }
  return Math.min.apply(null, times);
}

/** 用户点了一下：唤醒 + 掷一个反应变体 */
export function poke(rt: MascotRuntime, now: number, rng?: Rng): MascotRuntime {
  const r = rng || Math.random;
  const kind = rollReaction(rt.recentReactions, r);
  return Object.assign({}, rt, {
    phase: 'react' as MascotPhase,
    since: now,
    lastTouch: now,
    before: rt.phase === 'sleep' ? ('sleep' as MascotPhase) : ('idle' as MascotPhase),
    reaction: kind,
    reactionUntil: now + REACTIONS[kind].ms,
    recentReactions: [kind].concat(rt.recentReactions).slice(0, 2),
    /* 被点之后立刻抖一下，接着才回到呼吸 */
    behavior: 'fidget' as MascotBehavior,
    behaviorUntil: now + REACTIONS[kind].ms + 120,
    recent: ['fidget'].concat(rt.recent).slice(0, 2),
    jitter: { speed: pick(r, 0.85, 1.18), amp: pick(r, 0.86, 1.14) },
  });
}

/** 任何形式的人为接触都算"还醒着"（拖动、点击、换位置） */
export function touch(rt: MascotRuntime, now: number): MascotRuntime {
  if (rt.phase === 'drag') return Object.assign({}, rt, { lastTouch: now });
  return Object.assign({}, rt, {
    phase: rt.phase === 'react' ? 'react' : ('idle' as MascotPhase),
    lastTouch: now,
  });
}

/** 该用哪张素材：没有对应状态就退回 idle */
export function assetFor(phase: MascotPhase, available: MascotState[]): MascotState {
  if (available.indexOf(phase) >= 0) return phase;
  return 'idle';
}

/**
 * 该用哪张素材 —— 把**微动作**也算进去。
 *
 * 走动是唯一一个"和相位无关、但值得换素材"的动作：待机和走动都发生在 idle 相位里，
 * 而它们看起来应该完全不一样（一个站着发呆，一个在迈步）。
 * 所以这里多一层判断：相位是 idle、微动作是 walk、而且角色包里**确实有 walk 素材**时，
 * 用 walk；否则沿用相位那套（没有 walk 素材就退回 idle，界面层再用程序化动作补上区别）。
 */
export function assetKeyFor(phase: MascotPhase, behavior: MascotBehavior, available: MascotState[]): MascotState {
  if (phase === 'idle' && behavior === 'walk' && available.indexOf('walk') >= 0) return 'walk';
  return assetFor(phase, available);
}

/**
 * 一次眨眼该等多久。
 *
 * 入参是调用方掷出来的 [0,1) 随机数（不是"种子"）——
 * 上一版这里是 `blinkDelay(seed)` 配一个每次 +1.37 的计数器，算式写得像随机，
 * 实际上是**确定性**的：每个用户、每次启动的眨眼节奏完全一样。
 * 现在随机源在外面（生产用 Math.random），这里只负责映射到区间。
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
 * 现在的周期与幅度是**每次微动作现算的**（叠加 jitter），所以不会再出现
 * "永远 5.2 秒一次"的节拍器感。
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
