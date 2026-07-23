import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { PlateCalculator } from '../components/PlateCalculator';
import { elapsedMs, formatDuration, formatClock } from '../lib/time';
import { epley1RM } from '../lib/progression';
import type { ScreenName } from '../App';
import type { Exercise } from '../types';

export function ActiveSession(_props: { go: (s: ScreenName) => void }) {
  const {
    activeSession,
    activeSessionExercises,
    activeSets,
    exercises,
    settings,
    sessionSummary,
    startSession,
    pauseSession,
    resumeSession,
    endSession,
    logSet,
  } = useStore();

  const [pickerOpen, setPickerOpen] = useState(false);

  // Display-only tick. The elapsed value itself is computed from stored
  // timestamps, so it stays correct across reload/backgrounding.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (sessionSummary) {
    return <Summary />;
  }

  if (!activeSession) {
    return (
      <div>
        <h1>Active Session</h1>
        <p className="muted">No session running.</p>
        <button className="primary big" onClick={() => void startSession()}>
          Start Session
        </button>
      </div>
    );
  }

  const paused = activeSession.pausedSince != null;
  const elapsed = elapsedMs(
    activeSession.startedAt,
    undefined,
    activeSession.pausedAccumMs ?? 0,
    activeSession.pausedSince,
  );

  const sessionExerciseList = activeSessionExercises
    .map((se) => exercises.find((e) => e.id === se.exerciseId))
    .filter((e): e is Exercise => !!e);

  return (
    <div>
      <div className="card">
        <div className="row spread">
          <div>
            <div className="small muted">Session time{paused ? ' (paused)' : ''}</div>
            <div className="timer">{formatDuration(elapsed)}</div>
          </div>
          <div className="row">
            {paused ? (
              <button className="pill" onClick={() => void resumeSession()}>
                Resume
              </button>
            ) : (
              <button className="pill" onClick={() => void pauseSession()}>
                Pause
              </button>
            )}
          </div>
        </div>
        <div className="row spread small muted" style={{ marginTop: 8 }}>
          <span>Volume: {activeSession.totalVolume} {settings?.unit}</span>
          <span>XP: {activeSession.xpEarned}</span>
          <span>Sets: {activeSets.length}</span>
        </div>
      </div>

      {sessionExerciseList.map((ex) => (
        <ExerciseBlock key={ex.id} exercise={ex} logSet={logSet} />
      ))}

      <button className="big" onClick={() => setPickerOpen(true)}>
        + Add exercise
      </button>

      <button
        className="primary big"
        style={{ marginTop: 12 }}
        onClick={async () => {
          await endSession();
        }}
      >
        End Session
      </button>

      {pickerOpen && <ExercisePicker onClose={() => setPickerOpen(false)} />}
      <RestTimerBar />
    </div>
  );
}

