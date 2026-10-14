import { describe, expect, it } from 'vitest';
import { parseCollectorNumber } from '../src/lib/collector';

describe('parseCollectorNumber on OCR-noisy strings', () => {
  const cases: Array<[string, string, number]> = [
    ['O25/l65', '25', 165],
    ['Charizard ex 125/I97 OBF EN', '125', 197],
    ['l25 / 197', '125', 197],
    ['HP 330 ... 2O1/165 ★', '201', 165],
    ['O84\\l98', '84', 198],
    ['TGO5/TG3O', 'TG05', 30],
    ['SS/1O2', '55', 102],
    ['4/1O2', '4', 102],
    ['Illus. 5ban Graphics 0B8/ZO3 EN', '88', 203],
    ['weakness x2  O6O /O78 ', '60', 78],
  ];
  it.each(cases)('%s -> %s/%i', (input, number, total) => {
    const r = parseCollectorNumber(input);
    expect(r).not.toBeNull();
    expect(r!.number).toBe(number);
    expect(r!.total).toBe(total);
  });

  it('returns null when there is no collector number', () => {
    expect(parseCollectorNumber('Charizard ex HP 330 Basic Pokémon')).toBeNull();
    expect(parseCollectorNumber('Is/Is and Bolt/Spark')).toBeNull();
    expect(parseCollectorNumber('damage 1/2 of')).toBeNull();
  });

  it('prefers a clean zero-padded reading over a noisy one', () => {
    expect(parseCollectorNumber('SS/Bl  025/165')!.number).toBe('25');
  });
});
