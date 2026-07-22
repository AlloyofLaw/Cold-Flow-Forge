// Local-timezone date helpers. All dates in the app are YYYY-MM-DD strings in
// the device's own timezone (never UTC — a "day" is Andrew's local day).
import type { ISODate } from '../db/types'

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 0=Sun ... 6=Sat for an ISO date. */
export function dayOfWeek(s: ISODate): number {
  return parseISO(s).getDay()
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** Whole days clean since a timestamp (ms), floored at 0. */
export function daysSince(ms: number): number {
  const start = new Date(ms)
  const startISO = toISODate(start)
  return Math.max(0, daysBetween(startISO, todayISO()))
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7)
}

/** ISO week key (YYYY-Www) using local Monday-based weeks. */
export function weekKey(s: ISODate): string {
  const d = parseISO(s)
  const day = (d.getDay() + 6) % 7 // Mon=0
  d.setDate(d.getDate() - day + 3) // nearest Thursday
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7,
    )
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Start (Mon) ISO date of the week containing s. */
export function weekStart(s: ISODate): ISODate {
  const day = (dayOfWeek(s) + 6) % 7 // Mon=0
  return addDays(s, -day)
}
