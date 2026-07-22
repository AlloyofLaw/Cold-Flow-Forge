import { useRef, useState } from 'react'
import { useStore } from '../store/store'
import type { TargetSet, TrackPhase } from '../db/types'
import { daysSince } from '../lib/dates'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TARGET_FIELDS: { key: keyof TargetSet; label: string; group: string }[] = [
  { key: 'weightTargetLow', label: 'Weight target low (lb)', group: 'Health' },
  { key: 'weightTargetHigh', label: 'Weight target high (lb)', group: 'Health' },
  { key: 'bodyfatTargetPct', label: 'Body-fat target (%)', group: 'Health' },
  { key: 'stepsTarget', label: 'Steps target', group: 'Health' },
  { key: 'trainingDaysPerWeek', label: 'Training days / week', group: 'Health' },
  { key: 'proteinTarget', label: 'Protein target (g)', group: 'Health' },
  { key: 'caffeineCapMg', label: 'Caffeine cap (mg)', group: 'Health' },
  { key: 'junkExceptionsTarget', label: 'Junk exceptions target', group: 'Health' },
  { key: 'eatingOutExceptionsTarget', label: 'Eating-out exceptions target', group: 'Health' },
  { key: 'netWorthTarget', label: 'Net worth target ($)', group: 'Wealth' },
  { key: 'cffRevenueTarget', label: 'CFF revenue target ($/mo)', group: 'Wealth' },
  { key: 'cffClientsTarget', label: 'CFF clients target', group: 'Wealth' },
  { key: 'masterNumber', label: 'Master Number ($/mo)', group: 'Wealth' },
  { key: 'masterNumberMonths', label: 'Master Number months', group: 'Wealth' },
  { key: 'salesMinsTarget', label: 'Sales drill target (min/day)', group: 'Wealth' },
  { key: 'deepWorkWeeklyTarget', label: 'Deep work target (hr/wk)', group: 'Wealth' },
  { key: 'overtimeCapMins', label: '9-5 overtime cap (min)', group: 'Wealth' },
  { key: 'givingCurrent', label: 'Giving ($/mo)', group: 'Relationships' },
]

export function Settings() {
  const settings = useStore((s) => s.settings)!
  const update = useStore((s) => s.updateSettings)
  const exportJSON = useStore((s) => s.exportJSON)
  const importJSON = useStore((s) => s.importJSON)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')

  const setTarget = (key: keyof TargetSet, v: number) =>
    update({ targets: { ...settings.targets, [key]: v } })

  const setTimeTarget = (
    key: 'bedtimeTarget' | 'wakeTargetEarly' | 'wakeTargetLate',
    v: string,
  ) => update({ targets: { ...settings.targets, [key]: v } })

  const setAnchor = (key: keyof typeof settings.anchors, v: string) =>
    update({ anchors: { ...settings.anchors, [key]: v } })

  const doExport = async () => {
    const json = await exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beat-drew-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    try {
      const text = await file.text()
      await importJSON(text)
      setImportMsg('Import complete — data restored.')
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`)
    }
  }

  const backupStale =
    !settings.lastBackupAt || daysSince(settings.lastBackupAt) >= 7

  const groups = ['Health', 'Wealth', 'Relationships']

  return (
    <div>
      <h1 style={{ marginBottom: 14 }}>Settings</h1>

      {backupStale && (
        <div className="banner-note">
          Local-first means data lives only on this device. Back up to JSON weekly →
        </div>
      )}

      {/* Backup / restore — critical for local-first. */}
      <div className="card">
        <div className="card-title">Backup & restore</div>
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
          All data lives in this browser's IndexedDB. Export to a JSON file to keep it safe; import to restore on any device.
        </p>
        <div className="grid-2">
          <button className="btn btn-primary" onClick={doExport}>
            Export JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
        {importMsg && <p className="faint" style={{ marginTop: 10, fontSize: '0.82rem' }}>{importMsg}</p>}
        {settings.lastBackupAt && (
          <p className="faint" style={{ marginTop: 8, fontSize: '0.72rem' }}>
            Last backup: {daysSince(settings.lastBackupAt)} days ago
          </p>
        )}
      </div>

      {/* Reward-fading phase */}
      <div className="card">
        <div className="card-title">Reward fading · Bootstrap → Sustain → Fade</div>
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
          Extrinsic points taper over weeks so the behavior transfers to intrinsic motivation. Auto follows each track's age.
        </p>
        <select
          value={settings.fadePhase}
          onChange={(e) => update({ fadePhase: e.target.value as TrackPhase | 'auto' })}
        >
          <option value="auto">Auto (recommended)</option>
          <option value="bootstrap">Force Bootstrap</option>
          <option value="sustain">Force Sustain</option>
          <option value="fade">Force Fade</option>
        </select>
      </div>

      {/* Rest day */}
      <div className="card">
        <div className="card-title">Rest day</div>
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 10 }}>
          On the rest day, training auto-excludes so the day can still be won.
        </p>
        <select value={settings.restDay} onChange={(e) => update({ restDay: Number(e.target.value) })}>
          {DAY_NAMES.map((d, i) => (
            <option key={d} value={i}>{d}</option>
          ))}
        </select>
      </div>

      {/* Toggles */}
      <div className="card">
        <div className="card-title">Feedback & reminder</div>
        {([
          ['sound', 'Sound on log'],
          ['haptics', 'Haptic on log'],
          ['eveningReminder', 'Evening confrontation reminder'],
        ] as const).map(([key, label]) => (
          <div className="switch" key={key}>
            <span>{label}</span>
            <button
              className={`toggle${settings.toggles[key] ? ' on' : ''}`}
              aria-label={`Toggle ${label}`}
              onClick={() => update({ toggles: { ...settings.toggles, [key]: !settings.toggles[key] } })}
            />
          </div>
        ))}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Reminder time (the only reminder in the app)</label>
          <input
            type="time"
            value={settings.toggles.eveningReminderTime}
            onChange={(e) => update({ toggles: { ...settings.toggles, eveningReminderTime: e.target.value } })}
          />
        </div>
      </div>

      {/* Schedule anchors */}
      <div className="card">
        <div className="card-title">Schedule anchors</div>
        {([
          ['trainWindow', 'Training window'],
          ['deepWorkWeekday', 'Deep work (weekday)'],
          ['deepWorkWeekend', 'Deep work (weekend)'],
          ['familyDinner', 'Family dinner'],
          ['familyPrayer', 'Family prayer'],
          ['familyChurch', 'Church'],
        ] as const).map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input value={settings.anchors[key]} onChange={(e) => setAnchor(key, e.target.value)} />
          </div>
        ))}
        <div className="field">
          <label>Sleep bedtime / wake targets</label>
          <div className="row">
            <input
              type="time"
              value={settings.targets.bedtimeTarget}
              onChange={(e) => setTimeTarget('bedtimeTarget', e.target.value)}
            />
            <input
              type="time"
              value={settings.targets.wakeTargetEarly}
              onChange={(e) => setTimeTarget('wakeTargetEarly', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Targets / baselines */}
      {groups.map((g) => (
        <div className="card" key={g}>
          <div className="card-title">{g} targets</div>
          {TARGET_FIELDS.filter((f) => f.group === g).map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input
                type="number"
                inputMode="decimal"
                value={settings.targets[f.key] as number}
                onChange={(e) => setTarget(f.key, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      ))}

      <p className="faint" style={{ fontSize: '0.72rem', textAlign: 'center', marginTop: 8 }}>
        Beat Drew · local-first · no accounts · no backend · no analytics
      </p>
    </div>
  )
}
