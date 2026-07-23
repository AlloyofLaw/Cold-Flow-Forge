import { useMemo, useState } from 'react';
import { computeTotal } from '../lib/plateMath';
import { useStore } from '../store/useStore';

interface Props {
  onUseWeight?: (total: number) => void;
  compact?: boolean;
}

// Reusable plate calculator (plates -> total). Used both as the standalone
// screen and as the inline sheet during set entry. Never mixes units: it always
// works in the active settings unit with that unit's plate inventory and bar.
export function PlateCalculator({ onUseWeight, compact }: Props) {
  const settings = useStore((s) => s.settings);
  const [bar, setBar] = useState<number>(settings?.barWeight ?? 45);
  const [counts, setCounts] = useState<Record<number, number>>({});

  const unit = settings?.unit ?? 'lb';
  const plates = settings?.plateInventory ?? [45, 35, 25, 10, 5, 2.5];

  const breakdown = useMemo(() => computeTotal(bar, counts), [bar, counts]);

  const setCount = (plate: number, delta: number) => {
    setCounts((prev) => {
      const next = { ...prev };
      const v = Math.max(0, (prev[plate] ?? 0) + delta);
      if (v === 0) delete next[plate];
      else next[plate] = v;
      return next;
    });
  };

  const asymmetric = false; // per-side model is symmetric by construction

  return (
    <div>
      {!compact && (
        <label className="field">
          <span className="lbl">Bar weight ({unit})</span>
          <div className="row">
            <input
              type="number"
              inputMode="decimal"
              value={bar}
              onChange={(e) => setBar(Number(e.target.value) || 0)}
            />
            {[unit === 'kg' ? 20 : 45, unit === 'kg' ? 15 : 35, unit === 'kg' ? 10 : 15, 0].map((b) => (
              <button key={b} className="pill" onClick={() => setBar(b)}>
                {b}
              </button>
            ))}
          </div>
        </label>
      )}

      <p className="small muted">Tap to set how many of each plate you loaded PER SIDE.</p>
      <div className="plate-grid">
        {plates.map((p) => (
          <div className="plate-tile" key={p}>
            <span className="pw">{p}</span>
            <span className="cnt">{counts[p] ?? 0}</span>
            <div className="stepper">
              <button aria-label={`remove ${p}`} onClick={() => setCount(p, -1)}>
                −
              </button>
              <button aria-label={`add ${p}`} onClick={() => setCount(p, +1)}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card total-box" style={{ marginTop: 14 }}>
        <div className="small muted">
          Bar {breakdown.barWeight} {unit} + (per side {breakdown.perSide} {unit} × 2)
        </div>
        <div className="grand">
          {breakdown.total} <span className="small muted">{unit}</span>
        </div>
        {asymmetric && <div className="small muted">Per-side load is doubled.</div>}
        {onUseWeight && (
          <button className="primary big" style={{ marginTop: 10 }} onClick={() => onUseWeight(breakdown.total)}>
            Use this weight
          </button>
        )}
      </div>

      {Object.keys(counts).length > 0 && (
        <button className="ghost" onClick={() => setCounts({})}>
          Clear plates
        </button>
      )}
    </div>
  );
}
