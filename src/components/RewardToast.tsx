import { useEffect } from 'react';
import { useStore } from '../store/useStore';

// Immediate feedback ("juice") for a logged set. Celebrates the accomplishment,
// not the app-open — this only ever renders after a real logged set updates
// lastReward in the store. Optional sound respects the Settings toggle.
export function RewardToast() {
  const lastReward = useStore((s) => s.lastReward);
  const clear = useStore((s) => s.clearLastReward);
  const soundEnabled = useStore((s) => s.settings?.soundEnabled);

  useEffect(() => {
    if (!lastReward) return;
    if (soundEnabled) playBlip(lastReward.setReward.prBonus > 0);
    const t = setTimeout(clear, 3000);
    return () => clearTimeout(t);
  }, [lastReward, clear, soundEnabled]);

  if (!lastReward) return null;
  const r = lastReward.setReward;
  const isPr = r.prBonus > 0;
  const bits: string[] = [`+${r.baseXp} XP`];
  if (r.surpriseBonus > 0) bits.push(`surprise +${r.surpriseBonus}`);
  if (r.prBonus > 0) bits.push(`PR +${r.prBonus}`);

  return (
    <div className="toast-wrap">
      <div className={`toast ${isPr ? 'pr' : ''}`}>
        <strong>{isPr ? '🏆 New PR!' : '✓ Set logged'}</strong>{' '}
        <span>{bits.join(' · ')}</span>
        {lastReward.leveledUp && (
          <div className="small" style={{ color: 'var(--gold)' }}>
            {lastReward.trackName} reached Level {lastReward.newLevel}!
          </div>
        )}
      </div>
    </div>
  );
}

function playBlip(strong: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = strong ? 660 : 440;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.26);
  } catch {
    /* audio not available — silent */
  }
}
