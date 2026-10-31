// Card Shop: Lantern Street's glass case of singles (buy), its buylist (sell), and trading with the Locals regulars
// between rounds. Prices, stock and the regulars' binders come from src/collection/market.ts.
import { dp, onCollectionChange, ownedCount, ownedRarities, getCollection, type Copies } from '../../collection';
import {
  buyPrice,
  buySingle,
  cardPrintings,
  collectionValue,
  evaluateTrade,
  featured,
  isOlderPrinting,
  listings,
  makeTrade,
  marketWeek,
  price,
  priceTrend,
  sellSingle,
  trader,
  traders,
  WANT_BONUS,
  type Listing,
  type TradeCard,
  type Trader,
} from '../../collection/market';
import { RARITY_NAMES, RARITY_ORDER, type Rarity } from '../../collection/types';
import { findCard } from '../../cards';
import { shopById } from '../../locals/shops';
import { zoomCard } from '../cards/zoom';
import { haptic } from '../haptics';
import { dpChip, fmtDP, foilCard, rarityPill } from './collectionUi';
import { button, confirmDialog, h, icon, segmented, toast } from './dom';
import { avatar } from './locals';
import { frame, go, type Params, type Screen } from './nav';
import { listCustomDecks } from './store';
import './shop.css';

type Tab = 'buy' | 'sell' | 'trade';
type BuyFilter = 'all' | 'decks' | 'older' | 'foils';
const PAGE = 40;
/** Purchases at or above this price ask first. */
const CONFIRM_PRICE = 300;
const SHOP = shopById('lantern-street');

const kindLabel = (name: string) => {
  const c = findCard(name);
  if (!c) return '';
  if (c.kind === 'spell') return 'Spell';
  if (c.kind === 'trap') return 'Trap';
  return c.mtypes?.some((t) => t === 'synchro' || t === 'fusion') ? 'Extra Deck' : 'Monster';
};
const zoom = (name: string) => {
  const c = findCard(name);
  if (c) zoomCard(c);
};

/** Copies of each card your custom decks use (the most any one deck uses). */
function deckNeeds(): Map<string, number> {
  const need = new Map<string, number>();
  for (const d of listCustomDecks()) {
    if (d.format === 'draft') continue;
    const per = new Map<string, number>();
    for (const [n, c] of [...d.main, ...d.extra, ...d.side]) per.set(n, (per.get(n) ?? 0) + c);
    for (const [n, c] of per) need.set(n, Math.max(need.get(n) ?? 0, c));
  }
  return need;
}

function daysToRestock() {
  const next = (marketWeek() + 1) * 7 * 864e5 + Date.UTC(1970, 0, 2);
  return Math.max(1, Math.ceil((next - Date.now()) / 864e5));
}

function trendTag(name: string, r: Rarity) {
  const t = priceTrend(name, r);
  if (Math.abs(t) < 0.03) return null;
  return h('span', { class: ['sh-trend', t > 0 ? 'up' : 'down'], title: 'Change since last week' }, `${t > 0 ? '▲' : '▼'}${Math.round(Math.abs(t) * 100)}%`);
}

/** A "show more" pager over a long list of rows. */
function paged<T>(host: HTMLElement, items: T[], row: (x: T) => HTMLElement, empty: string) {
  let shown = 0;
  const more = button('Show more', () => draw(), { variant: 'ghost', small: true, cls: 'sh-more' });
  const draw = () => {
    const next = items.slice(shown, shown + PAGE).map(row);
    shown += next.length;
    more.remove();
    host.append(...next);
    if (shown < items.length) host.append(more);
  };
  host.replaceChildren();
  if (!items.length) host.append(h('div', { class: 'sh-empty' }, icon('search'), empty));
  else draw();
}

// =================================================================== shop screen

