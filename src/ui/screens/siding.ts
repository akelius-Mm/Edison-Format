// Side decking between games of a best-of-3 (shown before the go-first / go-second choice).
//
// Constructed: tap a Main/Extra card, then a Side card (or the other way round) to swap one copy.
// Extra Deck monsters swap only with Extra Deck monsters. Limited (Draft / Sealed): the side is the
// rest of the pool and cards also move one way ("Move to Side" / "Add to deck"), keeping 40+.
// Long-press (or right-click, or V) reads a card.
import './siding.css';
import { CARDS } from '../../cards';
import { canSwap, cloneDeck, isExtraDeckCard, moveToDeck, moveToSide, sideDiff, sideSummary, swapCards, type DeckIds } from '../../decks/siding';
import type { CardData } from '../../engine/card';
import { zoomCard } from '../cards/zoom';
import { haptic } from '../haptics';
import { button, h, icon } from './dom';
import { applyPlaymat, renderCard } from './ext';

export interface SidingOptions {
  /** Match caption, e.g. "Round 2 – vs Rei Mori". */
  caption: string;
  /** The game about to be played (2 or 3 …). */
  gameNo: number;
  /** "You lost game 1 · 0–1". */
  status: string;
  opp: { name: string; deck?: string; seen: [string, number][] };
  /** The deck to start from (the previous game's deck, or swaps saved before the app closed). */
  start: DeckIds;
  /** The previous game's deck: "Skip siding" keeps it. */
  previous: DeckIds;
  /** The deck the match started with: "Reset to original". */
  original: DeckIds;
  limited?: boolean;
  playmat: string;
  /** Called after every change (the match saves it, so a closed app comes back here). */
  onChange?: (d: DeckIds) => void;
}

type Sec = 'main' | 'extra' | 'side';
interface Sel {
  sec: Sec;
  id: string;
}

const card = (id: string): CardData | undefined => CARDS[id];
const same = (a: DeckIds, b: DeckIds) => a.main.join() === b.main.join() && a.extra.join() === b.extra.join() && a.side.join() === b.side.join();
const sameCounts = (a: DeckIds, b: DeckIds) => {
  const d = sideDiff(a, b);
  return !d.added.length && !d.removed.length;
};

/** Tap / long-press on a tile. */
function press(el: HTMLElement, on: { tap: () => void; long: () => void }) {
  let timer = 0;
  let sx = 0;
  let sy = 0;
  let longFired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    longFired = false;
    sx = e.clientX;
    sy = e.clientY;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      longFired = true;
      haptic('selection');
      on.long();
    }, 450);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    if (!longFired) on.long();
  });
  el.addEventListener('click', () => {
    if (longFired) {
      longFired = false;
      return;
    }
    on.tap();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      on.tap();
    } else if (e.key === 'v' || e.key === 'V') on.long();
  });
}

const KIND_ORDER: Record<string, number> = { monster: 0, spell: 1, trap: 2 };
function grouped(ids: string[]): [CardData, number][] {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m]
    .map(([id, n]) => [card(id), n] as [CardData | undefined, number])
    .filter((x): x is [CardData, number] => !!x[0])
    .sort(([a], [b]) => (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) || (a.kind === 'monster' ? (b.level ?? 0) - (a.level ?? 0) : 0) || a.name.localeCompare(b.name));
}

