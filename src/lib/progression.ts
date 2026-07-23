// Progression math: XP, leveling, Epley 1RM, PR detection, reinforcement phase,
// surprise rewards, and streak/freeze logic.
//
// EVERYTHING in this module is a PURE function of already-logged data. Nothing
// here can be triggered by opening the app or navigating a screen — the inputs
// are logged sets, sessions, and PRs only. See rewards.ts for the call sites,
// each of which is asserted to correspond to a real logged action.
//
// GUARANTEE: no function here ever reduces a track's xp/level or removes a PR.
// Mastery never decays. Missing days is handled purely in updateConsistency and
// never touches track XP.

import type {
  Track,
  TrackPhase,
  XpConstants,
  Consistency,
  WorkoutSet,
  PrFlags,
} from '../types';

// ---- Leveling curve (uncapped) ----
// Cost to advance FROM level L to L+1. Grows linearly so early levels come fast
// (motivating) and later levels take real, sustained work.
const LEVEL_BASE = 100;
const LEVEL_GROWTH = 50;

// One-time visible head-start when a track first receives activity.
// This is a FIXED MECHANIC (endowed progress), NOT a fabricated performance
// stat — it seeds the XP bar, never the user's weights/reps/PRs.
export const STARTER_ENDOWMENT_XP = 20;

export function costForLevel(level: number): number {
  // cost to go from `level` to `level + 1`
  return LEVEL_BASE + level * LEVEL_GROWTH;
}

export function xpToReachLevel(level: number): number {
  // cumulative XP required to have reached `level`
  let total = 0;
  for (let k = 0; k < level; k++) total += costForLevel(k);
  return total;
}

export interface LevelInfo {
  level: number;
  intoLevel: number; // XP accumulated into the current level
  neededForNext: number; // XP required to complete the current level
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 0;
  let remaining = xp;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cost = costForLevel(level);
    if (remaining < cost) {
      return { level, intoLevel: remaining, neededForNext: cost };
    }
    remaining -= cost;
    level += 1;
  }
}

// ---- Epley estimated 1RM ----
// 1RM ≈ weight × (1 + reps/30). This is an ESTIMATE, labeled as such in the UI.
export function epley1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

// ---- Volume load ----
export function volumeLoad(weight: number, reps: number): number {
  return Math.max(0, weight) * Math.max(0, reps);
}

// ---- Base set XP (configurable, neutral defaults) ----
// setXP = round(BASE_SET_XP + volume / VOLUME_DIVISOR)
export function baseSetXp(weight: number, reps: number, c: XpConstants): number {
  const volume = volumeLoad(weight, reps);
  return Math.round(c.BASE_SET_XP + volume / c.VOLUME_DIVISOR);
}

// ---- Reinforcement phase (continuous -> variable arc) ----
// For roughly the first BOOTSTRAP_DAYS active days of a track we reward EVERY
// logged set (build the habit). After that we thin the base reward and lean on
// PRs + occasional surprises (sustain), then thin further (fade).
export function phaseForActiveDays(activeDayCount: number, c: XpConstants): TrackPhase {
  if (activeDayCount < c.BOOTSTRAP_DAYS) return 'bootstrap';
  if (activeDayCount < c.BOOTSTRAP_DAYS + c.SUSTAIN_TO_FADE_DAYS) return 'sustain';
  return 'fade';
}

// Base-XP multiplier by phase. Bootstrap pays full; sustain/fade taper the
// extrinsic reward so the UI can shift toward intrinsic (trend) framing. PR
// bonuses are NEVER tapered — they are the honest progression currency.
export function phaseMultiplier(phase: TrackPhase): number {
  switch (phase) {
    case 'bootstrap':
      return 1;
    case 'sustain':
      return 0.6;
    case 'fade':
      return 0.4;
  }
}

// ---- Surprise / reward-prediction-error ----
// Occasionally (~SURPRISE_PROBABILITY of qualifying logged sets) fire an
// unexpected bonus. Attached to COMPLETING A REAL SET — never to app-open.
// rng is injectable for deterministic tests.
export function rollSurprise(
  probability: number,
  rng: () => number = Math.random,
): boolean {
  return rng() < probability;
}

export function surpriseBonusXp(baseXp: number, c: XpConstants): number {
  return Math.round(baseXp * (c.SURPRISE_MULTIPLIER - 1));
}

// ---- PR detection ----
// Prior bests computed from the exercise's already-logged sets. Detects:
//  - maxWeight: heaviest weight ever
//  - est1RM:    best Epley estimate
//  - repPR:     most reps at that exact weight
export interface PriorBests {
  maxWeight: number;
  bestEst1RM: number;
  repsAtWeight: Record<number, number>;
}

