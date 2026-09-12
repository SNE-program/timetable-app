import { describe, expect, it } from 'vitest';
import {
  ALL_BEHAVIORS, ALL_REACTIONS, BEHAVIORS, BLINK_MAX_MS, BLINK_MIN_MS, REACT_MS, REACTIONS,
  SELF_REACTIONS, SLEEP_AFTER_MS, advance, assetFor, assetKeyFor, behaviorWeights, blinkDelayFor, energyOf,
  initialRuntime, motionVars, nextWakeAt, pickWeighted, poke, rollBehavior, rollReaction, touch,
} from './motion';
import { MASCOT_STATES } from './types';
import type { MascotBehavior, MascotRuntime, Rng } from './motion';

const T0 = 1_700_000_000_000;

/**
 * 固定种子的伪随机源。
 *
 * 测试里**绝不能用 Math.random** —— 那样"偶尔失败"会变成日常。
 * 状态机的随机源是可注入的（见 motion.ts 的说明），这里就是它的用武之地。
 */
function seeded(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MOTION = { breathe: 0.03, bob: 0.02, sway: 4 };
const NO_JITTER = { speed: 1, amp: 1 };

describe('状态机 · 相位', function () {
  it('初始是待机', function () {
    const rt = initialRuntime(T0, seeded(1));
    expect(rt.phase).toBe('idle');
    expect(rt.lastTouch).toBe(T0);
  });

  it('点一下进入反应，反应完回到待机', function () {
    let rt = initialRuntime(T0, seeded(2));
    rt = poke(rt, T0, seeded(3));
    expect(rt.phase).toBe('react');
    expect(advance(rt, T0 + REACT_MS - 50, false).phase).toBe('react');
    expect(advance(rt, T0 + REACT_MS + 1, false).phase).toBe('idle');
  });

  it('睡着了被点：反应完回到睡着，而不是突然精神起来', function () {
    let rt = initialRuntime(T0, seeded(4));
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false);
    expect(rt.phase).toBe('sleep');
    rt = poke(rt, T0 + SLEEP_AFTER_MS, seeded(5));
    expect(rt.phase).toBe('react');
    expect(advance(rt, T0 + SLEEP_AFTER_MS + REACT_MS + 1, false).phase).toBe('sleep');
  });

  it('长时间没人碰就打瞌睡', function () {
    const rt = initialRuntime(T0, seeded(6));
    expect(advance(rt, T0 + SLEEP_AFTER_MS - 1, false).phase).toBe('idle');
    expect(advance(rt, T0 + SLEEP_AFTER_MS, false).phase).toBe('sleep');
  });

  it('碰一下就醒过来，而且重新开始计时', function () {
    let rt = initialRuntime(T0, seeded(7));
    rt = advance(rt, T0 + SLEEP_AFTER_MS + 10, false);
    rt = touch(rt, T0 + SLEEP_AFTER_MS + 20);
    expect(rt.phase).toBe('idle');
    expect(advance(rt, T0 + SLEEP_AFTER_MS + 30, false).phase).toBe('idle');
  });

  it('拖动优先级最高：拖起来立刻进 drag，松手回 idle', function () {
    let rt = poke(initialRuntime(T0, seeded(8)), T0, seeded(9));
    const dragging = advance(rt, T0 + 10, true);
    expect(dragging.phase).toBe('drag');
    expect(advance(dragging, T0 + SLEEP_AFTER_MS * 2, true).phase).toBe('drag');
    expect(advance(dragging, T0 + 20, false).phase).toBe('idle');
  });

  it('拖动中持续 touch 不会打断 drag', function () {
    let rt = advance(initialRuntime(T0, seeded(10)), T0 + 10, true);
    rt = touch(rt, T0 + 20);
    expect(rt.phase).toBe('drag');
  });

  it('同一个种子 + 同一个输入 = 完全相同的输出（随机可复现）', function () {
    const rt = initialRuntime(T0, seeded(11));
    const a = advance(rt, T0 + 9000, false, { energy: 0.4, rng: seeded(12) });
    const b = advance(rt, T0 + 9000, false, { energy: 0.4, rng: seeded(12) });
    expect(a).toEqual(b);
    /* 原对象没被改 */
    expect(rt.phase).toBe('idle');
    expect(rt.since).toBe(T0);
  });
});

