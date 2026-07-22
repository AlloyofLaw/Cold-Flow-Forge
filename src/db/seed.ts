// ---------------------------------------------------------------------------
// GROUNDING DATA. Every number here is supplied by Andrew's Villain Dossier.
// Nothing is invented. Anything the dossier is silent on is left blank/neutral
// and exposed as an editable field elsewhere. This is the app's first-run state.
// ---------------------------------------------------------------------------
import type {
  LedgerEntry,
  NeverAgainRecord,
  NonNegotiableKey,
  PrRecord,
  ScheduleAnchors,
  SettingsRecord,
  TargetSet,
  TrackRecord,
} from './types'

export const NON_NEGOTIABLES: { key: NonNegotiableKey; label: string; blurb: string; weight: number }[] = [
  { key: 'train', label: 'Train', blurb: '6 mornings/week, bro split, ~6:00–7:30 AM', weight: 3 },
  { key: 'bed10', label: 'In bed by 10:00 PM', blurb: 'Phone in a drawer, not in bed', weight: 2 },
  { key: 'noDistractions', label: 'No distractions', blurb: 'Porn & gaming banned (raves are the monthly exception)', weight: 2 },
  { key: 'steps', label: '10,000 steps', blurb: 'Move the body', weight: 1 },
  { key: 'monkMode', label: 'Monk mode', blurb: 'Stayed on the 3-month goal, no rabbit-holes', weight: 2 },
  { key: 'read1h', label: 'Read 1 hour before bed', blurb: 'The sales script or a book', weight: 1 },
  { key: 'cffWork', label: 'CFF work block', blurb: 'Daily deep-work block with the 1-hr sales hour inside', weight: 3 },
]

export const NEVER_AGAIN: Omit<NeverAgainRecord, 'currentCleanStart'>[] = [
  { key: 'gambling', label: 'Gambling', bestRun: 0 },
  { key: 'gaming', label: 'Gaming', bestRun: 0 },
  { key: 'porn', label: 'Porn', bestRun: 0 },
  { key: 'vape', label: 'Vape', bestRun: 0 },
  { key: 'phoneInBed', label: 'Phone in bed', bestRun: 0 },
  { key: 'past10', label: 'Up past 10 PM', bestRun: 0 },
]