export function shopScreen(params: Params): Screen {
  let tab: Tab = params.tab === 'sell' || params.tab === 'trade' ? params.tab : 'buy';
  const chipHost = h('div', { class: 'ps-dp' }, dpChip(dp()));
  const body = h('div', { class: 'sh-body' });
  const tabs = segmented<Tab>(
    [
      { value: 'buy', label: 'Glass case' },
      { value: 'sell', label: 'Sell' },
      { value: 'trade', label: 'Trade' },
    ],
    tab,
    (v) => {
      tab = v;
      history.replaceState(null, '', `#/shop?tab=${v}`);
      draw();
    },
    'Shop section',
  );

  const el = frame('Card Shop', { actions: chipHost, cls: 'sh-frame', eyebrow: SHOP.name }, h('div', { class: 'sh-tabs' }, tabs), body);

  let q = '';
  let filter: BuyFilter = 'all';

  function search(placeholder: string, redraw: () => void) {
    const input = h('input', {
      class: 'bd-search-input',
      type: 'search',
      placeholder,
      'aria-label': placeholder,
      autocomplete: 'off',
      value: q,
      oninput: () => {
        q = input.value.trim().toLowerCase();
        redraw();
      },
    });
    return h('label', { class: 'bd-search sh-search' }, icon('search'), input);
  }

  // ---------------------------------------------------------- buy

  function drawBuy() {
    const list = h('div', { class: 'sh-list' });
    const intro = h(
      'div',
      { class: 'sh-intro' },
      h('div', { class: 'sh-intro-icon' }, icon('store')),
      h('div', null, h('b', null, SHOP.where), h('div', { class: 'sh-muted' }, `Foils are in the case while they last. New stock arrives Friday (in ${daysToRestock()} day${daysToRestock() === 1 ? '' : 's'}). Commons and cheap rares are always in the bulk box.`)),
    );
    const feat = featured(10);
    const featRow = feat.length
      ? h(
          'section',
          { class: 'sh-feat' },
          h('h2', { class: 'sh-h' }, 'In the case this week'),
          h(
            'div',
            { class: 'sh-feat-row' },
            feat.map((l) =>
              h(
                'button',
                { type: 'button', class: 'sh-feat-card', 'aria-label': `${l.name}, ${RARITY_NAMES[l.rarity]}, ${fmtDP(l.price)}`, onclick: (e: MouseEvent) => void buy(l, e.currentTarget as Element) },
                foilCard(l.name, l.rarity, { lazy: true }),
                h('div', { class: 'sh-feat-price' }, rarityPill(l.rarity), h('b', null, fmtDP(l.price))),
                h('div', { class: 'sh-feat-stock' }, l.stock === 1 ? 'Last one' : `${l.stock} in the case`),
              ),
            ),
          ),
        )
      : null;
    const chips = h(
      'div',
      { class: 'bd-chips', role: 'radiogroup', 'aria-label': 'Show' },
      (
        [
          ['all', 'All'],
          ['decks', 'For my decks'],
          ['foils', 'Foils'],
          ['older', 'Older sets'],
        ] as [BuyFilter, string][]
      ).map(([v, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: ['bd-chip', v === filter && 'on'],
            role: 'radio',
            'aria-checked': String(v === filter),
            onclick: () => {
              filter = v;
              drawBuy();
            },
          },
          label,
        ),
      ),
    );
    body.replaceChildren(intro, featRow ?? '', h('div', { class: 'sh-controls' }, search('Search singles', fill), chips), list);

    function fill() {
      const needs = filter === 'decks' ? deckNeeds() : null;
      const names = [...cardPrintings().keys()].filter((n) => {
        if (q && !n.toLowerCase().includes(q)) return false;
        if (needs) return (needs.get(n) ?? 0) > ownedCount(n);
        if (filter === 'older') return isOlderPrinting(n);
        if (filter === 'foils') return cardPrintings().get(n)!.some((r) => r !== 'C' && r !== 'SP' && r !== 'R');
        return true;
      });
      // most valuable printing first: the case is laid out like a real one
      const top = new Map(names.map((n) => [n, Math.max(...cardPrintings().get(n)!.map((r) => price(n, r)))]));
      names.sort((a, b) => top.get(b)! - top.get(a)! || a.localeCompare(b));
      const empty = filter === 'decks' ? 'You own every card your decks use. (Draft decks don’t count.)' : 'No singles match.';
      paged(list, names, (n) => buyRow(n, needs?.get(n)), empty);
    }
    fill();
  }

  function buyRow(name: string, need?: number) {
    const have = ownedCount(name);
    const sub = [kindLabel(name), isOlderPrinting(name) ? 'older set' : '', have ? `you have ${have}` : '', need ? `your decks use ${need}` : ''].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: 'sh-row' },
      h('button', { type: 'button', class: 'sh-name', onclick: () => zoom(name) }, h('span', { class: 'sh-title' }, name), h('span', { class: 'sh-sub' }, sub)),
      h('div', { class: 'sh-prints' }, listings(name).map((l) => printButton(l))),
    );
  }

  /** Redraw the row (or featured tile) a purchase or sale came from, keeping the list and scroll as they are. */
  function refresh(from: Element | null, again: () => HTMLElement | null) {
    const row = from?.closest('.sh-row');
    if (row) {
      const next = again();
      if (next) row.replaceWith(next);
      else row.remove();
    } else if (from?.closest('.sh-feat')) drawBuy();
  }

  function printButton(l: Listing) {
    const out = l.stock <= 0;
    const b = h(
      'button',
      {
        type: 'button',
        class: ['sh-print', out && 'is-out'],
        'aria-label': `Buy ${l.name}, ${isOlderPrinting(l.name) ? 'older printing' : RARITY_NAMES[l.rarity]}, ${fmtDP(l.price)}${out ? ', sold out' : ''}`,
        onclick: (e: MouseEvent) => void buy(l, e.currentTarget as Element),
      },
      isOlderPrinting(l.name) ? h('span', { class: 'rpill sh-older' }, 'Old') : rarityPill(l.rarity),
      h('b', null, l.price.toLocaleString('en-US')),
      out ? h('span', { class: 'sh-stock' }, 'Sold out') : Number.isFinite(l.stock) ? h('span', { class: 'sh-stock' }, `${l.stock} left`) : null,
      trendTag(l.name, l.rarity),
    );
    if (out) b.disabled = true;
    return b;
  }

  async function buy(l: Listing, from: Element | null = null) {
    if (dp() < l.price) {
      toast(`You need ${fmtDP(l.price - dp())} more.`, 'error');
      return;
    }
    if (l.price >= CONFIRM_PRICE) {
      const what = isOlderPrinting(l.name) ? 'older printing' : RARITY_NAMES[l.rarity];
      if (!(await confirmDialog(`Buy ${l.name}?`, `${what} for ${fmtDP(l.price)}. You have ${fmtDP(dp())}.`, 'Buy'))) return;
    }
    const r = buySingle(l.name, l.rarity);
    if (!r.ok) {
      toast(r.reason, 'error');
      return;
    }
    haptic('success');
    toast(`Bought ${l.name}.`, 'success');
    refresh(from, () => buyRow(l.name, filter === 'decks' ? deckNeeds().get(l.name) : undefined));
  }

  // ---------------------------------------------------------- sell

  function drawSell() {
    const list = h('div', { class: 'sh-list' });
    body.replaceChildren(
      h(
        'div',
        { class: 'sh-intro' },
        h('div', { class: 'sh-intro-icon' }, icon('cards')),
        h('div', null, sellValue, h('div', { class: 'sh-muted' }, 'At the shop’s prices. The shop buys singles for half of what it sells them for. Trading with the regulars usually gets you more.')),
      ),
      h('div', { class: 'sh-controls' }, search('Search your cards', fill)),
      list,
    );
    function fill() {
      const needs = deckNeeds();
      const rows: { name: string; rarity: Rarity; n: number; pay: number }[] = [];
      for (const [name, rs] of Object.entries(getCollection().owned)) {
        if (q && !name.toLowerCase().includes(q)) continue;
        if (!cardPrintings().has(name)) continue;
        for (const r of RARITY_ORDER) if (rs[r]) rows.push({ name, rarity: r, n: rs[r]!, pay: buyPrice(name, r) });
      }
      rows.sort((a, b) => b.pay - a.pay || a.name.localeCompare(b.name));
      paged(list, rows, (x) => sellRow(x, needs.get(x.name) ?? 0), q ? 'No cards match.' : 'Nothing to sell yet. Open some packs!');
      drawSellValue();
    }
    fill();
  }

  const sellValue = h('b', null);
  function drawSellValue() {
    sellValue.textContent = `Your binder is worth ${fmtDP(collectionValue())}`;
  }

  function sellRow(x: { name: string; rarity: Rarity; n: number; pay: number }, need: number) {
    const sub = [kindLabel(x.name), `×${x.n}`, need ? `your decks use ${need}` : ''].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: 'sh-row sh-row--sell' },
      h('button', { type: 'button', class: 'sh-name', onclick: () => zoom(x.name) }, h('span', { class: 'sh-title' }, rarityPill(x.rarity), ' ', x.name), h('span', { class: 'sh-sub' }, sub)),
      button(`Sell · ${x.pay.toLocaleString('en-US')}`, (e) => void sell(x, need, e.currentTarget as Element), { variant: 'ghost', small: true, cls: 'sh-sell' }),
    );
  }

  async function sell(x: { name: string; rarity: Rarity; pay: number }, need: number, from: Element) {
    const left = ownedCount(x.name) - 1;
    if (left < need) {
      const ok = await confirmDialog(`Sell ${x.name}?`, `Your decks use ${need} and you'd have ${left} left, so a deck would be short of it in Collection mode. Sell it for ${fmtDP(x.pay)} anyway?`, 'Sell', true);
      if (!ok) return;
    } else if (x.pay >= CONFIRM_PRICE && !(await confirmDialog(`Sell ${x.name}?`, `${RARITY_NAMES[x.rarity]} for ${fmtDP(x.pay)}.`, 'Sell'))) return;
    const r = sellSingle(x.name, x.rarity);
    if (!r.ok) return toast(r.reason, 'error');
    haptic('success');
    toast(`Sold for ${fmtDP(x.pay)}.`, 'success');
    const n = ownedRarities(x.name)[x.rarity] ?? 0;
    refresh(from, () => (n ? sellRow({ ...x, n }, need) : null));
    drawSellValue();
  }

  // ---------------------------------------------------------- trade (who's here)

  function drawTrade() {
    body.replaceChildren(
      h(
        'div',
        { class: 'sh-intro' },
        h('div', { class: 'sh-intro-icon' }, icon('swap')),
        h('div', null, h('b', null, 'The binder crowd'), h('div', { class: 'sh-muted' }, 'The regulars trade between rounds. Each has a binder of cards they don’t play and a list of cards they want; offer one of those and they value it more. Binders change every Friday.')),
      ),
      h('div', { class: 'sh-traders' }, traders().map(traderRow)),
    );
  }

  function traderRow(t: Trader) {
    const youHave = t.wants.filter((n) => ownedCount(n) > 0);
    return h(
      'button',
      { type: 'button', class: 'sh-trader', onclick: () => go('trade', { id: t.regular.id }) },
      avatar(t.regular, 44),
      h(
        'div',
        { class: 'sh-trader-text' },
        h('div', { class: 'sh-title' }, t.regular.name, h('span', { class: 'sh-sub' }, ` · ${t.regular.title}`)),
        h('div', { class: 'sh-sub' }, `${t.binder.length} cards in the binder · top: ${t.binder[0]?.name ?? '—'}`),
        h('div', { class: ['sh-sub', youHave.length > 0 && 'sh-hot'] }, youHave.length ? `Wants ${youHave.length} card${youHave.length === 1 ? '' : 's'} you have: ${youHave.slice(0, 2).join(', ')}${youHave.length > 2 ? '…' : ''}` : `Looking for ${t.wants.slice(0, 2).join(', ')}`),
      ),
      icon('chevron'),
    );
  }

  function draw() {
    q = '';
    if (tab === 'buy') drawBuy();
    else if (tab === 'sell') drawSell();
    else drawTrade();
  }

  const off = onCollectionChange(() => chipHost.replaceChildren(dpChip(dp())));
  draw();
  return { el, dispose: off };
}

