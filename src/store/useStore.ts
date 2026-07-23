// Central app store (Zustand). Binds the Dexie database to the progression /
// reward logic. This is the ONLY place XP is awarded, and every award site is
// annotated + asserted as tied to a real logged action (never app-open).
import { create } from 'zustand';
import { db, ensureSeeded } from '../db/db';
import type {
  Settings,
  Track,
  Exercise,
  Consistency,
  Session,
  SessionExercise,
  WorkoutSet,
  PrRecord,
  RewardLogEntry,
  PrType,
} from '../types';
import { computeSetReward, assertRealAction, type SetReward } from '../lib/rewards';
import {
  applyXpToTrack,
  markTrackActiveDay,
  recordTrainingDay,
  epley1RM,
} from '../lib/progression';
import { todayIso } from '../lib/time';

export interface LastReward {
  at: number;
  setReward: SetReward;
  exerciseName: string;
  leveledUp: boolean;
  newLevel?: number;
  trackName?: string;
}

interface StoreState {
  loaded: boolean;
  settings: Settings | null;
  tracks: Track[];
  exercises: Exercise[];
  consistency: Consistency | null;
  sessions: Session[];
  prs: PrRecord[];
  rewardsLog: RewardLogEntry[];

  activeSession: Session | null;
  activeSessionExercises: SessionExercise[];
  activeSets: WorkoutSet[];

  lastReward: LastReward | null;
  sessionSummary: SessionSummary | null;

  init: () => Promise<void>;
  reloadAll: () => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  startSession: () => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  endSession: () => Promise<void>;

  addExerciseToSession: (exerciseId: number) => Promise<void>;
  logSet: (exerciseId: number, weight: number, reps: number) => Promise<SetReward | null>;
  clearLastReward: () => void;
  clearSummary: () => void;

  addExercise: (name: string, trackId: string, category: string) => Promise<void>;
  updateExercise: (id: number, patch: Partial<Exercise>) => Promise<void>;
}

export interface SessionSummary {
  durationMin: number;
  totalVolume: number;
  xpEarned: number;
  prCount: number;
  surpriseCount: number;
  setCount: number;
  freezeEarned: boolean;
  freezesSpent: number;
}

async function loadCollections() {
  const [settings, tracks, exercises, consistency, sessions, prs, rewardsLog] =
    await Promise.all([
      db.settings.get('singleton'),
      db.tracks.toArray(),
      db.exercises.toArray(),
      db.consistency.get('singleton'),
      db.sessions.orderBy('startedAt').reverse().toArray(),
      db.prs.toArray(),
      db.rewardsLog.orderBy('id').reverse().toArray(),
    ]);
  return { settings, tracks, exercises, consistency, sessions, prs, rewardsLog };
}

