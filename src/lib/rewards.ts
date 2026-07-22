// ===========================================================================
// REWARD ENGINE — the auditable core of the app's psychology.
//
// HARD RULE (enforced by assertReal below at EVERY call site): a reward fires
// ONLY when Andrew logs a genuinely completed real-world action. Never on
// app-open, never on a streak "check-in", never on a notification tap. If you
// are calling into this module, you must be handling a real logged action.
//
// The mechanics implemented here, and where:
//   #3  Reward-prediction-error / surprise bonuses ...... rollReward()
//   #4  Continuous → variable reinforcement arc ......... rollReward()/phaseFor
//   #5  Reward scaled to real wellbeing impact (MDP) .... action weights
//   #6  Gentle loss aversion — freezes, never resets .... freeze helpers
//   #11 Reward-fading (Bootstrap → Sustain → Fade) ...... resolvePhase()/multipliers
// ===========================================================================
import type { SettingsRecord, TrackPhase, TrackRecord } from '../db/types'

/**
 * Runtime assertion + documentation marker. Pass the human name of the real
 * action that triggered this reward. This exists so every reward site is
 * self-documenting and grep-auditable: search `assertReal(` to see that no
 * reward is wired to an app-open.
 */
export function assertReal(realActionName: string): void {
  if (!realActionName) {
    throw new Error(
      'Reward fired without a real action. Rewards must never fire on app-open.',
    )
  }
}

// --- Mechanic #5: action weights (impact on the real goal) -----------------
// Higher-impact actions pay more base XP than minor checks.
export const ACTION_WEIGHTS: Record<string, number> = {
  workout: 30,
  pr: 45,
  salesDrill: 25,
  deepWork: 20,
  dayWon: 40,
  nonNegotiable: 8,
  metric: 5,
  neverAgainHeld: 6,
  skinTreatment: 6,
}

// --- Mechanic #11 / #4: phase schedule --------------------------------------
// A track spends its first ~21 active days in BOOTSTRAP (reward EVERY action to
// build the habit). It then moves to SUSTAIN (thinner base reward, lean on the
// occasional surprise). FADE further tapers extrinsic points and shifts the UI
// toward intrinsic framing. The user can override the auto-schedule in Settings.
export const BOOTSTRAP_DAYS = 21
export const SUSTAIN_DAYS = 63 // ~9 weeks total before auto-fade

export function autoPhaseFor(startedAt: number, now: number): TrackPhase {
  const ageDays = Math.floor((now - startedAt) / 86_400_000)
  if (ageDays < BOOTSTRAP_DAYS) return 'bootstrap'
  if (ageDays < SUSTAIN_DAYS) return 'sustain'
  return 'fade'
}

/**
 * Resolves the effective phase for a track. A manual Settings override
 * (fadePhase !== 'auto') wins; otherwise we use the track's own age. This is
 * how "reward-fading" becomes a first-class, user-visible feature.
 */
export function resolvePhase(
  track: TrackRecord,
  settings: SettingsRecord,
  now: number,
): TrackPhase {
  if (settings.fadePhase !== 'auto') return settings.fadePhase
  return autoPhaseFor(track.startedAt, now)
}

// Base-reward multiplier by phase. As weeks pass, extrinsic point emphasis
// tapers (the antidote to the durability problem — behavior should transfer to
// intrinsic motivation, tracked by the trend/identity views, not points).
export const PHASE_BASE_MULTIPLIER: Record<TrackPhase, number> = {
  bootstrap: 1.0, // reward every action, full base
  sustain: 0.6, // thin the base reward
  fade: 0.3, // extrinsic points recede; intrinsic framing leads
}

// Surprise-bonus probability by phase. In sustain/fade we lean MORE on the
// occasional surprise (reward-prediction-error) and less on the reliable base —
// but surprise is always attached to a real action, never manufactured to force
// compulsive checking.
export const PHASE_SURPRISE_CHANCE: Record<TrackPhase, number> = {
  bootstrap: 0.15,
  sustain: 0.2,
  fade: 0.2,
}

export interface RewardRoll {
  baseXp: number
  surprise: boolean
  surpriseMultiplier: number
  totalXp: number
  phase: TrackPhase
  /** Optional rare "Drew tip" surfaced with a surprise. */
  drewTip?: string
}

const DREW_TIPS = [
  'Drew tip: the rep you almost skipped is the one that moved the line.',
  'Drew tip: handle the warm reply before the doubt does.',
  'Drew tip: the drawer, every night. That is where the 22 hours start.',
  'Drew tip: count the number today. You cannot allocate what you will not count.',
  'Drew tip: preworkout is a tool, not a patch. Fix the sleep first.',
]

/**
 * The single reward entry point. Given the action's weight and the track's
 * phase, returns the XP to award and whether a surprise fired.
 *
 * randFn is injectable for deterministic tests; in the app it's Math.random.
 * Surprise is a genuine reward-prediction-error: a fixed "+10 every time" goes
 * dopaminergically flat, so we vary the payout.
 */
export function rollReward(
  weight: number,
  phase: TrackPhase,
  randFn: () => number = Math.random,
): RewardRoll {
  const baseXp = Math.round(weight * PHASE_BASE_MULTIPLIER[phase])
  const surprise = randFn() < PHASE_SURPRISE_CHANCE[phase]
  // Variable-ratio surprise: 1.5×–3× the base, occasionally with a Drew tip.
  const surpriseMultiplier = surprise ? 1.5 + randFn() * 1.5 : 1
  const totalXp = Math.round(baseXp * surpriseMultiplier)
  const drewTip =
    surprise && randFn() < 0.5
      ? DREW_TIPS[Math.floor(randFn() * DREW_TIPS.length)]
      : undefined
  return { baseXp, surprise, surpriseMultiplier, totalXp, phase, drewTip }
}

// --- Mechanic #6: gentle loss aversion (freezes, protected progress) --------
export const MAX_FREEZE_TOKENS = 2

/** Earn one freeze token per fully-won week, banked up to MAX_FREEZE_TOKENS. */
export function grantFreezeForWonWeek(current: number): number {
  return Math.min(MAX_FREEZE_TOKENS, current + 1)
}

/**
 * A missed day spends a freeze instead of resetting the streak. Returns the new
 * token count and whether the day was frozen. NEVER wipes progress — if there
 * is no token, the streak simply pauses; mastery and all-time bests are
 * untouched (see streak.ts).
 */
export function spendFreeze(current: number): { tokens: number; frozen: boolean } {
  if (current > 0) return { tokens: current - 1, frozen: true }
  return { tokens: current, frozen: false }
}
