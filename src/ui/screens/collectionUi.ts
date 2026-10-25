// Shared pieces for the Packs and Binder screens: booster pack art (official product image
// with a drawn fallback), foil card faces per rarity, rarity pills and the DP balance chip.
import './packs.css';
import { findCard } from '../../cards';
import { packImageUrl, packThumbUrl, playableSet } from '../../collection/catalog';
import { PACK_FORMATS } from '../../collection/packs';
import { STRUCTURE_DECKS } from '../../collection/sets';
import { RARITY_NAMES, type Rarity } from '../../collection/types';
import { attachOfficialArt } from '../cards/officialArt';
import { cardArtSrc, renderCard } from '../cards/render';
import { h } from './dom';

export { packImageUrl };

/** Product images that failed this session: go straight to the drawn pack. */
const badImages = new Set<string>();

const year = (iso: string) => iso.slice(0, 4);

/**
 * A booster pack. The drawn design is always present underneath; the official image is
 * layered on top once it has actually loaded.
 */
export function packArt(code: string, opts: { cls?: string; image?: boolean } = {}): HTMLElement {
  const set = playableSet(code);
  const sd = STRUCTURE_DECKS.find((d) => d.code === code);
  const data = set?.data ?? sd;
  const [deep, light] = data?.colors ?? ['#2a2b30', '#c9b68e'];
  const fmt = set ? PACK_FORMATS[set.data.format] : null;
  const kind = sd ? 'Structure Deck' : fmt?.label ?? 'Booster Pack';
  const featured = data?.featured ? findCard(data.featured) : undefined;
  const win = h('div', { class: 'pk-window' });
  if (featured) {
    win.appendChild(h('img', { src: cardArtSrc(featured), alt: '', draggable: false, decoding: 'async' }));
    attachOfficialArt(win, featured.name);
  }
  const el = h(
    'div',
    {
      class: ['pk', sd && 'pk--deck', set?.data.format === 'gold' && 'pk--gold', opts.cls],
      style: { '--pk-deep': deep, '--pk-light': light },
      dataset: { code },
    },
    h(
      'div',
      { class: 'pk-draw', 'aria-hidden': 'true' },
      h('div', { class: 'pk-sheen' }),
      h('div', { class: 'pk-top' }, h('span', { class: 'pk-code' }, code)),
      win,
      h('div', { class: 'pk-name' }, data?.name ?? code),
      h('div', { class: 'pk-kind' }, kind, data ? ` · ${year(data.released)}` : ''),
    ),
  );
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${data?.name ?? code} ${kind}`);
  if (opts.image !== false && !badImages.has(code)) {
    const img = new Image();
    img.className = 'pk-img';
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.onload = () => {
      // Reject tiny placeholder images.
      if (img.naturalWidth < 40) return void badImages.add(code);
      el.appendChild(img);
      el.classList.add('pk--img');
    };
    // Full-size artwork first; if that host fails, the small image; then the drawn pack stays.
    img.onerror = () => {
      if (img.src !== packThumbUrl(code)) img.src = packThumbUrl(code);
      else badImages.add(code);
    };
    img.src = packImageUrl(code);
  }
  return el;
}

/** Short label used on pills ("UR", "ScR"…). Short Prints show as Common. */
export function rarityShort(r: Rarity) {
  return r === 'SP' ? 'C' : r;
}

export function rarityPill(r: Rarity, opts: { long?: boolean } = {}) {
  return h('span', { class: 'rpill', dataset: { r } }, opts.long ? RARITY_NAMES[r] : rarityShort(r));
}

/**
 * A card face with its rarity treatment (silver/gold name, holo art, secret sparkle…).
 * `live` starts the sheen animation (used right after a flip).
 */
export function foilCard(name: string, rarity: Rarity, opts: { live?: boolean; cls?: string; lazy?: boolean } = {}): HTMLElement {
  const data = findCard(name);
  const card = data ? renderCard(data, { size: 'md', lazy: opts.lazy }) : h('div', { class: 'yc yc--md rf-missing' }, name);
  return h(
    'div',
    { class: ['rf', opts.live && 'is-live', opts.cls], dataset: { r: rarity } },
    card,
    rarity === 'C' || rarity === 'SP' ? null : h('div', { class: 'rf-fx', 'aria-hidden': 'true' }, h('div', { class: 'rf-name' }), h('div', { class: 'rf-art' }), h('div', { class: 'rf-full' })),
  );
}

export function dpChip(n: number) {
  return h('span', { class: 'dp-chip', title: 'Duel Points' }, h('span', { class: 'dp-coin', 'aria-hidden': 'true' }), h('b', null, n.toLocaleString('en-US')), h('span', { class: 'dp-unit' }, 'DP'));
}

export const fmtDP = (n: number) => `${n.toLocaleString('en-US')} DP`;

export function releaseLabel(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
