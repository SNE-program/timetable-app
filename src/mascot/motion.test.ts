import { describe, expect, it } from 'vitest';
import {
  ALL_BEHAVIORS, ALL_REACTIONS, BEHAVIORS, BLINK_MAX_MS, BLINK_MIN_MS, REACT_MS, REACTIONS,
  SLEEP_AFTER_MS, advance, assetFor, assetKeyFor, behaviorWeights, blinkDelayFor, energyOf,
  initialRuntime, motionVars, nextWakeAt, pickWeighted, poke, rollBehavior, rollReaction, touch,
} from './motion';
import { MASCOT_STATES } from './types';
import type { MascotBehavior, MascotReaction, MascotRuntime, Rng } from './motion';

const T0 = 1_700_000_000_000;

/**
 * 固定种子的伪随机源。测试里**绝不能用 Math.random** —— 那样"偶尔失败"会变成日常。
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

describe('相位', function () {
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
    const rt = poke(initialRuntime(T0, seeded(8)), T0, seeded(9));
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
    expect(energyOf(Object.assign({}, base, { hour: 2 }))).toBeLessThan(energyOf(Object.assign({}, base, { hour: 8 })));
  });

  it('快到上课时会精神起来', function () {
    const far = energyOf(Object.assign({}, base, { minutesToClass: 120 }));
    const soon = energyOf(Object.assign({}, base, { minutesToClass: 5 }));
    expect(soon).toBeGreaterThan(far);
  });

  it('长时间没人理就蔫下去', function () {
    expect(energyOf(Object.assign({}, base, { idleForMs: 12 * 60 * 1000 }))).toBeLessThan(energyOf(base));
  });

  it('刚被逗过会更活泼，但不会无限叠加', function () {
    expect(energyOf(Object.assign({}, base, { interactions: 3 }))).toBeGreaterThan(energyOf(base));
    expect(energyOf(Object.assign({}, base, { interactions: 999 }))).toBeLessThanOrEqual(1);
  });

  it('脏数据不崩', function () {
    expect(energyOf({ hour: NaN, minutesToClass: NaN, idleForMs: NaN, interactions: NaN })).toBeGreaterThanOrEqual(0);
  });
});

describe('★ 自然状态只有三个（待机 / 走路 / 休息）', function () {
  it('动作池里只剩待机与走路', function () {
    expect(ALL_BEHAVIORS).toEqual(['breathe', 'walk']);
  });

  it('自己编的那些小动作已经删掉了', function () {
    for (const gone of ['fidget', 'stretch', 'perk', 'yawn', 'look', 'nod']) {
      expect(ALL_BEHAVIORS).not.toContain(gone as never);
    }
  });

  it('休息是相位，不是动作：睡着时只会呼吸、也不会走动', function () {
    const rng = seeded(20);
    let rt = initialRuntime(T0, rng);
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: rng });
    expect(rt.phase).toBe('sleep');
    expect(rt.behavior).toBe('breathe');
    let now = T0 + SLEEP_AFTER_MS;
    let walkWhileAsleep = 0;
    for (let i = 0; i < 200; i++) {
      rt = advance(rt, now, false, { energy: 0.8, rng: rng, allowWalk: true });
      if (rt.phase === 'sleep' && rt.behavior === 'walk') walkWhileAsleep++;
      now = nextWakeAt(rt, { sleepAfterMs: 45000 });
    }
    expect(walkWhileAsleep).toBe(0);
  });

  it('醒着时两个动作都会出现', function () {
    const rng = seeded(21);
    let rt: MascotRuntime = initialRuntime(T0, rng);
    let now = T0;
    const seen = new Set<MascotBehavior>();
    for (let i = 0; i < 400; i++) {
      rt = advance(rt, now, false, { energy: 0.65, rng: rng, allowWalk: true });
      seen.add(rt.behavior);
      now = nextWakeAt(rt, { sleepAfterMs: 1000 * 1000 });
    }
    expect(seen.has('breathe')).toBe(true);
    expect(seen.has('walk')).toBe(true);
  });

  it('★ 反应只有真的点它才会播：一整段自然运行里一次反应都没有', function () {
    const rng = seeded(22);
    let rt: MascotRuntime = initialRuntime(T0, rng);
    let now = T0;
    let reactions = 0;
    for (let i = 0; i < 500; i++) {
      rt = advance(rt, now, false, { energy: 0.7, rng: rng, allowWalk: true });
      if (rt.reaction) reactions++;
      now = nextWakeAt(rt, { sleepAfterMs: SLEEP_AFTER_MS });
    }
    expect(reactions).toBe(0);
  });
});

describe('走路', function () {
  it('时长明显比待机长，容得下一整趟步子', function () {
    expect(BEHAVIORS.walk.minMs).toBeGreaterThanOrEqual(4500);
    expect(BEHAVIORS.walk.maxMs).toBeLessThanOrEqual(10000);
  });

  it('★ 精力中等偏上时最想走，深夜（能量低）时几乎不走', function () {
    const w = function (e: number) {
      return behaviorWeights(e, []).filter(function (x) { return x.behavior === 'walk'; })[0].w;
    };
    expect(w(0.7)).toBeGreaterThan(w(0.05));
    expect(w(0.7)).toBeGreaterThan(w(0.2));
    expect(w(0.05)).toBeLessThan(0.1);
  });

  it('★ allowWalk=false / 睡着时永远不会被掷到', function () {
    const rng = seeded(30);
    for (let i = 0; i < 300; i++) {
      expect(rollBehavior(0.7, [], rng, { allowWalk: false }).behavior).not.toBe('walk');
      expect(rollBehavior(0.7, [], rng, { dozing: true }).behavior).not.toBe('walk');
    }
  });

  it('★ 自带 walk 素材时更常走动（权重倍数）', function () {
    const plain = behaviorWeights(0.7, []).filter(function (x) { return x.behavior === 'walk'; })[0].w;
    const biased = behaviorWeights(0.7, [], { walkBias: 2.2 }).filter(function (x) { return x.behavior === 'walk'; })[0].w;
    expect(biased).toBeCloseTo(plain * 2.2, 5);
  });

  it('掷出来的时长落在该动作自己的区间里，抖动在 ±15% 附近', function () {
    const rng = seeded(31);
    for (let i = 0; i < 200; i++) {
      const r = rollBehavior(0.7, [], rng);
      const cfg = BEHAVIORS[r.behavior];
      expect(r.until).toBeGreaterThanOrEqual(cfg.minMs);
      expect(r.until).toBeLessThanOrEqual(cfg.maxMs);
      expect(r.jitter.speed).toBeGreaterThanOrEqual(0.85);
      expect(r.jitter.speed).toBeLessThanOrEqual(1.18);
      expect(r.jitter.amp).toBeGreaterThanOrEqual(0.86);
      expect(r.jitter.amp).toBeLessThanOrEqual(1.14);
    }
  });

  it('按权重掷：权重为 0 的永远不会被选到', function () {
    const rng = seeded(32);
    for (let i = 0; i < 50; i++) {
      expect(pickWeighted([{ behavior: 'breathe' as const, w: 0 }, { behavior: 'walk' as const, w: 1 }], rng)).toBe('walk');
    }
  });

  it('动作做完会自动掷下一个，并记进"最近做过"', function () {
    const rng = seeded(33);
    const rt = initialRuntime(T0, rng);
    const next = advance(rt, rt.behaviorUntil + 1, false, { energy: 0.5, rng: rng });
    expect(next.behaviorUntil).toBeGreaterThan(rt.behaviorUntil);
    expect(next.recent[0]).toBe(next.behavior);
  });

  it('拖动结束不会立刻接着走（拖动是"被摆放"，不是"散步"）', function () {
    const rng = seeded(34);
    const rt = advance(initialRuntime(T0, rng), T0 + 10, true, { rng: rng });
    const after = advance(rt, T0 + 20, false, { rng: rng, energy: 0.7 });
    expect(after.behavior).not.toBe('walk');
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

  it('★ 睡着之后会隔一阵子醒一小段，然后再睡回去', function () {
    const rng = seeded(40);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    const phases: string[] = [];
    let backToSleep = 0;
    for (let i = 0; i < 400; i++) {
      const wasStir = rt.phase === 'idle' && (rt.stirUntil || 0) > 0;
      const opts = Object.assign({ energy: 0.25, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      if (phases[phases.length - 1] !== rt.phase) phases.push(rt.phase);
      if (wasStir && rt.phase === 'sleep' && rt.behavior === 'breathe') backToSleep++;
      now = nextWakeAt(rt, opts);
    }
    const sleeps = phases.filter(function (p) { return p === 'sleep'; }).length;
    expect(sleeps).toBeGreaterThanOrEqual(3);
    expect(phases.indexOf('idle')).toBeGreaterThanOrEqual(0);
    expect(backToSleep).toBeGreaterThanOrEqual(2);
  });

  it('★ 半醒那一小段会走动（靠"刚醒"的精神头，不是靠加动作）', function () {
    const rng = seeded(41);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    let walkWhileStirring = 0;
    for (let i = 0; i < 600; i++) {
      const opts = Object.assign({ energy: 0.2, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      if (rt.phase !== 'sleep' && (rt.stirUntil || 0) > 0 && rt.behavior === 'walk') walkWhileStirring++;
      now = nextWakeAt(rt, opts);
    }
    /* 能量只有 0.2（十几分钟没人理），半醒时仍然走起来了 */
    expect(walkWhileStirring).toBeGreaterThan(0);
  });

  it('半醒结束的时刻排在"睡回去"上，睡着时排在"醒一下"上', function () {
    const rng = seeded(42);
    let rt = initialRuntime(T0, rng);
    let now = T0;
    let sawStir = false;
    let sawSleepSchedule = false;
    for (let i = 0; i < 300; i++) {
      const opts = Object.assign({ energy: 0.5, rng: rng }, FAST);
      rt = advance(rt, now, false, opts);
      const wake = nextWakeAt(rt, opts);
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
    const rng = seeded(43);
    let rt = initialRuntime(T0, rng);
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: rng });
    expect(rt.nextStirAt).toBeGreaterThan(0);
    const woke = touch(rt, T0 + SLEEP_AFTER_MS + 1000);
    expect(woke.stirUntil).toBe(0);
    expect(woke.nextStirAt).toBe(0);
    expect(woke.phase).toBe('idle');
    expect(poke(rt, T0 + SLEEP_AFTER_MS + 1000, seeded(44)).stirUntil).toBe(0);
  });

  it('睡着之后不再排"睡点"（否则会一直空转）', function () {
    let rt = initialRuntime(T0, seeded(45));
    rt = advance(rt, T0 + SLEEP_AFTER_MS, false, { rng: seeded(46) });
    const wake = nextWakeAt(rt, { sleepAfterMs: 45000 });
    expect(wake).toBe(rt.behaviorUntil);
  });
});

