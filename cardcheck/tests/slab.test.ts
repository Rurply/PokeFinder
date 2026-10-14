import { describe, expect, it } from 'vitest';
import { parseSlab } from '../src/lib/slab';

describe('parseSlab', () => {
  it('reads a PSA label', () => {
    const s = parseSlab('2023 POKEMON OBF EN-OBSIDIAN FLAMES #125\nCHARIZARD EX\nGEM MT 10\n8765432l PSA');
    expect(s.isSlab).toBe(true);
    expect(s.grade).toBe('10');
    expect(s.gradeLabel).toBe('GEM MT');
    expect(s.cert).toBe('87654321');
    expect(s.number).toBe('125');
    expect(s.name).toBe('CHARIZARD EX');
    expect(s.year).toBe('2023');
  });
  it('handles OCR noise in the grade', () => {
    const s = parseSlab('1999 POKEMON GAME #4 CHARIZARD-HOLO NM-MT 8 12345678');
    expect(s.grade).toBe('8');
    expect(s.gradeLabel).toBe('NM-MT');
    expect(parseSlab('GEM MT 1O  PSA').grade).toBe('10');
  });
  it('does not flag a raw card as a slab', () => {
    expect(parseSlab('Charizard ex HP 330 125/197').isSlab).toBe(false);
  });
});

describe('parseSlab grade wording', () => {
  it('trusts the label wording when the number is split off or misread', () => {
    const s = parseSlab('2022 POKEMON JPN. SV P #01\nPIKACHU\nGEM MT\n\n3 AA\n10\n16802855');
    expect(s.grade).toBe('10');
    expect(s.gradeLabel).toBe('GEM MT');
    expect(s.cert).toBe('16802855');
  });
});
