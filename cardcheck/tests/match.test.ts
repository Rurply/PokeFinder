import { describe, expect, it } from 'vitest';
import { buildQueries, confidenceOf, nameClause, parseManual, parseOcr, rankCards, stripEvolvesFrom } from '../src/lib/match';
import { nameSimilarity } from '../src/lib/names';
import type { Card } from '../src/lib/tcgapi';
import search from './fixtures/search-11-108.json';

// Real API results for number:11 set.printedTotal:108 (four different cards).
const cards = search.data as unknown as Card[];

describe('matching', () => {
  const parsed = parseOcr({ top: 'Charlzard HP 150', full: 'Charizard\nStage 2', bottom: 'Illus. 11/l08' });

  it('builds number+total query first', () => {
    expect(buildQueries(parsed)[0].q).toBe('number:"11" set.printedTotal:108');
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
    expect(buildQueries(parseManual('charizard 4')).map((x) => x.q)).toContain('number:"4" name:*harizar*');
  });

  it('photo with lost slash: tallest word as name, set total as hint', () => {
    // Shape of real OCR output for an Italian Charizard 11/108 listing photo.
    const p = parseOcr({
      top: 'Si evolve da Charmeleon Metti Charizard sul Pokémon\nCharizard w.76 150 PS',
      full: 'Abilità: Bruciaenergia',
      bottom: '©2016 Pokémon 11108 + XX',
      words: [
        { text: 'evolve', conf: 92, h: 25, x: 0, y: 254, region: 'top' },
        { text: 'Charizard', conf: 85, h: 53, x: 300, y: 241, region: 'top' },
        { text: 'Pokémon.', conf: 71, h: 51, x: 400, y: 244, region: 'top' },
        { text: 'Charizard', conf: 82, h: 130, x: 488, y: 312, region: 'top' },
      ],
    });
    expect(p.names[0]).toBe('charizard');
    expect(p.totalHints).toEqual([108]);
    const qs = buildQueries(p);
    expect(qs.map((x) => x.q)).toContain('set.printedTotal:108 name:*harizar*');
    expect(qs).toContainEqual({ q: 'set.printedTotal:108', pageSize: 250 });
    const ranked = rankCards(cards, p);
    expect(ranked[0].card.id).toBe('xy12-11');
  });

  it('tolerates OCR errors at word edges and in the middle', () => {
    expect(nameClause('harizard')).toBe('name:*arizar*');
    expect(nameClause('mew')).toBe('name:mew*');
    expect(nameSimilarity('Charizard ex', 'STAGES harizard €X')).toBeGreaterThan(0.75);
    expect(nameSimilarity('Mew', 'Mev 1o')).toBe(0);
  });

  it('ignores the pre-evolution name in "Evolves from" text', () => {
    expect(stripEvolvesFrom('STAGE2 Evolves from Charmeleon\nCharizard ex')).not.toMatch(/charmeleon/i);
    expect(stripEvolvesFrom('Evol\n\nS\n\nrom Charmeleo\nharizard')).not.toMatch(/charmeleo/i);
    expect(stripEvolvesFrom('Si evolve da Charmeleon Metti Charizard')).toMatch(/Charizard/);
  });

  it('ignores "#N" text on raw cards', () => {
    const p = parseOcr({ top: 'Pikachu', full: 'Pokémon Fiamma #2', bottom: '' });
    expect(p.slab.isSlab).toBe(false);
    expect(buildQueries(p).some((x) => x.q.includes('number:"2"'))).toBe(false);
  });

  it('uses slab label data', () => {
    const p = parseOcr({ top: '2023 POKEMON OBF EN-OBSIDIAN FLAMES #125\nCHARIZARD EX\nGEM MT 10 87654321', full: '', bottom: '' });
    expect(p.slab.isSlab).toBe(true);
    expect(buildQueries(p)[0].q).toBe('number:"125" name:*harizar*');
  });
});
