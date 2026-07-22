import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { scoreDay, emptyFlags, applicableKeys } from './scoring'
import { computeStreak } from './streak'
import { detectPRs } from './workout'
import { rollReward } from './rewards'
import { addXp, levelForXp } from './mastery'
import { consecutiveMonthsAtLeast } from './analytics'
import { dayOfWeek, todayISO, addDays } from './dates'
import type { DayRecord, MetricRecord, NonNegotiableKey, TrackRecord } from '../db/types'

const REST_SUN = 0

function doneFlags(keys: NonNegotiableKey[]) {
  const f = emptyFlags()
  for (const k of keys) f[k] = 'done'
  return f
}

describe('day-won scoring', () => {
  it('a normal day needs all 7 non-negotiables', () => {
    // pick a non-rest weekday
    let date = todayISO()
    while (dayOfWeek(date) === REST_SUN) date = addDays(date, 1)
    const all = applicableKeys(date, REST_SUN)
    expect(all).toHaveLength(7)

    const won = scoreDay(doneFlags(all), date, REST_SUN)
    expect(won.won).toBe(true)
    expect(won.status).toBe('won')

    // 6 of 7 → not won
    const six = doneFlags(all.slice(0, 6))
    const notWon = scoreDay(six, date, REST_SUN)
    expect(notWon.won).toBe(false)
    expect(notWon.status).toBe('notyet')
    expect(notWon.doneCount).toBe(6)
  })

  it('rest day still wins without training', () => {
    // find a Sunday
    let date = todayISO()
    while (dayOfWeek(date) !== REST_SUN) date = addDays(date, 1)
    const keys = applicableKeys(date, REST_SUN)
    expect(keys).not.toContain('train')
    expect(keys).toHaveLength(6)

    const flags = doneFlags(keys) // train left as 'notyet'
    const s = scoreDay(flags, date, REST_SUN)
    expect(s.isRestDay).toBe(true)
    expect(s.won).toBe(true)
  })

  it('a hard break loses the day', () => {
    let date = todayISO()
    while (dayOfWeek(date) === REST_SUN) date = addDays(date, 1)
    const all = applicableKeys(date, REST_SUN)
    const flags = doneFlags(all)
    flags.noDistractions = 'broke'
    const s = scoreDay(flags, date, REST_SUN)
    expect(s.status).toBe('lost')
    expect(s.won).toBe(false)
  })
})

describe('streak with freezes (never punitive)', () => {
  it('a frozen missed day keeps the streak instead of resetting', () => {
    const t = todayISO()
    const days: DayRecord[] = [
      { date: addDays(t, -3), flags: emptyFlags(), status: 'won', won: true },
      { date: addDays(t, -2), flags: emptyFlags(), status: 'won', won: true },
      // missed day, protected by a freeze token:
      { date: addDays(t, -1), flags: emptyFlags(), status: 'notyet', won: false, frozen: true },
      { date: t, flags: emptyFlags(), status: 'won', won: true },
    ]
    const s = computeStreak(days)
    expect(s.current).toBe(4) // frozen day did NOT reset it
    expect(s.best).toBeGreaterThanOrEqual(4)
  })

  it('an unfrozen miss pauses but never zeroes earned best', () => {
    const t = todayISO()
    const days: DayRecord[] = [
      { date: addDays(t, -5), flags: emptyFlags(), status: 'won', won: true },
      { date: addDays(t, -4), flags: emptyFlags(), status: 'won', won: true },
      { date: addDays(t, -3), flags: emptyFlags(), status: 'notyet', won: false }, // miss, no freeze
      { date: t, flags: emptyFlags(), status: 'won', won: true },
    ]
    const s = computeStreak(days)
    expect(s.best).toBeGreaterThanOrEqual(2) // earned best preserved
    expect(s.current).toBe(1) // paused, not wiped
  })
})

describe('PR detection + Drew +5 lb', () => {
  it('detects a new best and puts Drew 5 lb ahead', () => {
    const hits = detectPRs(
      [{ name: 'Bench (flat)', sets: [{ weight: 155, reps: 3 }] }],
      [{ id: 1, exercise: 'Bench (flat)', weight: 145, reps: 1, date: '2026-01-01' }],
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].drewWeight).toBe(160)
    expect(hits[0].acknowledgment).toContain('160')
  })

  it('no PR when the lift does not beat the prior best', () => {
    const hits = detectPRs(
      [{ name: 'Bench (flat)', sets: [{ weight: 135, reps: 1 }] }],
      [{ id: 1, exercise: 'Bench (flat)', weight: 145, reps: 1, date: '2026-01-01' }],
    )
    expect(hits).toHaveLength(0)
  })
})

describe('mastery is non-decaying and uncapped', () => {
  it('adds XP and levels up without cap', () => {
    const track: TrackRecord = {
      id: 'strength',
      domain: 'Health',
      name: 'Strength',
      xp: 20,
      level: 1,
      phase: 'bootstrap',
      startedAt: 0,
    }
    const r = addXp(track, 200)
    expect(r.track.xp).toBe(220)
    expect(r.leveledUp).toBe(true)
    expect(r.track.level).toBeGreaterThan(1)
    // levels keep going — no cap
    expect(levelForXp(1_000_000)).toBeGreaterThan(50)
  })
})

describe('reward roll (variable, not flat)', () => {
  it('bootstrap always pays a base; surprise fires under the threshold', () => {
    const base = rollReward(30, 'bootstrap', () => 0.99) // no surprise
    expect(base.surprise).toBe(false)
    expect(base.baseXp).toBe(30)

    const surprise = rollReward(30, 'bootstrap', () => 0.01) // surprise fires
    expect(surprise.surprise).toBe(true)
    expect(surprise.totalXp).toBeGreaterThan(surprise.baseXp)
  })

  it('fade thins the base reward vs bootstrap', () => {
    const boot = rollReward(30, 'bootstrap', () => 0.99)
    const fade = rollReward(30, 'fade', () => 0.99)
    expect(fade.baseXp).toBeLessThan(boot.baseXp)
  })
})

describe('Master Number gauge', () => {
  it('counts trailing consecutive months at/above target', () => {
    const metrics: MetricRecord[] = [
      { date: '2026-01-31', type: 'revenue', value: 6200, unit: 'USD' },
      { date: '2026-02-28', type: 'revenue', value: 6500, unit: 'USD' },
      { date: '2026-03-31', type: 'revenue', value: 7000, unit: 'USD' },
    ]
    expect(consecutiveMonthsAtLeast(metrics, 'revenue', 6000)).toBe(3)

    const broken: MetricRecord[] = [
      { date: '2026-01-31', type: 'revenue', value: 6200, unit: 'USD' },
      { date: '2026-02-28', type: 'revenue', value: 5000, unit: 'USD' }, // dip breaks run
      { date: '2026-03-31', type: 'revenue', value: 7000, unit: 'USD' },
    ]
    expect(consecutiveMonthsAtLeast(broken, 'revenue', 6000)).toBe(1)
  })
})
