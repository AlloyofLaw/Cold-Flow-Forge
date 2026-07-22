// Workout / PR logic, including the "always 5 lb ahead" Drew mechanic.
// When Andrew logs a new best on a tracked lift, the app acknowledges it AND
// shows Drew already 5 lb beyond it. Forward pressure — never mockery.
import type { PrRecord, WorkoutExercise } from '../db/types'

/** A set's "strength score" — heavier and/or more reps beats a prior best. */
export function setScore(weight: number, reps: number): number {
  // Epley-style estimated 1RM; monotonic in both weight and reps.
  return weight * (1 + reps / 30)
}

export interface PrHit {
  exercise: string
  weight: number
  reps: number
  previousBest?: PrRecord
  /** Drew is always 5 lb ahead of Andrew's new best. */
  drewWeight: number
  acknowledgment: string
}

/**
 * Detects new PRs in a logged workout against existing PR history.
 * Returns one PrHit per exercise that beat its previous best.
 */
export function detectPRs(
  exercises: WorkoutExercise[],
  existingPRs: PrRecord[],
): PrHit[] {
  const bestByExercise = new Map<string, PrRecord>()
  for (const pr of existingPRs) {
    const cur = bestByExercise.get(pr.exercise)
    if (!cur || setScore(pr.weight, pr.reps) > setScore(cur.weight, cur.reps)) {
      bestByExercise.set(pr.exercise, pr)
    }
  }

  const hits: PrHit[] = []
  for (const ex of exercises) {
    let bestSet: { weight: number; reps: number } | null = null
    for (const s of ex.sets) {
      if (!bestSet || setScore(s.weight, s.reps) > setScore(bestSet.weight, bestSet.reps)) {
        bestSet = s
      }
    }
    if (!bestSet || bestSet.weight <= 0) continue
    const prev = bestByExercise.get(ex.name)
    const isPR = !prev || setScore(bestSet.weight, bestSet.reps) > setScore(prev.weight, prev.reps)
    if (isPR) {
      const drewWeight = bestSet.weight + 5
      hits.push({
        exercise: ex.name,
        weight: bestSet.weight,
        reps: bestSet.reps,
        previousBest: prev,
        drewWeight,
        acknowledgment: `New best on ${ex.name}: ${bestSet.weight}×${bestSet.reps}. Logged. Drew already put up ${drewWeight}×${bestSet.reps} this morning — close the 5.`,
      })
    }
  }
  return hits
}
