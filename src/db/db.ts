import Dexie, { type Table } from 'dexie'
import type {
  DayRecord,
  MetricRecord,
  MonthlyReviewRecord,
  NeverAgainRecord,
  PrRecord,
  RewardLogRecord,
  SettingsRecord,
  TrackRecord,
  WorkoutRecord,
} from './types'
import {
  makeDefaultSettings,
  METRIC_SEEDS,
  NEVER_AGAIN,
  PRS_SEED,
  TRACKS_SEED,
} from './seed'
import { todayISO } from '../lib/dates'

export class BeatDrewDB extends Dexie {
  days!: Table<DayRecord, string>
  metrics!: Table<MetricRecord, number>
  workouts!: Table<WorkoutRecord, number>
  prs!: Table<PrRecord, number>
  tracks!: Table<TrackRecord, string>
  neverAgain!: Table<NeverAgainRecord, string>
  rewardsLog!: Table<RewardLogRecord, number>
  reviews!: Table<MonthlyReviewRecord, number>
  settings!: Table<SettingsRecord, string>

  constructor() {
    super('beat-drew')
    this.version(1).stores({
      days: 'date, status, won',
      metrics: '++id, date, type, [type+date]',
      workouts: '++id, date, split',
      prs: '++id, exercise, date',
      tracks: 'id, domain',
      neverAgain: 'key',
      rewardsLog: '++id, date, type',
      reviews: '++id, month',
      settings: 'id',
    })
  }
}

export const db = new BeatDrewDB()

/**
 * Seeds first-run state from the GROUNDING DATA. Idempotent: it only writes a
 * table that is still empty, so re-running never clobbers real data (and an
 * import can wipe+repopulate safely).
 */
export async function seedIfEmpty(): Promise<void> {
  const now = Date.now()
  const today = todayISO()

  await db.transaction(
    'rw',
    [db.settings, db.tracks, db.neverAgain, db.prs, db.metrics],
    async () => {
      if ((await db.settings.count()) === 0) {
        await db.settings.put(makeDefaultSettings(now))
      }
      if ((await db.tracks.count()) === 0) {
        await db.tracks.bulkPut(TRACKS_SEED.map((t) => ({ ...t, startedAt: now })))
      }
      if ((await db.neverAgain.count()) === 0) {
        await db.neverAgain.bulkPut(
          NEVER_AGAIN.map((n) => ({ ...n, currentCleanStart: now })),
        )
      }
      if ((await db.prs.count()) === 0) {
        await db.prs.bulkPut(PRS_SEED.map((p) => ({ ...p, date: today })))
      }
      if ((await db.metrics.count()) === 0) {
        await db.metrics.bulkPut(
          METRIC_SEEDS.map((m) => ({ date: today, ...m })),
        )
      }
    },
  )
}

/** Full export of every table for the JSON backup feature. */
export async function exportAll() {
  const [days, metrics, workouts, prs, tracks, neverAgain, rewardsLog, reviews, settings] =
    await Promise.all([
      db.days.toArray(),
      db.metrics.toArray(),
      db.workouts.toArray(),
      db.prs.toArray(),
      db.tracks.toArray(),
      db.neverAgain.toArray(),
      db.rewardsLog.toArray(),
      db.reviews.toArray(),
      db.settings.toArray(),
    ])
  return {
    app: 'beat-drew',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { days, metrics, workouts, prs, tracks, neverAgain, rewardsLog, reviews, settings },
  }
}

/** Wipes every table and re-imports from a backup blob. Round-trips exportAll. */
export async function importAll(blob: Awaited<ReturnType<typeof exportAll>>) {
  if (blob?.app !== 'beat-drew' || !blob.data) {
    throw new Error('Not a Beat Drew backup file.')
  }
  const d = blob.data
  await db.transaction(
    'rw',
    [db.days, db.metrics, db.workouts, db.prs, db.tracks, db.neverAgain, db.rewardsLog, db.reviews, db.settings],
    async () => {
      await Promise.all([
        db.days.clear(),
        db.metrics.clear(),
        db.workouts.clear(),
        db.prs.clear(),
        db.tracks.clear(),
        db.neverAgain.clear(),
        db.rewardsLog.clear(),
        db.reviews.clear(),
        db.settings.clear(),
      ])
      await Promise.all([
        db.days.bulkPut(d.days ?? []),
        db.metrics.bulkPut(d.metrics ?? []),
        db.workouts.bulkPut(d.workouts ?? []),
        db.prs.bulkPut(d.prs ?? []),
        db.tracks.bulkPut(d.tracks ?? []),
        db.neverAgain.bulkPut(d.neverAgain ?? []),
        db.rewardsLog.bulkPut(d.rewardsLog ?? []),
        db.reviews.bulkPut(d.reviews ?? []),
        db.settings.bulkPut(d.settings ?? []),
      ])
    },
  )
}