describe('能量', function () {
  const base = { hour: 12, minutesToClass: null, idleForMs: 0, interactions: 0 };

  it('落在 0..1', function () {
    for (const hour of [0, 5, 8, 13, 18, 23]) {
      const e = energyOf(Object.assign({}, base, { hour: hour }));
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it('深夜比上午蔫', function () {
    const morning = energyOf(Object.assign({}, base, { hour: 8 }));
    const night = energyOf(Object.assign({}, base, { hour: 2 }));
    expect(night).toBeLessThan(morning);
  });

  it('快到上课时会精神起来', function () {
    const far = energyOf(Object.assign({}, base, { minutesToClass: 120 }));
    const soon = energyOf(Object.assign({}, base, { minutesToClass: 5 }));
    expect(soon).toBeGreaterThan(far);
  });

  it('长时间没人理就蔫下去', function () {
    const fresh = energyOf(base);
    const lonely = energyOf(Object.assign({}, base, { idleForMs: 12 * 60 * 1000 }));
    expect(lonely).toBeLessThan(fresh);
  });

  it('刚被逗过会更活泼，但不会无限叠加', function () {
    const none = energyOf(base);
    const poked = energyOf(Object.assign({}, base, { interactions: 3 }));
    const spammed = energyOf(Object.assign({}, base, { interactions: 999 }));
    expect(poked).toBeGreaterThan(none);
    expect(spammed).toBeLessThanOrEqual(1);
  });

  it('脏数据不崩', function () {
    expect(energyOf({ hour: NaN, minutesToClass: NaN, idleForMs: NaN, interactions: NaN })).toBeGreaterThanOrEqual(0);
  });
});

describe('微动作', function () {
  it('能量高时更容易抖，能量低时更容易打哈欠', function () {
    const hot = behaviorWeights(0.95, []);
    const cold = behaviorWeights(0.05, []);
    const w = function (list: { behavior: MascotBehavior; w: number }[], b: MascotBehavior) {
      return (list.filter(function (x) { return x.behavior === b; })[0] || { w: 0 }).w;
    };
    expect(w(hot, 'fidget')).toBeGreaterThan(w(cold, 'fidget'));
    expect(w(cold, 'yawn')).toBeGreaterThan(w(hot, 'yawn'));
  });

  it('刚做过的动作会被压低权重', function () {
    const fresh = behaviorWeights(0.5, []).filter(function (x) { return x.behavior === 'breathe'; })[0].w;
    const justDid = behaviorWeights(0.5, ['breathe']).filter(function (x) { return x.behavior === 'breathe'; })[0].w;
    expect(justDid).toBeLessThan(fresh);
  });

  it('按权重掷：权重为 0 的永远不会被选到', function () {
    const rng = seeded(20);
    for (let i = 0; i < 50; i++) {
      const b = pickWeighted([{ behavior: 'a' as const, w: 0 }, { behavior: 'b' as const, w: 1 }], rng);
      expect(b).toBe('b');
    }
  });

  it('掷出来的时长落在该动作自己的区间里', function () {
    const rng = seeded(21);
    for (let i = 0; i < 200; i++) {
      const r = rollBehavior(0.5, [], rng);
      const cfg = BEHAVIORS[r.behavior];
      expect(r.until).toBeGreaterThanOrEqual(cfg.minMs);
      expect(r.until).toBeLessThanOrEqual(cfg.maxMs);
    }
  });

  it('★ 抖动范围收在 ±15% 左右 —— 同样的动作用远是同一个周期就成节拍器了', function () {
    const rng = seeded(22);
    for (let i = 0; i < 100; i++) {
      const r = rollBehavior(0.5, [], rng);
      expect(r.jitter.speed).toBeGreaterThanOrEqual(0.85);
      expect(r.jitter.speed).toBeLessThanOrEqual(1.18);
      expect(r.jitter.amp).toBeGreaterThanOrEqual(0.86);
      expect(r.jitter.amp).toBeLessThanOrEqual(1.14);
    }
  });

  it('★ 连着两次不会是同一个动作', function () {
    const rng = seeded(23);
    let recent: MascotBehavior[] = [];
    const seen = new Set<MascotBehavior>();
    for (let i = 0; i < 300; i++) {
      const r = rollBehavior(0.5, recent, rng);
      expect(r.behavior).not.toBe(recent[0]);
      seen.add(r.behavior);
      recent = [r.behavior].concat(recent).slice(0, 2);
    }
    /* 五种动作都会被用到，不是偏科 */
    expect(seen.size).toBe(ALL_BEHAVIORS.length);
  });

  it('微动作做完会自动掷下一个，并记进"最近做过"', function () {
    const rng = seeded(24);
    const rt = initialRuntime(T0, rng);
    const next = advance(rt, rt.behaviorUntil + 1, false, { energy: 0.5, rng: rng });
    expect(next.behaviorUntil).toBeGreaterThan(rt.behaviorUntil);
    expect(next.recent[0]).toBe(next.behavior);
  });

  it('睡着的那一刻在打哈欠，而不是啪一下不动', function () {
    const rt = initialRuntime(T0, seeded(25));
    const asleep = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: seeded(26) });
    expect(asleep.phase).toBe('sleep');
    expect(asleep.behavior).toBe('yawn');
  });
});

describe('来回走走', function () {
  it('在动作池里，且时长明显比其它动作长', function () {
    expect(ALL_BEHAVIORS).toContain('walk');
    expect(BEHAVIORS.walk.minMs).toBeGreaterThanOrEqual(5000);
    expect(BEHAVIORS.walk.maxMs).toBeLessThanOrEqual(9000);
  });

  it('★ 精力中等偏上时最想走，深夜（能量低）时几乎不走', function () {
    const w = function (e: number) {
      return behaviorWeights(e, []).filter(function (x) { return x.behavior === 'walk'; })[0].w;
    };
    expect(w(0.7)).toBeGreaterThan(w(0.05));
    expect(w(0.7)).toBeGreaterThan(w(0.2));
    expect(w(0.05)).toBeLessThan(0.1);
  });

  it('★ allowWalk=false 时永远不会被掷到（贴边站 / 睡着了）', function () {
    const rng = seeded(60);
    for (let i = 0; i < 300; i++) {
      expect(rollBehavior(0.7, [], rng, false).behavior).not.toBe('walk');
    }
  });

  it('★ 睡着的时候一次都不会踱步（走只属于醒着的那一小段）', function () {
    const rng = seeded(61);
    let rt = initialRuntime(T0, rng);
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: rng });
    expect(rt.phase).toBe('sleep');
    let now = T0 + SLEEP_AFTER_MS;
    let walkWhileAsleep = 0;
    for (let i = 0; i < 200; i++) {
      rt = advance(rt, now, false, { energy: 0.8, rng: rng, allowWalk: true });
      /* 判据是"睡着的那一刻不许出现走走" —— 半醒那一小段是可以走的 */
      if (rt.phase === 'sleep' && rt.behavior === 'walk') walkWhileAsleep++;
      now = nextWakeAt(rt, { sleepAfterMs: 45000 });
    }
    expect(walkWhileAsleep).toBe(0);
  });

  it('允许走时，长时间运行里会出现走走', function () {
    const rng = seeded(62);
    let rt: MascotRuntime = initialRuntime(T0, rng);
    let now = T0;
    let sawWalk = false;
    for (let i = 0; i < 400 && !sawWalk; i++) {
      rt = advance(rt, now, false, { energy: 0.7, rng: rng, allowWalk: true });
      if (rt.behavior === 'walk') sawWalk = true;
      now = nextWakeAt(rt, { sleepAfterMs: SLEEP_AFTER_MS });
    }
    expect(sawWalk).toBe(true);
  });

  it('拖动结束不会立刻接着走（拖动是"被摆放"，不是"散步"）', function () {
    const rng = seeded(63);
    const rt = advance(initialRuntime(T0, rng), T0 + 10, true, { rng: rng });
    const after = advance(rt, T0 + 20, false, { rng: rng, energy: 0.7 });
    expect(after.behavior).not.toBe('walk');
  });
});

