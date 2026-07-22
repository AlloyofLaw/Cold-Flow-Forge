export function Bar({ pct, won }: { pct: number; won?: boolean }) {
  return (
    <div className={`bar${won ? ' won' : ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%` }} />
    </div>
  )
}
