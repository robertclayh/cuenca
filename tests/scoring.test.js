import { describe, expect, it } from 'vitest';
import { citiesScore, citiesTarget, distanceScore, planformScore, ROUND_MAX } from '../src/scoring.js';

describe('scoring', () => {
  it('planform rewards correct answers and speed', () => {
    expect(planformScore(false, 1)).toBe(0);
    expect(planformScore(true, 0)).toBe(3000);
    expect(planformScore(true, 1)).toBe(ROUND_MAX);
    expect(planformScore(true, 0.5)).toBe(4000);
    expect(planformScore(true, 7)).toBe(ROUND_MAX);
  });

  it('distance score is full near the target and decays monotonically', () => {
    expect(distanceScore(0)).toBe(ROUND_MAX);
    expect(distanceScore(25)).toBe(ROUND_MAX);
    expect(distanceScore(1025)).toBe(Math.round(ROUND_MAX / Math.E));
    let prev = ROUND_MAX;
    for (let km = 0; km < 20000; km += 250) {
      const s = distanceScore(km);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(distanceScore(20000)).toBe(0);
    expect(distanceScore(NaN)).toBe(0);
  });

  it('cities score scales to at most five targets', () => {
    expect(citiesTarget(14)).toBe(5);
    expect(citiesTarget(3)).toBe(3);
    expect(citiesScore(0, 10)).toBe(0);
    expect(citiesScore(2, 10)).toBe(2000);
    expect(citiesScore(7, 10)).toBe(ROUND_MAX);
    expect(citiesScore(3, 3)).toBe(ROUND_MAX);
    expect(citiesScore(0, 0)).toBe(0);
  });
});
