// Live check against the real APIs: `npm run live-check`. Not part of `npm test`.
import { expect, it } from 'vitest';
import { createCache, memoryKV } from '../../src/lib/cache';
import { convert, formatMoney, getRates } from '../../src/lib/currency';
import { buildQueries, confidenceOf, parseManual, rankCards } from '../../src/lib/match';
import { choosePrice } from '../../src/lib/pricing';
import { getCard, searchCards } from '../../src/lib/tcgapi';

const cache = createCache(memoryKV());
const apiKey = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.POKEMONTCG_API_KEY;

it('Charizard ex, Obsidian Flames 125/197', { timeout: 120_000 }, async () => {
  const parsed = parseManual('Charizard ex 125/197');
  const query = buildQueries(parsed)[0].q;
  const cards = await searchCards(query, { cache, apiKey });
  const ranked = rankCards(cards, parsed);
  const card = await getCard(ranked[0].card.id, { cache, apiKey, force: true });
  const cm = card.cardmarket!;
  console.log(`query: ${query} -> ${ranked.map((r) => `${r.card.id} (${r.score})`).join(', ')} [${confidenceOf(ranked)}]`);
  console.log(`${card.name} – ${card.set.name} ${card.number}/${card.set.printedTotal} (${card.id})`);
  console.log(`Cardmarket EUR (updated ${cm.updatedAt}): trend €${cm.prices?.trendPrice}, averageSell €${cm.prices?.averageSellPrice}, low €${cm.prices?.lowPrice}`);
  console.log(`TCGplayer USD (updated ${card.tcgplayer?.updatedAt}): ${JSON.stringify(card.tcgplayer?.prices)}`);

  const rates = await getRates(cache);
  console.log(`ECB rates ${rates.date}: USD ${rates.rates.USD}, GBP ${rates.rates.GBP}, JPY ${rates.rates.JPY}`);
  const choice = choosePrice(card, { metric: 'trend', policy: 'auto', freshnessDays: 30 });
  const p = choice.primary!;
  console.log(`Freshest-wins primary: ${p.source} ${p.metric} ${formatMoney(p.amount, p.currency)} (updated ${p.updatedAt}) = ${formatMoney(convert(p.amount, p.currency, 'EUR', rates)!, 'EUR')}${choice.note ? ` – ${choice.note}` : ''}`);
  expect(card.id).toBe('sv3-125');
  expect(cm.prices?.trendPrice).toBeGreaterThan(0);
});
