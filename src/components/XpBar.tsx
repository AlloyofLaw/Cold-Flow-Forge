interface Props {
  value: number;
  max: number;
}

export function XpBar({ value, max }: Props) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="xpbar" aria-label={`${value} of ${max} XP`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
