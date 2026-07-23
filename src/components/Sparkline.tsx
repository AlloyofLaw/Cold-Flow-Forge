interface Props {
  data: number[];
  height?: number;
  color?: string;
}

// Hand-rolled SVG sparkline — no chart library, keeps the bundle lean.
export function Sparkline({ data, height = 60, color = 'var(--accent)' }: Props) {
  if (data.length === 0) {
    return <div className="muted small">No data yet.</div>;
  }
  const w = 300;
  const h = height;
  const pad = 4;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (d - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r={3} fill={color} />}
    </svg>
  );
}
