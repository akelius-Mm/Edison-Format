// Binder: every card you own, by set (with completion) or by card type, plus the
// Collection-mode switch for deck building and the "trade extras for DP" action.
// It looks and turns like a real side-loading binder: your cover on top (tap to change it), and each section as
// pages of 9 pockets (3 × 3) that you swipe through; a missing card is an empty pocket with its name pencilled in.
import {
  bestOwnedRarity,
  convertExtras,
  dp,
  getCollection,
  isCollectionMode,
  onCollectionChange,
  ownedCount,
  ownedNames,
  ownedRarities,
  setCollectionMode,
  setCompletion,
  totalOwned,
} from '../../collection';
import { playableSets, rarityRank } from '../../collection/catalog';
import { RARITY_NAMES, RARITY_ORDER, type Rarity } from '../../collection/types';
import { findCard } from '../../cards';
import type { CardData } from '../../engine/card';
import { zoomCard } from '../cards/zoom';
import { getSettings, loadJSON, saveJSON, updateSettings } from '../settings';
import { BINDERS, binderById } from '../theme/binders';
import { button, confirmDialog, h, icon, modal, segmented, toast, toggle } from './dom';
import { dpChip, fmtDP, packArt, rarityPill, releaseLabel, foilCard } from './collectionUi';
import { frame, go, type Params, type Screen } from './nav';

type Group = 'set' | 'type';
type Show = 'all' | 'owned' | 'missing' | 'foils';
const PREF_KEY = 'edison.binder.v1';

interface Section {
  key: string;
  title: string;
  sub?: string;
  code?: string;
  names: string[];
  completion?: { owned: number; playable: number; printed: number };
}

const isExtra = (c: CardData) => !!c.mtypes?.some((t) => t === 'synchro' || t === 'fusion');