/** Resolves with the deck for the next game. */
export function sidingScreen(host: HTMLElement, o: SidingOptions): Promise<DeckIds> {
  return new Promise((resolve) => {
    let deck = cloneDeck(o.start);
    let sel: Sel | null = null;
    const limited = !!o.limited;

    const origCount = new Map<string, number>();
    for (const id of [...o.original.main, ...o.original.extra]) origCount.set(id, (origCount.get(id) ?? 0) + 1);

    host.replaceChildren();
    const bg = h('div', { class: 'inter-bg' });
    applyPlaymat(bg, o.playmat);

    const body = h('div', { class: 'sd-body' });
    const status = h('div', { class: 'sd-status', 'aria-live': 'polite' });
    const counts = h('div', { class: 'sd-counts' });
    const resetBtn = button('Reset to original', () => change(cloneDeck(o.original)), { variant: 'subtle', icon: 'refresh', small: true, cls: 'sd-reset' });
    const moveBtn = button('', () => limitedMove(), { variant: 'ghost', small: true, cls: 'sd-move' });
    const skipBtn = button('Skip siding', () => finish(cloneDeck(o.previous)), { variant: 'ghost', cls: 'sd-skip' });
    const doneBtn = button('Done', () => finish(deck), { variant: 'primary', icon: 'check', cls: 'sd-done' });

    const seen = o.opp.seen;
    const oppEl = h(
      'section',
      { class: 'sd-opp' },
      h('div', { class: 'sd-opp-h' }, h('b', null, o.opp.name), o.opp.deck ? h('span', null, o.opp.deck) : null),
      seen.length
        ? h(
            'div',
            { class: 'sd-chips', 'aria-label': `Cards ${o.opp.name} showed` },
            h('span', { class: 'sd-chips-l' }, 'Showed'),
            seen.map(([id, n]) => {
              const c = card(id);
              if (!c) return null;
              const chip = h('button', { type: 'button', class: ['sd-chip', `k-${c.kind}`], title: c.name }, c.name, n > 1 ? h('i', null, `×${n}`) : null);
              chip.addEventListener('click', () => zoomCard(c));
              return chip;
            }),
          )
        : h('div', { class: 'sd-chips-none' }, 'No cards seen yet.'),
    );

    const root = h(
      'div',
      { class: ['sd', limited && 'sd--limited'], role: 'dialog', 'aria-label': `Side deck for game ${o.gameNo}` },
      h(
        'header',
        { class: 'sd-head' },
        h('div', { class: 'sd-eyebrow' }, o.caption),
        h('h2', { class: 'sd-title' }, limited ? 'Adjust your deck' : 'Side Deck', h('span', null, ` · Game ${o.gameNo}`)),
        h('div', { class: 'sd-sub' }, o.status),
      ),
      oppEl,
      body,
      h('footer', { class: 'sd-bar' }, h('div', { class: 'sd-info' }, status, counts), h('div', { class: 'sd-tools' }, resetBtn, moveBtn), h('div', { class: 'sd-actions' }, skipBtn, doneBtn)),
    );
    host.append(bg, root);

    function finish(d: DeckIds) {
      haptic('selection');
      resolve(cloneDeck(d));
    }

    function change(d: DeckIds) {
      deck = d;
      sel = null;
      o.onChange?.(cloneDeck(deck));
      render();
    }

    function tap(sec: Sec, id: string) {
      const c = card(id);
      if (!c) return;
      if (sel && sel.sec === sec && sel.id === id) {
        sel = null;
        return render();
      }
      // a deck card and a side card: swap one copy
      if (sel && (sel.sec === 'side') !== (sec === 'side')) {
        const outId = sec === 'side' ? sel.id : id;
        const inId = sec === 'side' ? id : sel.id;
        const out = card(outId)!;
        const inn = card(inId)!;
        if (!canSwap(out, inn)) {
          flash('Extra Deck monsters swap only with Extra Deck monsters.');
          haptic('warning');
          return;
        }
        const next = swapCards(deck, outId, inId);
        if (next) {
          haptic('light');
          return change(next);
        }
      }
      // Limited: a side card with nothing selected goes straight into the deck
      if (limited && sec === 'side' && !sel) {
        const next = moveToDeck(deck, id);
        if (next) {
          haptic('light');
          return change(next);
        }
      }
      sel = { sec, id };
      haptic('selection');
      render();
    }

    function limitedMove() {
      if (!sel) return;
      const next = sel.sec === 'side' ? moveToDeck(deck, sel.id) : moveToSide(deck, sel.id);
      if (next) change(next);
      else flash(sel.sec === 'side' ? 'That deck section is full.' : 'Your Main Deck needs at least 40 cards.');
    }

    let flashT = 0;
    function flash(msg: string) {
      status.textContent = msg;
      status.classList.add('warn');
      clearTimeout(flashT);
      flashT = window.setTimeout(() => render(), 2200);
    }

    function tileFor(sec: Sec, c: CardData, n: number) {
      const isSel = sel?.sec === sec && sel.id === c.id;
      // while something is selected, show which cards it can swap with
      let can = false;
      let dim = false;
      if (sel && (sel.sec === 'side') !== (sec === 'side')) {
        const ok = canSwap(card(sel.id)!, c);
        can = ok;
        dim = !ok;
      }
      const added = sec !== 'side' && n > (origCount.get(c.id) ?? 0);
      const t = h(
        'div',
        {
          class: ['sd-tile', isSel && 'sel', can && 'can', dim && 'dim', added && 'new'],
          role: 'button',
          tabindex: '0',
          'aria-pressed': isSel ? 'true' : 'false',
          'aria-label': `${c.name}${n > 1 ? `, ${n} copies` : ''}${sec === 'side' ? ', Side Deck' : ''}`,
          dataset: { id: c.id, sec },
        },
        renderCard(c, { size: 'sm' }),
        n > 1 ? h('span', { class: 'sd-n' }, `×${n}`) : null,
        added ? h('span', { class: 'sd-new', 'aria-hidden': 'true' }, '+') : null,
      );
      press(t, { tap: () => tap(sec, c.id), long: () => zoomCard(c) });
      return t;
    }

    function section(sec: Sec, title: string, ids: string[], target: string) {
      const g = grouped(ids);
      return h(
        'section',
        { class: ['sd-sec', `sd-sec--${sec}`] },
        h('div', { class: 'sd-sec-h' }, h('h3', null, title), h('span', { class: 'sd-sec-n' }, String(ids.length), h('small', null, target))),
        g.length ? h('div', { class: 'sd-grid' }, g.map(([c, n]) => tileFor(sec, c, n))) : h('div', { class: 'sd-empty' }, sec === 'side' ? 'Empty.' : 'No cards.'),
      );
    }

    function render() {
      const scroll = body.scrollTop;
      const secs = [
        section('side', limited ? 'Pool (side)' : 'Side Deck', deck.side, limited ? '' : ` / ${o.original.side.length}`),
        section('main', 'Main Deck', deck.main, limited ? ' / 40+' : ` / ${o.original.main.length}`),
      ];
      if (deck.extra.length || deck.side.some((id) => card(id) && isExtraDeckCard(card(id)!))) secs.push(section('extra', 'Extra Deck', deck.extra, limited ? ' / 15' : ` / ${o.original.extra.length}`));
      body.replaceChildren(...secs);
      body.scrollTop = scroll;
      status.classList.remove('warn');
      const sum = sideSummary(o.original, deck);
      if (sel) {
        const c = card(sel.id)!;
        status.replaceChildren(
          h('b', null, c.name),
          sel.sec === 'side' ? ` · tap a ${isExtraDeckCard(c) ? 'Extra' : 'Main'} Deck card to swap it in` : ` · tap a Side card to swap it out`,
        );
      } else if (sum) {
        status.replaceChildren(h('span', { class: 'sd-sum' }, sum));
      } else {
        status.textContent = limited ? 'Tap a pool card to add it, or a deck card then a pool card to swap.' : 'No swaps. Tap a deck card, then a Side card to swap them.';
      }
      counts.textContent = `Main ${deck.main.length} · Extra ${deck.extra.length} · Side ${deck.side.length}`;
      resetBtn.disabled = sameCounts(deck, o.original);
      if (limited && sel) {
        moveBtn.style.display = '';
        moveBtn.querySelector('.ui-btn-label')?.remove();
        moveBtn.append(h('span', { class: 'ui-btn-label' }, sel.sec === 'side' ? 'Add to deck' : 'Move to pool'));
      } else moveBtn.style.display = 'none';
      skipBtn.title = same(o.previous, deck) ? `Play game ${o.gameNo} with the same deck` : `Undo these changes and play game ${o.gameNo} with last game's deck`;
    }

    render();
    setTimeout(() => doneBtn.focus({ preventScroll: true }), 60);
  });
}
