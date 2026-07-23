// JSON export/import of the full database. Critical for a local-first app —
// this is the user's only backup path since there is no server.
import { db } from '../db/db';

export interface BackupBundle {
  format: 'liftlog-backup';
  version: number;
  exportedAt: string;
  data: {
    sessions: unknown[];
    exercises: unknown[];
    sessionExercises: unknown[];
    sets: unknown[];
    prs: unknown[];
    tracks: unknown[];
    consistency: unknown[];
    rewardsLog: unknown[];
    settings: unknown[];
  };
}

export async function exportAll(): Promise<BackupBundle> {
  const [
    sessions,
    exercises,
    sessionExercises,
    sets,
    prs,
    tracks,
    consistency,
    rewardsLog,
    settings,
  ] = await Promise.all([
    db.sessions.toArray(),
    db.exercises.toArray(),
    db.sessionExercises.toArray(),
    db.sets.toArray(),
    db.prs.toArray(),
    db.tracks.toArray(),
    db.consistency.toArray(),
    db.rewardsLog.toArray(),
    db.settings.toArray(),
  ]);
  return {
    format: 'liftlog-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      sessions,
      exercises,
      sessionExercises,
      sets,
      prs,
      tracks,
      consistency,
      rewardsLog,
      settings,
    },
  };
}

export function downloadBackup(bundle: BackupBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = bundle.exportedAt.slice(0, 10);
  a.href = url;
  a.download = `liftlog-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Replace the entire database with the contents of a backup bundle. Clears all
 * tables first, then bulk-loads. Restores sessions, sets, PRs, levels — all of
 * it — so an export/clear/import round-trip is lossless.
 */
export async function importAll(bundle: BackupBundle): Promise<void> {
  if (bundle.format !== 'liftlog-backup') {
    throw new Error('Not a Lift Log backup file.');
  }
  const d = bundle.data;
  await db.transaction(
    'rw',
    [
      db.sessions,
      db.exercises,
      db.sessionExercises,
      db.sets,
      db.prs,
      db.tracks,
      db.consistency,
      db.rewardsLog,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.sessions.clear(),
        db.exercises.clear(),
        db.sessionExercises.clear(),
        db.sets.clear(),
        db.prs.clear(),
        db.tracks.clear(),
        db.consistency.clear(),
        db.rewardsLog.clear(),
        db.settings.clear(),
      ]);
      await Promise.all([
        db.sessions.bulkAdd(d.sessions as never[]),
        db.exercises.bulkAdd(d.exercises as never[]),
        db.sessionExercises.bulkAdd(d.sessionExercises as never[]),
        db.sets.bulkAdd(d.sets as never[]),
        db.prs.bulkAdd(d.prs as never[]),
        db.tracks.bulkAdd(d.tracks as never[]),
        db.consistency.bulkPut(d.consistency as never[]),
        db.rewardsLog.bulkAdd(d.rewardsLog as never[]),
        db.settings.bulkPut(d.settings as never[]),
      ]);
    },
  );
}

export function parseBackup(text: string): BackupBundle {
  const parsed = JSON.parse(text) as BackupBundle;
  if (parsed.format !== 'liftlog-backup' || !parsed.data) {
    throw new Error('Invalid backup file format.');
  }
  return parsed;
}
