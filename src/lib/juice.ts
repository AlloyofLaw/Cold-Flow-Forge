// Mechanic #7: immediate, multi-sensory feedback ("juice"). A satisfying,
// OPTIONAL sound + haptic on a real accomplishment. Kept deliberately light so
// the animation never becomes more rewarding than the act itself (guardrail).
// All of this fires only from a real logged action (see rewards/store).
import type { SettingsRecord } from '../db/types'

let audioCtx: AudioContext | null = null

function beep(freq: number, durationMs: number, delayMs = 0, gain = 0.05) {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (!Ctx) return
      audioCtx = new Ctx()
    }
    const ctx = audioCtx
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    g.gain.value = gain
    osc.connect(g)
    g.connect(ctx.destination)
    const start = ctx.currentTime + delayMs / 1000
    osc.start(start)
    g.gain.setValueAtTime(gain, start)
    g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000)
    osc.stop(start + durationMs / 1000)
  } catch {
    /* audio is best-effort and never blocks a log */
  }
}

export function playJuice(
  settings: SettingsRecord,
  kind: { surprise?: boolean; pr?: boolean } = {},
) {
  if (settings.toggles.haptics && 'vibrate' in navigator) {
    navigator.vibrate(kind.pr ? [12, 40, 24] : kind.surprise ? [10, 30, 10] : 14)
  }
  if (settings.toggles.sound) {
    if (kind.pr) {
      beep(523, 90)
      beep(659, 90, 90)
      beep(784, 140, 180)
    } else if (kind.surprise) {
      beep(587, 80)
      beep(880, 130, 80)
    } else {
      beep(660, 90)
    }
  }
}
