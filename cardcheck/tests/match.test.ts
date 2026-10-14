import { describe, expect, it } from 'vitest';
import { buildQueries, confidenceOf, parseManual, parseOcr, rankCards } from '../src/lib/match';
import type { Card } from '../src/lib/tcgapi';
import search from './fixtures/search-11-108.json';

// Real API results for number:11 set.printedTotal:108 (four different cards).
const cards = search.data as unknown as Card[];

describe('matching', () => {
  const parsed = parseOcr({ top: 'Charlzard HP 150', full: 'Charizard\nStage 2', bottom: 'Illus. 11/l08' });

  it('builds number+total query first', () => {
    expect(buildQueries(parsed)[0]).toBe('number:"11" set.printedTotal:108');
  });

  it('ranks the card whose name matches the OCR text first', () => {
    const ranked = rankCards(cards, parsed);
    expect(ranked[0].card.id).toBe('xy12-11');
    expect(confidenceOf(ranked)).toBe('high');
  });

  it('low confidence when the name cannot be read', () => {
    const blind = parseOcr({ top: '', full: '', bottom: '11/108' });
    expect(confidenceOf(rankCards(cards, blind))).toBe('low');
  });

  it('parses manual searches', () => {
    expect(parseManual('charizard ex 125/197')).toMatchObject({ collector: { number: '125', total: 197 }, names: ['charizard', 'ex'] });
    expect(parseManual('pikachu #25').collector!.number).toBe('25');
    expect(buildQueries(parseManual('charizard 4'))).toContain('number:"4" name:charizard*');
  });

  it('uses slab label data', () => {
    const p = parseOcr({ top: '2023 POKEMON OBF EN-OBSIDIAN FLAMES #125\nCHARIZARD EX\nGEM MT 10 87654321', full: '', bottom: '' });
    expect(p.slab.isSlab).toBe(true);
    expect(buildQueries(p)[0]).toBe('number:"125" name:charizard*');
  });
});