function ExerciseBlock({
  exercise,
  logSet,
}: {
  exercise: Exercise;
  logSet: (exId: number, w: number, r: number) => Promise<unknown>;
}) {
  const activeSets = useStore((s) => s.activeSets.filter((x) => x.exerciseId === exercise.id));
  const unit = useStore((s) => s.settings?.unit ?? 'lb');
  const restDefault = useStore((s) => s.settings?.restTimerDefault ?? 120);

  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastSet = activeSets[activeSets.length - 1];

  const submit = async () => {
    const w = Number(weight);
    const r = Number(reps);
    if (!Number.isFinite(r) || r <= 0) return;
    await logSet(exercise.id!, Number.isFinite(w) ? w : 0, r);
    setWeight('');
    setReps('');
    // kick the shared rest timer
    window.dispatchEvent(new CustomEvent('start-rest', { detail: restDefault }));
  };

  const repeatLast = async () => {
    if (!lastSet) return;
    await logSet(exercise.id!, lastSet.weight, lastSet.reps);
    window.dispatchEvent(new CustomEvent('start-rest', { detail: restDefault }));
  };

  return (
    <div className="card">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>{exercise.name}</h3>
        <span className="tag">{exercise.category}</span>
      </div>

      {activeSets.map((s, i) => (
        <div className="set-row" key={s.id}>
          <span className="muted small" style={{ width: 24 }}>
            {i + 1}
          </span>
          <span className="grow">
            {s.weight} {unit} × {s.reps}
          </span>
          {(s.prFlags.maxWeight || s.prFlags.est1RM || s.prFlags.repPR) && (
            <span className="tag gold">PR</span>
          )}
          <span className="small muted">est 1RM {Math.round(epley1RM(s.weight, s.reps))}</span>
        </div>
      ))}

      <div className="row" style={{ marginTop: 10 }}>
        <label className="grow" style={{ margin: 0 }}>
          <input
            type="number"
            inputMode="decimal"
            placeholder={`Weight (${unit})`}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <button className="pill" onClick={() => setSheetOpen(true)} aria-label="plate calculator">
          🥏
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="grow" style={{ margin: 0 }}>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Reps"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
        <button className="primary" onClick={() => void submit()}>
          Log set
        </button>
      </div>
      {lastSet && (
        <button className="ghost" style={{ marginTop: 8 }} onClick={() => void repeatLast()}>
          ↺ Repeat last ({lastSet.weight} {unit} × {lastSet.reps})
        </button>
      )}

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <h2 style={{ margin: 0 }}>Plate Calculator</h2>
              <button className="ghost" onClick={() => setSheetOpen(false)}>
                Close
              </button>
            </div>
            <PlateCalculator
              onUseWeight={(total) => {
                setWeight(String(total));
                setSheetOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExercisePicker({ onClose }: { onClose: () => void }) {
  const exercises = useStore((s) => s.exercises.filter((e) => !e.retired));
  const tracks = useStore((s) => s.tracks);
  const addToSession = useStore((s) => s.addExerciseToSession);
  const addExercise = useStore((s) => s.addExercise);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? 'push');

  const filtered = useMemo(
    () => exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())),
    [exercises, q],
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Add exercise</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {creating ? (
          <div>
            <label className="field">
              <span className="lbl">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="lbl">Track</span>
              <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary big"
              onClick={async () => {
                if (!name.trim()) return;
                await addExercise(name.trim(), trackId, 'Custom');
                setCreating(false);
                setName('');
              }}
            >
              Create
            </button>
            <button className="ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div className="exercise-pick">
              {filtered.map((e) => (
                <div
                  className="list-item row spread"
                  key={e.id}
                  onClick={async () => {
                    await addToSession(e.id!);
                    onClose();
                  }}
                >
                  <span>{e.name}</span>
                  <span className="tag">{e.category}</span>
                </div>
              ))}
              {filtered.length === 0 && <p className="muted">No matches.</p>}
            </div>
            <button className="ghost" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
              + Create new exercise
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Optional rest timer between sets. Purely a convenience countdown; it awards
// nothing. Listens for 'start-rest' events dispatched when a set is logged.
function RestTimerBar() {
  const [remaining, setRemaining] = useState(0);
  const endRef = useRef<number>(0);

  useEffect(() => {
    const onStart = (e: Event) => {
      const secs = (e as CustomEvent).detail as number;
      endRef.current = Date.now() + secs * 1000;
      setRemaining(secs);
    };
    window.addEventListener('start-rest', onStart);
    return () => window.removeEventListener('start-rest', onStart);
  }, []);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(left);
    }, 500);
    return () => clearInterval(t);
  }, [remaining]);

  if (remaining <= 0) return null;
  return (
    <div className="card" style={{ position: 'sticky', bottom: 80 }}>
      <div className="row spread">
        <span className="muted small">Rest</span>
        <span className="timer" style={{ fontSize: '1.6rem' }}>
          {formatClock(remaining)}
        </span>
        <button className="pill" onClick={() => setRemaining(0)}>
          Skip
        </button>
      </div>
    </div>
  );
}

function Summary() {
  const summary = useStore((s) => s.sessionSummary)!;
  const clearSummary = useStore((s) => s.clearSummary);
  const unit = useStore((s) => s.settings?.unit ?? 'lb');
  return (
    <div>
      <h1>Session Complete 🎉</h1>
      <div className="kpi">
        <div className="card">
          <div className="small muted">Duration</div>
          <div className="v">{summary.durationMin} min</div>
        </div>
        <div className="card">
          <div className="small muted">Volume</div>
          <div className="v">
            {summary.totalVolume} {unit}
          </div>
        </div>
        <div className="card">
          <div className="small muted">XP earned</div>
          <div className="v" style={{ color: 'var(--accent)' }}>
            {summary.xpEarned}
          </div>
        </div>
        <div className="card">
          <div className="small muted">Sets</div>
          <div className="v">{summary.setCount}</div>
        </div>
      </div>
      {summary.prCount > 0 && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          🏆 <strong>{summary.prCount}</strong> personal record{summary.prCount > 1 ? 's' : ''} this session!
        </div>
      )}
      {summary.surpriseCount > 0 && (
        <div className="banner">✨ {summary.surpriseCount} surprise bonus{summary.surpriseCount > 1 ? 'es' : ''} landed.</div>
      )}
      {summary.freezeEarned && <div className="banner">❄️ You earned a streak freeze for hitting your weekly target.</div>}
      {summary.freezesSpent > 0 && (
        <div className="banner">❄️ {summary.freezesSpent} freeze{summary.freezesSpent > 1 ? 's' : ''} kept your streak alive.</div>
      )}
      <button className="primary big" style={{ marginTop: 14 }} onClick={clearSummary}>
        Done
      </button>
    </div>
  );
}
