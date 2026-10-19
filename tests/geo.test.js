import { describe, expect, it } from 'vitest';
import { bounds, haversineKm, projectLocal, rotateShape, sphericalMean, unwrapAround } from '../src/geo.js';

describe('haversineKm', () => {
  it('matches known distances', () => {
    // Madrid to Buenos Aires is about 10,040 km
    expect(haversineKm([-3.7038, 40.4168], [-58.3816, -34.6037])).toBeGreaterThan(10000);
    expect(haversineKm([-3.7038, 40.4168], [-58.3816, -34.6037])).toBeLessThan(10100);
    expect(haversineKm([0, 0], [0, 1])).toBeCloseTo(111.19, 1);
    expect(haversineKm([179.5, 0], [-179.5, 0])).toBeCloseTo(111.19, 1);
  });
});

describe('rotateShape', () => {
  const ring = [[10, 50], [14, 50], [14, 53], [10, 53], [10, 50]];
  const center = [12, 51.5];

  it('moves the anchor onto the target', () => {
    const [moved] = rotateShape([center], center, [-60, -10]);
    expect(moved[0]).toBeCloseTo(-60, 6);
    expect(moved[1]).toBeCloseTo(-10, 6);
  });

  it('preserves every pairwise great-circle distance', () => {
    for (const target of [[-60, -10], [150, 70], [-168, 0], [12 - 180, -51.5]]) {
      const moved = rotateShape(ring, center, target);
      for (let i = 0; i < ring.length - 1; i++) {
        expect(haversineKm(moved[i], moved[i + 1])).toBeCloseTo(haversineKm(ring[i], ring[i + 1]), 6);
        expect(haversineKm(moved[i], target)).toBeCloseTo(haversineKm(ring[i], center), 6);
      }
    }
  });

  it('keeps nesting depth for multipolygons', () => {
    const moved = rotateShape([[ring]], center, [0, 0]);
    expect(moved).toHaveLength(1);
    expect(moved[0][0]).toHaveLength(ring.length);
  });
});

describe('projectLocal / bounds / sphericalMean', () => {
  it('projects the center to the origin and keeps north up', () => {
    const [c, n] = projectLocal([[20, 10], [20, 11]], [20, 10]);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    expect(n[0]).toBeCloseTo(0);
    expect(n[1]).toBeCloseTo(111.19, 0);
  });

  it('computes nested bounds', () => {
    expect(bounds([[[1, 2], [3, -4]], [[-5, 6]]])).toEqual([[-5, -4], [3, 6]]);
  });

  it('averages across the antimeridian', () => {
    const [lon, lat] = sphericalMean([[179, 0], [-179, 0]]);
    expect(Math.abs(lon)).toBeCloseTo(180, 6);
    expect(lat).toBeCloseTo(0, 6);
  });
});

describe('unwrapAround', () => {
  it('keeps a shape near the date line contiguous', () => {
    const out = unwrapAround([[179, 0], [-179, 1], [178, 2]], 179);
    expect(out).toEqual([[179, 0], [181, 1], [178, 2]]);
    expect(unwrapAround([[-179, 0]], -170)).toEqual([[-179, 0]]);
    expect(unwrapAround([[170, 5]], -175)[0][0]).toBeCloseTo(-190);
  });
});
