// Day-won scoring. A day is WON only if every *applicable* non-negotiable is
// done. On the rest day, Train auto-excludes so a rest day can still be won.
// Missing a day NEVER wipes a streak — see rewards.ts for the freeze logic.
import type {
  DayRecord,
  DayStatus,
  FlagState,
  ISODate,
  NonNegotiableKey,
} from '../db/types'
import { NON_NEGOTIABLES } from '../db/seed'
import { dayOfWeek } from './dates'

export const ALL_KEYS: NonNegotiableKey[] = NON_NEGOTIABLES.map((n) => n.key)

export function emptyFlags(): Record<NonNegotiableKey, FlagState> {
  return ALL_KEYS.reduce(
    (acc, k) => ((acc[k] = 'notyet'), acc),
    {} as Record<NonNegotiableKey, FlagState>,
  )
}

/** Which non-negotiables apply on this date (rest day excludes Train). */
export function applicableKeys(date: ISODate, restDay: number): NonNegotiableKey[] {
  const isRest = dayOfWeek(date) === restDay
  return ALL_KEYS.filter((k) => !(isRest && k === 'train'))
}

export interface DayScore {
  status: DayStatus
  won: boolean
  doneCount: number
  applicableCount: number
  /** Keys that are applicable but not yet done (for near-miss / rings). */
  remaining: NonNegotiableKey[]
  /** Keys explicitly broken today (drives the contextual Drew line). */
  broken: NonNegotiableKey[]
  isRestDay: boolean
}

/**
 * Scores a day. Rules:
 *  - Applicable, non-broken key must be 'done' to count.
 *  - Rest day: Train is not applicable, so its absence never breaks the day.
 *  - 'broke' on any applicable key => day is LOST (a hard break stands).
 *  - All applicable done => WON. Otherwise NOT YET.
 */
export function scoreDay(
  flags: Record<NonNegotiableKey, FlagState>,
  date: ISODate,
  restDay: number,
): DayScore {
  const keys = applicableKeys(date, restDay)
  const isRestDay = dayOfWeek(date) === restDay
  let doneCount = 0
  const remaining: NonNegotiableKey[] = []
  const broken: NonNegotiableKey[] = []

  for (const k of keys) {
    const state = flags[k]
    if (state === 'done') doneCount++
    else if (state === 'broke') broken.push(k)
    else remaining.push(k)
  }

  let status: DayStatus
  if (broken.length > 0) status = 'lost'
  else if (doneCount === keys.length) status = 'won'
  else status = 'notyet'

  return {
    status,
    won: status === 'won',
    doneCount,
    applicableCount: keys.length,
    remaining,
    broken,
    isRestDay,
  }
}

export function statusLabel(status: DayStatus): string {
  switch (status) {
    case 'won':
      return 'WON'
    case 'lost':
      return 'LOST TO DREW'
    default:
      return 'NOT YET'
  }
}

/** Builds a fresh DayRecord for a date with empty flags. */
export function blankDay(date: ISODate, restDay: number): DayRecord {
  const flags = emptyFlags()
  const s = scoreDay(flags, date, restDay)
  return { date, flags, status: s.status, won: s.won }
}
