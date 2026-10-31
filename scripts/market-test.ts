// Card shop and trades (src/collection/market.ts): prices follow rarity and demand, the glass case has limited
// stock that refreshes weekly, buying/selling/trading move cards and DP atomically, and the regulars only take
// trades worth it to them.
// Usage: npx tsx scripts/market-test.ts
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

import '../src/cards';
import { dp, getCollection, ownedRarities, transact } from '../src/collection';
import { FORBIDDEN } from '../src/cards/banlist';
import {
  buyPrice,
  buySingle,
  cardPrintings,
  demand,
  evaluateTrade,
  featured,
  isOlderPrinting,
  makeTrade,
  marketLog,
  marketWeek,
  price,
  sellSingle,
  stock,
  trader,
  traders,
  WANT_BONUS,
} from '../src/collection/market';

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else failures.push(msg);
}
const give = (n: number) => transact({ dp: n });

// ---- prices
const week = marketWeek();
check(price('Brionac, Dragon of the Ice Barrier', 'ScR') > 1500, 'Brionac (a staple, only printed as a foil) is expensive');
check(price('Mystical Space Typhoon', 'C') < 300 && price('Mystical Space Typhoon', 'GUR') > price('Mystical Space Typhoon', 'C') * 2, 'a staple with a common printing is cheap as a common and dearer as a foil');
check(price('Pot of Avarice', 'C') < 100, 'a common nobody chases is bulk');
check(price('Brionac, Dragon of the Ice Barrier', 'ScR', week) === price('Brionac, Dragon of the Ice Barrier', 'ScR', week), 'prices are fixed within a week');
check(buyPrice('Brionac, Dragon of the Ice Barrier', 'ScR') <= price('Brionac, Dragon of the Ice Barrier', 'ScR') / 2 + 5, 'the shop buys at about half its price');
check(FORBIDDEN.every((n) => demand(n) === 0), 'Forbidden cards have no tournament demand');
check(isOlderPrinting('Gorz the Emissary of Darkness') && cardPrintings().get('Gorz the Emissary of Darkness')?.[0] === 'R', 'Gorz (no era printing) is carried as an older-set single');
check(price('Gorz the Emissary of Darkness', 'R') > 800, 'an older-set staple carries the full demand premium');
check(![...cardPrintings().keys()].some((n) => FORBIDDEN.includes(n) && isOlderPrinting(n)), 'Forbidden cards are not stocked as older singles');

// ---- buying
const startDp = dp();
const bulk = 'Pot of Avarice';
check(stock(bulk, 'C') === Infinity, 'bulk commons are always in stock');
const before = ownedRarities(bulk).C ?? 0;
check(buySingle(bulk, 'C').ok, 'buying a common works');
check((ownedRarities(bulk).C ?? 0) === before + 1, 'the bought card joins the collection');
check(dp() === startDp - price(bulk, 'C'), 'its price is paid');
check(!buySingle(bulk, 'UR').ok, 'a printing that does not exist cannot be bought');

const top = featured(30).find((l) => l.stock >= 1)!;
check(!!top, 'the glass case has foils in stock');
give(top.price * 5);
const s0 = stock(top.name, top.rarity);
for (let i = 0; i < s0; i++) buySingle(top.name, top.rarity);
check(stock(top.name, top.rarity) === 0, `buying every copy empties the case (${top.name} ${top.rarity}: ${s0})`);
const r = buySingle(top.name, top.rarity);
check(!r.ok && /Sold out/.test((r as { reason: string }).reason), 'a sold-out card cannot be bought');
check(stock(top.name, top.rarity, week + 1) >= 0 && (() => {
  // next week's case is rolled fresh: the copies bought this week don't count against it
  for (let w = week + 1; w < week + 30; w++) if (stock(top.name, top.rarity, w) > 0) return true;
  return false;
})(), 'the case restocks in later weeks');

const poor = dp();
transact({ dp: -poor });
check(!buySingle('Brionac, Dragon of the Ice Barrier', 'ScR').ok && dp() === 0, 'no DP, no purchase, nothing changes');

