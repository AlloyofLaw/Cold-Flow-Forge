// Reward orchestration — the SINGLE source of truth for XP awards.
//
// ============================ REWARD-INTEGRITY ============================
// Rewards fire ONLY on real logged actions. RewardTrigger is a closed union of
// exactly three real actions. There is deliberately NO 'app-open', 'screen-view',
// 'navigation', or 'notification-tap' member — those pathways literally cannot
// be expressed in this type, so no reward code path is reachable from them.
//
// Every award call site (in the store) passes one of these triggers and calls
// assertRealAction(). Opening the app or switching screens calls NOTHING here.
// =========================================================================

import type { WorkoutSet, XpConstants, PrFlags } from '../types';
import {
  baseSetXp,
  phaseForActiveDays,
  phaseMultiplier,
  rollSurprise,
  surpriseBonusXp,
  computePriorBests,
  detectPRs,
  countPRFlags,
  volumeLoad,
} from './progression';

export type RewardTrigger = 'set-logged' | 'session-ended' | 'pr-hit';

const REAL_ACTIONS: readonly RewardTrigger[] = ['set-logged', 'session-ended', 'pr-hit'];

/**
 * Runtime guard asserting a reward is tied to a real logged action. Throws if
 * anything ever tries to award on a non-action (defence in depth alongside the
 * type-level guarantee).
 */
export function assertRealAction(trigger: RewardTrigger): void {
  if (!REAL_ACTIONS.includes(trigger)) {
    throw new Error(
      `Reward integrity violation: reward attempted for non-action "${trigger}". ` +
        `Rewards may only fire on a logged set, ended session, or PR.`,
    );
  }
}

export interface SetRewardInput {
  weight: number;
  reps: number;
  activeDayCount: number; // active days of the set's track (drives phase)
  priorSets: WorkoutSet[]; // prior logged sets for this exercise (for PR detection)
  constants: XpConstants;
  rng?: () => number; // injectable for deterministic tests
}

export interface SetReward {
  baseXp: number;
  surpriseBonus: number;
  prBonus: number;
  totalXp: number;
  prFlags: PrFlags;
  volume: number;
  isRealSet: boolean;
}

/**
 * Compute the reward for a single logged set. A set only qualifies (and only
 * earns XP) when it represents real work: weight >= 0 and reps > 0. An empty
 * "set" (0 reps) earns exactly 0 XP — you cannot manufacture XP without lifting.
 */
export function computeSetReward(input: SetRewardInput): SetReward {
  const { weight, reps, activeDayCount, priorSets, constants, rng } = input;
  const isRealSet = reps > 0 && weight >= 0;
  if (!isRealSet) {
    return {
      baseXp: 0,
      surpriseBonus: 0,
      prBonus: 0,
      totalXp: 0,
      prFlags: {},
      volume: 0,
      isRealSet: false,
    };
  }

  const volume = volumeLoad(weight, reps);
  const phase = phaseForActiveDays(activeDayCount, constants);
  const rawBase = baseSetXp(weight, reps, constants);
  const baseXp = Math.round(rawBase * phaseMultiplier(phase));

  // Surprise bonus is attached to completing a REAL set, never to app-open.
  const surprise = rollSurprise(constants.SURPRISE_PROBABILITY, rng);
  const surpriseBonus = surprise ? surpriseBonusXp(baseXp, constants) : 0;

  // PR detection + bonus — the strongest, most honest real signal.
  const prior = computePriorBests(priorSets);
  const prFlags = detectPRs(weight, reps, prior);
  const prBonus = countPRFlags(prFlags) * constants.PR_BONUS_XP;

  return {
    baseXp,
    surpriseBonus,
    prBonus,
    totalXp: baseXp + surpriseBonus + prBonus,
    prFlags,
    volume,
    isRealSet: true,
  };
}
