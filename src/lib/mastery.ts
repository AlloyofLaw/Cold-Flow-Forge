// Non-decaying Mastery Tracks — the healthiest mechanic, led with in the UI.
// Tracks level up as REAL actions/PRs are logged. They NEVER decay and are
// NEVER stripped. Levels are uncapped. Improvement is graded against Andrew's
// own past trajectory, not against merely showing up.
import type { TrackRecord } from '../db/types'

/**
 * XP required to reach a given level. Grows gently and without cap so there is
 * always a next level, but never a wall. Level 1 starts at 0 XP.
 *   level 1: 0, level 2: 100, level 3: 220, level 4: 360, ...
 * cost to go from L→L+1 is 100 + (L-1)*20.
 */
export function xpForLevel(level: number): number {
  let total = 0
  for (let l = 1; l < level; l++) total += 100 + (l - 1) * 20
  return total
}

export function levelForXp(xp: number): number {
  let level = 1
  while (xp >= xpForLevel(level + 1)) level++
  return level
}

export interface LevelProgress {
  level: number
  intoLevel: number
  levelSpan: number
  pct: number
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp)
  const base = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const span = next - base
  const into = xp - base
  return { level, intoLevel: into, levelSpan: span, pct: Math.min(1, into / span) }
}

export interface AddXpResult {
  track: TrackRecord
  leveledUp: boolean
  fromLevel: number
  toLevel: number
}

/** Adds XP to a track (pure) and recomputes its uncapped level. */
export function addXp(track: TrackRecord, amount: number): AddXpResult {
  const fromLevel = track.level
  const xp = track.xp + Math.max(0, Math.round(amount))
  const toLevel = levelForXp(xp)
  return {
    track: { ...track, xp, level: toLevel },
    leveledUp: toLevel > fromLevel,
    fromLevel,
    toLevel,
  }
}
