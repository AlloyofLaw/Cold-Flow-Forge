// ---------------------------------------------------------------------------
// Data model for Beat Drew. Mirrors the Dexie tables described in the spec.
// Everything here lives locally in IndexedDB; nothing leaves the device.
// ---------------------------------------------------------------------------

/** ISO date string, YYYY-MM-DD, in the device's local timezone. */
export type ISODate = string

/** The 7 daily non-negotiables. Keys are stable; labels live in seed data. */
export type NonNegotiableKey =
  | 'train'
  | 'bed10'
  | 'noDistractions'
  | 'steps'
  | 'monkMode'
  | 'read1h'
  | 'cffWork'

/** Tri-state for each non-negotiable on a given day. */
export type FlagState = 'done' | 'notyet' | 'broke' | 'na'

/** A day is WON only if every *applicable* non-negotiable is done. */
export type DayStatus = 'won' | 'notyet' | 'lost'

export interface DayRecord {
  /** Primary key. */
  date: ISODate
  flags: Record<NonNegotiableKey, FlagState>
  /** Cached day status (recomputed on every write). */
  status: DayStatus
  won: boolean
  notes?: string
  /** Whether a freeze token was spent to protect this (missed) day. */
  frozen?: boolean
}

/** Free-form metric log entries (weight, steps, revenue, etc.). */
export type MetricType =
  | 'weight'
  | 'bodyfat'
  | 'steps'
  | 'sleepBed'
  | 'sleepWake'
  | 'protein'
  | 'caffeine'
  | 'junkExceptions'
  | 'eatingOutExceptions'
  | 'deepWorkHours'
  | 'salesDrillMins'
  | 'warmReplies'
  | 'warmRepliesHandledFast'
  | 'revenue'
  | 'clients'
  | 'netWorth'
  | 'giving'
  | 'monthlyNet'
  | 'overtimeMins'

export interface MetricRecord {
  id?: number
  date: ISODate
  type: MetricType
  value: number
  unit: string
}

export interface WorkoutExercise {
  name: string
  sets: { weight: number; reps: number }[]
}

export interface WorkoutRecord {
  id?: number
  date: ISODate
  split: string
  exercises: WorkoutExercise[]
  durationMin?: number
}

export interface PrRecord {
  id?: number
  exercise: string
  weight: number
  reps: number
  date: ISODate
}

/** Mastery tracks — permanent, non-decaying XP lines per domain area. */
export type TrackPhase = 'bootstrap' | 'sustain' | 'fade'

export interface TrackRecord {
  id: string
  domain: 'Health' | 'Wealth' | 'Relationships'
  name: string
  xp: number
  level: number
  phase: TrackPhase
  /** Timestamp (ms) the track became active — drives the 21-day arc. */
  startedAt: number
}

export interface NeverAgainRecord {
  key: string
  label: string
  /** Timestamp (ms) the current clean run started. */
  currentCleanStart: number
  /** Best clean run ever, in whole days. */
  bestRun: number
}

export type RewardType =
  | 'base'
  | 'surprise'
  | 'pr'
  | 'freezeEarned'
  | 'dayWon'
  | 'levelUp'

export interface RewardLogRecord {
  id?: number
  date: ISODate
  type: RewardType
  description: string
  xp: number
  /**
   * Asserted true at every reward call site: this reward corresponds to a
   * real logged action, never an app-open, launch, or notification tap.
   */
  fromRealAction: true
}

/** Guided monthly review entries. */
export interface MonthlyReviewRecord {
  id?: number
  month: string // YYYY-MM
  daysWon: number
  gapMoved: string
  changesNextMonth: string
  createdAt: number
}

export interface TargetSet {
  // Health
  weightTargetLow: number
  weightTargetHigh: number
  bodyfatTargetPct: number
  stepsTarget: number
  bedtimeTarget: string // "22:00"
  wakeTargetEarly: string // "05:00"
  wakeTargetLate: string // "05:30"
  trainingDaysPerWeek: number
  proteinTarget: number
  caffeineCapMg: number
  junkExceptionsTarget: number
  eatingOutExceptionsTarget: number
  // Wealth
  netWorthTarget: number
  cffRevenueTarget: number
  cffClientsTarget: number
  masterNumber: number
  masterNumberMonths: number
  salesMinsTarget: number
  deepWorkWeeklyTarget: number
  overtimeCapMins: number
  // Relationships
  givingCurrent: number
}

/** Editable schedule anchors (times / cadence the app frames around). */
export interface ScheduleAnchors {
  trainWindow: string
  deepWorkWeekday: string
  deepWorkWeekend: string
  familyDinner: string
  familyPrayer: string
  familyChurch: string
}

export interface Toggles {
  sound: boolean
  haptics: boolean
  eveningReminder: boolean
  eveningReminderTime: string // "20:30"
}

/** Singleton settings row. */
export interface SettingsRecord {
  id: 'singleton'
  restDay: number // 0=Sun ... 6=Sat
  fadePhase: TrackPhase | 'auto'
  freezeTokens: number
  toggles: Toggles
  targets: TargetSet
  anchors: ScheduleAnchors
  /** Timestamp (ms) of first run — anchors the global fade schedule. */
  firstRunAt: number
  /** Timestamp (ms) of last data export, for the gentle backup reminder. */
  lastBackupAt?: number
}

/** The Villain Ledger: Drew's standard vs Andrew's current, per sub-area. */
export interface LedgerEntry {
  domain: 'Health' | 'Wealth' | 'Relationships'
  area: string
  drewStandard: string
  andrewCurrent: string
  /** Optional numeric pair to compute a % closed as real data arrives. */
  metric?: MetricType
  baselineValue?: number
  targetValue?: number
  /** true when higher is better (e.g. revenue); false when lower is better. */
  higherIsBetter?: boolean
}
