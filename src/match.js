// Typed-answer matching for the cities round. fold() mirrors
// pipeline/build_data.py so names compare the same on both sides.

export function fold(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim();
}

export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function allowedTypos(key) {
  if (key.length >= 9) return 2;
  if (key.length >= 5) return 1;
  return 0;
}

const namesOf = (city) => [city.name, ...(city.names || [])];

/**
 * Find the city a guess refers to. Exact folded matches on any listed name
 * win; otherwise one typo is forgiven on 5+ letters, two on 9+.
 * Returns { city, exact } or null. Cities in `skip` (a Set of ids) are ignored.
 */
export function matchCity(guess, cities, skip = new Set()) {
  const key = fold(guess);
  if (!key) return null;
  const pool = cities.filter((c) => !skip.has(c.id));
  for (const city of pool) {
    if (namesOf(city).some((n) => fold(n) === key)) return { city, exact: true };
  }
  const max = allowedTypos(key);
  if (!max) return null;
  let best = null;
  for (const city of pool) {
    for (const name of namesOf(city)) {
      const d = levenshtein(fold(name), key, max);
      if (d <= max && (!best || d < best.d)) best = { city, d };
    }
  }
  return best && { city: best.city, exact: false };
}

/** True when the guess names a city already found (so the UI can say so). */
export function isRepeat(guess, cities, found) {
  const key = fold(guess);
  return cities.some((c) => found.has(c.id) && namesOf(c).some((n) => fold(n) === key));
}
