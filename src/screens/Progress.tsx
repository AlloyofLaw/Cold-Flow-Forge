import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { XpBar } from '../components/XpBar';
import { Sparkline } from '../components/Sparkline';
import { db } from '../db/db';
import { levelFromXp, epley1RM } from '../lib/progression';
import type { WorkoutSet } from '../types';

const PHASE_COPY: Record<string, string> = {
  bootstrap: 'Bootstrap — every set rewarded while the habit forms.',
  sustain: 'Sustain — base reward thinned; PRs & surprises carry more weight.',
  fade: 'Fade — extrinsic points recede; your trend lines are the reward.',
};

export function Progress() {
  const tracks = useStore((s) => s.tracks);
  const exercises = useStore((s) => s.exercises);
  const prs = useStore((s) => s.prs);
  const unit = useStore((s) => s.settings?.unit ?? 'lb');

  const [allSets, setAllSets] = useState<WorkoutSet[]>([]);
  useEffect(() => {
    void db.sets.toArray().then(setAllSets);
  }, [prs]);

  // Intrinsic "fade" framing: volume this month vs the previous 30-day window.
  const volumeTrend = useMemo(() => computeVolumeTrend(allSets), [allSets]);

  const bestByExercise = useMemo(() => {
    const map = new Map<number, { maxWeight: number; est1RM: number; repPR: number }>();
    for (const p of prs) {
      const cur = map.get(p.exerciseId) ?? { maxWeight: 0, est1RM: 0, repPR: 0 };
      if (p.type === 'maxWeight') cur.maxWeight = Math.max(cur.maxWeight, p.value);
      if (p.type === 'est1RM') cur.est1RM = Math.max(cur.est1RM, p.value);
      if (p.type === 'repPR') cur.repPR = Math.max(cur.repPR, p.value);
      map.set(p.exerciseId, cur);
    }
    return map;
  }, [prs]);

  return (
    <div>
      <h1>Progress</h1>

      {volumeTrend != null && (
        <div className="card">
          <h3>You vs a month ago</h3>
          <p style={{ margin: 0 }}>
            You're lifting{' '}
            <strong style={{ color: volumeTrend >= 0 ? 'var(--accent)' : 'var(--muted)' }}>
              {volumeTrend >= 0 ? '+' : ''}
              {volumeTrend}%
            </strong>{' '}
            volume vs the prior 30 days. Intrinsic progress — the real reward.
          </p>
        </div>
      )}

      <h2>Mastery tracks</h2>
      {tracks.map((t) => {
        const info = levelFromXp(t.xp);
        return (
          <div className="card" key={t.id}>
            <div className="row spread">
              <strong>{t.name}</strong>
              <span className="tag accent">Level {t.level}</span>
            </div>
            <div className="small muted" style={{ margin: '6px 0' }}>
              {info.intoLevel} / {info.neededForNext} XP · {t.xp} total
            </div>
            <XpBar value={info.intoLevel} max={info.neededForNext} />
            <div className="small muted" style={{ marginTop: 8 }}>
              <span className="tag">{t.phase}</span> {PHASE_COPY[t.phase]}
            </div>
          </div>
        );
      })}

      <h2>PR records</h2>
      {[...bestByExercise.entries()].length === 0 && (
        <p className="muted">No PRs yet — your records fill in from real logged sets.</p>
      )}
      {[...bestByExercise.entries()].map(([exId, best]) => {
        const ex = exercises.find((e) => e.id === exId);
        if (!ex) return null;
        const series = est1RMSeries(allSets.filter((s) => s.exerciseId === exId));
        return (
          <div className="card" key={exId}>
            <strong>{ex.name}</strong>
            <div className="row wrap small" style={{ gap: 14, margin: '8px 0' }}>
              <span>
                Heaviest: <strong>{best.maxWeight}</strong> {unit}
              </span>
              <span>
                Best est. 1RM: <strong>{Math.round(best.est1RM)}</strong> {unit}
                <span className="muted"> (est)</span>
              </span>
              {best.repPR > 0 && (
                <span>
                  Rep PR: <strong>{best.repPR}</strong>
                </span>
              )}
            </div>
            {series.length > 1 && (
              <>
                <div className="small muted">Estimated 1RM curve</div>
                <Sparkline data={series} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function est1RMSeries(sets: WorkoutSet[]): number[] {
  // best est. 1RM per day, chronological
  const byDay = new Map<number, number>();
  for (const s of sets) {
    const day = Math.floor(s.timestamp / 86400000);
    const e = epley1RM(s.weight, s.reps);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, e));
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => Math.round(v));
}

function computeVolumeTrend(sets: WorkoutSet[]): number | null {
  if (sets.length === 0) return null;
  const now = Date.now();
  const day = 86400000;
  const recent = sets
    .filter((s) => s.timestamp >= now - 30 * day)
    .reduce((a, s) => a + s.weight * s.reps, 0);
  const prior = sets
    .filter((s) => s.timestamp >= now - 60 * day && s.timestamp < now - 30 * day)
    .reduce((a, s) => a + s.weight * s.reps, 0);
  if (prior === 0) return null;
  return Math.round(((recent - prior) / prior) * 100);
}
