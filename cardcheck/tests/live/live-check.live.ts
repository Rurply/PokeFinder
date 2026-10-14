// Live check against the real APIs: `npm run live-check`. Not part of `npm test`.
import { expect, it } from 'vitest';
import { createCache, memoryKV } from '../../src/lib/cache';
import { convert, formatMoney, getRates } from '../../src/lib/currency';
import { buildQueries, confidenceOf, parseManual, rankCards } from '../../src/lib/match';
import { choosePrice } from '../../src/lib/pricing';
import { getCard, searchCards } from '../../src/lib/tcgdex';

const cache = createCache(memoryKV());

it('Charizard ex, Obsidian Flames 125/197', { timeout: 120_000 }, async () => {
  const parsed = parseManual('Charizard ex 125/197');
  const query = buildQueries(parsed)[0];
  const ranked = rankCards(await searchCards(query.filters, query.lang, { cache }), parsed);
  const card = await getCard(ranked[0].card.id, 'en', { cache, force: true });
  const cm = card.pricing!.cardmarket!;
  console.log(`query: ${query.lang} ${new URLSearchParams(query.filters)} -> ${ranked.map((r) => `${r.card.id} (${r.score})`).join(', ')} [${confidenceOf(ranked)}]`);
  console.log(`${card.name} – ${card.set.name} ${card.number}/${card.set.printedTotal} (${card.id})`);
  console.log(`Cardmarket EUR (updated ${cm.updated}): trend €${cm.trend}, avg €${cm.avg}, low €${cm.low}`);
  console.log(`TCGplayer USD (updated ${card.pricing?.tcgplayer?.updated}): ${JSON.stringify(card.pricing?.tcgplayer)}`);

  const rates = await getRates(cache);
  console.log(`ECB rates ${rates.date}: USD ${rates.rates.USD}, GBP ${rates.rates.GBP}, JPY ${rates.rates.JPY}`);
  const choice = choosePrice(card, { metric: 'trend', policy: 'auto', freshnessDays: 30 });
  const p = choice.primary!;
  console.log(`Freshest-wins primary: ${p.source} ${p.metric} ${formatMoney(p.amount, p.currency)} (updated ${p.updatedAt}) = ${formatMoney(convert(p.amount, p.currency, 'EUR', rates)!, 'EUR')}${choice.note ? ` – ${choice.note}` : ''}`);
  expect(card.id).toBe('sv03-125');
  expect(cm.trend).toBeGreaterThan(0);
});

it('Japanese: Mega Gengar ex 240/193', { timeout: 120_000 }, async () => {
  const parsed = parseManual('Mega Gengar ex Japans 240/193');
  const query = buildQueries(parsed)[0];
  const ranked = rankCards(await searchCards(query.filters, query.lang, { cache }), parsed);
  const card = await getCard(ranked[0].card.id, ranked[0].card.lang, { cache });
  console.log(`JA: ${card.name} – ${card.set.name} ${card.number}/${card.set.printedTotal} (${card.id}); Cardmarket trend €${card.pricing?.cardmarket?.trend} (updated ${card.pricing?.cardmarket?.updated})`);
  expect(card.lang).toBe('ja');
});
