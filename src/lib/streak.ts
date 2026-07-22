// Streak computation with gentle loss aversion. A missed day spends a freeze
// token (if banked) and is treated as protected — it does NOT reset the streak.
// If no freeze is available the streak simply pauses at its current length; it
// is never wiped, and mastery is never touched. There are no punitive resets.
import type { DayRecord, ISODate } from '../db/types'
import { addDays, todayISO } from './dates'

export interface StreakInfo {
  current: number
  best: number
  /** Days until the most recent freeze protection "runs out" (soft nudge). */
  atRiskSoon: boolean
}

/**
 * Current streak = consecutive days up to today that were either WON or FROZEN.
 * A day that is 'lost' or missing-and-unfrozen ends the current run (pauses it),
 * but we never subtract earned progress or zero anything out.
 */
export function computeStreak(days: DayRecord[]): StreakInfo {
  const byDate = new Map<ISODate, DayRecord>()
  for (const d of days) byDate.set(d.date, d)

  const isKept = (d?: DayRecord) => !!d && (d.won || d.frozen)

  // current run walking backward from today
  let current = 0
  let cursor = todayISO()
  // today itself may still be "not yet" — don't penalize an in-progress day.
  if (!isKept(byDate.get(cursor))) cursor = addDays(cursor, -1)
  while (isKept(byDate.get(cursor))) {
    current++
    cursor = addDays(cursor, -1)
  }

  // best run across all recorded history
  const sorted = [...byDate.keys()].sort()
  let best = 0
  let run = 0
  let prev: ISODate | null = null
  for (const date of sorted) {
    if (!isKept(byDate.get(date))) {
      run = 0
      prev = date
      continue
    }
    run = prev && addDays(prev, 1) === date ? run + 1 : 1
    best = Math.max(best, run)
    prev = date
  }
  best = Math.max(best, current)

  // Soft "one day from a freeze running out" nudge: today not yet kept and the
  // last kept day was frozen (a freeze is currently shielding the run).
  const yesterday = byDate.get(addDays(todayISO(), -1))
  const atRiskSoon = !isKept(byDate.get(todayISO())) && !!yesterday?.frozen

  return { current, best, atRiskSoon }
}
