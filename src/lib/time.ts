// Time helpers. The session timer is ALWAYS computed from stored timestamps
// (startedAt / accumulated pause), never from a ticking counter — so it stays
// correct across reload and backgrounding.

export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Elapsed ms of a session given its start, optional end, and accumulated paused
 * ms. Computed purely from timestamps so it survives reload/backgrounding.
 */
export function elapsedMs(
  startedAt: number,
  endedAt: number | undefined,
  pausedAccumMs: number,
  pausedSince: number | undefined,
  now: number = Date.now(),
): number {
  const end = endedAt ?? now;
  let paused = pausedAccumMs;
  if (pausedSince != null) paused += now - pausedSince;
  return Math.max(0, end - startedAt - paused);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
