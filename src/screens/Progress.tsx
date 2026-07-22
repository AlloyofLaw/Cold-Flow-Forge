import { useMemo } from 'react'
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '../store/store'
import { Bar } from '../components/Bar'
import { levelProgress } from '../lib/mastery'
import { resolvePhase } from '../lib/rewards'
import {
  consecutiveMonthsAtLeast,
  latest,
  series,
  weekTotal,
} from '../lib/analytics'
import { todayISO } from '../lib/dates'
import type { MetricType } from '../db/types'

const PHASE_LABEL: Record<string, string> = {
  bootstrap: 'Bootstrap · rewarding every action',
  sustain: 'Sustain · thinning rewards, surprises lead',
  fade: 'Fade · intrinsic framing, points recede',
}

function Trend({
  data,
  target,
  color = '#e11d48',
  unit,
}: {
  data: { date: string; value: number }[]
  target?: number
  color?: string
  unit?: string
}) {
  if (data.length === 0) {
    return <p className="faint" style={{ fontSize: '0.82rem' }}>No data logged yet.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b6b74' }} tickFormatter={(d) => String(d).slice(5)} />
        <YAxis tick={{ fontSize: 10, fill: '#6b6b74' }} width={40} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#1a1a1e', border: '1px solid #2a2a31', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#a1a1aa' }}
          formatter={(v: number) => [`${v}${unit ? ' ' + unit : ''}`, '']}
        />
        {target !== undefined && (
          <ReferenceLine y={target} stroke="#22c55e" strokeDasharray="4 4" />
        )}
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function Progress() {
  const settings = useStore((s) => s.settings)!
  const tracks = useStore((s) => s.tracks)
  const metrics = useStore((s) => s.metrics)
  const prs = useStore((s) => s.prs)

  const now = Date.now()
  const metricSeries = (t: MetricType) => series(metrics, t)

  const masterCount = useMemo(
    () => consecutiveMonthsAtLeast(metrics, 'revenue', settings.targets.masterNumber),
    [metrics, settings.targets.masterNumber],
  )
  const deepWorkWeek = weekTotal(metrics, 'deepWorkHours', todayISO())

  const bestPRs = useMemo(() => {
    const map = new Map<string, { weight: number; reps: number; date: string }>()
    for (const p of prs) {
      const cur = map.get(p.exercise)
      const score = (w: number, r: number) => w * (1 + r / 30)
      if (!cur || score(p.weight, p.reps) > score(cur.weight, cur.reps)) {
        map.set(p.exercise, { weight: p.weight, reps: p.reps, date: p.date })
      }
    }
    return [...map.entries()]
  }, [prs])

  return (
    <div>
      <h1 style={{ marginBottom: 14 }}>Progress</h1>

      {/* Mastery Tracks — the healthiest mechanic, led with. Never decay. */}
      <div className="card">
        <div className="card-title">Mastery tracks · never decay, uncapped</div>
        {tracks.map((t) => {
          const lp = levelProgress(t.xp)
          const phase = resolvePhase(t, settings, now)
          return (
            <div key={t.id} style={{ marginBottom: 14 }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <strong>{t.name}</strong>
                <span className="pill accent">Lv {lp.level}</span>
              </div>
              <Bar pct={lp.pct} />
              <div className="row-between" style={{ marginTop: 4 }}>
                <span className="faint" style={{ fontSize: '0.72rem' }}>
                  {lp.intoLevel}/{lp.levelSpan} to Lv {lp.level + 1} · {t.domain}
                </span>
                <span className="faint" style={{ fontSize: '0.72rem' }}>{t.xp} XP</span>
              </div>
              <div className="faint" style={{ fontSize: '0.68rem', marginTop: 2 }}>
                {PHASE_LABEL[phase]}
              </div>
            </div>
          )
        })}
      </div>

      {/* Master Number gauge — the single biggest goal. */}
      <div className="card">
        <div className="card-title">The Master Number</div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              ${settings.targets.masterNumber.toLocaleString()}/mo × {settings.targets.masterNumberMonths} months
            </div>
            <div className="faint" style={{ fontSize: '0.8rem' }}>
              Then: reveal CFF to Dad · give two weeks' notice
            </div>
          </div>
          <span className="stat-val">
            {Math.min(masterCount, settings.targets.masterNumberMonths)}/
            {settings.targets.masterNumberMonths}
          </span>
        </div>
        <Bar pct={masterCount / settings.targets.masterNumberMonths} won={masterCount >= settings.targets.masterNumberMonths} />
      </div>

      {/* Metric trend charts */}
      <div className="card">
        <div className="card-title">Bodyweight → {settings.targets.weightTargetLow}–{settings.targets.weightTargetHigh} lb</div>
        <Trend data={metricSeries('weight')} target={settings.targets.weightTargetLow} unit="lb" />
      </div>
      <div className="card">
        <div className="card-title">Steps → {settings.targets.stepsTarget.toLocaleString()}/day</div>
        <Trend data={metricSeries('steps')} target={settings.targets.stepsTarget} unit="steps" />
      </div>
      <div className="card">
        <div className="row-between">
          <div className="card-title" style={{ margin: 0 }}>Deep work this week vs {settings.targets.deepWorkWeeklyTarget}</div>
          <span className="pill accent">{deepWorkWeek.toFixed(1)} / {settings.targets.deepWorkWeeklyTarget} hr</span>
        </div>
        <Bar pct={deepWorkWeek / settings.targets.deepWorkWeeklyTarget} won={deepWorkWeek >= settings.targets.deepWorkWeeklyTarget} />
      </div>
      <div className="card">
        <div className="card-title">CFF revenue → ${settings.targets.cffRevenueTarget.toLocaleString()}/mo</div>
        <Trend data={metricSeries('revenue')} target={settings.targets.cffRevenueTarget} unit="USD" />
        <div className="faint" style={{ fontSize: '0.78rem', marginTop: 6 }}>
          Latest clients: {latest(metrics, 'clients') ?? 0} / {settings.targets.cffClientsTarget}
        </div>
      </div>
      <div className="card">
        <div className="card-title">Net worth → ${settings.targets.netWorthTarget.toLocaleString()}</div>
        <Trend data={metricSeries('netWorth')} target={settings.targets.netWorthTarget} unit="USD" />
      </div>

      {/* PR history */}
      <div className="card">
        <div className="card-title">Personal records</div>
        {bestPRs.length === 0 && <p className="faint" style={{ fontSize: '0.82rem' }}>No lifts logged yet.</p>}
        {bestPRs.map(([ex, pr]) => (
          <div className="row-between" key={ex} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{ex}</span>
            <span>
              <strong>{pr.weight}</strong> × {pr.reps}{' '}
              <span className="faint" style={{ fontSize: '0.72rem' }}>· Drew: {pr.weight + 5}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
