import { create } from 'zustand'
import { db, exportAll, importAll, seedIfEmpty } from '../db/db'
import type {
  DayRecord,
  FlagState,
  ISODate,
  MetricRecord,
  MetricType,
  NeverAgainRecord,
  NonNegotiableKey,
  PrRecord,
  SettingsRecord,
  TrackRecord,
  WorkoutExercise,
} from '../db/types'
import { addDays, todayISO, weekStart } from '../lib/dates'
import { blankDay, scoreDay } from '../lib/scoring'
import {
  ACTION_WEIGHTS,
  assertReal,
  grantFreezeForWonWeek,
  resolvePhase,
  rollReward,
} from '../lib/rewards'
import { addXp } from '../lib/mastery'
import { detectPRs, type PrHit } from '../lib/workout'
import { playJuice } from '../lib/juice'

// Which mastery track a real action feeds.
const TRACK_FOR_NN: Record<NonNegotiableKey, string> = {
  train: 'strength',
  bed10: 'sleep',
  noDistractions: 'discipline',
  steps: 'conditioning',
  monkMode: 'deepwork',
  read1h: 'sales',
  cffWork: 'deepwork',
}
const TRACK_FOR_METRIC: Partial<Record<MetricType, string>> = {
  weight: 'conditioning',
  bodyfat: 'conditioning',
  steps: 'conditioning',
  sleepBed: 'sleep',
  sleepWake: 'sleep',
  protein: 'conditioning',
  caffeine: 'conditioning',
  deepWorkHours: 'deepwork',
  salesDrillMins: 'sales',
  warmReplies: 'sales',
  warmRepliesHandledFast: 'sales',
  revenue: 'discipline',
  netWorth: 'discipline',
  giving: 'discipline',
  monthlyNet: 'discipline',
  overtimeMins: 'discipline',
  junkExceptions: 'conditioning',
  eatingOutExceptions: 'conditioning',
  clients: 'discipline',
}

/** Ephemeral reward feedback for the "juice" toast. */
export interface RewardFeedback {
  nonce: number
  xp: number
  surprise: boolean
  drewTip?: string
  message: string
  prHits?: PrHit[]
}

interface AppState {
  loaded: boolean
  settings: SettingsRecord | null
  days: Record<ISODate, DayRecord>
  tracks: TrackRecord[]
  neverAgain: NeverAgainRecord[]
  prs: PrRecord[]
  metrics: MetricRecord[]
  xpToday: number
  lastReward: RewardFeedback | null

  init: () => Promise<void>
  reload: () => Promise<void>
  setFlag: (key: NonNegotiableKey, state: FlagState) => Promise<void>
  logMetric: (type: MetricType, value: number, unit: string) => Promise<void>
  logWorkout: (
    split: string,
    exercises: WorkoutExercise[],
    durationMin?: number,
  ) => Promise<PrHit[]>
  breakNeverAgain: (key: string) => Promise<void>
  updateSettings: (patch: Partial<SettingsRecord>) => Promise<void>
  exportJSON: () => Promise<string>
  importJSON: (text: string) => Promise<void>
  dismissReward: () => void
}

