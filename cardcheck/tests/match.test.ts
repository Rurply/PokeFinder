import { describe, expect, it } from 'vitest';
import { buildQueries, confidenceOf, nameFilter, parseManual, parseOcr, rankCards, stripEvolvesFrom } from '../src/lib/match';
import { nameSimilarity } from '../src/lib/names';
import { fromBrief, type Card } from '../src/lib/tcgdex';
import search from './fixtures/tcgdex-search-11-108.json';
import sets from './fixtures/tcgdex-sets-en.json';

// Real TCGdex results for localId=11 & set.cardCount.official=108.
const setMap = new Map(sets.map((s) => [s.id, s]));
const cards: Card[] = search.map((b) => fromBrief(b, 'en', setMap));
const q = (p: ReturnType<typeof parseOcr>) => buildQueries(p).map((x) => `${x.lang}:${new URLSearchParams(x.filters)}`);

describe('matching', () => {
  const parsed = parseOcr({ top: 'Charlzard HP 150', full: 'Charizard\nStage 2', bottom: 'Illus. 11/l08' });

  it('builds number+total query first', () => {
    expect(q(parsed)[0]).toBe('en:localId=11&set.cardCount.official=108');
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

  it('listing title alone identifies the card', () => {
    const p = parseOcr({ top: '', full: '', bottom: '' }, 'Pokémon - 1 Card - Charizard 11/108 Holo - XY');
    expect(q(p)[0]).toBe('en:localId=11&set.cardCount.official=108');
    const ranked = rankCards(cards, p);
    expect(ranked[0].card.id).toBe('xy12-11');
    expect(confidenceOf(ranked)).toBe('high');
  });

  it('set name in the title separates same-numbered cards', () => {
    const p = parseOcr({ top: '', full: '', bottom: '' }, 'Charizard #11 Power Keepers');
    const ranked = rankCards(cards, p);
    expect(ranked[0].card.set.name).not.toBe('Power Keepers'); // ex16-11 is Machamp, not Charizard
    expect(ranked.find((r) => r.card.id === 'ex16-11')!.score).toBeGreaterThan(ranked.find((r) => r.card.id === 'xy6-11')!.score);
  });

  it('Japanese title: Japanese number+total query comes first', () => {
    const p = parseOcr({ top: '', full: '', bottom: '' }, 'Mega Gengar ex SIR Japans 240/193');
    expect(p.lang).toBe('ja');
    expect(q(p)[0]).toBe('ja:localId=240&set.cardCount.official=193');
  });

  it('photo with lost slash: tallest word as name, set total as hint', () => {
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
    expect(q(p)).toContain('en:set.cardCount.official=108&name=harizar');
    expect(rankCards(cards, p)[0].card.id).toBe('xy12-11');
  });

  it('ignores the pre-evolution in "Evolves from"', () => {
    expect(stripEvolvesFrom('STAGE2 Evolves from Charmeleon\nCharizard ex')).not.toMatch(/charmeleon/i);
    expect(stripEvolvesFrom('Evol\n\nS\n\nrom Charmeleo\nharizard')).not.toMatch(/charmeleo/i);
    const p = parseOcr({ top: 'Evolves from Eevee\nFlareon', full: '', bottom: '' });
    expect(p.names).not.toContain('eevee');
    expect(p.names).toContain('flareon');
  });

  it('tolerates OCR errors at word edges; short names need an exact match', () => {
    expect(nameFilter('harizard')).toBe('arizar');
    expect(nameFilter('mew')).toBe('mew');
    expect(nameSimilarity('Charizard ex', 'STAGES harizard €X')).toBeGreaterThan(0.75);
    expect(nameSimilarity('Mew', 'Mev 1o')).toBe(0);
  });

  it('ignores "#N" and grade-like words on raw cards', () => {
    const p = parseOcr({ top: 'Pikachu', full: 'Pokémon Fiamma #2 PR EX 4 weakness', bottom: '' });
    expect(p.slab.isSlab).toBe(false);
    expect(q(p).some((x) => x.includes('localId=2'))).toBe(false);
  });

  it('manual search', () => {
    expect(parseManual('charizard ex 125/197').title).toMatchObject({ collector: { number: '125', total: 197 }, names: ['charizard'] });
    expect(parseManual('メガゲンガーex 240/193').lang).toBe('ja');
  });

  it('uses slab label data', () => {
    const p = parseOcr({ top: '2023 POKEMON OBF EN-OBSIDIAN FLAMES #125\nCHARIZARD EX\nGEM MT 10 87654321', full: '', bottom: '' });
    expect(p.slab.isSlab).toBe(true);
    expect(q(p)[0]).toBe('en:localId=125&name=harizar');
  });

  it('"PSA 8" in the title marks a slab', () => {
    expect(parseOcr({ top: '', full: '', bottom: '' }, 'Pidgeot ex 104/108 XY Evolutions PSA 8').slab).toMatchObject({ isSlab: true, grade: '8' });
  });
});

describe('evidence against a candidate', () => {
  it('a Japanese title with a set total no English card has gives low confidence', () => {
    // Japanese 30th Celebration (/103) is not in TCGdex yet; the English set is /128.
    const p = parseOcr({ top: '', full: '', bottom: '' }, '042/103 Pikachu Japans 30th Celebration Pokemon Kaart');
    const english: Card = { id: 'me03-042', lang: 'en', name: 'Pikachu', number: '042', set: { id: 'me03', name: '30th Celebration', printedTotal: 128 } };
    expect(confidenceOf(rankCards([english], p))).toBe('low');
  });
  it('subset numbers are not penalised for the main set total', () => {
    const p = parseOcr({ top: '', full: '', bottom: '' }, 'Pokémon TCG - Magneton Holo H19/H32');
    const magneton: Card = { id: 'ecard3-H19', lang: 'en', name: 'Magneton', number: 'H19', set: { id: 'ecard3', name: 'Skyridge', printedTotal: 144 } };
    expect(confidenceOf(rankCards([magneton], p))).toBe('high');
  });
});
