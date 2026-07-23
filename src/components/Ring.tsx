interface Props {
  filled: boolean;
  size?: number;
  label?: string;
}

// A single closable ring. Filled = a completed session for the week. Framed
// forward ("close the ring"), never as failure.
export function Ring({ filled, size = 44, label }: Props) {
  const r = size / 2 - 4;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring" role="img" aria-label={label}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={5} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={filled ? 0 : circ}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}