describe('反应（只有点了才会有）', function () {
  it('三种程序化反应都会出现，左右摇摆那种已经删掉', function () {
    const rng = seeded(50);
    const seen = new Set<string>();
    let recent: MascotReaction[] = [];
    for (let i = 0; i < 200; i++) {
      const r = rollReaction(recent, rng);
      seen.add(r);
      recent = [r].concat(recent).slice(0, 2);
    }
    expect(seen.size).toBe(ALL_REACTIONS.length);
    expect(ALL_REACTIONS).not.toContain('sway' as never);
    expect(ALL_REACTIONS.length).toBe(3);
  });

  it('★ 不会连着两次同一个反应', function () {
    const rng = seeded(51);
    let recent: MascotReaction[] = [];
    for (let i = 0; i < 200; i++) {
      const r = rollReaction(recent, rng);
      expect(r).not.toBe(recent[0]);
      recent = [r].concat(recent).slice(0, 2);
    }
  });

  it('点一下会带上反应，并且反应结束后自动清掉', function () {
    const rt = poke(initialRuntime(T0, seeded(52)), T0, seeded(53));
    expect(rt.reaction).not.toBeNull();
    expect(rt.reactionUntil).toBe(T0 + REACTIONS[rt.reaction!].ms);
    const after = advance(rt, rt.reactionUntil + 1, false, { rng: seeded(54) });
    expect(after.reaction).toBeNull();
  });

  it('★ 自带 react 素材时可以要求播久一点（逐帧动画不被拦腰砍断）', function () {
    const rt = poke(initialRuntime(T0, seeded(55)), T0, seeded(56), 900);
    expect(rt.reactionUntil).toBe(T0 + 900);
    expect(rt.behaviorUntil).toBe(T0 + 900 + 120);
  });

  it('反应序号会往前走（界面靠它可靠地重启动画）', function () {
    const rt0 = initialRuntime(T0, seeded(57));
    expect(poke(rt0, T0, seeded(58)).reactionSeq).toBe(rt0.reactionSeq + 1);
  });
});

