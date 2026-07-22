import { useState } from 'react'
import { useStore } from '../store/store'
import type { MetricType, WorkoutExercise } from '../db/types'
import { TRACKED_LIFTS } from '../db/seed'

interface MetricDef {
  type: MetricType
  label: string
  unit: string
  kind: 'number' | 'time'
  hint?: string
}

const METRICS: { group: string; items: MetricDef[] }[] = [
  {
    group: 'Health',
    items: [
      { type: 'weight', label: 'Bodyweight', unit: 'lb', kind: 'number' },
      { type: 'bodyfat', label: 'Body fat', unit: '%', kind: 'number', hint: 'optional' },
      { type: 'steps', label: 'Steps', unit: 'steps', kind: 'number' },
      { type: 'sleepBed', label: 'Bedtime', unit: 'min', kind: 'time' },
      { type: 'sleepWake', label: 'Wake time', unit: 'min', kind: 'time' },
      { type: 'protein', label: 'Protein', unit: 'g', kind: 'number' },
      { type: 'caffeine', label: 'Caffeine', unit: 'mg', kind: 'number' },
      { type: 'junkExceptions', label: 'Junk exceptions', unit: 'count', kind: 'number', hint: 'target 0' },
      { type: 'eatingOutExceptions', label: 'Eating-out exceptions', unit: 'count', kind: 'number', hint: 'target 0' },
    ],
  },
  {
    group: 'Wealth',
    items: [
      { type: 'deepWorkHours', label: 'Deep work today', unit: 'hr', kind: 'number' },
      { type: 'salesDrillMins', label: 'Sales drill', unit: 'min', kind: 'number', hint: 'target 60' },
      { type: 'warmReplies', label: 'Warm replies', unit: 'count', kind: 'number' },
      { type: 'warmRepliesHandledFast', label: 'Replies handled fast', unit: 'count', kind: 'number' },
      { type: 'revenue', label: 'CFF revenue (mo)', unit: 'USD', kind: 'number' },
      { type: 'clients', label: 'Clients', unit: 'count', kind: 'number' },
      { type: 'netWorth', label: 'Net worth', unit: 'USD', kind: 'number' },
      { type: 'monthlyNet', label: 'Monthly net', unit: 'USD', kind: 'number' },
      { type: 'overtimeMins', label: '9-5 overtime', unit: 'min', kind: 'number', hint: 'cap 45' },
    ],
  },
  {
    group: 'Relationships',
    items: [{ type: 'giving', label: 'Giving (mo)', unit: 'USD', kind: 'number' }],
  },
]

function timeToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number)
  return h * 60 + (m || 0)
}

function MetricInput({ def }: { def: MetricDef }) {
  const logMetric = useStore((s) => s.logMetric)
  const [val, setVal] = useState('')

  const submit = () => {
    if (val === '') return
    const value = def.kind === 'time' ? timeToMinutes(val) : Number(val)
    if (Number.isNaN(value)) return
    // Every submit here is a REAL logged action → rewarded in the store.
    void logMetric(def.type, value, def.unit)
    setVal('')
  }

  return (
    <div className="field">
      <label>
        {def.label} {def.hint && <span className="faint">· {def.hint}</span>}
      </label>
      <div className="row">
        <input
          type={def.kind === 'time' ? 'time' : 'number'}
          inputMode={def.kind === 'time' ? undefined : 'decimal'}
          value={val}
          placeholder={def.kind === 'time' ? undefined : def.unit}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn btn-primary" onClick={submit} style={{ flex: 'none' }}>
          Log
        </button>
      </div>
    </div>
  )
}

function WorkoutLogger() {
  const logWorkout = useStore((s) => s.logWorkout)
  const [split, setSplit] = useState('Push')
  const [rows, setRows] = useState<{ name: string; weight: string; reps: string }[]>([
    { name: '', weight: '', reps: '' },
  ])
  const [duration, setDuration] = useState('')

  const update = (i: number, k: 'name' | 'weight' | 'reps', v: string) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))
  }
  const addRow = () => setRows((r) => [...r, { name: '', weight: '', reps: '' }])

  const save = async () => {
    // Group same-named exercises into one WorkoutExercise with multiple sets.
    const map = new Map<string, WorkoutExercise>()
    for (const row of rows) {
      if (!row.name.trim() || !row.weight || !row.reps) continue
      const key = row.name.trim()
      if (!map.has(key)) map.set(key, { name: key, sets: [] })
      map.get(key)!.sets.push({ weight: Number(row.weight), reps: Number(row.reps) })
    }
    const exercises = [...map.values()]
    if (exercises.length === 0) return
    await logWorkout(split, exercises, duration ? Number(duration) : undefined)
    setRows([{ name: '', weight: '', reps: '' }])
    setDuration('')
  }

  return (
    <div className="card">
      <div className="card-title">Workout logger</div>
      <div className="field">
        <label>Split</label>
        <select value={split} onChange={(e) => setSplit(e.target.value)}>
          {['Push', 'Pull', 'Legs', 'Chest', 'Back', 'Shoulders', 'Arms', 'Full body'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {rows.map((row, i) => (
        <div className="row" key={i} style={{ marginBottom: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 2 }}>
            {i === 0 && <label className="faint" style={{ fontSize: '0.72rem' }}>Exercise</label>}
            <input
              list="tracked-lifts"
              placeholder="Exercise"
              value={row.name}
              onChange={(e) => update(i, 'name', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            {i === 0 && <label className="faint" style={{ fontSize: '0.72rem' }}>lb</label>}
            <input
              type="number"
              inputMode="decimal"
              placeholder="lb"
              value={row.weight}
              onChange={(e) => update(i, 'weight', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            {i === 0 && <label className="faint" style={{ fontSize: '0.72rem' }}>reps</label>}
            <input
              type="number"
              inputMode="numeric"
              placeholder="reps"
              value={row.reps}
              onChange={(e) => update(i, 'reps', e.target.value)}
            />
          </div>
        </div>
      ))}
      <datalist id="tracked-lifts">
        {TRACKED_LIFTS.map((l) => (
          <option key={l.exercise} value={l.exercise} />
        ))}
      </datalist>
      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn btn-ghost" onClick={addRow}>
          + Set
        </button>
        <input
          type="number"
          inputMode="numeric"
          placeholder="duration (min)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>
      <button className="btn btn-primary btn-block" onClick={save} style={{ marginTop: 12 }}>
        Save workout · detect PRs
      </button>
      <p className="faint" style={{ fontSize: '0.78rem', marginTop: 8 }}>
        A new best on a tracked lift is auto-detected — and Drew shows up five pounds ahead.
      </p>
    </div>
  )
}

export function Log() {
  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Log</h1>
      <p className="faint" style={{ marginBottom: 14, fontSize: '0.85rem' }}>
        Every entry here is a real action — and only real actions are rewarded.
      </p>

      <WorkoutLogger />

      {METRICS.map((grp) => (
        <div className="card" key={grp.group}>
          <div className="card-title">{grp.group} metrics</div>
          {grp.items.map((def) => (
            <MetricInput key={def.type} def={def} />
          ))}
        </div>
      ))}
    </div>
  )
}
