import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { XpBar } from '../components/XpBar';
import { Ring } from '../components/Ring';
import { levelFromXp } from '../lib/progression';
import { todayIso } from '../lib/time';
import type { ScreenName } from '../App';

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export function Home({ go }: { go: (s: ScreenName) => void }) {
  const { tracks, sessions, consistency, prs, exercises, activeSession, settings } = useStore();

  const overall = useMemo(() => {
    const totalXp = tracks.reduce((a, t) => a + t.xp, 0);
    return { totalXp, ...levelFromXp(totalXp) };
  }, [tracks]);

  const weeklyTarget = settings?.weeklyTarget ?? 4;
  const sessionsThisWeek = useMemo(() => {
    const start = startOfWeek(new Date()).getTime();
    const days = new Set(
      sessions
        .filter((s) => s.endedAt != null && new Date(s.date + 'T00:00:00').getTime() >= start)
        .map((s) => s.date),
    );
    return days.size;
  }, [sessions]);

  const recentPr = prs.length
    ? [...prs].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0]
    : null;
  const prExercise = recentPr ? exercises.find((e) => e.id === recentPr.exerciseId) : null;

  return (
    <div>
      <h1>Lift Log</h1>
      <p className="muted small">{todayIso()}</p>

      <div className="card">
        <div className="row spread">
          <div>
            <div className="small muted">Lifter Level</div>
            <div className="big-level">{overall.level}</div>
          </div>
          <div className="grow" style={{ maxWidth: 220 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {overall.intoLevel} / {overall.neededForNext} XP to Level {overall.level + 1}
            </div>
            <XpBar value={overall.intoLevel} max={overall.neededForNext} />
            <div className="small muted" style={{ marginTop: 6 }}>
              {overall.totalXp} total XP
            </div>
          </div>
        </div>
      </div>

      {activeSession ? (
        <button className="primary big" onClick={() => go('session')}>
          ⏱️ Resume Session
        </button>
      ) : (
        <button className="primary big" onClick={() => go('session')}>
          Start Session
        </button>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>This week</h3>
          <span className="small muted">
            {sessionsThisWeek} of {weeklyTarget} sessions
          </span>
        </div>
        <div className="rings" style={{ marginTop: 10 }}>
          {Array.from({ length: Math.max(weeklyTarget, sessionsThisWeek) }).map((_, i) => (
            <Ring key={i} filled={i < sessionsThisWeek} label={`session ${i + 1}`} />
          ))}
        </div>
        {sessionsThisWeek < weeklyTarget && (
          <p className="small muted" style={{ marginTop: 8 }}>
            {weeklyTarget - sessionsThisWeek} more to close your week. Forward, not failure.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Mastery tracks</h3>
        <div className="row wrap">
          {tracks.map((t) => (
            <span key={t.id} className="tag accent" style={{ marginBottom: 6 }}>
              {t.name} · L{t.level}
            </span>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 14 }}>
        <div className="card grow">
          <div className="small muted">Current streak</div>
          <div className="v" style={{ fontSize: '1.6rem', fontWeight: 800 }}>
            {consistency?.currentStreak ?? 0} 🔥
          </div>
          <div className="small muted">Freezes: {consistency?.freezeTokens ?? 0} ❄️</div>
        </div>
        <div className="card grow">
          <div className="small muted">Latest PR</div>
          {recentPr && prExercise ? (
            <>
              <div style={{ fontWeight: 700 }}>{prExercise.name}</div>
              <div className="small muted">
                {prLabel(recentPr.type)} · {recentPr.weight}
                {settings?.unit} × {recentPr.reps}
              </div>
            </>
          ) : (
            <div className="small muted">None yet — log a set to set your first record.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function prLabel(t: string): string {
  if (t === 'maxWeight') return 'Heaviest';
  if (t === 'est1RM') return 'Best est. 1RM';
  return 'Rep PR';
}
