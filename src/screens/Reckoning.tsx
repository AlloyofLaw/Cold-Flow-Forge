import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { db } from '../db/db'
import type { MonthlyReviewRecord } from '../db/types'
import { NON_NEGOTIABLES } from '../db/seed'
import { addDays, monthKey, todayISO, weekStart } from '../lib/dates'
import { scoreDay, statusLabel } from '../lib/scoring'
import { computeStreak } from '../lib/streak'

export function Reckoning() {
  const settings = useStore((s) => s.settings)!
  const days = useStore((s) => s.days)
  const [reviews, setReviews] = useState<MonthlyReviewRecord[]>([])
  const [gapMoved, setGapMoved] = useState('')
  const [changes, setChanges] = useState('')
  const [shareText, setShareText] = useState('')

  const today = todayISO()
  const day = days[today]
  const score = day ? scoreDay(day.flags, today, settings.restDay) : null

  // Weekly score: days won in the current Mon–Sun week.
  const week = useMemo(() => {
    const start = weekStart(today)
    let won = 0
    let counted = 0
    const rows: { date: string; won: boolean }[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i)
      if (d > today) break
      counted++
      const rec = days[d]
      const w = !!rec?.won
      if (w) won++
      rows.push({ date: d, won: w })
    }
    return { won, counted, rows }
  }, [days, today])

  const monthWon = useMemo(() => {
    const mk = monthKey(today)
    return Object.values(days).filter((d) => d.date.startsWith(mk) && d.won).length
  }, [days, today])

  useEffect(() => {
    void db.reviews.toArray().then((r) => setReviews(r.sort((a, b) => b.month.localeCompare(a.month))))
  }, [])

  const saveReview = async () => {
    const rec: MonthlyReviewRecord = {
      month: monthKey(today),
      daysWon: monthWon,
      gapMoved,
      changesNextMonth: changes,
      createdAt: Date.now(),
    }
    await db.reviews.add(rec)
    setReviews(await db.reviews.toArray().then((r) => r.sort((a, b) => b.month.localeCompare(a.month))))
    setGapMoved('')
    setChanges('')
  }

  // "Share my week" — optional local export to text/image. No social account.
  const buildShare = () => {
    const streak = computeStreak(Object.values(days))
    const lines = [
      'Beat Drew — week report',
      `Week of ${weekStart(today)}`,
      `Days won: ${week.won}/${week.counted}`,
      `Current streak: ${streak.current} (best ${streak.best})`,
      `Freeze tokens: ${settings.freezeTokens}`,
      '',
      'Still closing the gap on Drew.',
    ]
    const text = lines.join('\n')
    setShareText(text)
    if (navigator.share) {
      navigator.share({ title: 'Beat Drew — my week', text }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(text).catch(() => {})
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: 14 }}>Reckoning</h1>

      {/* Daily confrontation */}
      <div className="card">
        <div className="card-title">Today's confrontation</div>
        {score ? (
          <>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span>Status</span>
              <strong className={score.won ? 'won-text' : 'accent'}>{statusLabel(score.status)}</strong>
            </div>
            {NON_NEGOTIABLES.map((nn) => {
              const st = day!.flags[nn.key]
              const applies = !(score.isRestDay && nn.key === 'train')
              return (
                <div className="row-between" key={nn.key} style={{ padding: '4px 0' }}>
                  <span className={applies ? '' : 'faint'}>{nn.label}</span>
                  <span className="faint" style={{ fontSize: '0.8rem' }}>
                    {!applies ? 'rest' : st === 'done' ? '✓ done' : st === 'broke' ? '✕ broke' : '— not yet'}
                  </span>
                </div>
              )
            })}
          </>
        ) : (
          <p className="faint">Nothing logged today yet. Head to Today to start.</p>
        )}
      </div>

      {/* Weekly score */}
      <div className="card">
        <div className="card-title">This week · {week.won}/{week.counted} won</div>
        <div className="row" style={{ gap: 6 }}>
          {week.rows.map((r) => (
            <div
              key={r.date}
              title={r.date}
              style={{
                flex: 1,
                height: 34,
                borderRadius: 8,
                background: r.won ? 'var(--won-soft)' : 'var(--bg-3)',
                border: `1px solid ${r.won ? 'rgba(34,197,94,0.4)' : 'var(--line)'}`,
                display: 'grid',
                placeItems: 'center',
                fontSize: '0.72rem',
                color: r.won ? 'var(--won)' : 'var(--text-faint)',
              }}
            >
              {r.date.slice(8)}
            </div>
          ))}
        </div>
      </div>

      {/* Monthly review ritual */}
      <div className="card">
        <div className="card-title">Monthly review · {monthKey(today)}</div>
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
          Days won this month: <strong>{monthWon}</strong>
        </p>
        <div className="field">
          <label>Which gap moved?</label>
          <textarea rows={2} value={gapMoved} onChange={(e) => setGapMoved(e.target.value)} />
        </div>
        <div className="field">
          <label>What changes next month?</label>
          <textarea rows={2} value={changes} onChange={(e) => setChanges(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" onClick={saveReview} disabled={!gapMoved && !changes}>
          Save review
        </button>
        {reviews.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {reviews.map((r) => (
              <div key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <div className="row-between">
                  <strong>{r.month}</strong>
                  <span className="pill">{r.daysWon} days won</span>
                </div>
                {r.gapMoved && <p className="faint" style={{ fontSize: '0.8rem', marginTop: 4 }}>Moved: {r.gapMoved}</p>}
                {r.changesNextMonth && <p className="faint" style={{ fontSize: '0.8rem' }}>Next: {r.changesNextMonth}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Yearly reckoning + share */}
      <div className="card">
        <div className="card-title">Yearly reckoning</div>
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
          The Villain ledger is your year-end scorecard: every gap, every % closed. Review it in the Villain tab.
        </p>
        <button className="btn btn-block" onClick={buildShare}>
          Share my week
        </button>
        {shareText && (
          <pre
            style={{
              marginTop: 12,
              whiteSpace: 'pre-wrap',
              fontSize: '0.8rem',
              background: 'var(--bg-2)',
              padding: 12,
              borderRadius: 10,
              border: '1px solid var(--line)',
            }}
          >
            {shareText}
          </pre>
        )}
      </div>
    </div>
  )
}
