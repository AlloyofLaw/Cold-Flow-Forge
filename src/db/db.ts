// Dexie (IndexedDB) schema and first-run seeding. All persistence lives here.
// No network, no backend, no telemetry.
import Dexie, { type Table } from 'dexie';
import type {
  Session,
  Exercise,
  SessionExercise,
  WorkoutSet,
  PrRecord,
  Track,
  Consistency,
  RewardLogEntry,
  Settings,
} from '../types';
import { TRACK_DEFS, EXERCISE_CATALOG } from './seedData';
import { defaultSettings } from '../lib/defaults';

export class LiftLogDB extends Dexie {
  sessions!: Table<Session, number>;
  exercises!: Table<Exercise, number>;
  sessionExercises!: Table<SessionExercise, number>;
  sets!: Table<WorkoutSet, number>;
  prs!: Table<PrRecord, number>;
  tracks!: Table<Track, string>;
  consistency!: Table<Consistency, string>;
  rewardsLog!: Table<RewardLogEntry, number>;
  settings!: Table<Settings, string>;

  constructor() {
    super('liftlog');
    this.version(1).stores({
      sessions: '++id, date, startedAt, endedAt',
      exercises: '++id, name, trackId, category, isCustom, retired',
      sessionExercises: '++id, sessionId, exerciseId, order',
      sets: '++id, sessionId, exerciseId, weight, reps, timestamp',
      prs: '++id, exerciseId, type, date',
      tracks: 'id',
      consistency: 'id',
      rewardsLog: '++id, date, type, sessionId',
      settings: 'id',
    });
  }
}

export const db = new LiftLogDB();

// Seed ONLY the exercise catalog and track definitions on first run.
// Never seed user performance data.
export async function ensureSeeded(): Promise<void> {
  await db.transaction(
    'rw',
    db.tracks,
    db.exercises,
    db.consistency,
    db.settings,
    async () => {
      const trackCount = await db.tracks.count();
      if (trackCount === 0) {
        const now = Date.now();
        await db.tracks.bulkAdd(
          TRACK_DEFS.map((t) => ({
            ...t,
            xp: 0,
            level: 0,
            phase: 'bootstrap' as const,
            tierProgress: 0,
            activeDays: [],
            startedAt: now,
          })),
        );
      }

      const exCount = await db.exercises.count();
      if (exCount === 0) {
        await db.exercises.bulkAdd(
          EXERCISE_CATALOG.map((e) => ({
            name: e.name,
            trackId: e.trackId,
            category: e.category,
            isCustom: false,
            retired: false,
          })),
        );
      }

      const consistency = await db.consistency.get('singleton');
      if (!consistency) {
        await db.consistency.put({
          id: 'singleton',
          currentStreak: 0,
          bestStreak: 0,
          freezeTokens: 0,
          trainedDates: [],
          weekSessionsHit: 0,
        });
      }

      const settings = await db.settings.get('singleton');
      if (!settings) {
        await db.settings.put(defaultSettings());
      }
    },
  );
}
