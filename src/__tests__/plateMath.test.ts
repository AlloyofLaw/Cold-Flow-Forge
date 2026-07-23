import { describe, it, expect } from 'vitest';
import { computeTotal, defaultBarFor, defaultPlatesFor } from '../lib/plateMath';

describe('plate math (plates -> total)', () => {
  it('45 lb bar + (1×45, 1×25, 1×10) per side = 205 lb', () => {
    const r = computeTotal(45, { 45: 1, 25: 1, 10: 1 });
    expect(r.perSide).toBe(80);
    expect(r.total).toBe(205); // 45 + 2×80
  });

  it('bar only = 45 lb', () => {
    expect(computeTotal(45, {}).total).toBe(45);
  });

  it('20 kg bar + 1×20 per side = 60 kg', () => {
    expect(computeTotal(20, { 20: 1 }).total).toBe(60);
  });

  it('bar weight of 0 (machine) works', () => {
    expect(computeTotal(0, { 25: 2 }).total).toBe(100); // 2×(2×25)
  });

  it('ignores zero / negative counts', () => {
    expect(computeTotal(45, { 45: 0, 25: -3 }).total).toBe(45);
  });

  it('unit defaults never mix', () => {
    expect(defaultBarFor('lb')).toBe(45);
    expect(defaultBarFor('kg')).toBe(20);
    expect(defaultPlatesFor('lb')).toEqual([45, 35, 25, 10, 5, 2.5]);
    expect(defaultPlatesFor('kg')).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
  });
});