export function computePriorBests(priorSets: WorkoutSet[]): PriorBests {
  const bests: PriorBests = { maxWeight: 0, bestEst1RM: 0, repsAtWeight: {} };
  for (const s of priorSets) {
    if (s.weight > bests.maxWeight) bests.maxWeight = s.weight;
    const e = epley1RM(s.weight, s.reps);
    if (e > bests.bestEst1RM) bests.bestEst1RM = e;
    const prev = bests.repsAtWeight[s.weight] ?? 0;
    if (s.reps > prev) bests.repsAtWeight[s.weight] = s.reps;
  }
  return bests;
}

export function detectPRs(
  weight: number,
  reps: number,
  prior: PriorBests,
): PrFlags {
  const flags: PrFlags = {};
  if (weight > 0 && reps > 0) {
    if (weight > prior.maxWeight) flags.maxWeight = true;
    if (epley1RM(weight, reps) > prior.bestEst1RM) flags.est1RM = true;
    const prevReps = prior.repsAtWeight[weight] ?? 0;
    // Only a rep PR if there was a prior attempt at this weight to beat.
    if (prevReps > 0 && reps > prevReps) flags.repPR = true;
  }
  return flags;
}

export function countPRFlags(flags: PrFlags): number {
  return (flags.maxWeight ? 1 : 0) + (flags.est1RM ? 1 : 0) + (flags.repPR ? 1 : 0);
}

// ---- Consistency: streak with freezes (NOT punishment) ----
// NOTE: this function NEVER touches track XP/levels/PRs. Skipping days can, at
// worst, reset the *streak counter* to 1 once banked freezes are exhausted —
// mastery is untouched. bestStreak is preserved. Freezes absorb missed days.

const MAX_FREEZE_TOKENS = 2;

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

export interface ConsistencyUpdate {
  consistency: Consistency;
  freezesSpent: number;
  freezeEarned: boolean;
}

/**
 * Record a training day. weeklyTarget drives freeze earning: each fully-hit
 * training week banks one freeze (capped at MAX_FREEZE_TOKENS).
 */
export function recordTrainingDay(
  prev: Consistency,
  date: string,
  weeklyTarget: number,
): ConsistencyUpdate {
  const c: Consistency = {
    ...prev,
    trainedDates: [...prev.trainedDates],
  };
  let freezesSpent = 0;
  let freezeEarned = false;

  if (c.lastTrainedDate === date) {
    // Same day already counted — no streak change, no double count.
    return { consistency: c, freezesSpent, freezeEarned };
  }

  if (!c.lastTrainedDate) {
    c.currentStreak = 1;
  } else {
    const gap = daysBetween(c.lastTrainedDate, date);
    if (gap <= 1) {
      c.currentStreak += 1;
    } else {
      // Missed (gap - 1) days. Spend a freeze per missed day to preserve streak.
      const missed = gap - 1;
      const covered = Math.min(missed, c.freezeTokens);
      freezesSpent = covered;
      c.freezeTokens -= covered;
      if (covered >= missed) {
        // Fully covered by freezes — streak continues, +1 for today.
        c.currentStreak += 1;
      } else {
        // Freezes exhausted. Streak counter restarts at 1 (soft, non-punitive:
        // NO XP/level/PR is lost — only the streak count restarts).
        c.currentStreak = 1;
      }
    }
  }

  if (c.currentStreak > c.bestStreak) c.bestStreak = c.currentStreak;
  c.lastTrainedDate = date;
  if (!c.trainedDates.includes(date)) c.trainedDates.push(date);

  // Weekly target -> earn a freeze. weekSessionsHit counts distinct training
  // days toward the current target; on reaching it, bank a freeze and reset.
  c.weekSessionsHit += 1;
  if (weeklyTarget > 0 && c.weekSessionsHit >= weeklyTarget) {
    if (c.freezeTokens < MAX_FREEZE_TOKENS) {
      c.freezeTokens += 1;
      freezeEarned = true;
    }
    c.weekSessionsHit = 0;
  }

  return { consistency: c, freezesSpent, freezeEarned };
}

// Add XP to a track and recompute level/phase. This is the ONLY way XP enters a
// track, and it is monotonic (delta is expected >= 0). See rewards.ts callers.
export function applyXpToTrack(track: Track, deltaXp: number, c: XpConstants): Track {
  const isFirstActivity = (track.xp === 0 && (track.activeDays?.length ?? 0) === 0);
  const endow = isFirstActivity ? STARTER_ENDOWMENT_XP : 0;
  const newXp = track.xp + endow + Math.max(0, deltaXp);
  const info = levelFromXp(newXp);
  return {
    ...track,
    xp: newXp,
    level: info.level,
    tierProgress: info.intoLevel,
    phase: phaseForActiveDays(track.activeDays?.length ?? 0, c),
    startedAt: track.startedAt ?? Date.now(),
  };
}

export function markTrackActiveDay(track: Track, date: string, c: XpConstants): Track {
  const activeDays = track.activeDays?.includes(date)
    ? track.activeDays
    : [...(track.activeDays ?? []), date];
  return {
    ...track,
    activeDays,
    phase: phaseForActiveDays(activeDays.length, c),
  };
}