export const useStore = create<StoreState>((set, get) => ({
  loaded: false,
  settings: null,
  tracks: [],
  exercises: [],
  consistency: null,
  sessions: [],
  prs: [],
  rewardsLog: [],
  activeSession: null,
  activeSessionExercises: [],
  activeSets: [],
  lastReward: null,
  sessionSummary: null,

  init: async () => {
    await ensureSeeded();
    await get().reloadAll();
    // Resume a live (un-ended) session if one exists — this restores the timer
    // purely from stored timestamps. NOTE: resuming awards NO XP; it is not a
    // logged action, merely restoring UI state.
    const live = await db.sessions.filter((s) => s.endedAt == null).last();
    if (live) {
      const [se, sets] = await Promise.all([
        db.sessionExercises.where('sessionId').equals(live.id!).toArray(),
        db.sets.where('sessionId').equals(live.id!).toArray(),
      ]);
      set({
        activeSession: live,
        activeSessionExercises: se.sort((a, b) => a.order - b.order),
        activeSets: sets,
      });
    }
    set({ loaded: true });
  },

  reloadAll: async () => {
    const c = await loadCollections();
    set({
      settings: c.settings ?? null,
      tracks: c.tracks.sort(trackOrder),
      exercises: c.exercises,
      consistency: c.consistency ?? null,
      sessions: c.sessions,
      prs: c.prs,
      rewardsLog: c.rewardsLog,
    });
  },

  updateSettings: async (patch) => {
    const cur = get().settings;
    if (!cur) return;
    const next = { ...cur, ...patch };
    await db.settings.put(next);
    set({ settings: next });
  },

  startSession: async () => {
    if (get().activeSession) return;
    const now = Date.now();
    const session: Session = {
      date: todayIso(),
      startedAt: now,
      totalVolume: 0,
      xpEarned: 0,
      pausedAccumMs: 0,
    };
    const id = await db.sessions.add(session);
    set({
      activeSession: { ...session, id },
      activeSessionExercises: [],
      activeSets: [],
      sessionSummary: null,
    });
  },

  pauseSession: async () => {
    const s = get().activeSession;
    if (!s || s.pausedSince != null) return;
    const next = { ...s, pausedSince: Date.now() };
    await db.sessions.put(next);
    set({ activeSession: next });
  },

  resumeSession: async () => {
    const s = get().activeSession;
    if (!s || s.pausedSince == null) return;
    const accum = (s.pausedAccumMs ?? 0) + (Date.now() - s.pausedSince);
    const next = { ...s, pausedAccumMs: accum, pausedSince: undefined };
    await db.sessions.put(next);
    set({ activeSession: next });
  },

  endSession: async () => {
    const s = get().activeSession;
    if (!s || !s.id) return;
    // Finalize any active pause.
    const now = Date.now();
    let pausedAccum = s.pausedAccumMs ?? 0;
    if (s.pausedSince != null) pausedAccum += now - s.pausedSince;
    const durationMs = Math.max(0, now - s.startedAt - pausedAccum);
    const durationMin = Math.round(durationMs / 60000);

    const sets = get().activeSets;
    const totalVolume = sets.reduce((a, x) => a + x.weight * x.reps, 0);
    const xpEarned = sets.reduce(
      (a, x) => a + x.xpAwarded + x.surpriseBonus,
      0,
    );

    const finished: Session = {
      ...s,
      endedAt: now,
      pausedAccumMs: pausedAccum,
      pausedSince: undefined,
      durationMin,
      totalVolume,
      xpEarned,
    };
    await db.sessions.put(finished);

    // ---- REWARD: session ended (a real logged action) ----
    assertRealAction('session-ended');
    let freezeEarned = false;
    let freezesSpent = 0;
    if (sets.length > 0) {
      const cur = get().consistency;
      if (cur) {
        const upd = recordTrainingDay(cur, finished.date, get().settings!.weeklyTarget);
        await db.consistency.put(upd.consistency);
        freezeEarned = upd.freezeEarned;
        freezesSpent = upd.freezesSpent;
      }
      await db.rewardsLog.add({
        date: todayIso(),
        type: 'session-ended',
        description: `Session complete: ${durationMin} min, ${totalVolume} volume, ${xpEarned} XP.`,
        sessionId: s.id,
      });
    }

    const prCount = sets.reduce(
      (a, x) =>
        a +
        (x.prFlags.maxWeight ? 1 : 0) +
        (x.prFlags.est1RM ? 1 : 0) +
        (x.prFlags.repPR ? 1 : 0),
      0,
    );
    const surpriseCount = sets.filter((x) => x.surpriseBonus > 0).length;

    set({
      activeSession: null,
      activeSessionExercises: [],
      activeSets: [],
      sessionSummary: {
        durationMin,
        totalVolume,
        xpEarned,
        prCount,
        surpriseCount,
        setCount: sets.length,
        freezeEarned,
        freezesSpent,
      },
    });
    await get().reloadAll();
  },

  addExerciseToSession: async (exerciseId) => {
    const s = get().activeSession;
    if (!s || !s.id) return;
    const existing = get().activeSessionExercises;
    if (existing.some((e) => e.exerciseId === exerciseId)) return;
    const se: SessionExercise = {
      sessionId: s.id,
      exerciseId,
      order: existing.length,
    };
    const id = await db.sessionExercises.add(se);
    set({ activeSessionExercises: [...existing, { ...se, id }] });
  },

  logSet: async (exerciseId, weight, reps) => {
    const s = get().activeSession;
    if (!s || !s.id) return null;
    const settings = get().settings!;
    const exercise = get().exercises.find((e) => e.id === exerciseId);
    if (!exercise) return null;

    // A set only earns anything if it is real work (reps > 0). Empty entries
    // earn exactly 0 XP — you cannot manufacture XP without lifting.
    if (reps <= 0) return null;

    // Ensure the exercise is attached to the session.
    if (!get().activeSessionExercises.some((e) => e.exerciseId === exerciseId)) {
      await get().addExerciseToSession(exerciseId);
    }

    const track = get().tracks.find((t) => t.id === exercise.trackId);
    const activeDayCount = track?.activeDays?.length ?? 0;

    // Prior logged sets for this exercise across ALL sessions -> PR detection.
    const priorSets = await db.sets.where('exerciseId').equals(exerciseId).toArray();

    const reward = computeSetReward({
      weight,
      reps,
      activeDayCount,
      priorSets,
      constants: settings.xpConstants,
    });

    // ---- REWARD: set logged (a real logged action) ----
    // This is reached ONLY from the user tapping "Log set". Never from app-open,
    // navigation, or a notification. assertRealAction is defence-in-depth.
    assertRealAction('set-logged');

    const now = Date.now();
    const newSet: WorkoutSet = {
      sessionId: s.id,
      exerciseId,
      weight,
      reps,
      unit: settings.unit,
      timestamp: now,
      xpAwarded: reward.baseXp + reward.prBonus,
      surpriseBonus: reward.surpriseBonus,
      prFlags: reward.prFlags,
    };
    const setId = await db.sets.add(newSet);

    // Write PR records + PR reward-log entries (real action: PR hit).
    const today = todayIso();
    if (reward.prFlags.maxWeight || reward.prFlags.est1RM || reward.prFlags.repPR) {
      assertRealAction('pr-hit');
      const prWrites: PrRecord[] = [];
      if (reward.prFlags.maxWeight)
        prWrites.push(mkPr(exerciseId, 'maxWeight', weight, weight, reps, today, s.id));
      if (reward.prFlags.est1RM)
        prWrites.push(
          mkPr(exerciseId, 'est1RM', epley1RM(weight, reps), weight, reps, today, s.id),
        );
      if (reward.prFlags.repPR)
        prWrites.push(mkPr(exerciseId, 'repPR', reps, weight, reps, today, s.id));
      await db.prs.bulkAdd(prWrites);
      await db.rewardsLog.add({
        date: today,
        type: 'pr-hit',
        description: `PR on ${exercise.name}: ${prLabels(reward.prFlags)}`,
        sessionId: s.id,
      });
    }

    if (reward.surpriseBonus > 0) {
      await db.rewardsLog.add({
        date: today,
        type: 'surprise',
        description: `Surprise bonus +${reward.surpriseBonus} XP on ${exercise.name}.`,
        sessionId: s.id,
      });
    }

    // Apply XP to the track (marks today active, then adds XP). applyXpToTrack
    // is monotonic — it never lowers XP/level. Mastery cannot decay.
    let leveledUp = false;
    let newLevel: number | undefined;
    if (track) {
      const prevLevel = track.level;
      let updated = markTrackActiveDay(track, today, settings.xpConstants);
      updated = applyXpToTrack(updated, reward.totalXp, settings.xpConstants);
      await db.tracks.put(updated);
      leveledUp = updated.level > prevLevel;
      newLevel = updated.level;
    }

    // Update the running session totals.
    const updatedSession: Session = {
      ...s,
      totalVolume: s.totalVolume + weight * reps,
      xpEarned: s.xpEarned + reward.baseXp + reward.prBonus + reward.surpriseBonus,
    };
    await db.sessions.put(updatedSession);

    // Base set-logged reward-log entry.
    await db.rewardsLog.add({
      date: today,
      type: 'set-logged',
      description: `Logged ${weight}${settings.unit} × ${reps} on ${exercise.name} (+${reward.baseXp} XP).`,
      sessionId: s.id,
    });

    set({
      activeSession: updatedSession,
      activeSets: [...get().activeSets, { ...newSet, id: setId }],
      lastReward: {
        at: now,
        setReward: reward,
        exerciseName: exercise.name,
        leveledUp,
        newLevel,
        trackName: track?.name,
      },
    });
    await get().reloadAll();

    // Optional multi-sensory feedback (haptic). Sound is handled in the UI.
    if (settings.hapticEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      const pattern = reward.prFlags.maxWeight || reward.prFlags.est1RM ? [30, 40, 60] : 20;
      navigator.vibrate(pattern);
    }

    return reward;
  },

  clearLastReward: () => set({ lastReward: null }),
  clearSummary: () => set({ sessionSummary: null }),

  addExercise: async (name, trackId, category) => {
    await db.exercises.add({ name, trackId, category, isCustom: true, retired: false });
    await get().reloadAll();
  },

  updateExercise: async (id, patch) => {
    await db.exercises.update(id, patch);
    await get().reloadAll();
  },
}));

function mkPr(
  exerciseId: number,
  type: PrType,
  value: number,
  weight: number,
  reps: number,
  date: string,
  sessionId: number,
): PrRecord {
  return { exerciseId, type, value, weight, reps, date, sessionId };
}

function prLabels(flags: { maxWeight?: boolean; est1RM?: boolean; repPR?: boolean }): string {
  const parts: string[] = [];
  if (flags.maxWeight) parts.push('heaviest weight');
  if (flags.est1RM) parts.push('best est. 1RM');
  if (flags.repPR) parts.push('rep PR');
  return parts.join(', ');
}

const TRACK_SORT = ['squat', 'bench', 'deadlift', 'ohp', 'push', 'pull', 'legs', 'core'];
function trackOrder(a: Track, b: Track): number {
  return TRACK_SORT.indexOf(a.id) - TRACK_SORT.indexOf(b.id);
}