describe('反应变体', function () {
  it('有四种，四种都会出现', function () {
    const rng = seeded(30);
    const seen = new Set<string>();
    let recent: ('hop' | 'sway' | 'startle' | 'peek')[] = [];
    for (let i = 0; i < 200; i++) {
      const r = rollReaction(recent, rng);
      seen.add(r);
      recent = [r].concat(recent).slice(0, 2);
    }
    expect(seen.size).toBe(ALL_REACTIONS.length);
  });

  it('★ 不会连着两次同一个反应', function () {
    const rng = seeded(31);
    let recent: ('hop' | 'sway' | 'startle' | 'peek')[] = [];
    for (let i = 0; i < 200; i++) {
      const r = rollReaction(recent, rng);
      expect(r).not.toBe(recent[0]);
      recent = [r].concat(recent).slice(0, 2);
    }
  });

  it('点一下会带上反应，并且反应结束后自动清掉', function () {
    const rt = poke(initialRuntime(T0, seeded(32)), T0, seeded(33));
    expect(rt.reaction).not.toBeNull();
    expect(rt.reactionUntil).toBe(T0 + REACTIONS[rt.reaction!].ms);
    const after = advance(rt, rt.reactionUntil + 1, false, { rng: seeded(34) });
    expect(after.reaction).toBeNull();
  });
});

