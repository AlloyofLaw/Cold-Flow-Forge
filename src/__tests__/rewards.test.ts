import { describe, it, expect } from 'vitest';
import { computeSetReward, assertRealAction, type RewardTrigger } from '../lib/rewards';
import { DEFAULT_XP_CONSTANTS } from '../lib/defaults';
import type { WorkoutSet } from '../types';

const C = DEFAULT_XP_CONSTANTS;

function mkSet(weight: number, reps: number): WorkoutSet {
  return {
    sessionId: 1,
    exerciseId: 1,
    weight,
    reps,
    unit: 'lb',
    timestamp: Date.now(),
    xpAwarded: 0,
    surpriseBonus: 0,
    prFlags: {},
  };
}

describe('reward integrity — rewards only fire on real logged actions', () => {
  it('the RewardTrigger union contains ONLY real actions (no app-open pathway)', () => {
    const valid: RewardTrigger[] = ['set-logged', 'session-ended', 'pr-hit'];
    // @ts-expect-error 'app-open' is not assignable to RewardTrigger — the type
    // makes an app-open reward pathway unrepresentable.
    const invalid: RewardTrigger = 'app-open';
    expect(valid).toHaveLength(3);
    expect(String(invalid)).toBe('app-open'); // only reachable by force-casting
  });

  it('assertRealAction throws for any non-action (defence in depth)', () => {
    expect(() => assertRealAction('set-logged')).not.toThrow();
    expect(() => assertRealAction('session-ended')).not.toThrow();
    expect(() => assertRealAction('pr-hit')).not.toThrow();
    // Force an illegal trigger as could only happen via a bug.
    expect(() => assertRealAction('app-open' as RewardTrigger)).toThrow(/integrity/i);
    expect(() => assertRealAction('screen-view' as RewardTrigger)).toThrow();
  });

  it('an empty "set" (0 reps) earns exactly 0 XP — no XP without lifting', () => {
    const r = computeSetReward({
      weight: 100,
      reps: 0,
      activeDayCount: 0,
      priorSets: [],
      constants: C,
    });
    expect(r.totalXp).toBe(0);
    expect(r.isRealSet).toBe(false);
  });
});

describe('computeSetReward — XP scales with real work', () => {
  it('base XP scales with volume load', () => {
    const light = computeSetReward({ weight: 45, reps: 5, activeDayCount: 0, priorSets: [], constants: C, rng: () => 1 });
    const heavy = computeSetReward({ weight: 315, reps: 5, activeDayCount: 0, priorSets: [], constants: C, rng: () => 1 });
    expect(heavy.baseXp).toBeGreaterThan(light.baseXp);
  });

  it('surprise bonus is deterministic under injected rng and attached to a real set', () => {
    const never = computeSetReward({ weight: 100, reps: 5, activeDayCount: 0, priorSets: [mkSet(100, 5)], constants: C, rng: () => 0.99 });
    expect(never.surpriseBonus).toBe(0);
    const always = computeSetReward({ weight: 100, reps: 5, activeDayCount: 0, priorSets: [mkSet(100, 5)], constants: C, rng: () => 0 });
    expect(always.surpriseBonus).toBeGreaterThan(0);
  });

  it('PR bonus is added on a genuine PR', () => {
    const r = computeSetReward({ weight: 200, reps: 3, activeDayCount: 0, priorSets: [mkSet(100, 5)], constants: C, rng: () => 1 });
    expect(r.prFlags.maxWeight).toBe(true);
    expect(r.prBonus).toBeGreaterThanOrEqual(C.PR_BONUS_XP);
  });

  it('phase tapers base XP: a fade-phase set pays less base than a bootstrap set', () => {
    const boot = computeSetReward({ weight: 100, reps: 5, activeDayCount: 0, priorSets: [mkSet(100, 5)], constants: C, rng: () => 1 });
    const fade = computeSetReward({
      weight: 100,
      reps: 5,
      activeDayCount: C.BOOTSTRAP_DAYS + C.SUSTAIN_TO_FADE_DAYS,
      priorSets: [mkSet(100, 5)],
      constants: C,
      rng: () => 1,
    });
    expect(fade.baseXp).toBeLessThan(boot.baseXp);
  });
});