let rewardNonce = 0

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  settings: null,
  days: {},
  tracks: [],
  neverAgain: [],
  prs: [],
  metrics: [],
  xpToday: 0,
  lastReward: null,

  async init() {
    await seedIfEmpty()
    await reconcileFreezes()
    await get().reload()
    set({ loaded: true })
    // NOTE: no reward is fired here. Opening the app is NOT a rewarded event.
  },

  async reload() {
    const [settings, dayArr, tracks, neverAgain, prs, metrics, rewardsToday] =
      await Promise.all([
        db.settings.get('singleton'),
        db.days.toArray(),
        db.tracks.toArray(),
        db.neverAgain.toArray(),
        db.prs.toArray(),
        db.metrics.toArray(),
        db.rewardsLog.where('date').equals(todayISO()).toArray(),
      ])
    const days: Record<ISODate, DayRecord> = {}
    for (const d of dayArr) days[d.date] = d
    const xpToday = rewardsToday.reduce((s, r) => s + r.xp, 0)
    set({ settings: settings ?? null, days, tracks, neverAgain, prs, metrics, xpToday })
  },

  async setFlag(key, state) {
    const { settings } = get()
    if (!settings) return
    const date = todayISO()
    const existing = get().days[date] ?? blankDay(date, settings.restDay)
    const prevState = existing.flags[key]
    const flags = { ...existing.flags, [key]: state }
    const s = scoreDay(flags, date, settings.restDay)
    const wasWon = existing.won
    const day: DayRecord = { ...existing, flags, status: s.status, won: s.won }
    await db.days.put(day)

    // Mechanic: reward the REAL action only on the transition into 'done'.
    if (state === 'done' && prevState !== 'done') {
      await grantReward(
        get,
        set,
        TRACK_FOR_NN[key],
        ACTION_WEIGHTS.nonNegotiable,
        `logged non-negotiable: ${key}`,
      )
    }

    // Day just became WON → bonus + maybe a freeze token for a fully-won week.
    if (s.won && !wasWon) {
      await grantReward(get, set, 'discipline', ACTION_WEIGHTS.dayWon, 'day won')
      await maybeGrantWeeklyFreeze(date)
    }
    await get().reload()
  },

  async logMetric(type, value, unit) {
    await db.metrics.add({ date: todayISO(), type, value, unit })
    const track = TRACK_FOR_METRIC[type]
    if (track) {
      await grantReward(get, set, track, ACTION_WEIGHTS.metric, `logged metric: ${type}`)
    }
    await get().reload()
  },

  async logWorkout(split, exercises, durationMin) {
    const date = todayISO()
    await db.workouts.add({ date, split, exercises, durationMin })
    const hits = detectPRs(exercises, get().prs)
    // Persist each new PR.
    for (const h of hits) {
      await db.prs.add({ exercise: h.exercise, weight: h.weight, reps: h.reps, date })
    }
    // Base reward for the workout (a real, high-impact action)...
    await grantReward(get, set, 'strength', ACTION_WEIGHTS.workout, 'logged workout', {
      silent: hits.length > 0,
    })
    // ...plus a PR reward carrying the "Drew +5 lb" acknowledgment.
    if (hits.length > 0) {
      await grantReward(get, set, 'strength', ACTION_WEIGHTS.pr, 'logged lift PR', {
        prHits: hits,
        message: hits.map((h) => h.acknowledgment).join('  '),
      })
    }
    await get().reload()
    return hits
  },

  async breakNeverAgain(key) {
    const rec = get().neverAgain.find((n) => n.key === key)
    if (!rec) return
    const runDays = Math.max(0, Math.floor((Date.now() - rec.currentCleanStart) / 86_400_000))
    // Gentle framing only: reset THIS counter's current run, keep all-time best.
    // No punishment, no shame, no XP stripped. (Guardrail #3.)
    await db.neverAgain.put({
      ...rec,
      bestRun: Math.max(rec.bestRun, runDays),
      currentCleanStart: Date.now(),
    })
    await get().reload()
  },

  async updateSettings(patch) {
    const cur = get().settings
    if (!cur) return
    const next = { ...cur, ...patch }
    await db.settings.put(next)
    // If the rest day changed, rescore today so training exclusion is correct.
    const date = todayISO()
    const day = get().days[date]
    if (day) {
      const s = scoreDay(day.flags, date, next.restDay)
      await db.days.put({ ...day, status: s.status, won: s.won })
    }
    await get().reload()
  },

  async exportJSON() {
    const blob = await exportAll()
    await get().updateSettings({ lastBackupAt: Date.now() })
    return JSON.stringify(blob, null, 2)
  },

  async importJSON(text) {
    const parsed = JSON.parse(text)
    await importAll(parsed)
    await get().reload()
  },

  dismissReward() {
    set({ lastReward: null })
  },
}))