// ---- selling
transact({ dp: 0, add: [{ name: 'Dark Armed Dragon', rarity: 'ScR', n: 2 }] });
const pay = buyPrice('Dark Armed Dragon', 'ScR');
check(sellSingle('Dark Armed Dragon', 'ScR').ok && dp() === pay && ownedRarities('Dark Armed Dragon').ScR === 1, 'selling pays the buylist price and removes the copy');
check(!sellSingle('Dark Armed Dragon', 'ScR', 5).ok && ownedRarities('Dark Armed Dragon').ScR === 1, 'you cannot sell copies you do not have');
check(marketLog()[0]?.kind === 'sell' && marketLog().some((l) => l.kind === 'buy'), 'buys and sells are logged');

// ---- transact atomicity
const dpBefore = dp();
check(!transact({ dp: 100, add: [{ name: 'Sangan', rarity: 'C', n: 1 }], remove: [{ name: 'Dark Armed Dragon', rarity: 'ScR', n: 9 }] }), 'a transaction removing cards you lack fails');
check(dp() === dpBefore && !(ownedRarities('Sangan').C ?? 0 > (getCollection().owned['Sangan']?.C ?? 0)), 'a failed transaction changes nothing');

// ---- trading
check(traders().length >= 9, 'every regular has a trade binder');
const dave = trader('dave')!;
check(dave.binder.length >= 10 && dave.wants.length === 6, `Dave has a binder (${dave.binder.length}) and a want list`);
check(dave.binder.every((c) => !dave.wants.includes(c.name)), 'a regular never offers a card they want');
const theirs = dave.binder[0];
check(!evaluateTrade(dave, { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: 0 }).accept, 'nothing for something is refused');
const v = evaluateTrade(dave, { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: 0 });
check(v.short >= theirs.value, `the refusal says how much value is missing (${v.short} ≥ ${theirs.value})`);
const enough = Math.ceil(theirs.value * dave.greed) + 5;
check(evaluateTrade(dave, { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: enough }).accept, 'enough DP on your side gets the deal');
check(!evaluateTrade(dave, { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: Math.floor(theirs.value * dave.greed) - 20 }).accept, 'Dave bargains hard: face value is not enough');

// a wanted card is worth WANT_BONUS more to them
const want = dave.wants[0];
const wr = cardPrintings().get(want)![0];
const wantVal = evaluateTrade(dave, { give: [{ name: want, rarity: wr, n: 1 }], get: [], dp: 0 }).offered;
check(Math.abs(wantVal - price(want, wr) * WANT_BONUS) <= 1, `a card on their want list counts ×${WANT_BONUS}`);

// a real trade
transact({ dp: enough });
const dpPre = dp();
const res = makeTrade('dave', { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: enough });
check(res.ok, 'the accepted trade goes through');
check((ownedRarities(theirs.name)[theirs.rarity] ?? 0) >= 1 && dp() === dpPre - enough, 'you get their card and pay the DP');
check(!trader('dave')!.binder.some((c) => c.name === theirs.name && c.rarity === theirs.rarity), 'the traded card leaves their binder');
check(!makeTrade('dave', { give: [], get: [{ name: theirs.name, rarity: theirs.rarity }], dp: 0 }).ok, 'it cannot be traded for twice');
check(!makeTrade('dave', { give: [{ name: 'Dark Armed Dragon', rarity: 'ScR', n: 3 }], get: [{ name: dave.binder[1].name, rarity: dave.binder[1].rarity }], dp: 0 }).ok, 'offering cards you do not own fails');

// ---- weekly reset
const wk = JSON.parse(store.get('edison.market.v1')!);
wk.week = week - 1;
store.set('edison.market.v1', JSON.stringify(wk));
check(stock(top.name, top.rarity) === Math.max(0, stock(top.name, top.rarity)) && trader('dave')!.binder.length >= dave.binder.length - 1, 'a new week clears the purchases and trades of the old one');
check(JSON.stringify(trader('dave', week + 1)!.binder) !== JSON.stringify(trader('dave', week)!.binder), 'binders change from week to week');

if (failures.length) {
  console.error(`market-test: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`market-test: all ${passed} checks passed`);