// Endowed starter-progress: every track begins pre-filled, never at zero.
// "You're already 2/10 toward Tier 1" — converts "not begun" into "in motion".
const ENDOWED_XP = 20 // ~2/10 of a 100-XP first tier
export const TRACKS_SEED: Omit<TrackRecord, 'startedAt'>[] = [
  { id: 'strength', domain: 'Health', name: 'Strength', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
  { id: 'conditioning', domain: 'Health', name: 'Conditioning', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
  { id: 'sleep', domain: 'Health', name: 'Sleep', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
  { id: 'sales', domain: 'Wealth', name: 'Sales', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
  { id: 'deepwork', domain: 'Wealth', name: 'Deep Work', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
  { id: 'discipline', domain: 'Relationships', name: 'Discipline', xp: ENDOWED_XP, level: 1, phase: 'bootstrap' },
]

// Current tracked lifts → seeded as the current PR baseline for overload lines.
export const PRS_SEED: Omit<PrRecord, 'id' | 'date'>[] = [
  { exercise: 'Bench (flat)', weight: 145, reps: 1 },
  { exercise: 'Incline barbell', weight: 135, reps: 6 },
  { exercise: 'Incline DB', weight: 70, reps: 5 },
  { exercise: 'Squat', weight: 145, reps: 6 },
  { exercise: 'Deadlift', weight: 225, reps: 3 },
]

// Tracked lifts, current → Drew's ceiling. Used by the "always 5 lb ahead"
// mechanic and the Ledger.
export const TRACKED_LIFTS: { exercise: string; current: string; ceiling: string }[] = [
  { exercise: 'Bench (flat)', current: '145', ceiling: '—' },
  { exercise: 'Incline barbell', current: '135×6', ceiling: '—' },
  { exercise: 'Incline DB', current: '65–70×5–6', ceiling: '100 lb DBs ×6' },
  { exercise: 'Squat', current: '135–145×6 (regressed from 225×2)', ceiling: '80 lb/hand Bulgarian split squats' },
  { exercise: 'Deadlift', current: '225×3 (regressed from 325×1)', ceiling: '225 lb RDL' },
]

export const DEFAULT_TARGETS: TargetSet = {
  // Health
  weightTargetLow: 155,
  weightTargetHigh: 160,
  bodyfatTargetPct: 10,
  stepsTarget: 10000,
  bedtimeTarget: '22:00',
  wakeTargetEarly: '05:00',
  wakeTargetLate: '05:30',
  trainingDaysPerWeek: 6,
  proteinTarget: 155,
  caffeineCapMg: 100,
  junkExceptionsTarget: 0,
  eatingOutExceptionsTarget: 0,
  // Wealth
  netWorthTarget: 75000,
  cffRevenueTarget: 10000,
  cffClientsTarget: 3,
  masterNumber: 6000,
  masterNumberMonths: 3,
  salesMinsTarget: 60,
  deepWorkWeeklyTarget: 22,
  overtimeCapMins: 45,
  // Relationships
  givingCurrent: 50,
}

export const DEFAULT_ANCHORS: ScheduleAnchors = {
  trainWindow: '06:00–07:30',
  deepWorkWeekday: '16:30–18:30',
  deepWorkWeekend: '05:30–12:00',
  familyDinner: '19:00',
  familyPrayer: '21:00',
  familyChurch: 'Sat 19:00',
}

export function makeDefaultSettings(now: number): SettingsRecord {
  return {
    id: 'singleton',
    restDay: 0, // Sunday, editable
    fadePhase: 'auto',
    freezeTokens: 0,
    toggles: {
      sound: true,
      haptics: true,
      eveningReminder: false,
      eveningReminderTime: '20:30',
    },
    targets: { ...DEFAULT_TARGETS },
    anchors: { ...DEFAULT_ANCHORS },
    firstRunAt: now,
  }
}

// Baseline metric seeds (current-state numbers from the dossier), logged on
// first run so trend charts and the Ledger have a real starting point.
export const METRIC_SEEDS: { type: import('./types').MetricType; value: number; unit: string }[] = [
  { type: 'weight', value: 174, unit: 'lb' },
  { type: 'bodyfat', value: 16, unit: '%' },
  { type: 'netWorth', value: 16000, unit: 'USD' },
  { type: 'monthlyNet', value: -250, unit: 'USD/mo' },
  { type: 'revenue', value: 0, unit: 'USD/mo' },
  { type: 'clients', value: 0, unit: 'clients' },
  { type: 'deepWorkHours', value: 1, unit: 'hr' }, // honest baseline avg ~1 hr/day
  { type: 'warmReplies', value: 9, unit: 'replies' },
  { type: 'giving', value: 50, unit: 'USD/mo' },
]

export const DREW_LAW =
  'Believe in yourself that you can, never quit, and always choose the best move on the board.'

// The 10 Drew voice lines, verbatim. Shown contextually when the matching
// non-negotiable is skipped/broken, and collected in the Villain screen.
// Framing is forward pressure, never mockery.
export const DREW_LINES: { id: string; trigger: string; line: string }[] = [
  {
    id: 'skipWorkout',
    trigger: 'Skipping the workout',
    line: "I trained at 6am, session six of six this week, five pounds over last week. You're negotiating with the ceiling at noon. That's not a rest day, that's a surrender.",
  },
  {
    id: 'avoidScript',
    trigger: 'Avoiding script practice',
    line: "One hour. Voice roleplay, script burned in, onion framework until it's breath. You've never done a single sales call and it's the only skill worth 10x — and you're finding reasons not to start the hour.",
  },
  {
    id: 'phoneInBed',
    trigger: 'Phone in bed at night',
    line: "My phone's in a drawer and I'm reading the script. Yours is on your chest at 1am and it'll be the first thing you touch at 7. You wonder why you can't fall asleep — you're holding the reason.",
  },
  {
    id: 'vape',
    trigger: 'Vape craving',
    line: "Eight, nine years. You only ever quit when the business had you — clean stretches of 8 to 12 months — then the warehouse pulled you back. The urge isn't the enemy. Going back to the 9-5 in your head is. I'd have done pushups by now.",
  },
  {
    id: 'porn',
    trigger: 'Porn urge',
    line: "One to twice a day, muscle memory, nothing behind it. Temptation gets resisted and destroyed by taking action elsewhere. Open the doc. Or drop and do the pushups. Either way you're up and I'm still ahead.",
  },
  {
    id: 'weekendSleepIn',
    trigger: 'Sleeping in on a weekend',
    line: "I was up at 5:30 and I'll work until noon while you're unconscious. Weekends are where I built the 22 hours and you built the 7. You don't lose the race on Monday. You lose it right now, asleep.",
  },
  {
    id: 'gamingInvite',
    trigger: 'A gaming invite',
    line: "Gen texts and you reach for the controller like it's oxygen. It's on the never-again list for a reason. I still care about Gen — I just stopped gaming with him entirely. Two to three hours a night. That's a client a quarter you're feeding to a console.",
  },
  {
    id: 'crash4pm',
    trigger: 'The 4pm crash excuse',
    line: "You crash at 4, take preworkout to train, then can't sleep, then crash at 4 again. I don't crash, because I fixed the sleep you keep breaking. Stop dosing the symptom. The loop is the excuse.",
  },
  {
    id: 'avoidMoney',
    trigger: 'Avoiding the money numbers',
    line: "You bleed 250 a month and won't look at it. $16K net worth, $0 from CFF, nine dead replies. I know every number cold because I refuse to spend on anything that doesn't serve Health, Wealth, or Relationships. You can't allocate what you won't count.",
  },
  {
    id: 'warmReplyDied',
    trigger: 'Letting a warm reply die',
    line: "Nine positive replies. Nine. All dead, zero calls booked. I handle a warm reply in minutes — VSL, then it's on my calendar. You let interested people go cold because opening the message felt like work. That's the whole difference between us.",
  },
]

// Maps a non-negotiable / event to the Drew line that should surface when it is
// skipped or broken on the Today screen.
export const FLAG_TO_LINE: Partial<Record<NonNegotiableKey, string>> = {
  train: 'skipWorkout',
  bed10: 'phoneInBed',
  noDistractions: 'porn',
  monkMode: 'avoidMoney',
  read1h: 'avoidScript',
  cffWork: 'avoidScript',
}

// The Villain Ledger — Drew's standard vs Andrew's current for every sub-area.
// % closed is computed from real metric data where a metric pair is supplied.
export const LEDGER_SEED: LedgerEntry[] = [
  // HEALTH
  { domain: 'Health', area: 'Bodyweight', drewStandard: '155–160 lb @ 10% BF', andrewCurrent: '174 lb, ~16% BF', metric: 'weight', baselineValue: 174, targetValue: 157.5, higherIsBetter: false },
  { domain: 'Health', area: 'Steps', drewStandard: '10,000/day', andrewCurrent: 'varies', metric: 'steps', baselineValue: 0, targetValue: 10000, higherIsBetter: true },
  { domain: 'Health', area: 'Sleep', drewStandard: 'Bed 10:00 PM, wake 5:00–5:30 AM', andrewCurrent: 'phone in bed, 4pm crashes' },
  { domain: 'Health', area: 'Training', drewStandard: '6×/week, +5 lb every week', andrewCurrent: 'inconsistent' },
  { domain: 'Health', area: 'Bench (flat)', drewStandard: '5 lb ahead, always', andrewCurrent: '145' },
  { domain: 'Health', area: 'Incline DB', drewStandard: '100 lb DBs ×6', andrewCurrent: '65–70×5–6' },
  { domain: 'Health', area: 'Squat', drewStandard: '80 lb/hand Bulgarian split squats', andrewCurrent: '135–145×6 (regressed from 225×2)' },
  { domain: 'Health', area: 'Deadlift', drewStandard: '225 lb RDL', andrewCurrent: '225×3 (regressed from 325×1)' },
  { domain: 'Health', area: 'Skin (eczema)', drewStandard: 'Daily steroid application until cleared', andrewCurrent: 'inconsistent' },
  { domain: 'Health', area: 'Protein', drewStandard: '~155–160 g/day', andrewCurrent: 'untracked', metric: 'protein', baselineValue: 0, targetValue: 157, higherIsBetter: true },
  { domain: 'Health', area: 'Caffeine', drewStandard: '≤100 mg (preworkout only)', andrewCurrent: 'crash-dosing' },
  { domain: 'Health', area: 'Alcohol', drewStandard: 'Zero', andrewCurrent: 'Zero (held asset)' },

  // WEALTH
  { domain: 'Wealth', area: 'Net worth', drewStandard: '$75K liquid yr1 → $1M yr3 → $50M yr10', andrewCurrent: '$16K ($12K + $4K reserve)', metric: 'netWorth', baselineValue: 16000, targetValue: 75000, higherIsBetter: true },
  { domain: 'Wealth', area: 'Monthly cash flow', drewStandard: '10/20/20/50 allocation, positive', andrewCurrent: '−$250/mo bleed', metric: 'monthlyNet', baselineValue: -250, targetValue: 0, higherIsBetter: true },
  { domain: 'Wealth', area: 'CFF revenue', drewStandard: '$10K/mo + 3 clients by month 3', andrewCurrent: '$0 / 0 clients', metric: 'revenue', baselineValue: 0, targetValue: 10000, higherIsBetter: true },
  { domain: 'Wealth', area: 'Master Number', drewStandard: '$6,000/mo held 3 consecutive months', andrewCurrent: '0 / 3 months' },
  { domain: 'Wealth', area: 'Sales skill', drewStandard: '≥1 hr/day roleplay/script/onion', andrewCurrent: '0 calls ever', metric: 'salesDrillMins', baselineValue: 0, targetValue: 60, higherIsBetter: true },
  { domain: 'Wealth', area: 'Deep work', drewStandard: '~22+ focused hrs/week', andrewCurrent: '~7 hrs/wk (~1 hr/day)', metric: 'deepWorkHours', baselineValue: 1, targetValue: 22, higherIsBetter: true },
  { domain: 'Wealth', area: 'Warm replies', drewStandard: 'Handled in minutes → VSL → call booked', andrewCurrent: '9 replies, all died, 0 calls' },
  { domain: 'Wealth', area: '9-5 overtime', drewStandard: 'Cap 45 min', andrewCurrent: 'overrun' },

  // RELATIONSHIPS
  { domain: 'Relationships', area: 'Athena', drewStandard: 'Weekly date, 2 weeknight windows, 10 PM law holds', andrewCurrent: 'inconsistent' },
  { domain: 'Relationships', area: 'Family', drewStandard: '7 PM dinner, 9 PM prayer, Sat 7 PM church', andrewCurrent: 'keep structure' },
  { domain: 'Relationships', area: 'CFF secret', drewStandard: 'Revealed to father at the Master Number', andrewCurrent: 'hidden' },
  { domain: 'Relationships', area: 'Friends', drewStandard: 'Weekly touch, zero gaming with Gen', andrewCurrent: 'gaming 2–3 hrs/night' },
  { domain: 'Relationships', area: 'Giving', drewStandard: 'Scales with real income', andrewCurrent: '$50/mo to church', metric: 'giving', baselineValue: 50, targetValue: 50, higherIsBetter: true },
]
