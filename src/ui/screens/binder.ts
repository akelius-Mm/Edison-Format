// Binder: every card you own, by set (with completion) or by card type, plus the
// Collection-mode switch for deck building and the "trade extras for DP" action.
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
import { loadJSON, saveJSON } from '../settings';
import { button, confirmDialog, h, icon, segmented, toast, toggle } from './dom';
import { dpChip, fmtDP, packArt, rarityPill, releaseLabel, foilCard } from './collectionUi';
import { frame, type Params, type Screen } from './nav';

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
    { actions: chipHost, cls: 'bd-frame', eyebrow: 'Your collection' },
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
    summary.replaceChildren(
      h(
        'div',
        { class: 'bd-ring', style: { '--p': String(pct) }, 'aria-label': `${pct}% of era booster cards collected` },
        h('b', null, `${pct}%`),
      ),
      h(
        'div',
        { class: 'bd-summary-text' },
        h('div', { class: 'bd-summary-main' }, `${have} of ${all.size} era booster cards`),
        h('div', { class: 'bd-stats' }, stat(totalOwned(), 'cards'), stat(names.length, 'unique'), stat(foils, 'foils'), stat(s.packsOpened, 'packs opened')),
      ),
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
        const grid = h('div', { class: 'bd-grid', style: { '--rows': String(Math.ceil(s.names.length / 4)) } }) as HTMLElement & { fill?: () => void };
        grid.fill = () => grid.replaceChildren(...s.names.map(cell));
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
        );
      }),
    );
  }

  function cell(name: string) {
    const have = ownedCount(name);
    const c = findCard(name);
    if (!have) {
      return h(
        'button',
        { type: 'button', class: 'bd-cell bd-cell--missing', 'aria-label': `${name}, not owned`, onclick: () => c && zoomCard(c) },
        h('div', { class: 'bd-pocket' }, h('span', null, name)),
      );
    }
    const best = bestOwnedRarity(name) ?? 'C';
    const rs = ownedRarities(name);
    const parts = RARITY_ORDER.filter((r) => rs[r]).map((r) => `${rs[r]} ${RARITY_NAMES[r]}`);
    return h(
      'button',
      { type: 'button', class: 'bd-cell', 'aria-label': `${name}: ${parts.join(', ')}`, title: parts.join(' · '), onclick: () => c && zoomCard(c) },
      foilCard(name, best as Rarity, { lazy: true }),
      h('div', { class: 'bd-badges' }, best !== 'C' ? rarityPill(best as Rarity) : h('span'), h('span', { class: 'bd-n' }, `×${have}`)),
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