// =================================================================== trade table

const LINES: Record<string, { yes: string; no: string }> = {
  dave: { yes: 'Pleasure doing business. Binder’s open again next week.', no: 'My binder, my prices. You’re about {short} short.' },
  marcus: { yes: 'Fair. Good luck tonight.', no: 'Store champ doesn’t do charity. Need about {short} more.' },
  priya: { yes: 'Deal. Sleeve it up.', no: 'Close, but I’d want about {short} more on your side.' },
  felix: { yes: 'Sweet, deal!', no: 'Hmm… could you add a little? Like {short}?' },
  gus: { yes: 'Sure, it’s just cardboard.', no: 'Eh, throw in about {short} more and it’s yours.' },
};
const line = (id: string, kind: 'yes' | 'no', short = 0) =>
  (LINES[id]?.[kind] ?? (kind === 'yes' ? 'Deal.' : 'Not quite. About {short} short.')).replace('{short}', fmtDP(short));

const k = (name: string, r: Rarity) => `${name}|${r}`;

export function tradeScreen(params: Params): Screen {
  const id = params.id ?? '';
  let t = trader(id);
  if (!t) {
    go('shop', { tab: 'trade' }, { replace: true });
    return { el: h('div') };
  }
  const get = new Set<string>();
  const give = new Map<string, Copies>();
  let addDp = 0;
  let q = '';
  let reply: { text: string; ok: boolean } | null = null;

  const chipHost = h('div', { class: 'ps-dp' }, dpChip(dp()));
  const theirs = h('div', { class: 'sh-list' });
  const wantsHost = h('div', { class: 'sh-wants' });
  const yours = h('div', { class: 'sh-list' });
  const dpHost = h('div', { class: 'sh-dp-row' });
  const bar = h('div', { class: 'sh-bar' });
  const input = h('input', {
    class: 'bd-search-input',
    type: 'search',
    placeholder: 'Search your cards',
    'aria-label': 'Search your cards',
    autocomplete: 'off',
    oninput: () => {
      q = input.value.trim().toLowerCase();
      drawYours();
    },
  });

  const el = frame(
    t.regular.name,
    { cls: 'sh-frame sh-trade', eyebrow: `Trading · ${t.regular.title}`, actions: chipHost, backTo: () => go('shop', { tab: 'trade' }), backLabel: 'Shop' },
    h('div', { class: 'sh-intro' }, avatar(t.regular, 44), h('div', { class: 'sh-muted' }, t.regular.blurb)),
    h('h2', { class: 'sh-h' }, 'Their binder', h('span', { class: 'sh-sub' }, ' · tap the cards you want')),
    theirs,
    h('h2', { class: 'sh-h' }, 'They’re looking for', h('span', { class: 'sh-sub' }, ` · worth ×${WANT_BONUS} to them`)),
    wantsHost,
    h('h2', { class: 'sh-h' }, 'Your side'),
    h('label', { class: 'bd-search sh-search' }, icon('search'), input),
    yours,
    dpHost,
    bar,
  );

  function drawTheirs() {
    theirs.replaceChildren(
      ...(t!.binder.length
        ? t!.binder.map((c: TradeCard) => {
            const on = get.has(k(c.name, c.rarity));
            return h(
              'button',
              {
                type: 'button',
                class: ['sh-row', 'sh-pick', on && 'on'],
                'aria-pressed': String(on),
                onclick: () => {
                  on ? get.delete(k(c.name, c.rarity)) : get.add(k(c.name, c.rarity));
                  reply = null;
                  haptic('selection');
                  drawTheirs();
                  drawBar();
                },
              },
              h('span', { class: 'sh-check', 'aria-hidden': 'true' }, on ? icon('check') : null),
              h('span', { class: 'sh-name' }, h('span', { class: 'sh-title' }, rarityPill(c.rarity), ' ', c.name), h('span', { class: 'sh-sub' }, `${kindLabel(c.name)}${ownedCount(c.name) ? ` · you have ${ownedCount(c.name)}` : ''}`)),
              h('b', { class: 'sh-val' }, c.value.toLocaleString('en-US')),
            );
          })
        : [h('div', { class: 'sh-empty' }, 'Their binder is empty this week. Come back Friday.')]),
    );
  }

  function drawWants() {
    wantsHost.replaceChildren(...t!.wants.map((n) => h('button', { type: 'button', class: ['sh-want', ownedCount(n) > 0 && 'have'], onclick: () => zoom(n) }, n, ownedCount(n) ? h('span', null, ` · you have ${ownedCount(n)}`) : null)));
  }

  function drawYours() {
    const wants = new Set(t!.wants);
    const rows: { name: string; rarity: Rarity; n: number; value: number; wanted: boolean }[] = [];
    for (const [name, rs] of Object.entries(getCollection().owned)) {
      if (!cardPrintings().has(name)) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      for (const r of RARITY_ORDER) if (rs[r]) rows.push({ name, rarity: r, n: rs[r]!, value: price(name, r), wanted: wants.has(name) });
    }
    // wanted cards first, then the ones already in the offer, then by value
    rows.sort((a, b) => Number(b.wanted) - Number(a.wanted) || Number(give.has(k(b.name, b.rarity))) - Number(give.has(k(a.name, a.rarity))) || b.value - a.value);
    paged(yours, rows, (x) => {
      const cur = give.get(k(x.name, x.rarity))?.n ?? 0;
      const set = (n: number) => {
        n = Math.max(0, Math.min(x.n, n));
        if (n) give.set(k(x.name, x.rarity), { name: x.name, rarity: x.rarity, n });
        else give.delete(k(x.name, x.rarity));
        reply = null;
        drawYours();
        drawBar();
      };
      return h(
        'div',
        { class: ['sh-row', cur > 0 && 'on'] },
        h('button', { type: 'button', class: 'sh-name', onclick: () => zoom(x.name) }, h('span', { class: 'sh-title' }, rarityPill(x.rarity), ' ', x.name), h('span', { class: ['sh-sub', x.wanted && 'sh-hot'] }, `${x.wanted ? 'Wanted · ' : ''}${x.value.toLocaleString('en-US')} each · you have ${x.n}`)),
        h('div', { class: 'sh-step' }, button('', () => set(cur - 1), { icon: 'minus', small: true, variant: 'subtle', title: 'One fewer', disabled: !cur }), h('b', null, String(cur)), button('', () => set(cur + 1), { icon: 'plus', small: true, variant: 'subtle', title: 'One more', disabled: cur >= x.n })),
      );
    }, q ? 'No cards match.' : 'You have no cards to trade yet.');
  }

  function drawDp() {
    const set = (n: number) => {
      addDp = Math.max(0, Math.min(dp(), n));
      reply = null;
      drawDp();
      drawBar();
    };
    dpHost.replaceChildren(
      h('span', null, 'Add Duel Points'),
      h('div', { class: 'sh-step' }, button('−100', () => set(addDp - 100), { small: true, variant: 'subtle', disabled: !addDp }), h('b', null, fmtDP(addDp)), button('+100', () => set(addDp + 100), { small: true, variant: 'subtle', disabled: addDp + 100 > dp() })),
    );
  }

  function offer() {
    return {
      give: [...give.values()],
      get: [...get].map((x) => {
        const [name, rarity] = x.split('|') as [string, Rarity];
        return { name, rarity };
      }),
      dp: addDp,
    };
  }

  function drawBar() {
    const o = offer();
    const v = evaluateTrade(t!, o);
    const pct = v.asked ? Math.min(100, Math.round((v.offered / v.asked) * 100)) : 0;
    const ready = o.get.length > 0;
    bar.replaceChildren(
      reply ? h('div', { class: ['sh-reply', reply.ok && 'ok'] }, h('b', null, `${t!.regular.name.replace(/^Big /, '').split(' ')[0]}: `), `“${reply.text}”`) : '',
      h(
        'div',
        { class: 'sh-meter-row' },
        h('div', { class: 'sh-meter', 'aria-hidden': 'true' }, h('span', { class: v.accept ? 'ok' : '', style: { width: `${pct}%` } })),
        h('div', { class: 'sh-sub' }, ready ? `You offer ${v.offered.toLocaleString('en-US')} · they want ${v.asked.toLocaleString('en-US')}` : 'Pick a card from their binder'),
      ),
      button('Offer trade', () => propose(), { variant: 'primary', icon: 'swap', disabled: !ready }),
    );
  }

  async function propose() {
    const o = offer();
    const v = evaluateTrade(t!, o);
    if (!v.accept) {
      haptic('warning');
      reply = { text: line(id, 'no', v.short), ok: false };
      drawBar();
      return;
    }
    const gave = o.give.reduce((n, c) => n + c.n, 0);
    const msg = `You give ${gave ? `${gave} card${gave === 1 ? '' : 's'}` : ''}${gave && o.dp ? ' and ' : ''}${o.dp ? fmtDP(o.dp) : ''} for ${o.get.map((c) => c.name).join(', ')}.`;
    if (!(await confirmDialog('Make this trade?', msg, 'Trade'))) return;
    const r = makeTrade(id, o);
    if (!r.ok) {
      reply = { text: r.verdict ? line(id, 'no', r.verdict.short) : r.reason, ok: false };
      drawBar();
      return;
    }
    haptic('success');
    toast(`Traded with ${t!.regular.name}.`, 'success');
    t = trader(id);
    get.clear();
    give.clear();
    addDp = 0;
    reply = { text: line(id, 'yes'), ok: true };
    drawAll();
  }

  function drawAll() {
    drawTheirs();
    drawWants();
    drawYours();
    drawDp();
    drawBar();
  }
  const off = onCollectionChange(() => chipHost.replaceChildren(dpChip(dp())));
  drawAll();
  return { el, dispose: off };
}
