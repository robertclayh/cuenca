import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng, isValidSeed } from '../src/rng.js';
import { buildGame, eligible, MODES, PRACTICE_ROUNDS, ROUND_SECONDS } from '../src/rounds.js';

const continents = ['af', 'eu', 'as', 'na', 'sa'];
const rivers = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  name: { en: `River ${i}`, es: `Río ${i}` },
  continent: continents[i % continents.length],
  line: Array.from({ length: 10 }, (_, k) => [i + k * 0.1, k * 0.1]),
  basin: i % 4 === 3 ? null : [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
  basinCentroid: i % 4 === 3 ? null : [0.5, 0.4],
  cities: i % 3 === 0 ? [] : [{ id: 1 }, { id: 2 }, { id: 3 }],
}));

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng('abc');
    const b = createRng('abc');
    const c = createRng('abd');
    const seqA = Array.from({ length: 5 }, a.next);
    expect(Array.from({ length: 5 }, b.next)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c.next)).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('shuffles without losing items', () => {
    const out = createRng(1).shuffle([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('validates seeds from URLs', () => {
    expect(isValidSeed('k3x9ab')).toBe(true);
    expect(isValidSeed('<script>')).toBe(false);
    expect(isValidSeed('')).toBe(false);
  });
});

describe('buildGame', () => {
  it('mix plays each mode once with distinct, eligible rivers', () => {
    const game = buildGame(rivers, 'seed1', 'mix');
    expect(game.rounds.map((r) => r.mode).sort()).toEqual([...MODES].sort());
    const ids = game.rounds.map((r) => r.riverId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const round of game.rounds) {
      const river = rivers.find((r) => r.id === round.riverId);
      expect(eligible(round.mode, river)).toBe(true);
      expect(round.seconds).toBe(ROUND_SECONDS[round.mode]);
    }
    expect(game.rounds.reduce((s, r) => s + r.seconds, 0)).toBeLessThanOrEqual(60);
  });

  it('is reproducible from the seed', () => {
    expect(buildGame(rivers, 'same', 'mix')).toEqual(buildGame(rivers, 'same', 'mix'));
    expect(buildGame(rivers, 'same', 'basin')).toEqual(buildGame(rivers, 'same', 'basin'));
  });

  it('planform options hold the answer plus three unique distractors', () => {
    for (let s = 0; s < 30; s++) {
      const game = buildGame(rivers, `p${s}`, 'planform');
      expect(game.rounds).toHaveLength(PRACTICE_ROUNDS);
      for (const round of game.rounds) {
        expect(round.options).toHaveLength(4);
        expect(new Set(round.options).size).toBe(4);
        expect(round.options).toContain(round.riverId);
      }
    }
  });

  it('prefers same-continent distractors', () => {
    const game = buildGame(rivers, 'cont', 'planform');
    for (const round of game.rounds) {
      const answer = rivers.find((r) => r.id === round.riverId);
      const same = round.options.filter((id) => id !== answer.id && rivers.find((r) => r.id === id).continent === answer.continent);
      expect(same.length).toBe(2);
    }
  });

  it('skips modes with no eligible rivers rather than failing', () => {
    const noCities = rivers.map((r) => ({ ...r, cities: [] }));
    const game = buildGame(noCities, 'x', 'mix');
    expect(game.rounds.map((r) => r.mode)).not.toContain('cities');
  });
});

const built = new URL('../public/data/rivers.json', import.meta.url);
describe.runIf(existsSync(built))('built dataset', () => {
  const data = JSON.parse(readFileSync(built, 'utf8'));
  it('can host a full game in every mode', () => {
    for (const mode of ['mix', ...MODES]) {
      const game = buildGame(data.rivers, 'data-check', mode);
      expect(game.rounds.length).toBe(mode === 'mix' ? 3 : PRACTICE_ROUNDS);
    }
  });
  it('has bilingual names and closed basin rings', () => {
    for (const r of data.rivers) {
      expect(r.name.en && r.name.es).toBeTruthy();
      for (const poly of r.basin || []) expect(poly[0][0]).toEqual(poly[0].at(-1));
    }
  });
});
