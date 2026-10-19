// Procedural round generation: every game is a pure function of (data, seed, mode).

import { createRng } from './rng.js';

export const MODES = ['planform', 'basin', 'cities'];
export const ROUND_SECONDS = { planform: 15, basin: 20, cities: 25 };
export const PRACTICE_ROUNDS = 5;
export const OPTION_COUNT = 4;

export function eligible(mode, river) {
  if (mode === 'planform') return river.line?.length >= 8;
  if (mode === 'basin') return Boolean(river.basin?.length && river.basinCentroid);
  if (mode === 'cities') return river.cities?.length >= 3;
  return false;
}

/** Three distractors: two from the same continent where possible, one from anywhere. */
export function pickOptions(rng, answer, rivers, count = OPTION_COUNT) {
  const others = rng.shuffle(rivers.filter((r) => r.id !== answer.id && eligible('planform', r)));
  const near = others.filter((r) => r.continent === answer.continent);
  const far = others.filter((r) => r.continent !== answer.continent);
  const chosen = [...near.slice(0, count - 2), ...far.slice(0, 1)];
  for (const r of others) {
    if (chosen.length >= count - 1) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  return rng.shuffle([answer, ...chosen.slice(0, count - 1)]).map((r) => r.id);
}

/**
 * mode 'mix' plays one round of each mode in a seeded order (the under-a-minute
 * game); a single mode plays PRACTICE_ROUNDS of it. No river repeats in a game.
 */
export function buildGame(rivers, seed, mode = 'mix') {
  const rng = createRng(`${seed}:${mode}`);
  const modes = mode === 'mix' ? rng.shuffle(MODES) : Array(PRACTICE_ROUNDS).fill(mode);
  const used = new Set();
  const rounds = [];
  for (const m of modes) {
    const pool = rivers.filter((r) => eligible(m, r) && !used.has(r.id));
    if (!pool.length) continue;
    const river = rng.pick(pool);
    used.add(river.id);
    const round = { mode: m, riverId: river.id, seconds: ROUND_SECONDS[m] };
    if (m === 'planform') round.options = pickOptions(rng, river, rivers);
    rounds.push(round);
  }
  return { seed, mode, rounds };
}
