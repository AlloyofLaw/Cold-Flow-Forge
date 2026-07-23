import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { db } from '../db/db';
import { Sparkline } from '../components/Sparkline';
import type { WorkoutSet, Exercise } from '../types';

export function History() {
  const sessions = useStore((s) => s.sessions.filter((x) => x.endedAt != null));
  const exercises = useStore((s) => s.exercises);
  const prs = useStore((s) => s.prs);
  const unit = useStore((s) => s.settings?.unit ?? 'lb');
  const [openId, setOpenId] = useState<number | null>(null);
  const [openSets, setOpenSets] = useState<WorkoutSet[]>([]);

  useEffect(() => {
    if (openId == null) {
      setOpenSets([]);
      return;
    }
    void db.sets
      .where('sessionId')
      .equals(openId)
      .toArray()
      .then(setOpenSets);
  }, [openId]);

  const chrono = useMemo(() => [...sessions].reverse(), [sessions]);
  const volumeSeries = chrono.map((s) => s.totalVolume);
  const durationSeries = chrono.map((s) => s.durationMin ?? 0);

  const exName = (id: number) => exercises.find((e: Exercise) => e.id === id)?.name ?? 'Exercise';

  return (
    <div>
      <h1>History</h1>

      {sessions.length === 0 ? (
        <p className="muted">No sessions logged yet. Start one from Home.</p>
      ) : (
        <>
          <div className="card">
            <h3>Volume over time</h3>
            <Sparkline data={volumeSeries} />
          </div>
          <div className="card">
            <h3>Session duration trend</h3>
            <Sparkline data={durationSeries} color="var(--gold)" />
          </div>
          <div className="card">
            <h3>PR timeline</h3>
            {prs.length === 0 ? (
              <p className="muted small">No PRs yet.</p>
            ) : (
              [...prs]
                .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
                .slice(0, 12)
                .map((p) => (
                  <div className="set-row" key={p.id}>
                    <span className="grow">{exName(p.exerciseId)}</span>
                    <span className="tag gold">{prLabel(p.type)}</span>
                    <span className="small muted">{p.date}</span>
                  </div>
                ))
            )}
          </div>

          <h2>Sessions</h2>
          {sessions.map((s) => (
            <div className="card" key={s.id}>
              <div
                className="row spread"
                onClick={() => setOpenId(openId === s.id ? null : s.id!)}
                style={{ cursor: 'pointer' }}
              >
                <div>
                  <strong>{s.date}</strong>
                  <div className="small muted">
                    {s.durationMin} min · {s.totalVolume} {unit} · {s.xpEarned} XP
                  </div>
                </div>
                <span className="muted">{openId === s.id ? '▲' : '▼'}</span>
              </div>
              {openId === s.id && (
                <div style={{ marginTop: 10 }}>
                  {openSets.length === 0 && <p className="muted small">No sets.</p>}
                  {groupByExercise(openSets).map(([exId, sets]) => (
                    <div key={exId} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 600 }}>{exName(exId)}</div>
                      {sets.map((set, i) => (
                        <div className="small muted" key={set.id}>
                          Set {i + 1}: {set.weight} {unit} × {set.reps}
                          {(set.prFlags.maxWeight || set.prFlags.est1RM || set.prFlags.repPR) && ' 🏆'}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function groupByExercise(sets: WorkoutSet[]): [number, WorkoutSet[]][] {
  const map = new Map<number, WorkoutSet[]>();
  for (const s of sets) {
    const arr = map.get(s.exerciseId) ?? [];
    arr.push(s);
    map.set(s.exerciseId, arr);
  }
  return [...map.entries()];
}

function prLabel(t: string): string {
  if (t === 'maxWeight') return 'Heaviest';
  if (t === 'est1RM') return 'Est. 1RM';
  return 'Rep PR';
}
