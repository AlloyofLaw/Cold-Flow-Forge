import { useMemo } from 'react'
import { useStore } from '../store/store'
import { LEDGER_SEED, DREW_LINES, NEVER_AGAIN } from '../db/seed'
import { Bar } from '../components/Bar'
import { latest } from '../lib/analytics'
import { daysSince } from '../lib/dates'
import type { LedgerEntry } from '../db/types'

/** % of the gap closed for a ledger entry, from real metric data. */
function pctClosed(entry: LedgerEntry, current?: number): number | null {
  if (
    entry.baselineValue === undefined ||
    entry.targetValue === undefined ||
    current === undefined
  )
    return null
  const span = entry.targetValue - entry.baselineValue
  if (span === 0) return current >= entry.targetValue ? 1 : 0
  const closed = (current - entry.baselineValue) / span
  return Math.max(0, Math.min(1, closed))
}

export function Villain() {
  const metrics = useStore((s) => s.metrics)
  const neverAgain = useStore((s) => s.neverAgain)
  const breakNeverAgain = useStore((s) => s.breakNeverAgain)

  const domains: LedgerEntry['domain'][] = ['Health', 'Wealth', 'Relationships']

  const naByKey = useMemo(() => {
    const m = new Map(neverAgain.map((n) => [n.key, n]))
    return NEVER_AGAIN.map((seed) => m.get(seed.key) ?? { ...seed, currentCleanStart: Date.now() })
  }, [neverAgain])

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>The Villain</h1>
      <p className="faint" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
        Drew's standard vs your current. Close the gap with real data.
      </p>

      {/* Never-Again clean-streak counters — gentle framing only. */}
      <div className="card">
        <div className="card-title">Never-again · days clean</div>
        {naByKey.map((n) => (
          <div className="na-counter" key={n.key}>
            <div>
              <div style={{ fontWeight: 600 }}>{n.label}</div>
              <div className="faint" style={{ fontSize: '0.72rem' }}>
                best run: {n.bestRun} days
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <span className="na-days accent">{daysSince(n.currentCleanStart)}</span>
              <button
                className="chip"
                onClick={() => {
                  if (confirm(`Reset the "${n.label}" clean run? Your all-time best stays. No penalty.`))
                    void breakNeverAgain(n.key)
                }}
              >
                broke
              </button>
            </div>
          </div>
        ))}
        <p className="faint" style={{ fontSize: '0.72rem', marginTop: 10 }}>
          Breaking one only resets that counter's current run — your all-time best stays, and nothing is punished.
        </p>
      </div>

      {/* The Ledger */}
      {domains.map((domain) => (
        <div className="card" key={domain}>
          <div className="card-title">{domain} ledger</div>
          {LEDGER_SEED.filter((e) => e.domain === domain).map((e) => {
            const current = e.metric ? latest(metrics, e.metric) : undefined
            const pct = pctClosed(e, current)
            return (
              <div className="ledger-row" key={e.area}>
                <div className="row-between" style={{ marginBottom: 4 }}>
                  <strong>{e.area}</strong>
                  {pct !== null && (
                    <span className="pill accent">{Math.round(pct * 100)}% closed</span>
                  )}
                </div>
                <div className="faint" style={{ fontSize: '0.8rem' }}>
                  You: {current !== undefined ? `${current}` : e.andrewCurrent}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>Drew: {e.drewStandard}</div>
                {pct !== null && (
                  <div style={{ marginTop: 6 }}>
                    <Bar pct={pct} won={pct >= 1} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* The 10 Drew voice lines */}
      <div className="card">
        <div className="card-title">Drew's voice</div>
        {DREW_LINES.map((l) => (
          <div key={l.id} style={{ marginBottom: 12 }}>
            <div className="faint" style={{ fontSize: '0.72rem', marginBottom: 4 }}>{l.trigger}</div>
            <div className="drew-line">{l.line}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
