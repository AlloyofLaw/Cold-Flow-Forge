// Plate calculator math — plates -> total only.
// Direction is one-way by design: the user enters how many of each plate they
// loaded PER SIDE, and we compute the total on the bar. Never mixes units.
import type { Unit } from '../types';

export const LB_PLATES = [45, 35, 25, 10, 5, 2.5];
export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export const DEFAULT_BAR_LB = 45;
export const DEFAULT_BAR_KG = 20;

export function defaultPlatesFor(unit: Unit): number[] {
  return unit === 'kg' ? [...KG_PLATES] : [...LB_PLATES];
}

export function defaultBarFor(unit: Unit): number {
  return unit === 'kg' ? DEFAULT_BAR_KG : DEFAULT_BAR_LB;
}

export interface PlateBreakdown {
  barWeight: number;
  perSide: number; // sum of plate weight on ONE side
  total: number; // barWeight + 2 * perSide
}

/**
 * counts: map of plateWeight -> countPerSide.
 * total = barWeight + 2 * Σ(countPerSide_i × plateWeight_i)
 */
export function computeTotal(
  barWeight: number,
  counts: Record<number, number>,
): PlateBreakdown {
  let perSide = 0;
  for (const [plateStr, count] of Object.entries(counts)) {
    const plate = Number(plateStr);
    if (!Number.isFinite(plate) || !Number.isFinite(count) || count <= 0) continue;
    perSide += plate * count;
  }
  const total = barWeight + 2 * perSide;
  return { barWeight, perSide, total };
}
