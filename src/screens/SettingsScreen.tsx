import { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { exportAll, downloadBackup, importAll, parseBackup } from '../lib/backup';
import { defaultBarFor, defaultPlatesFor } from '../lib/plateMath';
import type { Unit, XpConstants } from '../types';

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const reloadAll = useStore((s) => s.reloadAll);
  const exercises = useStore((s) => s.exercises);
  const tracks = useStore((s) => s.tracks);
  const updateExercise = useStore((s) => s.updateExercise);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  if (!settings) return null;

  const setUnit = async (unit: Unit) => {
    // Switching units resets bar + plate inventory to that unit's defaults so we
    // never silently mix units.
    await update({ unit, barWeight: defaultBarFor(unit), plateInventory: defaultPlatesFor(unit) });
  };

  const setConst = async (key: keyof XpConstants, value: number) => {
    await update({ xpConstants: { ...settings.xpConstants, [key]: value } });
  };

  const doExport = async () => {
    const bundle = await exportAll();
    downloadBackup(bundle);
    await update({ lastBackupDate: new Date().toISOString().slice(0, 10) });
    setStatus('Backup downloaded.');
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = parseBackup(text);
      await importAll(bundle);
      await reloadAll();
      setStatus('Backup restored.');
    } catch (e) {
      setStatus('Import failed: ' + (e as Error).message);
    }
  };

  return (
    <div>
      <h1>Settings</h1>

      <div className="banner" style={{ marginBottom: 14 }}>
        📱 <strong>Install on iPhone (iOS):</strong> open in Safari → tap Share → “Add to Home
        Screen”. iOS doesn't show an automatic install prompt. On Android/Chrome, use the
        “Install app” prompt or the browser menu → “Add to Home screen”.
      </div>

      <h2>Units & equipment</h2>
      <div className="card">
        <label className="field">
          <span className="lbl">Unit</span>
          <div className="row">
            <button className={settings.unit === 'lb' ? 'primary pill' : 'pill'} onClick={() => void setUnit('lb')}>
              lb
            </button>
            <button className={settings.unit === 'kg' ? 'primary pill' : 'pill'} onClick={() => void setUnit('kg')}>
              kg
            </button>
          </div>
        </label>
        <label className="field">
          <span className="lbl">Default bar weight ({settings.unit})</span>
          <input
            type="number"
            value={settings.barWeight}
            onChange={(e) => void update({ barWeight: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="field">
          <span className="lbl">Plate inventory ({settings.unit}, comma-separated)</span>
          <input
            defaultValue={settings.plateInventory.join(', ')}
            onBlur={(e) =>
              void update({
                plateInventory: e.target.value
                  .split(',')
                  .map((x) => Number(x.trim()))
                  .filter((x) => Number.isFinite(x) && x > 0),
              })
            }
          />
        </label>
      </div>

      <h2>Training</h2>
      <div className="card">
        <label className="field">
          <span className="lbl">Weekly session target</span>
          <input
            type="number"
            value={settings.weeklyTarget}
            onChange={(e) => void update({ weeklyTarget: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="field">
          <span className="lbl">Default rest timer (seconds)</span>
          <input
            type="number"
            value={settings.restTimerDefault}
            onChange={(e) => void update({ restTimerDefault: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="field">
          <span className="lbl">Reward-fading phase</span>
          <select
            value={settings.fadePhaseMode}
            onChange={(e) => void update({ fadePhaseMode: e.target.value as never })}
          >
            <option value="auto">Auto (schedule by active days)</option>
            <option value="bootstrap">Bootstrap (reward every set)</option>
            <option value="sustain">Sustain (thin base reward)</option>
            <option value="fade">Fade (intrinsic framing)</option>
          </select>
        </label>
      </div>

      <h2>Feedback</h2>
      <div className="card">
        <Toggle label="Sound" value={settings.soundEnabled} onChange={(v) => void update({ soundEnabled: v })} />
        <Toggle label="Haptic (vibrate)" value={settings.hapticEnabled} onChange={(v) => void update({ hapticEnabled: v })} />
        <Toggle
          label="Weekly backup reminder"
          value={settings.reminderEnabled}
          onChange={(v) => void update({ reminderEnabled: v })}
        />
      </div>

      <h2>XP formula (tunable defaults)</h2>
      <div className="card">
        <p className="small muted">
          Neutral defaults — tune to taste. setXP = round(BASE_SET_XP + volume / VOLUME_DIVISOR).
        </p>
        <NumField label="BASE_SET_XP" value={settings.xpConstants.BASE_SET_XP} onChange={(v) => void setConst('BASE_SET_XP', v)} />
        <NumField label="VOLUME_DIVISOR" value={settings.xpConstants.VOLUME_DIVISOR} onChange={(v) => void setConst('VOLUME_DIVISOR', v)} />
        <NumField label="PR_BONUS_XP" value={settings.xpConstants.PR_BONUS_XP} onChange={(v) => void setConst('PR_BONUS_XP', v)} />
        <NumField
          label="SURPRISE_PROBABILITY (0–1)"
          value={settings.xpConstants.SURPRISE_PROBABILITY}
          step={0.01}
          onChange={(v) => void setConst('SURPRISE_PROBABILITY', v)}
        />
        <NumField
          label="SURPRISE_MULTIPLIER"
          value={settings.xpConstants.SURPRISE_MULTIPLIER}
          step={0.1}
          onChange={(v) => void setConst('SURPRISE_MULTIPLIER', v)}
        />
      </div>

      <h2>Backup (local-first — this is your only copy)</h2>
      <div className="card">
        <p className="small muted">
          Data lives only on this device. Export regularly.
          {settings.lastBackupDate ? ` Last backup: ${settings.lastBackupDate}.` : ' No backup yet.'}
        </p>
        <button className="big" onClick={() => void doExport()}>
          ⬇️ Export all data (JSON)
        </button>
        <button className="big" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          ⬆️ Import backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        {status && <p className="small" style={{ color: 'var(--accent)' }}>{status}</p>}
      </div>

      <h2>Exercise catalog</h2>
      <div className="card">
        {exercises.map((ex) => (
          <div className="set-row" key={ex.id}>
            <span className="grow" style={{ opacity: ex.retired ? 0.4 : 1 }}>
              {ex.name} <span className="tag">{tracks.find((t) => t.id === ex.trackId)?.name}</span>
            </span>
            <button className="pill ghost" onClick={() => void updateExercise(ex.id!, { retired: !ex.retired })}>
              {ex.retired ? 'Restore' : 'Retire'}
            </button>
          </div>
        ))}
      </div>

      <p className="small muted center" style={{ marginTop: 20 }}>
        Lift Log · local-first · no account, no server, no tracking.
      </p>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row spread" style={{ padding: '8px 0' }}>
      <span>{label}</span>
      <button className={value ? 'primary pill' : 'pill'} onClick={() => onChange(!value)}>
        {value ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input type="number" step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