describe('下一次唤醒时刻', function () {
  it('取最近的待办时刻（微动作 / 反应 / 睡点）', function () {
    const rt = poke(initialRuntime(T0, seeded(40)), T0, seeded(41));
    const wake = nextWakeAt(rt, { sleepAfterMs: SLEEP_AFTER_MS });
    expect(wake).toBeLessThanOrEqual(rt.behaviorUntil);
    expect(wake).toBeLessThanOrEqual(rt.reactionUntil);
    expect(wake).toBeLessThanOrEqual(T0 + REACT_MS);
  });

  it('睡着之后不再排"睡点"（否则会一直空转）', function () {
    let rt = initialRuntime(T0, seeded(42));
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: seeded(43) });
    const wake = nextWakeAt(rt, { sleepAfterMs: 45000 });
    expect(wake).toBe(rt.behaviorUntil);
  });
});

describe('素材选择 · 相位 + 微动作', function () {
  it('★ 走动时优先用 walk 素材（走路与休息要能区分）', function () {
    expect(assetKeyFor('idle', 'walk', ['idle', 'walk'])).toBe('walk');
    /* 不在走动时绝不用 walk 素材 */
    expect(assetKeyFor('idle', 'breathe', ['idle', 'walk'])).toBe('idle');
    expect(assetKeyFor('idle', 'yawn', ['idle', 'walk'])).toBe('idle');
    expect(assetKeyFor('idle', 'fidget', ['idle', 'walk'])).toBe('idle');
  });

  it('★ 没有 walk 素材就退回 idle —— 只放一张图也必须能跑', function () {
    expect(assetKeyFor('idle', 'walk', ['idle'])).toBe('idle');
    expect(assetKeyFor('idle', 'walk', [])).toBe('idle');
  });

  it('睡着 / 被点 / 被拖时不走 walk 素材（相位优先）', function () {
    expect(assetKeyFor('sleep', 'breath' as never, ['idle', 'walk', 'sleep'])).toBe('sleep');
    expect(assetKeyFor('react', 'walk', ['idle', 'walk', 'react'])).toBe('react');
    expect(assetKeyFor('drag', 'walk', ['idle', 'walk', 'drag'])).toBe('drag');
  });

  it('walk 是角色包里的正式状态之一', function () {
    expect(MASCOT_STATES).toContain('walk');
    expect(MASCOT_STATES[0]).toBe('idle');
  });
});

describe('素材选择 · 相位', function () {
  it('有对应状态的素材就用它', function () {
    expect(assetFor('react', ['idle', 'react'])).toBe('react');
    expect(assetFor('sleep', ['idle', 'sleep'])).toBe('sleep');
  });

  it('没有就退回 idle —— 只放一张图也必须能跑', function () {
    expect(assetFor('react', ['idle'])).toBe('idle');
    expect(assetFor('sleep', ['idle'])).toBe('idle');
    expect(assetFor('drag', [])).toBe('idle');
  });
});

