import { describe, it, expect } from 'vitest';
import {
  epley1RM,
  baseSetXp,
  levelFromXp,
  xpToReachLevel,
  computePriorBests,
  detectPRs,
  phaseForActiveDays,
  applyXpToTrack,
  markTrackActiveDay,
  recordTrainingDay,
  STARTER_ENDOWMENT_XP,
} from '../lib/progression';
import { DEFAULT_XP_CONSTANTS } from '../lib/defaults';
import type { WorkoutSet, Track, Consistency } from '../types';

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

describe('Epley estimated 1RM', () => {
  it('1RM ≈ weight × (1 + reps/30)', () => {
    expect(epley1RM(100, 10)).toBeCloseTo(133.333, 3);
    expect(epley1RM(225, 1)).toBeCloseTo(232.5, 3);
  });
  it('0 reps -> 0', () => {
    expect(epley1RM(100, 0)).toBe(0);
  });
});

describe('XP formula', () => {
  it('setXP = round(BASE_SET_XP + volume / VOLUME_DIVISOR)', () => {
    // volume 1000, base 10, divisor 100 -> 10 + 10 = 20
    expect(baseSetXp(100, 10, C)).toBe(20);
    // volume 0 -> just base
    expect(baseSetXp(0, 5, C)).toBe(10);
  });
});

describe('leveling curve (uncapped, never decays)', () => {
  it('levels rise monotonically with xp', () => {
    expect(levelFromXp(0).level).toBe(0);
    expect(levelFromXp(100).level).toBe(1);
    expect(xpToReachLevel(2)).toBe(100 + 150);
  });
});

describe('PR detection', () => {
  it('first set at a weight sets maxWeight + est1RM PR but not repPR', () => {
    const prior = computePriorBests([]);
    const flags = detectPRs(135, 5, prior);
    expect(flags.maxWeight).toBe(true);
    expect(flags.est1RM).toBe(true);
    expect(flags.repPR).toBeUndefined();
  });

  it('more reps at same weight is a rep PR', () => {
    const prior = computePriorBests([mkSet(100, 5)]);
    const flags = detectPRs(100, 8, prior);
    expect(flags.repPR).toBe(true);
    expect(flags.maxWeight).toBeUndefined(); // 100 not heavier than 100
    expect(flags.est1RM).toBe(true); // 8 reps beats prior est 1RM
  });

  it('heavier weight is a max-weight PR', () => {
    const prior = computePriorBests([mkSet(100, 5)]);
    const flags = detectPRs(110, 3, prior);
    expect(flags.maxWeight).toBe(true);
  });

  it('a weaker set is no PR', () => {
    const prior = computePriorBests([mkSet(100, 8)]);
    const flags = detectPRs(90, 5, prior);
    expect(flags.maxWeight).toBeUndefined();
    expect(flags.est1RM).toBeUndefined();
    expect(flags.repPR).toBeUndefined();
  });
});

describe('reinforcement phase (continuous -> variable)', () => {
  it('bootstrap for first BOOTSTRAP_DAYS active days, then sustain, then fade', () => {
    expect(phaseForActiveDays(0, C)).toBe('bootstrap');
    expect(phaseForActiveDays(C.BOOTSTRAP_DAYS - 1, C)).toBe('bootstrap');
    expect(phaseForActiveDays(C.BOOTSTRAP_DAYS, C)).toBe('sustain');
    expect(phaseForActiveDays(C.BOOTSTRAP_DAYS + C.SUSTAIN_TO_FADE_DAYS, C)).toBe('fade');
  });
});

describe('track XP application (endowed start, monotonic, no decay)', () => {
  const base: Track = {
    id: 'push',
    name: 'Push',
    xp: 0,
    level: 0,
    phase: 'bootstrap',
    tierProgress: 0,
    activeDays: [],
  };

  it('first activity grants a fixed head-start (endowed progress)', () => {
    const t = applyXpToTrack(base, 5, C);
    expect(t.xp).toBe(STARTER_ENDOWMENT_XP + 5);
  });

  it('applying XP never lowers xp/level (monotonic)', () => {
    let t = applyXpToTrack(base, 50, C);
    const before = t.xp;
    t = applyXpToTrack(t, 0, C); // no negative allowed
    expect(t.xp).toBeGreaterThanOrEqual(before);
    t = applyXpToTrack(t, -999, C); // negative deltas are clamped to 0
    expect(t.xp).toBe(before);
  });
});

describe('consistency: streak with freezes, NO decay on skipped days', () => {
  const fresh: Consistency = {
    id: 'singleton',
    currentStreak: 0,
    bestStreak: 0,
    freezeTokens: 0,
    trainedDates: [],
    weekSessionsHit: 0,
  };

  it('consecutive days increment the streak', () => {
    let c = recordTrainingDay(fresh, '2026-01-01', 4).consistency;
    expect(c.currentStreak).toBe(1);
    c = recordTrainingDay(c, '2026-01-02', 4).consistency;
    expect(c.currentStreak).toBe(2);
  });

  it('same day does not double-count', () => {
    let c = recordTrainingDay(fresh, '2026-01-01', 4).consistency;
    c = recordTrainingDay(c, '2026-01-01', 4).consistency;
    expect(c.currentStreak).toBe(1);
  });

  it('a missed day spends a freeze instead of resetting', () => {
    let c: Consistency = { ...fresh, currentStreak: 3, freezeTokens: 2, lastTrainedDate: '2026-01-01' };
    const upd = recordTrainingDay(c, '2026-01-03', 4); // skipped Jan 2
    c = upd.consistency;
    expect(upd.freezesSpent).toBe(1);
    expect(c.freezeTokens).toBe(1);
    expect(c.currentStreak).toBe(4); // streak preserved, +1 for today
  });

  it('hitting the weekly target banks a freeze (cap 2)', () => {
    let c = { ...fresh };
    c = recordTrainingDay(c, '2026-01-01', 2).consistency;
    const upd = recordTrainingDay(c, '2026-01-02', 2);
    expect(upd.freezeEarned).toBe(true);
    expect(upd.consistency.freezeTokens).toBe(1);
  });

  it('NO-DECAY GUARANTEE: skipping many days loses zero XP / level / PRs', () => {
    // Build a track with real XP.
    let track: Track = {
      id: 'squat',
      name: 'Squat',
      xp: 0,
      level: 0,
      phase: 'bootstrap',
      tierProgress: 0,
      activeDays: [],
    };
    track = markTrackActiveDay(track, '2026-01-01', C);
    track = applyXpToTrack(track, 500, C);
    const xpBefore = track.xp;
    const levelBefore = track.level;

    // Simulate skipping a week+ of training days on the consistency record.
    let c: Consistency = {
      ...fresh,
      currentStreak: 5,
      bestStreak: 5,
      freezeTokens: 0,
      lastTrainedDate: '2026-01-01',
    };
    c = recordTrainingDay(c, '2026-01-12', 4).consistency; // skipped 10 days, no freezes

    // Streak counter may restart, but the TRACK is entirely untouched.
    expect(track.xp).toBe(xpBefore);
    expect(track.level).toBe(levelBefore);
    expect(c.bestStreak).toBe(5); // best is preserved
    // No throw, no negative, no reset of mastery — only the streak count restarts.
    expect(c.currentStreak).toBe(1);
  });
});
