// Shared domain types for Lift Log.

export type Unit = 'lb' | 'kg';

export type TrackPhase = 'bootstrap' | 'sustain' | 'fade';

export type PrType = 'maxWeight' | 'est1RM' | 'repPR';

export interface Session {
  id?: number;
  date: string; // ISO date (YYYY-MM-DD) of the session start
  startedAt: number; // epoch ms — timer is computed from this, never a ticking counter
  endedAt?: number; // epoch ms
  durationMin?: number;
  totalVolume: number;
  xpEarned: number;
  notes?: string;
  // Pause bookkeeping — timer is computed from these timestamps, not a ticking
  // counter, so elapsed time is correct across reload/backgrounding.
  pausedAccumMs?: number;
  pausedSince?: number;
}

export interface Exercise {
  id?: number;
  name: string;
  trackId: string;
  category: string;
  isCustom: boolean;
  retired?: boolean;
}

export interface SessionExercise {
  id?: number;
  sessionId: number;
  exerciseId: number;
  order: number;
}

export interface PrFlags {
  maxWeight?: boolean;
  est1RM?: boolean;
  repPR?: boolean;
}

export interface WorkoutSet {
  id?: number;
  sessionId: number;
  exerciseId: number;
  weight: number;
  reps: number;
  unit: Unit;
  timestamp: number;
  xpAwarded: number;
  surpriseBonus: number;
  prFlags: PrFlags;
}

export interface PrRecord {
  id?: number;
  exerciseId: number;
  type: PrType;
  value: number; // for maxWeight -> weight; est1RM -> 1RM; repPR -> reps
  weight: number;
  reps: number;
  date: string;
  sessionId: number;
}

export interface Track {
  id: string;
  name: string;
  xp: number;
  level: number;
  phase: TrackPhase;
  startedAt?: number; // epoch ms of first activity
  activeDays: string[]; // distinct ISO dates with logged work — drives phase transition
  tierProgress: number; // XP into the current level
}

export interface Consistency {
  id: 'singleton';
  currentStreak: number;
  bestStreak: number;
  freezeTokens: number;
  lastTrainedDate?: string; // ISO date
  trainedDates: string[]; // distinct ISO dates trained
  weekSessionsHit: number; // sessions counted toward the current week's target
}

export interface RewardLogEntry {
  id?: number;
  date: string;
  type: string;
  description: string;
  sessionId?: number;
}

export interface XpConstants {
  BASE_SET_XP: number;
  VOLUME_DIVISOR: number;
  PR_BONUS_XP: number;
  SURPRISE_PROBABILITY: number; // 0..1
  SURPRISE_MULTIPLIER: number;
  BOOTSTRAP_DAYS: number; // active days before bootstrap -> sustain
  SUSTAIN_TO_FADE_DAYS: number; // active days before sustain -> fade
}

export interface Settings {
  id: 'singleton';
  barWeight: number;
  plateInventory: number[]; // available plate denominations in the active unit
  unit: Unit;
  weeklyTarget: number;
  restTimerDefault: number; // seconds
  fadePhaseMode: 'auto' | 'bootstrap' | 'sustain' | 'fade';
  xpConstants: XpConstants;
  soundEnabled: boolean;
  hapticEnabled: boolean;
  reminderEnabled: boolean;
  lastBackupDate?: string;
}