describe('素材选择', function () {
  it('★ 正在播反应且包里有 react 素材 → 用 react（作者画的优先）', function () {
    expect(assetKeyFor('react', 'breathe', ['idle', 'react'], true)).toBe('react');
    expect(assetKeyFor('idle', 'breathe', ['idle', 'react'], true)).toBe('react');
  });

  it('没有 react 素材就退回 idle，由界面层加程序化反应', function () {
    expect(assetKeyFor('react', 'breathe', ['idle'], true)).toBe('idle');
  });

  it('没在播反应时不会去切 react 素材', function () {
    expect(assetKeyFor('idle', 'breathe', ['idle', 'react'], false)).toBe('idle');
  });

  it('★ 走动时优先用 walk 素材（走路与休息要能区分）', function () {
    expect(assetKeyFor('idle', 'walk', ['idle', 'walk'])).toBe('walk');
    expect(assetKeyFor('idle', 'breathe', ['idle', 'walk'])).toBe('idle');
    expect(assetKeyFor('idle', 'walk', ['idle'])).toBe('idle');
    expect(assetKeyFor('idle', 'walk', [])).toBe('idle');
  });

  it('睡着 / 被点 / 被拖时不走 walk 素材（相位优先）', function () {
    expect(assetKeyFor('sleep', 'walk', ['idle', 'walk', 'sleep'])).toBe('sleep');
    expect(assetKeyFor('react', 'walk', ['idle', 'walk', 'react'])).toBe('react');
    expect(assetKeyFor('drag', 'walk', ['idle', 'walk', 'drag'])).toBe('drag');
  });

  it('有对应状态的素材就用它，没有就退回 idle', function () {
    expect(assetFor('react', ['idle', 'react'])).toBe('react');
    expect(assetFor('sleep', ['idle', 'sleep'])).toBe('sleep');
    expect(assetFor('sleep', ['idle'])).toBe('idle');
    expect(assetFor('drag', [])).toBe('idle');
  });

  it('walk 是角色包里的正式状态之一', function () {
    expect(MASCOT_STATES).toContain('walk');
    expect(MASCOT_STATES[0]).toBe('idle');
  });
});