describe('眨眼节奏', function () {
  it('落在设定区间里', function () {
    for (let i = 0; i < 50; i++) {
      const d = blinkDelayFor(i / 50);
      expect(d).toBeGreaterThanOrEqual(BLINK_MIN_MS);
      expect(d).toBeLessThanOrEqual(BLINK_MAX_MS);
    }
  });

  it('输入越界也夹住，不会给出负数或超长间隔', function () {
    expect(blinkDelayFor(-5)).toBe(BLINK_MIN_MS);
    expect(blinkDelayFor(9)).toBe(BLINK_MAX_MS);
    expect(blinkDelayFor(NaN)).toBe(BLINK_MIN_MS);
  });

  it('随机源在外面 —— 这里只是映射，不做"假随机"', function () {
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) seen.add(blinkDelayFor(i / 20));
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe('动画参数', function () {
  it('按素材设置换算成 CSS 变量', function () {
    const v = motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false);
    expect(v['--m-breathe']).toBe('0.0300');
    expect(v['--m-bob']).toBe('0.0200');
    expect(v['--m-sway']).toBe('4.00deg');
    expect(parseFloat(v['--m-speed'])).toBeCloseTo(5.2, 1);
  });

  it('不同微动作给不同的快慢与幅度', function () {
    const breathe = parseFloat(motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false)['--m-speed']);
    const fidget = parseFloat(motionVars(MOTION, 'idle', 'fidget', NO_JITTER, false)['--m-speed']);
    const yawn = parseFloat(motionVars(MOTION, 'idle', 'yawn', NO_JITTER, false)['--m-speed']);
    expect(fidget).toBeLessThan(breathe);   /* 抖一下 = 周期更短 */
    expect(yawn).toBeGreaterThan(breathe);  /* 打哈欠 = 更慢 */
  });

  it('★ 抖动会改周期与幅度（同样动作不会永远同一个节奏）', function () {
    const a = motionVars(MOTION, 'idle', 'breathe', { speed: 1, amp: 1 }, false);
    const b = motionVars(MOTION, 'idle', 'breathe', { speed: 1.18, amp: 1.14 }, false);
    expect(parseFloat(b['--m-speed'])).toBeGreaterThan(parseFloat(a['--m-speed']));
    expect(parseFloat(b['--m-breathe'])).toBeGreaterThan(parseFloat(a['--m-breathe']));
  });

  it('系统开了"减弱动态效果"就全部归零，且与微动作无关', function () {
    for (const b of ALL_BEHAVIORS) {
      const v = motionVars(MOTION, 'idle', b, NO_JITTER, true);
      expect(v['--m-breathe']).toBe('0');
      expect(v['--m-bob']).toBe('0');
      expect(v['--m-sway']).toBe('0deg');
      expect(v['--m-speed']).toBe('0s');
    }
  });

  it('拖动时不晃 —— 手指按着还在动会很难对准', function () {
    const v = motionVars(MOTION, 'drag', 'breathe', NO_JITTER, false);
    expect(parseFloat(v['--m-breathe'])).toBe(0);
    expect(parseFloat(v['--m-bob'])).toBe(0);
    expect(parseFloat(v['--m-sway'])).toBe(0);
  });

  it('睡着了动作放慢、幅度变小', function () {
    const idle = motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false);
    const sleep = motionVars(MOTION, 'sleep', 'breathe', NO_JITTER, false);
    expect(parseFloat(sleep['--m-speed'])).toBeGreaterThan(parseFloat(idle['--m-speed']));
    expect(parseFloat(sleep['--m-breathe'])).toBeLessThan(parseFloat(idle['--m-breathe']));
  });

  it('素材把动作幅度设为 0 时（视频角色），行为层不会凭空造出动作', function () {
    const zero = { breathe: 0, bob: 0, sway: 0 };
    for (const b of ALL_BEHAVIORS) {
      const v = motionVars(zero, 'idle', b, { speed: 1, amp: 1.5 }, false);
      expect(parseFloat(v['--m-breathe'])).toBe(0);
      expect(parseFloat(v['--m-bob'])).toBe(0);
      expect(v['--m-sway']).toBe('0.00deg');
    }
  });
});

