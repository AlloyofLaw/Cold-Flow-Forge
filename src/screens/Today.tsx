import { useMemo } from 'react'
import { useStore } from '../store/store'
import { NON_NEGOTIABLES, DREW_LAW, DREW_LINES, FLAG_TO_LINE } from '../db/seed'
import { blankDay, scoreDay, statusLabel } from '../lib/scoring'
import { computeStreak } from '../lib/streak'
import { todayISO } from '../lib/dates'
import { Icon } from '../components/icons'
import { Bar } from '../components/Bar'
import type { FlagState, NonNegotiableKey } from '../db/types'

export function Today({ goToLog }: { goToLog: () => void }) {
  const settings = useStore((s) => s.settings)!
  const days = useStore((s) => s.days)
  const xpToday = useStore((s) => s.xpToday)
  const setFlag = useStore((s) => s.setFlag)
  const updateSettings = useStore((s) => s.updateSettings)

  const date = todayISO()
  const day = days[date] ?? blankDay(date, settings.restDay)
  const score = scoreDay(day.flags, date, settings.restDay)
  const streak = useMemo(() => computeStreak(Object.values(days)), [days])

  // Contextual Drew line: the first applicable non-negotiable that's broken,
  // else the first still-remaining one. Forward pressure, never mockery.
  const contextKey: NonNegotiableKey | undefined = score.broken[0] ?? score.remaining[0]
  const lineId = contextKey ? FLAG_TO_LINE[contextKey] : undefined
  const drewLine = lineId ? DREW_LINES.find((l) => l.id === lineId) : undefined

  const cycle = (key: NonNegotiableKey, cur: FlagState) => {
    // done ↔ notyet toggle on the big check; the chips handle broke/na.
    void setFlag(key, cur === 'done' ? 'notyet' : 'done')
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h1>Beat Drew</h1>
        <span className="pill">
          <Icon name="today" /> {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="drew-line" style={{ marginBottom: 14 }}>{DREW_LAW}</div>

      {/* Day status banner */}
      <div
        className={`status-banner ${
          score.status === 'won'
            ? 'status-won'
            : score.status === 'lost'
              ? 'status-lost'
              : 'status-notyet'
        }`}
        style={{ marginBottom: 14 }}
      >
        {statusLabel(score.status)}
      </div>

      {/* Closable rings summary (Zeigarnik) */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="card-title" style={{ margin: 0 }}>
            {score.doneCount} of {score.applicableCount} closed
            {score.isRestDay && ' · rest day'}
          </span>
          <span className="pill accent">{xpToday} XP today</span>
        </div>
        <Bar pct={score.applicableCount ? score.doneCount / score.applicableCount : 0} won={score.won} />
        {!score.won && score.remaining.length === 1 && score.broken.length === 0 && (
          <p className="faint" style={{ marginTop: 8, fontSize: '0.82rem' }}>
            {score.doneCount} of {score.applicableCount} — one from a won day. Drew won his.
          </p>
        )}
      </div>

      {/* The 7 non-negotiables */}
      <div className="card">
        <div className="card-title">Daily non-negotiables</div>
        {NON_NEGOTIABLES.map((nn) => {
          const applies = !(score.isRestDay && nn.key === 'train')
          const state = day.flags[nn.key]
          return (
            <div
              key={nn.key}
              className={`nn${state === 'done' ? ' done' : state === 'broke' ? ' broke' : ''}`}
              style={applies ? undefined : { opacity: 0.5 }}
            >
              <button
                className={`nn-check${state === 'done' ? ' on' : ''}`}
                aria-label={`Toggle ${nn.label}`}
                disabled={!applies}
                onClick={() => cycle(nn.key, state)}
              >
                {state === 'done' && <Icon name="check" />}
              </button>
              <div className="nn-body">
                <div className="nn-label">{nn.label}</div>
                <div className="nn-blurb">
                  {applies ? nn.blurb : 'Rest day — not required today'}
                </div>
              </div>
              {applies && (
                <div className="nn-actions">
                  <button
                    className={`chip${state === 'broke' ? ' sel-broke' : ''}`}
                    onClick={() => setFlag(nn.key, state === 'broke' ? 'notyet' : 'broke')}
                  >
                    broke
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Streak + freeze tokens */}
      <div className="grid-2">
        <div className="stat">
          <div className="row" style={{ gap: 6 }}>
            <span className="accent">
              <Icon name="flame" />
            </span>
            <span className="stat-val">{streak.current}</span>
          </div>
          <div className="stat-label">Day streak · best {streak.best}</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 6 }}>
            <span className="accent">
              <Icon name="snow" />
            </span>
            <span className="stat-val">{settings.freezeTokens}</span>
          </div>
          <div className="stat-label">Freeze tokens (max 2)</div>
        </div>
      </div>

      {streak.atRiskSoon && (
        <div className="banner-note">
          A freeze is shielding your streak — win today so it doesn't run out.
        </div>
      )}

      {/* Drew's day strip */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Drew's day</div>
        <div className="drew-strip">
          <div className="avatar">D</div>
          <div>
            <div style={{ fontWeight: 600 }}>All 7 done. Trained at 6am.</div>
            <div className="faint" style={{ fontSize: '0.82rem' }}>
              And he's five pounds ahead of you.
            </div>
          </div>
        </div>
        {drewLine && (
          <div className="drew-line" style={{ marginTop: 12 }}>
            <div className="faint" style={{ fontStyle: 'normal', fontSize: '0.72rem', marginBottom: 4 }}>
              {drewLine.trigger}
            </div>
            {drewLine.line}
          </div>
        )}
      </div>

      <button className="btn btn-primary btn-block" onClick={goToLog} style={{ marginTop: 4 }}>
        Log an action →
      </button>

      {/* One optional evening reminder — the only reminder in the app. */}
      <div className="switch" style={{ marginTop: 14 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Evening confrontation reminder</div>
          <div className="faint" style={{ fontSize: '0.8rem' }}>
            Optional · {settings.toggles.eveningReminderTime} · the only reminder
          </div>
        </div>
        <button
          className={`toggle${settings.toggles.eveningReminder ? ' on' : ''}`}
          aria-label="Toggle evening reminder"
          onClick={() =>
            updateSettings({
              toggles: {
                ...settings.toggles,
                eveningReminder: !settings.toggles.eveningReminder,
              },
            })
          }
        />
      </div>
    </div>
  )
}
