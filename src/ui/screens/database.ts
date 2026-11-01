// Card Database: full browser with a large detail panel.
import { allCards } from '../../cards';
import { PREMADE_DECKS } from '../../decks';
import type { CardData } from '../../engine/card';
import { cardBrowser } from './cardBrowser';
import { cardDetail } from './components';
import { badge, clear, h, modal } from './dom';
import { frame, go, type Screen } from './nav';

export function databaseScreen(): Screen {
  const detail = h('aside', { class: 'dbx-detail' });
  let pinned: CardData | null = null;
  const narrow = () => matchMedia('(max-width: 899px)').matches;
  const show = (c: CardData | null) => {
    clear(detail);
    if (c && pinned?.name === c.name) detail.appendChild(h('div', { class: 'dbx-pin' }, badge('Pinned', 'gold'), h('span', { class: 'muted' }, 'Click the card again to unpin')));
    fill(detail, c);
  };
  const fill = (host: HTMLElement, c: CardData | null) => {
    const detail = host;
    detail.appendChild(cardDetail(c, { size: 'xl' }));
    if (!c) return;
    const decks = PREMADE_DECKS.filter((d) => [...d.main, ...d.extra, ...(d.side ?? [])].some(([n]) => n === c.name));
    detail.appendChild(
      h(
        'div',
        { class: 'dbx-decks' },
        h('div', { class: 'st-sub' }, decks.length ? 'Played in premade decks' : 'Not used in any premade deck'),
        h(
          'div',
          { class: 'dbx-deck-list' },
          decks.map((d) =>
            h(
              'button',
              { type: 'button', class: 'dbx-deck', style: { '--deck': d.color }, onclick: () => go('deck-builder', { from: d.id }), title: `Open a copy of ${d.name} in the Deck Builder` },
              h('i'),
              d.name,
              badge(`×${[...d.main, ...d.extra, ...(d.side ?? [])].filter(([n]) => n === c.name).reduce((a, [, k]) => a + k, 0)}`),
            ),
          ),
        ),
      ),
    );
  };
  const browser = cardBrowser({
    initialView: 'grid',
    gridSize: 'md',
    storageKey: 'edison.cb.database',
    onHover: (c) => {
      if (!pinned && !narrow() && matchMedia('(hover: hover)').matches) show(c);
    },
    onPick: (c) => {
      if (narrow()) {
        const body = h('div', { class: 'dbx-sheet' });
        fill(body, c);
        modal(c.name, body, [{ label: 'Done', variant: 'primary' }], { cls: 'card-modal sheet-modal' });
        return;
      }
      pinned = pinned?.name === c.name ? null : c;
      show(c);
    },
  });
  show(null);
  const total = allCards().length;
  const el = frame(
    'Card Database',
    { subtitle: `${total} cards in the Edison card pool`, cls: 'database frame-wide', compact: true, backTo: () => go('deck-builder'), backLabel: 'Decks', actions: h('span', { class: 'head-count' }, `${total} cards`) },
    h('div', { class: 'dbx-layout' }, h('section', { class: 'dbx-browser' }, browser.el), detail),
  );
  return { el, onShow: () => setTimeout(() => !narrow() && browser.focusSearch(), 80) };
}
