// Searchable / filterable card list used by the Deck Builder and the Card Database.
import { allCards } from '../../cards';
import type { CardData } from '../../engine/card';
import { cap, limitBadge, typeLine } from './components';
import { button, clear, h, icon } from './dom';
import { renderCard, type CardSize } from './ext';

export interface CardFilter {
  q: string;
  searchText: boolean;
  kind: '' | 'monster' | 'spell' | 'trap';
  mtype: string;
  stSub: string;
  attribute: string;
  race: string;
  levelMin: string;
  levelMax: string;
  atkMin: string;
  atkMax: string;
  defMin: string;
  defMax: string;
  archetype: string;
  limit: '' | '0' | '1' | '2' | '3';
  sort: 'name' | 'type' | 'level' | 'atk' | 'def';
}

export const EMPTY_FILTER: CardFilter = {
  q: '',
  searchText: true,
  kind: '',
  mtype: '',
  stSub: '',
  attribute: '',
  race: '',
  levelMin: '',
  levelMax: '',
  atkMin: '',
  atkMax: '',
  defMin: '',
  defMax: '',
  archetype: '',
  limit: '',
  sort: 'type',
};

const KIND_ORDER = (c: CardData) => {
  if (c.kind === 'monster') {
    const t = c.mtypes ?? [];
    if (t.includes('fusion')) return 4;
    if (t.includes('synchro')) return 5;
    return t.includes('normal') ? 0 : 1;
  }
  return c.kind === 'spell' ? 2 : 3;
};

export function sortCards(list: CardData[], sort: CardFilter['sort']) {
  const by = (f: (c: CardData) => number) => (a: CardData, b: CardData) => f(b) - f(a) || a.name.localeCompare(b.name);
  switch (sort) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'level':
      return list.sort(by((c) => c.level ?? -1));
    case 'atk':
      return list.sort(by((c) => (c.kind === 'monster' ? (c.atk ?? 0) : -1)));
    case 'def':
      return list.sort(by((c) => (c.kind === 'monster' ? (c.def ?? 0) : -1)));
    default:
      return list.sort((a, b) => KIND_ORDER(a) - KIND_ORDER(b) || (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
  }
}

const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));

export function filterCards(cards: CardData[], f: CardFilter): CardData[] {
  const q = f.q.trim().toLowerCase();
  const lmin = num(f.levelMin);
  const lmax = num(f.levelMax);
  const amin = num(f.atkMin);
  const amax = num(f.atkMax);
  const dmin = num(f.defMin);
  const dmax = num(f.defMax);
  const out = cards.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !(f.searchText && c.text.toLowerCase().includes(q))) return false;
    if (f.kind && c.kind !== f.kind) return false;
    if (f.mtype && !(c.kind === 'monster' && (c.mtypes ?? []).includes(f.mtype as never))) return false;
    if (f.stSub && (c.kind === 'monster' || (c.stype ?? c.ttype ?? 'normal') !== f.stSub)) return false;
    if (f.attribute && c.attribute !== f.attribute) return false;
    if (f.race && c.race !== f.race) return false;
    if ((lmin != null || lmax != null || amin != null || amax != null || dmin != null || dmax != null) && c.kind !== 'monster') return false;
    if (lmin != null && (c.level ?? 0) < lmin) return false;
    if (lmax != null && (c.level ?? 0) > lmax) return false;
    if (amin != null && (c.atk ?? 0) < amin) return false;
    if (amax != null && (c.atk ?? 0) > amax) return false;
    if (dmin != null && (c.def ?? 0) < dmin) return false;
    if (dmax != null && (c.def ?? 0) > dmax) return false;
    if (f.archetype && !(c.sets ?? []).includes(f.archetype)) return false;
    if (f.limit && String(c.limit ?? 3) !== f.limit) return false;
    return true;
  });
  return sortCards(out, f.sort);
}

