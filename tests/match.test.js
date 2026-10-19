import { describe, expect, it } from 'vitest';
import { fold, isRepeat, levenshtein, matchCity } from '../src/match.js';

const cities = [
  { id: 1, name: 'Köln', names: ['Köln', 'Koln', 'Cologne', 'Colonia'] },
  { id: 2, name: 'Düsseldorf', names: ['Düsseldorf', 'Dusseldorf'] },
  { id: 3, name: 'Bonn', names: ['Bonn'] },
  { id: 4, name: 'New Orleans', names: ['New Orleans', 'Nueva Orleans', 'La Nouvelle-Orléans'] },
];

describe('fold', () => {
  it('matches the pipeline rules', () => {
    expect(fold('São Paulo')).toBe('sao paulo');
    expect(fold('Köln-Ehrenfeld')).toBe('koln ehrenfeld');
    expect(fold("  St. John's ")).toBe('st john s');
    expect(fold('Straße')).toBe('strasse');
  });
});

describe('matchCity', () => {
  it('accepts any listed name, accent- and case-insensitively', () => {
    expect(matchCity('cologne', cities).city.id).toBe(1);
    expect(matchCity('COLONIA', cities)).toEqual({ city: cities[0], exact: true });
    expect(matchCity('dusseldorf', cities).city.id).toBe(2);
    expect(matchCity('nueva orleans', cities).city.id).toBe(4);
    expect(matchCity('la nouvelle orleans', cities).city.id).toBe(4);
  });

  it('forgives small typos only on longer names', () => {
    expect(matchCity('Dusseldorff', cities)).toEqual({ city: cities[1], exact: false });
    expect(matchCity('Bonm', cities)).toBeNull();
    expect(matchCity('Berlin', cities)).toBeNull();
  });

  it('skips cities already found and reports repeats', () => {
    const found = new Set([1]);
    expect(matchCity('Köln', cities, found)).toBeNull();
    expect(isRepeat('cologne', cities, found)).toBe(true);
    expect(isRepeat('bonn', cities, found)).toBe(false);
  });

  it('always accepts the official name even if the alternates list omits it', () => {
    expect(matchCity('Port 7', [{ id: 9, name: 'Port 7', names: [] }]).city.id).toBe(9);
  });

  it('ignores empty input', () => {
    expect(matchCity('  ', cities)).toBeNull();
    expect(matchCity('---', cities)).toBeNull();
  });
});

describe('levenshtein', () => {
  it('computes edit distance with an early exit', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abcdef', 'zzzzzz', 2)).toBe(3);
  });
});