describe('打盹循环（久等也不会卡在同一个动画上）', function () {
  /** 压缩过的节奏：睡 3–4 秒 → 醒 2–3 秒。正常是 45–150 / 4–14 秒 */
  const FAST = {
    sleepAfterMs: 5000,
    stirMs: { min: 3000, max: 4000 },
    wakeMs: { min: 2000, max: 3000 },
    allowWalk: true,
  };

  it('★ 睡着之后会隔一阵子醒一小段，再打哈欠睡回去（一轮一轮地来回）', function () {
    const rng = seeded(70);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    const phases: string[] = [];
    let backToSleepWithYawn = 0;
    for (let i = 0; i < 400; i++) {
      const wasStir = rt.phase === 'idle' && (rt.stirUntil || 0) > 0;
      const opts = Object.assign({ energy: 0.25, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      if (phases[phases.length - 1] !== rt.phase) phases.push(rt.phase);
      /* 从半醒睡回去的那一下，必须是"睡着 + 打哈欠" */
      if (wasStir && rt.phase === 'sleep' && rt.behavior === 'yawn') backToSleepWithYawn++;
      now = nextWakeAt(rt, Object.assign({ energy: 0.25, rng: rng }, FAST));
    }
    const sleeps = phases.filter(function (p) { return p === 'sleep'; }).length;
    /* 睡 → 醒 → 睡 至少来回好几轮，而不是一睡不醒 */
    expect(sleeps).toBeGreaterThanOrEqual(3);
    expect(phases.indexOf('idle')).toBeGreaterThanOrEqual(0);
    expect(backToSleepWithYawn).toBeGreaterThanOrEqual(2);
  });

  it('★ 半醒那一小段走的是"醒着"的动作池（会出现走动 / 张望 / 点头，而不是清一色呼吸）', function () {
    const rng = seeded(71);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    const duringStir = new Set<MascotBehavior>();
    let walkOutsideSleep = 0;
    for (let i = 0; i < 500; i++) {
      const opts = Object.assign({ energy: 0.2, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      if (rt.phase !== 'sleep' && (rt.stirUntil || 0) > 0) duringStir.add(rt.behavior);
      if (rt.phase !== 'sleep' && rt.behavior === 'walk') walkOutsideSleep++;
      now = nextWakeAt(rt, opts);
    }
    /* 半醒时不该只有"呼吸"一种 —— 至少三种动作，且不含睡眠专属的哈欠堆叠 */
    expect(duringStir.size).toBeGreaterThanOrEqual(3);
    /* 能量只有 0.2（十几分钟没人理），半醒时仍然走起来了 —— 靠的是"刚醒"的精神头 */
    expect(walkOutsideSleep).toBeGreaterThan(0);
  });

  it('半醒结束的时刻排在"睡回去"上，睡着时排在"醒一下"上', function () {
    const rng = seeded(72);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    let sawStir = false;
    let sawSleepSchedule = false;
    for (let i = 0; i < 300; i++) {
      const opts = Object.assign({ energy: 0.5, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      const wake = nextWakeAt(rt, opts);
      /*
       * 三条不变量（不去复述实现，只钉住"不能怎样"）：
       *   1. 不会排在过去 —— 排到过去就等于紧循环空转；
       *   2. 睡着时一定会被叫醒去"动一下"；
       *   3. 半醒时一定会被叫醒去睡回去。
       */
      expect(wake).toBeGreaterThanOrEqual(now);
      expect(wake - now).toBeLessThanOrEqual(5 * 60 * 1000);
      if (rt.phase === 'sleep') {
        expect((rt.nextStirAt || 0)).toBeGreaterThan(0);
        expect(wake).toBeLessThanOrEqual(rt.nextStirAt);
        sawSleepSchedule = true;
      } else if ((rt.stirUntil || 0) > 0) {
        expect(wake).toBeLessThanOrEqual(rt.stirUntil);
        sawStir = true;
      }
      now = wake;
    }
    expect(sawSleepSchedule).toBe(true);
    expect(sawStir).toBe(true);
  });

  it('人一碰就打盹循环清空：半醒取消、下一次"醒一下"重排', function () {
    const rng = seeded(73);
    let rt = initialRuntime(T0, rng);
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: rng });
    expect(rt.nextStirAt).toBeGreaterThan(0);
    const woke = touch(rt, T0 + SLEEP_AFTER_MS + 1000);
    expect(woke.stirUntil).toBe(0);
    expect(woke.nextStirAt).toBe(0);
    expect(woke.phase).toBe('idle');
    /* 被点也一样 */
    const poked = poke(rt, T0 + SLEEP_AFTER_MS + 1000, seeded(74));
    expect(poked.stirUntil).toBe(0);
  });
});

describe('自发小动作（没人点也会自己动一下）', function () {
  it('★ 长时间没人理也会零星播反应，而且绝不会是"被吓一跳"', function () {
    const rng = seeded(80);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    const kinds = new Set<string>();
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const before = rt.reaction;
      rt = advance(rt, now, false, { energy: 0.6, rng: rng, allowWalk: true });
      if (rt.reaction && rt.reaction !== before) {
        total++;
        kinds.add(rt.reaction);
        /* 自发动作只从 SELF_REACTIONS 里挑 */
        expect(SELF_REACTIONS).toContain(rt.reaction);
      }
      now = nextWakeAt(rt, { sleepAfterMs: SLEEP_AFTER_MS });
    }
    expect(total).toBeGreaterThanOrEqual(3);
    expect(kinds.has('startle')).toBe(false);
  });

  it('已经在播反应时不会叠加第二个（两段 transform 动画会互相抢）', function () {
    const rng = seeded(81);
    const poked = poke(initialRuntime(T0, rng), T0, seeded(82));
    const next = advance(poked, poked.behaviorUntil + 1, false, { rng: rng, energy: 1 });
    /* 反应还没播完，动作即使换了一个也不该塞进新的自发反应 */
    if (next.reaction && poked.reactionUntil > poked.behaviorUntil + 1) {
      expect(next.reaction).toBe(poked.reaction);
    }
  });

  it('反应序号会往前走（界面靠它可靠地重启动画）', function () {
    const rng = seeded(83);
    const rt0 = initialRuntime(T0, rng);
    const poked = poke(rt0, T0, seeded(84));
    expect(poked.reactionSeq).toBe(rt0.reactionSeq + 1);
  });
});

describe('新增的微动作', function () {
  it('张望 / 点头进了动作池，并且会被掷到', function () {
    expect(ALL_BEHAVIORS).toContain('look');
    expect(ALL_BEHAVIORS).toContain('nod');
    const rng = seeded(90);
    let recent: MascotBehavior[] = [];
    const seen = new Set<MascotBehavior>();
    for (let i = 0; i < 400; i++) {
      const r = rollBehavior(0.6, recent, rng);
      seen.add(r.behavior);
      recent = [r.behavior].concat(recent).slice(0, 2);
    }
    expect(seen.has('look')).toBe(true);
    expect(seen.has('nod')).toBe(true);
  });

  it('★ 配比让"点头"与"张望"落在不同的通道上（不是同一个动作换速度）', function () {
    const baseBob = parseFloat(motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false)['--m-bob']);
    const baseSway = parseFloat(motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false)['--m-sway']);
    const nod = motionVars(MOTION, 'idle', 'nod', NO_JITTER, false);
    const look = motionVars(MOTION, 'idle', 'look', NO_JITTER, false);
    /* 同一条通道横向比：点头的上下更多，张望的左右更多 */
    expect(parseFloat(nod['--m-bob']) / baseBob).toBeGreaterThan(parseFloat(look['--m-bob']) / baseBob);
    expect(parseFloat(look['--m-sway']) / baseSway).toBeGreaterThan(parseFloat(nod['--m-sway']) / baseSway);
  });

  it('睡着了挑不到"张望 / 点头"这类醒着才有的动作（权重为 0 或极低）', function () {
    const rng = seeded(91);
    let recent: MascotBehavior[] = [];
    let awakeish = 0;
    for (let i = 0; i < 300; i++) {
      const r = rollBehavior(0.8, recent, rng, { dozing: true, allowWalk: false });
      if (r.behavior === 'look' || r.behavior === 'nod' || r.behavior === 'walk') awakeish++;
      recent = [r.behavior].concat(recent).slice(0, 2);
    }
    expect(awakeish / 300).toBeLessThan(0.2);
  });
});

describe('长时间运行的手感', function () {
  it('★ 60 秒里会做多种动作，而不是一直呼吸', function () {
    const rng = seeded(50);
    let rt: MascotRuntime = initialRuntime(T0, rng);
    let now = T0;
    const kinds = new Set<MascotBehavior>();
    for (let i = 0; i < 600; i++) {
      rt = advance(rt, now, false, { energy: 0.6, rng: rng });
      kinds.add(rt.behavior);
      now = nextWakeAt(rt, { sleepAfterMs: SLEEP_AFTER_MS });
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});