// ---------------------------------------------------------------------------
// Reward dispatch — the ONLY place XP is granted. Every path here corresponds
// to a real logged action (asserted). App-open never reaches this function.
// ---------------------------------------------------------------------------
async function grantReward(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  trackId: string,
  weight: number,
  realActionName: string,
  opts: { prHits?: PrHit[]; message?: string; silent?: boolean } = {},
) {
  assertReal(realActionName) // guardrail: throws if not tied to a real action
  const { settings } = get()
  if (!settings) return
  const track = get().tracks.find((t) => t.id === trackId)
  if (!track) return

  const now = Date.now()
  const phase = resolvePhase(track, settings, now)
  const roll = rollReward(weight, phase)
  const { track: updated, leveledUp, toLevel } = addXp(track, roll.totalXp)

  await db.tracks.put({ ...updated, phase })
  await db.rewardsLog.add({
    date: todayISO(),
    type: roll.surprise ? 'surprise' : 'base',
    description: `${track.name}: ${realActionName}${roll.surprise ? ' (surprise bonus!)' : ''}`,
    xp: roll.totalXp,
    fromRealAction: true, // asserted above; never an app-open
  })

  if (!opts.silent) {
    const parts: string[] = []
    if (opts.message) parts.push(opts.message)
    else parts.push(`+${roll.totalXp} ${track.name} XP`)
    if (roll.surprise && !opts.message) parts.push('Surprise bonus!')
    if (leveledUp) parts.push(`${track.name} → Level ${toLevel}`)
    playJuice(settings, { surprise: roll.surprise, pr: !!opts.prHits })
    set({
      lastReward: {
        nonce: ++rewardNonce,
        xp: roll.totalXp,
        surprise: roll.surprise,
        drewTip: roll.drewTip,
        message: parts.join(' · '),
        prHits: opts.prHits,
      },
    })
  }
}

/** Grant a freeze token if the week containing `date` is now fully won. */
async function maybeGrantWeeklyFreeze(date: ISODate) {
  const settings = await db.settings.get('singleton')
  if (!settings) return
  const start = weekStart(date)
  let allWon = true
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    if (d > todayISO()) break // don't judge future days
    const rec = await db.days.get(d)
    if (!rec || !rec.won) {
      allWon = false
      break
    }
  }
  if (allWon) {
    const tokens = grantFreezeForWonWeek(settings.freezeTokens)
    if (tokens !== settings.freezeTokens) {
      await db.settings.put({ ...settings, freezeTokens: tokens })
      await db.rewardsLog.add({
        date: todayISO(),
        type: 'freezeEarned',
        description: 'Fully-won week → streak freeze token banked',
        xp: 0,
        fromRealAction: true,
      })
    }
  }
}

/**
 * Reconcile streak freezes on load. Walks backward from yesterday; each
 * consecutive MISSED day (no win, not a hard break) spends a banked freeze and
 * is marked frozen so the streak is protected, NOT reset. Stops when tokens run
 * out or it hits a kept/lost day. Never strips mastery or all-time bests.
 */
async function reconcileFreezes() {
  const settings = await db.settings.get('singleton')
  if (!settings) return
  let tokens = settings.freezeTokens
  let cursor = addDays(todayISO(), -1)
  const earliest = settings.firstRunAt
    ? addDays(todayISO(), -Math.floor((Date.now() - settings.firstRunAt) / 86_400_000) - 1)
    : addDays(todayISO(), -30)

  while (tokens > 0 && cursor >= earliest) {
    const rec = await db.days.get(cursor)
    if (rec?.won || rec?.frozen) break // streak already kept here — stop
    if (rec?.status === 'lost') break // a hard break stands; don't freeze it
    // Missed (incomplete or absent) day → spend a freeze to protect the run.
    const frozen: DayRecord = rec
      ? { ...rec, frozen: true }
      : { ...blankDay(cursor, settings.restDay), frozen: true }
    await db.days.put(frozen)
    tokens -= 1
    cursor = addDays(cursor, -1)
  }
  if (tokens !== settings.freezeTokens) {
    await db.settings.put({ ...settings, freezeTokens: tokens })
  }
}