export function binderScreen(_params: Params): Screen {
  const pref = loadJSON<{ group: Group; show: Show }>(PREF_KEY, { group: 'set', show: 'all' });
  let group: Group = pref.group;
  let show: Show = pref.show;
  let q = '';

  const chipHost = h('div', { class: 'ps-dp' }, dpChip(dp()));
  const summary = h('div', { class: 'bd-summary' });
  const modeRow = h('div', { class: 'bd-mode' });
  const sectionsHost = h('div', { class: 'bd-sections' });
  const extrasHost = h('div', { class: 'bd-extras' });

  const search = h('input', {
    class: 'bd-search-input',
    type: 'search',
    placeholder: 'Search your binder',
    'aria-label': 'Search cards',
    autocomplete: 'off',
    oninput: () => {
      q = search.value.trim().toLowerCase();
      drawSections();
    },
  });
  const groupSeg = segmented(
    [
      { value: 'set', label: 'Sets' },
      { value: 'type', label: 'Types' },
    ],
    group,
    (v) => {
      group = v as Group;
      persist();
      drawSections();
    },
    'Group cards',
  );
  const showChips = h(
    'div',
    { class: 'bd-chips', role: 'radiogroup', 'aria-label': 'Show' },
    (
      [
        ['all', 'All'],
        ['owned', 'Owned'],
        ['missing', 'Missing'],
        ['foils', 'Foils'],
      ] as [Show, string][]
    ).map(([v, label]) =>
      h(
        'button',
        {
          type: 'button',
          class: ['bd-chip', v === show && 'on'],
          role: 'radio',
          'aria-checked': String(v === show),
          dataset: { v },
          onclick: (e: MouseEvent) => {
            show = v;
            persist();
            for (const b of showChips.querySelectorAll<HTMLElement>('.bd-chip')) {
              const on = b === e.currentTarget;
              b.classList.toggle('on', on);
              b.setAttribute('aria-checked', String(on));
            }
            drawSections();
          },
        },
        label,
      ),
    ),
  );

  const el = frame(
    'Binder',
    { actions: chipHost, cls: 'bd-frame', eyebrow: 'Your collection', backTo: () => go('collection'), backLabel: 'Collection' },
    summary,
    modeRow,
    h('div', { class: 'bd-controls' }, h('div', { class: 'bd-searchrow' }, h('label', { class: 'bd-search' }, icon('search'), search), groupSeg), showChips),
    sectionsHost,
    extrasHost,
  );

  function persist() {
    saveJSON(PREF_KEY, { group, show });
  }

  // ---------------------------------------------------------- summary & mode

  function drawSummary() {
    const sets = playableSets().filter((s) => s.playable.length);
    const all = new Set(sets.flatMap((s) => s.playable));
    const have = [...all].filter((n) => ownedCount(n) > 0).length;
    const pct = all.size ? Math.round((have / all.size) * 100) : 0;
    const names = ownedNames();
    const foils = names.filter((n) => rarityRank(bestOwnedRarity(n) ?? 'C') >= rarityRank('SR')).length;
    const s = getCollection().stats;
    const cover = binderById(getSettings().binder);
    summary.replaceChildren(
      h(
        'button',
        {
          type: 'button',
          class: 'bd-cover',
          style: { background: cover.css, '--stitch': cover.stitch, '--ink': cover.ink, '--spine': cover.color },
          'aria-label': `${cover.name} binder, ${pct}% collected. Change the binder`,
          'data-test': 'binder-cover',
          onclick: pickCover,
        },
        h('span', { class: 'bd-cover-label' }, h('b', null, `${pct}%`), h('small', null, getSettings().playerName || 'Duelist')),
      ),
      h(
        'div',
        { class: 'bd-summary-text' },
        h('div', { class: 'bd-summary-main' }, `${have} of ${all.size} era booster cards`),
        h('div', { class: 'bd-stats' }, stat(totalOwned(), 'cards'), stat(names.length, 'unique'), stat(foils, 'foils'), stat(s.packsOpened, 'packs opened')),
      ),
    );
  }
  function pickCover() {
    const cur = getSettings().binder;
    const m = modal(
      'Your binder',
      h(
        'div',
        { class: 'bd-cover-grid', role: 'radiogroup', 'aria-label': 'Binder' },
        BINDERS.map((b) =>
          h(
            'button',
            {
              type: 'button',
              class: ['bd-cover-opt', b.id === cur && 'on'],
              role: 'radio',
              'aria-checked': String(b.id === cur),
              title: b.description,
              onclick: () => {
                updateSettings({ binder: b.id });
                m.close();
                drawSummary();
              },
            },
            h('span', { class: 'bd-cover bd-cover--sm', style: { background: b.css, '--stitch': b.stitch, '--spine': b.color } }),
            h('span', { class: 'bd-cover-name' }, b.name),
          ),
        ),
      ),
      [],
      { dismissable: true },
    );
  }
  const stat = (n: number, label: string) => h('span', { class: 'bd-stat' }, h('b', null, n.toLocaleString('en-US')), ` ${label}`);

  function drawMode() {
    modeRow.replaceChildren(
      h(
        'div',
        { class: 'bd-mode-text' },
        h('div', { class: 'bd-mode-title' }, 'Build decks from my collection'),
        h('div', { class: 'bd-mode-sub' }, 'Your custom decks can only use cards you own. Premade and AI decks stay free to use.'),
      ),
      toggle(isCollectionMode(), (v) => {
        setCollectionMode(v);
        toast(v ? 'Collection mode on: custom decks use cards you own.' : 'Collection mode off: every card is available.', 'info');
      }, 'Build decks from my collection'),
    );
  }

  function drawExtras() {
    const pre = convertExtras(false);
    extrasHost.replaceChildren(
      h(
        'div',
        { class: 'bd-extras-row' },
        h(
          'div',
          { class: 'bd-mode-text' },
          h('div', { class: 'bd-mode-title' }, 'Trade in extra copies'),
          h('div', { class: 'bd-mode-sub' }, pre.copies ? `${pre.copies} cop${pre.copies === 1 ? 'y' : 'ies'} beyond the 3 you can play → ${fmtDP(pre.dp)}. Your best three of each card are kept.` : 'Copies beyond 3 of a card can be traded for Duel Points.'),
        ),
        button(
          'Trade',
          async () => {
            if (!(await confirmDialog('Trade extra copies?', `Trade ${pre.copies} extra cop${pre.copies === 1 ? 'y' : 'ies'} for ${fmtDP(pre.dp)}? Your three best copies of every card stay in the binder.`, 'Trade'))) return;
            const r = convertExtras(true);
            toast(`Traded ${r.copies} copies for ${fmtDP(r.dp)}.`, 'success');
          },
          { variant: 'ghost', small: true, disabled: !pre.copies },
        ),
      ),
    );
  }

  // ---------------------------------------------------------- sections

  function sections(): Section[] {
    const out: Section[] = [];
    if (group === 'set') {
      const inSets = new Set<string>();
      for (const s of playableSets()) {
        if (!s.playable.length) continue;
        s.playable.forEach((n) => inSets.add(n));
        out.push({
          key: s.code,
          code: s.code,
          title: s.data.name,
          sub: `${s.code} · ${releaseLabel(s.data.released)}`,
          names: s.playable,
          completion: setCompletion(s.code),
        });
      }
      const other = ownedNames()
        .filter((n) => !inSets.has(n))
        .sort();
      if (other.length) out.push({ key: 'other', title: 'Structure Decks & other', sub: 'Cards not printed in these boosters', names: other });
    } else {
      const names = new Set<string>(ownedNames());
      if (show === 'missing' || show === 'all') for (const s of playableSets()) s.playable.forEach((n) => names.add(n));
      const by: Record<string, string[]> = { Monsters: [], Spells: [], Traps: [], 'Extra Deck': [] };
      for (const n of names) {
        const c = findCard(n);
        if (!c) continue;
        const k = c.kind === 'spell' ? 'Spells' : c.kind === 'trap' ? 'Traps' : isExtra(c) ? 'Extra Deck' : 'Monsters';
        by[k].push(n);
      }
      for (const [k, list] of Object.entries(by)) if (list.length) out.push({ key: k, title: k, names: list.sort() });
    }
    return out;
  }

  function visible(n: string) {
    if (q && !n.toLowerCase().includes(q)) return false;
    const have = ownedCount(n);
    if (show === 'owned') return have > 0;
    if (show === 'missing') return have === 0;
    if (show === 'foils') return have > 0 && rarityRank(bestOwnedRarity(n) ?? 'C') >= rarityRank('SR');
    return true;
  }

  let io: IntersectionObserver | null = null;
  // Sections near the screen are filled one per task, so a tap or a scroll frame can run in between.
  let queue: (() => void)[] = [];
  let pumping = 0;
  const pump = () => {
    queue.shift()?.();
    pumping = queue.length ? window.setTimeout(pump, 0) : 0;
  };
  function drawSections() {
    io?.disconnect();
    queue = [];
    io = new IntersectionObserver(
      (ents) => {
        for (const e of ents) {
          if (!e.isIntersecting) continue;
          const host = e.target as HTMLElement & { fill?: () => void };
          io!.unobserve(host);
          if (host.fill) queue.push(host.fill);
        }
        if (queue.length && !pumping) pumping = window.setTimeout(pump, 0);
      },
      { rootMargin: '700px 0px' },
    );
    const list = sections()
      .map((s) => ({ ...s, names: s.names.filter(visible) }))
      .filter((s) => s.names.length);
    if (!list.length) {
      sectionsHost.replaceChildren(h('div', { class: 'bd-empty' }, icon('search'), q ? 'No cards match your search.' : show === 'missing' ? 'Nothing missing here.' : 'No cards to show yet.'));
      return;
    }
    sectionsHost.replaceChildren(
      ...list.map((s) => {
        // 9 pockets a page; the last page is padded with empty pockets like a real one
        const pageCount = Math.ceil(s.names.length / 9);
        const pages = h('div', { class: 'bd-pages', role: 'group', 'aria-label': `${s.title}: ${pageCount} page${pageCount === 1 ? '' : 's'}` }) as HTMLElement & { fill?: () => void };
        const counter = h('div', { class: 'bd-page-n' }, pageCount > 1 ? `Page 1 of ${pageCount} · swipe` : 'Page 1 of 1');
        pages.fill = () =>
          pages.replaceChildren(
            ...Array.from({ length: pageCount }, (_, p) => {
              const slice = s.names.slice(p * 9, p * 9 + 9);
              return h('div', { class: 'bd-page' }, ...slice.map(cell), ...Array.from({ length: 9 - slice.length }, () => h('div', { class: 'bd-pocket bd-pocket--empty', 'aria-hidden': 'true' })));
            }),
          );
        let shown = 0;
        pages.addEventListener(
          'scroll',
          () => {
            const w = pages.firstElementChild ? (pages.firstElementChild as HTMLElement).offsetWidth : 1;
            const n = Math.min(pageCount, Math.round(pages.scrollLeft / Math.max(1, w)) + 1);
            if (n !== shown) counter.textContent = `Page ${(shown = n)} of ${pageCount}`;
          },
          { passive: true },
        );
        const grid = pages;
        io!.observe(grid);
        const pct = s.completion && s.completion.playable ? Math.round((s.completion.owned / s.completion.playable) * 100) : null;
        return h(
          'section',
          { class: 'bd-sec' },
          h(
            'header',
            { class: 'bd-sec-head' },
            s.code ? h('div', { class: 'bd-sec-pack' }, packArt(s.code)) : null,
            h('div', { class: 'bd-sec-text' }, h('h2', null, s.title), s.sub ? h('div', { class: 'bd-sec-sub' }, s.sub) : null),
            s.completion
              ? h(
                  'div',
                  { class: 'bd-sec-comp', title: `${s.completion.printed - s.completion.playable} printed cards are not playable yet` },
                  h('b', null, `${pct}%`),
                  h('span', null, `${s.completion.owned}/${s.completion.playable}`),
                  h('div', { class: 'ps-progress' }, h('span', { style: { width: pct + '%' } })),
                )
              : h('div', { class: 'bd-sec-comp' }, h('span', null, `${s.names.length}`)),
          ),
          grid,
          counter,
        );
      }),
    );
  }

  function cell(name: string) {
    const have = ownedCount(name);
    const c = findCard(name);
    if (!have) {
      return h('button', { type: 'button', class: 'bd-pocket bd-cell--missing', 'aria-label': `${name}, not owned`, onclick: () => c && zoomCard(c) }, h('span', null, name));
    }
    const best = bestOwnedRarity(name) ?? 'C';
    const rs = ownedRarities(name);
    const parts = RARITY_ORDER.filter((r) => rs[r]).map((r) => `${rs[r]} ${RARITY_NAMES[r]}`);
    return h(
      'button',
      { type: 'button', class: 'bd-pocket bd-cell', 'aria-label': `${name}: ${parts.join(', ')}`, title: parts.join(' · '), onclick: () => c && zoomCard(c) },
      foilCard(name, best as Rarity, { lazy: true }),
      h('div', { class: 'bd-badges' }, best !== 'C' ? rarityPill(best as Rarity) : null, have > 1 ? h('span', { class: 'bd-n' }, `×${have}`) : null),
    );
  }

  function drawAll() {
    drawSummary();
    drawMode();
    drawSections();
    drawExtras();
  }

  const off = onCollectionChange(() => {
    chipHost.replaceChildren(dpChip(dp()));
    drawSummary();
    drawSections();
    drawExtras();
  });
  drawAll();

  return {
    el,
    dispose: () => {
      off();
      io?.disconnect();
      queue = [];
      window.clearTimeout(pumping);
    },
  };
}
