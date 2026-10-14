import { describe, expect, it } from 'vitest';
import { parseTitle } from '../src/lib/title';

// Real listing titles from Marktplaats (October 2026).
describe('parseTitle', () => {
  it.each([
    ['Kadabra #49/110 – LC Reverse HoloNM/EXC English 2002', '49', 110, 'kadabra', 'en'],
    ['Pidgeot ex 104/108 XY Evolutions PSA 8', '104', 108, 'pidgeot', undefined],
    ['Kabutops #6/75 - Neo Discovery Holo NM/EXC English', '6', 75, 'kabutops', 'en'],
    ['Pokémon TCG - Magneton Holo H19/H32', 'H19', 32, 'magneton', undefined],
    ['Mega Gengar ex SIR Japans 240/193', '240', 193, 'mega', 'ja'],
    ['042/103 Pikachu Japans 30th Celebration Pokemon Kaart', '42', 103, 'pikachu', 'ja'],
    ['VENUSAUR ex 198/165 – 151 – SPECIAL ILLUSTRATION RARE – NM', '198', 165, 'venusaur', undefined],
  ] as const)('%s', (title, number, total, name, lang) => {
    const t = parseTitle(title)!;
    expect(t.collector).toMatchObject({ number, total });
    expect(t.names[0]).toBe(name);
    expect(t.lang).toBe(lang);
  });

  it('promo numbers without a set total', () => {
    expect(parseTitle('Blastoise ex xy122 front NM back EXC standard size')!.collector!.number).toBe('XY122');
    expect(parseTitle('Snorlax SVP 051 – Black Star Promo – Pokémon Scarlet &')!.collector!.number).toBe('051');
    expect(parseTitle('Charizard ex #161 Promo 2024 PSA 9 Pokémon Engels graded')!.collector!.number).toBe('161');
  });

  it('a lone number that is not a grade or year', () => {
    const t = parseTitle('PSA 6 Jolteon Gold star 101 - Ex Power Keepers')!;
    expect(t.collector!.number).toBe('101');
    expect(t.grade).toBe('6');
    expect(t.names).toContain('jolteon');
    expect(t.names).toContain('power');
  });

  it('empty or missing title', () => {
    expect(parseTitle('')).toBeNull();
    expect(parseTitle(null)).toBeNull();
  });
});
