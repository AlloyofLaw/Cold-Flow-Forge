// Read-only derivations over logged metrics for the Progress/Reckoning charts.
import type { MetricRecord, MetricType, ISODate } from '../db/types'
import { monthKey, weekStart } from './dates'

export interface Point {
  date: ISODate
  value: number
}

/** Time series (sorted) for a metric type. */
export function series(metrics: MetricRecord[], type: MetricType): Point[] {
  return metrics
    .filter((m) => m.type === type)
    .map((m) => ({ date: m.date, value: m.value }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Latest logged value for a metric, or undefined. */
export function latest(metrics: MetricRecord[], type: MetricType): number | undefined {
  const s = series(metrics, type)
  return s.length ? s[s.length - 1].value : undefined
}

/** Sum of a metric over the ISO week containing `date` (e.g. deep-work hrs). */
export function weekTotal(
  metrics: MetricRecord[],
  type: MetricType,
  date: ISODate,
): number {
  const start = weekStart(date)
  return metrics
    .filter((m) => m.type === type && m.date >= start && m.date <= date)
    .reduce((s, m) => s + m.value, 0)
}

/** The last logged value of a metric per calendar month, oldest→newest. */
export function monthlyLatest(
  metrics: MetricRecord[],
  type: MetricType,
): { month: string; value: number }[] {
  const byMonth = new Map<string, { date: ISODate; value: number }>()
  for (const m of metrics.filter((x) => x.type === type)) {
    const key = monthKey(m.date)
    const cur = byMonth.get(key)
    if (!cur || m.date > cur.date) byMonth.set(key, { date: m.date, value: m.value })
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, value: v.value }))
}

/**
 * The MASTER NUMBER gauge: consecutive most-recent months at/above the target.
 * Returns the trailing consecutive count (capped for display at `need`).
 */
export function consecutiveMonthsAtLeast(
  metrics: MetricRecord[],
  type: MetricType,
  target: number,
): number {
  const months = monthlyLatest(metrics, type)
  let count = 0
  for (let i = months.length - 1; i >= 0; i--) {
    if (months[i].value >= target) count++
    else break
  }
  return count
}
