export const ROUND_MAX = 5000;

/** Planform: right answer earns 3000 plus up to 2000 for speed. */
export function planformScore(correct, timeLeftFraction) {
  if (!correct) return 0;
  const f = Math.max(0, Math.min(1, timeLeftFraction));
  return Math.round(3000 + 2000 * f);
}

export const PERFECT_KM = 25;
export const FALLOFF_KM = 1000;

/** Watershed placement: full marks within 25 km, then exponential decay. */
export function distanceScore(km) {
  if (!Number.isFinite(km)) return 0;
  if (km <= PERFECT_KM) return ROUND_MAX;
  return Math.round(ROUND_MAX * Math.exp(-(km - PERFECT_KM) / FALLOFF_KM));
}

export const CITY_TARGET = 5;

export function citiesTarget(available) {
  return Math.min(CITY_TARGET, available);
}

/** Cities: an equal share of 5000 for each city found, up to the target. */
export function citiesScore(found, available) {
  const target = citiesTarget(available);
  if (target === 0) return 0;
  return Math.round((ROUND_MAX * Math.min(found, target)) / target);
}