describe('眨眼节奏', function () {
  it('落在设定区间里；输入越界也夹住', function () {
    for (let i = 0; i < 50; i++) {
      const d = blinkDelayFor(i / 50);
      expect(d).toBeGreaterThanOrEqual(BLINK_MIN_MS);
      expect(d).toBeLessThanOrEqual(BLINK_MAX_MS);
    }
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

  it('走路比待机幅度小、周期长（贴着地迈步，不飘）', function () {
    const breathe = motionVars(MOTION, 'idle', 'breathe', NO_JITTER, false);
    const walk = motionVars(MOTION, 'idle', 'walk', NO_JITTER, false);
    /* --m-speed 是**周期**（秒）：走路 7 秒一轮，比呼吸的 5.2 秒慢 */
    expect(parseFloat(walk['--m-speed'])).toBeGreaterThan(parseFloat(breathe['--m-speed']));
    expect(parseFloat(walk['--m-bob'])).toBeLessThan(parseFloat(breathe['--m-bob']));
  });

  it('★ 幅度只减不增：行为层不会把素材的呼吸 / 摆动放大', function () {
    for (const b of ALL_BEHAVIORS) {
      for (const jitter of [NO_JITTER, { speed: 1.18, amp: 1.14 }]) {
        const v = motionVars(MOTION, 'idle', b, jitter, false);
        expect(parseFloat(v['--m-breathe'])).toBeLessThanOrEqual(MOTION.breathe * 1.14 + 0.0001);
        expect(parseFloat(v['--m-sway'])).toBeLessThanOrEqual(MOTION.sway * 1.14 + 0.001);
      }
    }
  });

  it('系统开了"减弱动态效果"就全部归零，且与动作无关', function () {
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