export function isExtraCard(c: CardData) {
  return !!(c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion'));
}

export interface BrowserOptions {
  /** Called on primary click. */
  onPick?: (c: CardData, ev: MouseEvent) => void;
  /** Right click (context menu). */
  onAlt?: (c: CardData, ev: MouseEvent) => void;
  onHover?: (c: CardData) => void;
  draggable?: boolean;
  /** Extra info per card (e.g. copies in deck). */
  countOf?: (c: CardData) => number;
  initialView?: 'list' | 'grid';
  gridSize?: CardSize;
  /** Persist filter between visits. */
  storageKey?: string;
  placeholder?: string;
}

export interface CardBrowser {
  el: HTMLElement;
  refresh: () => void;
  focusSearch: () => void;
}

export function cardBrowser(o: BrowserOptions): CardBrowser {
  const cards = allCards();
  const f: CardFilter = { ...EMPTY_FILTER };
  let view: 'list' | 'grid' = o.initialView ?? 'list';
  try {
    if (o.storageKey) Object.assign(f, JSON.parse(sessionStorage.getItem(o.storageKey) ?? '{}'));
  } catch {
    /* ignore */
  }
  const persist = () => {
    try {
      if (o.storageKey) sessionStorage.setItem(o.storageKey, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  };

  const uniq = (vals: (string | undefined)[]) => [...new Set(vals.filter((x): x is string => !!x))].sort();
  const attributes = uniq(cards.map((c) => c.attribute));
  const races = uniq(cards.map((c) => c.race));
  const archetypes = uniq(cards.flatMap((c) => c.sets ?? []));
  const mtypes = ['normal', 'effect', 'tuner', 'fusion', 'synchro', 'ritual', 'flip', 'gemini', 'spirit', 'union', 'toon'].filter((t) =>
    cards.some((c) => (c.mtypes ?? []).includes(t as never)),
  );

  // ---------- controls
  const search = h('input', {
    class: 'input cb-search',
    type: 'search',
    placeholder: o.placeholder ?? 'Search name or text…',
    value: f.q,
    'aria-label': 'Search cards',
  });
  let deb = 0;
  search.addEventListener('input', () => {
    f.q = search.value;
    clearTimeout(deb);
    deb = window.setTimeout(apply, 110);
  });

  const sel = (key: keyof CardFilter, label: string, opts: [string, string][]) => {
    const s = h('select', { class: 'select', 'aria-label': label });
    for (const [v, l] of opts) s.appendChild(h('option', { value: v }, l));
    s.value = String(f[key]);
    s.addEventListener('change', () => {
      (f as any)[key] = s.value;
      apply();
    });
    return h('label', { class: 'cb-field' }, h('span', null, label), s);
  };
  const numIn = (key: keyof CardFilter, ph: string) => {
    const i = h('input', { class: 'input cb-num', type: 'number', inputmode: 'numeric', placeholder: ph, value: String(f[key]), step: '100', min: '0', 'aria-label': ph });
    i.addEventListener('input', () => {
      (f as any)[key] = i.value;
      clearTimeout(deb);
      deb = window.setTimeout(apply, 150);
    });
    return i;
  };
  const kindSeg = h('div', { class: 'cb-kinds', role: 'radiogroup', 'aria-label': 'Card kind' });
  const kinds: [CardFilter['kind'], string][] = [
    ['', 'All'],
    ['monster', 'Monsters'],
    ['spell', 'Spells'],
    ['trap', 'Traps'],
  ];
  const drawKinds = () => {
    clear(kindSeg);
    for (const [v, l] of kinds)
      kindSeg.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['cb-kind', `k-${v || 'all'}`, f.kind === v && 'on'],
            role: 'radio',
            'aria-checked': String(f.kind === v),
            onclick: () => {
              f.kind = v;
              drawKinds();
              apply();
            },
          },
          l,
        ),
      );
  };
  drawKinds();

  const textToggle = h('input', { type: 'checkbox', 'aria-label': 'Search card text' });
  textToggle.checked = f.searchText;
  textToggle.addEventListener('change', () => {
    f.searchText = textToggle.checked;
    apply();
  });

  const adv = h(
    'div',
    { class: 'cb-adv' },
    h(
      'div',
      { class: 'cb-adv-grid' },
      sel('mtype', 'Monster card', [['', 'Any'], ...mtypes.map((t) => [t, cap(t)] as [string, string])]),
      sel('stSub', 'Spell/Trap type', [
        ['', 'Any'],
        ['normal', 'Normal'],
        ['quickplay', 'Quick-Play'],
        ['continuous', 'Continuous'],
        ['equip', 'Equip'],
        ['field', 'Field'],
        ['ritual', 'Ritual'],
        ['counter', 'Counter'],
      ]),
      sel('attribute', 'Attribute', [['', 'Any'], ...attributes.map((a) => [a, a] as [string, string])]),
      sel('race', 'Monster type', [['', 'Any'], ...races.map((a) => [a, a] as [string, string])]),
      sel('archetype', 'Archetype', [['', 'Any'], ...archetypes.map((a) => [a, cap(a.replace(/-/g, ' '))] as [string, string])]),
      sel('limit', 'Banlist', [
        ['', 'Any'],
        ['3', 'Unlimited'],
        ['2', 'Semi-Limited'],
        ['1', 'Limited'],
        ['0', 'Forbidden'],
      ]),
      h('label', { class: 'cb-field cb-range' }, h('span', null, 'Level'), h('div', null, numIn('levelMin', 'min'), h('i', null, '–'), numIn('levelMax', 'max'))),
      h('label', { class: 'cb-field cb-range' }, h('span', null, 'ATK'), h('div', null, numIn('atkMin', 'min'), h('i', null, '–'), numIn('atkMax', 'max'))),
      h('label', { class: 'cb-field cb-range' }, h('span', null, 'DEF'), h('div', null, numIn('defMin', 'min'), h('i', null, '–'), numIn('defMax', 'max'))),
    ),
    h(
      'div',
      { class: 'cb-adv-foot' },
      h('label', { class: 'cb-check' }, textToggle, ' Search card text too'),
      button(
        'Reset filters',
        () => {
          Object.assign(f, EMPTY_FILTER, { sort: f.sort });
          rebuild();
        },
        { variant: 'subtle', small: true, icon: 'refresh' },
      ),
    ),
  );
  const advOpen = sessionStorage.getItem('edison.cb.adv') === '1';
  adv.hidden = !advOpen;
  const filtersBtn = button(
    'Filters',
    () => {
      adv.hidden = !adv.hidden;
      filtersBtn.classList.toggle('on', !adv.hidden);
      try {
        sessionStorage.setItem('edison.cb.adv', adv.hidden ? '0' : '1');
      } catch {
        /* ignore */
      }
    },
    { variant: 'ghost', small: true, icon: 'sort', cls: advOpen ? 'on' : '' },
  );
  const sortSel = h('select', { class: 'select cb-sort', 'aria-label': 'Sort by' });
  for (const [v, l] of [
    ['type', 'Sort: Type'],
    ['name', 'Sort: Name'],
    ['level', 'Sort: Level'],
    ['atk', 'Sort: ATK'],
    ['def', 'Sort: DEF'],
  ])
    sortSel.appendChild(h('option', { value: v }, l));
  sortSel.value = f.sort;
  sortSel.addEventListener('change', () => {
    f.sort = sortSel.value as CardFilter['sort'];
    apply();
  });
  const viewBtn = button('', () => setView(view === 'list' ? 'grid' : 'list'), { variant: 'ghost', small: true, icon: view === 'list' ? 'grid' : 'list', title: 'Toggle grid / list view' });
  const setView = (v: 'list' | 'grid') => {
    view = v;
    viewBtn.replaceChildren(icon(v === 'list' ? 'grid' : 'list'));
    apply();
  };
  const countEl = h('span', { class: 'cb-count' });

  const results = h('div', { class: 'cb-results', role: 'list' });
  const sentinel = h('div', { class: 'cb-sentinel' });
  const scroller = h('div', { class: 'cb-scroll' }, results, sentinel);

  let list: CardData[] = [];
  let shown = 0;
  const PAGE = 48;

  const item = (c: CardData) => {
    const n = o.countOf?.(c) ?? 0;
    const common = {
      role: 'listitem',
      tabindex: '0',
      draggable: o.draggable ? 'true' : undefined,
      title: `${c.name}${o.onPick ? ' — click to add, right-click to add to Side' : ''}`,
      onclick: (e: MouseEvent) => o.onPick?.(c, e),
      oncontextmenu: (e: MouseEvent) => {
        if (!o.onAlt) return;
        e.preventDefault();
        o.onAlt(c, e);
      },
      onmouseenter: () => o.onHover?.(c),
      onfocus: () => o.onHover?.(c),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          o.onPick?.(c, e as unknown as MouseEvent);
        }
      },
      ondragstart: (e: DragEvent) => {
        e.dataTransfer?.setData('text/x-edison-card', JSON.stringify({ name: c.name, from: 'browser' }));
        e.dataTransfer!.effectAllowed = 'copy';
      },
    };
    if (view === 'grid') {
      return h('div', { class: ['cb-cell', c.limit === 0 && 'forbidden'], ...common }, renderCard(c, { size: o.gridSize ?? 'sm', showLimit: true }), n ? h('span', { class: 'cb-n' }, `×${n}`) : null);
    }
    const stats =
      c.kind === 'monster'
        ? h('span', { class: 'cb-stats' }, c.level ? h('span', { class: 'cb-lv' }, `★${c.level}`) : null, h('span', null, `${c.atk ?? '?'}/${c.def ?? '?'}`))
        : h('span', { class: 'cb-stats' });
    return h(
      'div',
      { class: ['cb-row', `kind-${c.kind}`, c.limit === 0 && 'forbidden'], ...common },
      h('span', { class: 'cb-thumb' }, renderCard(c, { size: 'xs' })),
      h('span', { class: 'cb-row-text' }, h('span', { class: 'cb-name' }, c.name), h('span', { class: 'cb-type' }, c.kind === 'monster' ? `${c.attribute ?? ''} · ${typeLine(c)}` : typeLine(c))),
      stats,
      h('span', { class: 'cb-badges' }, limitBadge(c), n ? h('span', { class: 'cb-n' }, `×${n}`) : null),
    );
  };

  const more = () => {
    const next = list.slice(shown, shown + PAGE);
    for (const c of next) results.appendChild(item(c));
    shown += next.length;
    sentinel.hidden = shown >= list.length;
  };

  const apply = () => {
    persist();
    list = filterCards(cards, f);
    shown = 0;
    clear(results);
    results.className = `cb-results view-${view}`;
    countEl.textContent = `${list.length} card${list.length === 1 ? '' : 's'}`;
    if (!list.length) results.appendChild(h('div', { class: 'empty' }, icon('search'), 'No cards match these filters.'));
    more();
    scroller.scrollTop = 0;
  };

  const io = new IntersectionObserver(
    (ents) => {
      if (ents.some((e) => e.isIntersecting) && shown < list.length) more();
    },
    { root: scroller, rootMargin: '400px' },
  );
  io.observe(sentinel);

  const head = h('div', { class: 'cb-head' }, h('div', { class: 'cb-searchrow' }, h('span', { class: 'cb-search-wrap' }, icon('search'), search), filtersBtn), kindSeg, adv, h('div', { class: 'cb-toolbar' }, countEl, h('span', { class: 'cb-spacer' }), sortSel, viewBtn));
  const el = h('div', { class: 'card-browser' }, head, scroller);

  function rebuild() {
    search.value = f.q;
    drawKinds();
    textToggle.checked = f.searchText;
    for (const s of adv.querySelectorAll('select')) s.dispatchEvent(new Event('sync'));
    // re-create advanced controls with reset values
    adv.querySelectorAll<HTMLSelectElement>('select').forEach((s) => (s.value = ''));
    adv.querySelectorAll<HTMLInputElement>('input[type=number]').forEach((i) => (i.value = ''));
    apply();
  }

  apply();
  return {
    el,
    refresh: () => {
      // keep scroll and re-render counts
      const top = scroller.scrollTop;
      const keep = shown;
      clear(results);
      shown = 0;
      while (shown < keep && shown < list.length) more();
      if (!list.length) results.appendChild(h('div', { class: 'empty' }, icon('search'), 'No cards match these filters.'));
      scroller.scrollTop = top;
    },
    focusSearch: () => search.focus(),
  };
}
