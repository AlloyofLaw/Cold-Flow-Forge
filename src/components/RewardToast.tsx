import { useEffect } from 'react'
import { useStore } from '../store/store'

// Displays the reward "juice" for a real logged action. It auto-dismisses.
// This toast ONLY ever appears as a consequence of a logged action — it is
// wired to store.lastReward, which is set exclusively inside grantReward().
export function RewardToast() {
  const reward = useStore((s) => s.lastReward)
  const dismiss = useStore((s) => s.dismissReward)

  useEffect(() => {
    if (!reward) return
    const t = setTimeout(dismiss, reward.drewTip || reward.prHits ? 6000 : 3200)
    return () => clearTimeout(t)
  }, [reward, dismiss])

  if (!reward) return null
  return (
    <div className="toast-wrap">
      <div
        className={`toast${reward.surprise ? ' surprise' : ''}`}
        key={reward.nonce}
        onClick={dismiss}
      >
        <div className="row-between">
          <strong>{reward.surprise ? '⚡ Surprise bonus' : '✓ Logged'}</strong>
          <span className="pill accent">+{reward.xp} XP</span>
        </div>
        <p style={{ marginTop: 6, fontSize: '0.9rem' }}>{reward.message}</p>
        {reward.drewTip && (
          <p className="faint" style={{ marginTop: 6, fontSize: '0.82rem' }}>
            {reward.drewTip}
          </p>
        )}
      </div>
    </div>
  )
}
