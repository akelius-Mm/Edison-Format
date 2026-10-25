// Deck Builder: card browser + editable Main/Extra/Side deck with live validation and stats.
import { findCard } from '../../cards';
import { PREMADE_DECKS, validateDeck } from '../../decks';
import type { CardData } from '../../engine/card';
import { isExtraCard, cardBrowser, sortCards } from './cardBrowser';
import { cardDetail, deckTile } from './components';
import { append, button, clear, confirmDialog, h, icon, modal, promptDialog, segmented, toast, type Child } from './dom';
import { zoomCard } from '../cards/zoom';
import { renderCard } from './ext';
import { frame, go, type Params, type Screen } from './nav';
import {
  copyOfPremade,
  deckCount,
  deleteCustomDeck,
  exportDeckText,
  getCustomDeck,
  listCustomDecks,
  newDeckId,
  parseDeckText,
  premadeInfo,
  saveCustomDeck,
  uniqueDeckName,
  type Entry,
  type SavedDeck,
} from './store';

type Section = 'main' | 'extra' | 'side';
const LAST_KEY = 'edison.deckBuilder.last';
const MAX: Record<Section, number> = { main: 60, extra: 15, side: 15 };
const DRAG_TYPE = 'text/x-edison-card';

export function deckBuilderScreen(params: Params): Screen {
  let cur: SavedDeck | null = null;
  let selected: CardData | null = null;
  let mobileTab: 'deck' | 'cards' | 'info' = 'deck';
  let shownSection: Section = 'main';

  // ---------- load initial deck
  const all = listCustomDecks();
  if (params.from) {
    const p = PREMADE_DECKS.find((d) => d.id === params.from);
    if (p) {
      cur = copyOfPremade(p);
      saveCustomDeck(cur);
      // don't create another copy if the page is reloaded
      history.replaceState(null, '', `#/deck-builder?deck=${cur.id}`);
    }
  }
  if (!cur && params.deck) cur = getCustomDeck(params.deck) ?? null;
  if (!cur) {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {
      /* ignore */
    }
    cur = (last && all.find((d) => d.id === last)) || all[0] || null;
  }

  // ---------- helpers
  const copies = (name: string) => (cur ? [...cur.main, ...cur.extra, ...cur.side].filter(([n]) => n === name).reduce((a, [, c]) => a + c, 0) : 0);
  const list = (s: Section) => cur![s];

  function add(name: string, section: Section, quiet = false): boolean {
    if (!cur) return false;
    const c = findCard(name);
    if (!c) return false;
    if (section === 'main' && isExtraCard(c)) section = 'extra';
    if (section === 'extra' && !isExtraCard(c)) section = 'main';
    const lim = c.limit ?? 3;
    if (lim === 0) {
      if (!quiet) toast(`${c.name} is Forbidden in Edison Format.`, 'error');
      return false;
    }
    if (copies(name) >= lim) {
      if (!quiet) toast(lim === 3 ? `Maximum 3 copies of ${c.name}.` : `${c.name} is ${lim === 1 ? 'Limited' : 'Semi-Limited'} (${lim} cop${lim === 1 ? 'y' : 'ies'}).`, 'error');
      return false;
    }
    if (deckCount(list(section)) >= MAX[section]) {
      if (!quiet) toast(`${section === 'main' ? 'Main' : section === 'extra' ? 'Extra' : 'Side'} Deck is full (${MAX[section]}).`, 'error');
      return false;
    }
    const e = list(section).find(([n]) => n === c.name);
    if (e) e[1]++;
    else list(section).push([c.name, 1]);
    return true;
  }
  function remove(name: string, section: Section) {
    if (!cur) return;
    const l = list(section);
    const i = l.findIndex(([n]) => n === name);
    if (i < 0) return;
    l[i][1]--;
    if (l[i][1] <= 0) l.splice(i, 1);
  }
  function move(name: string, from: Section, to: Section) {
    if (from === to || !cur) return;
    const c = findCard(name);
    if (!c) return;
    if (to !== 'side' && from === 'side') to = isExtraCard(c) ? 'extra' : 'main';
    if (deckCount(list(to)) >= MAX[to]) return toast('That section is full.', 'error');
    remove(name, from);
    const e = list(to).find(([n]) => n === name);
    if (e) e[1]++;
    else list(to).push([name, 1]);
    commit();
  }

  let savedTimer = 0;
  function commit() {
    if (!cur) return;
    saveCustomDeck(cur);
    try {
      localStorage.setItem(LAST_KEY, cur.id);
    } catch {
      /* ignore */
    }
    drawDeck();
    drawInfo();
    browser.refresh();
    saveState.textContent = 'Saved';
    saveState.classList.add('flash');
    clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => saveState.classList.remove('flash'), 900);
  }

  function select(c: CardData | null) {
    selected = c;
    drawDetail();
    drawSelBar();
    deckCol.querySelectorAll<HTMLElement>('.dk-slot').forEach((el) => el.classList.toggle('sel', !!c && el.dataset.name === c.name));
  }

  // ---------- selection bar (phone-friendly edit controls for the selected deck card)
  const selBar = h('div', { class: 'db-selbar', 'aria-live': 'polite' });
  function drawSelBar() {
    const c = selected;
    const inDeck = c && cur ? (['main', 'extra', 'side'] as Section[]).filter((x) => list(x).some(([n]) => n === c.name)) : [];
    selBar.hidden = !c || !cur;
    if (!c || !cur) return selBar.replaceChildren();
    const from = inDeck.includes(shownSection) ? shownSection : inDeck[0];
    const mini = (label: string, ic: Parameters<typeof icon>[0], fn: () => void, disabled = false, title = label) => {
      const b = h('button', { type: 'button', class: 'db-selbtn', title, 'aria-label': title, onclick: fn }, icon(ic), label ? h('span', null, label) : null);
      b.disabled = disabled;
      return b;
    };
    selBar.replaceChildren(
      h('button', { type: 'button', class: 'db-selcard', title: 'View card', onclick: () => zoomCard(c) }, renderCard(c, { size: 'xs' }), h('span', { class: 'db-seltext' }, h('b', null, c.name), h('span', null, `${copies(c.name)} of ${c.limit ?? 3} in deck`))),
      mini('', 'minus', () => from && (remove(c.name, from), commit()), !from, 'Remove one copy'),
      mini('', 'plus', () => add(c.name, from === 'side' ? 'side' : 'main') && commit(), false, 'Add one copy'),
      ...(from ? [mini(from === 'side' ? 'Main' : 'Side', 'shuffle', () => move(c.name, from, from === 'side' ? 'main' : 'side'), false, from === 'side' ? 'Move to Main/Extra Deck' : 'Move to Side Deck')] : []),
    );
  }

  // ---------- browser
  const browser = cardBrowser({
    draggable: true,
    storageKey: 'edison.cb.builder',
    countOf: (c) => copies(c.name),
    onHover: (c) => select(c),
    onPick: (c, e) => {
      if (!cur) return toast('Create or open a deck first.', 'error');
      if (add(c.name, e.shiftKey ? 'side' : 'main')) commit();
    },
    onAlt: (c) => {
      if (!cur) return;
      if (add(c.name, 'side')) commit();
    },
  });
  const browserCol = h('section', { class: 'db-col db-browser' }, browser.el);
  browserCol.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
      e.preventDefault();
      browserCol.classList.add('drop-remove');
    }
  });
  browserCol.addEventListener('dragleave', () => browserCol.classList.remove('drop-remove'));
  browserCol.addEventListener('drop', (e) => {
    browserCol.classList.remove('drop-remove');
    const d = readDrag(e);
    if (d && d.from !== 'browser') {
      e.preventDefault();
      remove(d.name, d.from as Section);
      commit();
    }
  });

  // ---------- deck column
  const deckCol = h('section', { class: 'db-col db-deck' });
  const saveState = h('span', { class: 'db-saved' }, 'Saved');

  function readDrag(e: DragEvent): { name: string; from: string } | null {
    try {
      return JSON.parse(e.dataTransfer?.getData(DRAG_TYPE) || 'null');
    } catch {
      return null;
    }
  }

  function sectionEl(s: Section, title: string, hint: string) {
    const entries = list(s);
    const n = deckCount(entries);
    const grid = h('div', { class: 'dk-grid' });
    for (const [name, cnt] of entries) {
      const c = findCard(name);
      for (let i = 0; i < cnt; i++) {
        let pressT = 0;
        const slot = h(
          'div',
          {
            class: ['dk-slot', selected?.name === name && 'sel', !c && 'missing'],
            dataset: { name },
            draggable: 'true',
            tabindex: '0',
            onpointerdown: (e: PointerEvent) => {
              if (e.pointerType !== 'touch') return;
              clearTimeout(pressT);
              pressT = window.setTimeout(() => {
                remove(name, s);
                commit();
                toast(`Removed ${name}.`, 'info', 1400);
              }, 550);
            },
            onpointerup: () => clearTimeout(pressT),
            onpointercancel: () => clearTimeout(pressT),
            onpointerleave: () => clearTimeout(pressT),
            title: `${name} — right-click or Delete to remove`,
            onclick: () => c && select(c),
            onmouseenter: (e: MouseEvent) => c && (e as PointerEvent).pointerType !== 'touch' && matchMedia('(hover: hover)').matches && select(c),
            oncontextmenu: (e: MouseEvent) => {
              e.preventDefault();
              clearTimeout(pressT);
              if (matchMedia('(hover: none)').matches) return;
              remove(name, s);
              commit();
            },
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                remove(name, s);
                commit();
              }
            },
            ondragstart: (e: DragEvent) => {
              e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ name, from: s }));
              e.dataTransfer!.effectAllowed = 'move';
            },
          },
          c ? renderCard(c, { size: 'sm', showLimit: true }) : h('div', { class: 'dk-missing' }, name),
        );
        grid.appendChild(slot);
      }
    }
    if (!n) grid.appendChild(h('div', { class: 'dk-empty' }, hint));
    const target = s === 'main' ? '40–60' : '0–15';
    const bad = s === 'main' ? n < 40 || n > 60 : n > 15;
    const sec = h(
      'div',
      { class: ['dk-section', `dk-${s}`] },
      h('div', { class: 'dk-head' }, h('h3', null, title), h('span', { class: ['dk-count', bad && 'bad'] }, `${n}`, h('small', null, ` / ${target}`)), s === 'main' ? typeSplit(entries) : null),
      grid,
    );
    sec.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        sec.classList.add('drop');
      }
    });
    sec.addEventListener('dragleave', (e) => {
      if (!sec.contains(e.relatedTarget as Node)) sec.classList.remove('drop');
    });
    sec.addEventListener('drop', (e) => {
      sec.classList.remove('drop');
      const d = readDrag(e);
      if (!d) return;
      e.preventDefault();
      if (d.from === 'browser') {
        if (add(d.name, s)) commit();
      } else move(d.name, d.from as Section, s);
    });
    return sec;
  }

  function typeSplit(entries: Entry[]) {
    let m = 0,
      sp = 0,
      t = 0;
    for (const [name, n] of entries) {
      const c = findCard(name);
      if (!c) continue;
      if (c.kind === 'monster') m += n;
      else if (c.kind === 'spell') sp += n;
      else t += n;
    }
    return h('span', { class: 'dk-split' }, h('span', { class: 'k-monster' }, `${m} Monsters`), h('span', { class: 'k-spell' }, `${sp} Spells`), h('span', { class: 'k-trap' }, `${t} Traps`));
  }

  function drawDeck() {
    clear(deckCol);
    if (!cur) {
      deckCol.appendChild(startView());
      return;
    }
    const nameIn = h('input', { class: 'db-name', value: cur.name, maxlength: 40, 'aria-label': 'Deck name', spellcheck: false });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim();
      if (!v || !cur) return;
      cur.name = v;
      commit();
      drawHeader();
    });
    const problems = validateDeck(cur);
    const legal = h(
      'span',
      { class: ['db-legal', problems.length ? 'bad' : 'ok'], title: problems.join('\n') },
      icon(problems.length ? 'warn' : 'check'),
      problems.length ? `${problems.length} problem${problems.length > 1 ? 's' : ''}` : 'Legal',
    );
    const tool = (label: string, fn: () => void, ic: Parameters<typeof icon>[0], danger = false) =>
      h('button', { type: 'button', class: ['db-tool', danger && 'danger'], onclick: fn, title: label }, icon(ic), h('span', null, label));
    const tools = h(
      'div',
      { class: 'db-tools' },
      tool('Sort', sortDeck, 'sort'),
      tool('Test hand', testHand, 'hand'),
      tool('Import', importDeck, 'upload'),
      tool('Export', exportDeck, 'download'),
      tool('Duplicate', duplicateDeck, 'copy'),
      tool('Clear', () => void clearDeck(), 'refresh'),
      tool('Delete', () => void deleteDeck(), 'trash', true),
    );
    const n = (x: Section) => deckCount(list(x));
    const secSeg = segmented<Section>(
      [
        { value: 'main', label: `Main ${n('main')}` },
        { value: 'extra', label: `Extra ${n('extra')}` },
        { value: 'side', label: `Side ${n('side')}` },
      ],
      shownSection,
      (v) => {
        shownSection = v;
        sections.dataset.section = v;
        drawSelBar();
      },
      'Deck section',
    );
    secSeg.classList.add('db-secseg');
    const sections = h(
      'div',
      { class: 'db-sections', dataset: { section: shownSection } },
      sectionEl('main', 'Main Deck', 'Tap cards in Add cards (or drag them here) to build your Main Deck.'),
      sectionEl('extra', 'Extra Deck', 'Synchro and Fusion monsters go here.'),
      sectionEl('side', 'Side Deck', 'Add cards to the Side Deck from the card list or the selection bar.'),
    );
    deckCol.append(
      h('div', { class: 'db-deckbar' }, h('div', { class: 'db-namewrap' }, nameIn), legal, saveState),
      tools,
      secSeg,
      selBar,
      sections,
      h(
        'div',
        { class: 'db-hint' },
        h('span', { class: 'hint-mouse' }, h('b', null, 'Click'), ' add · ', h('b', null, 'Shift/Right-click'), ' add to Side · ', h('b', null, 'Right-click'), ' a deck card to remove · ', h('b', null, 'Drag'), ' between sections or back to the list'),
        h('span', { class: 'hint-touch' }, h('b', null, 'Tap'), ' a card to select it · ', h('b', null, 'Press and hold'), ' to remove one copy'),
      ),
    );
    drawSelBar();
  }

  function startView() {
    return h(
      'div',
      { class: 'db-start' },
      h('div', { class: 'db-start-title' }, icon('cards'), h('h2', null, 'Start a new deck')),
      h('p', { class: 'muted' }, 'Build from scratch, start from one of the premade Edison decks, or paste a decklist.'),
      h(
        'div',
        { class: 'db-start-actions' },
        button('Blank deck', newBlank, { variant: 'primary', icon: 'plus' }),
        button('Copy a premade deck', choosePremade, { variant: 'ghost', icon: 'copy' }),
        button('Import decklist', importDeck, { variant: 'ghost', icon: 'upload' }),
      ),
    );
  }

  // ---------- info column (detail + stats)
  const detailHost = h('div', { class: 'db-detail' });
  const statsHost = h('div', { class: 'db-stats' });
  const infoCol = h('section', { class: 'db-col db-info' }, detailHost, statsHost);

  function drawDetail() {
    const c = selected;
    clear(detailHost);
    const actions: Child = c && cur
      ? [
          button('Main', () => add(c.name, 'main') && commit(), { variant: 'ghost', small: true, icon: 'plus', title: 'Add to Main/Extra Deck' }),
          button('Side', () => add(c.name, 'side') && commit(), { variant: 'ghost', small: true, icon: 'plus', title: 'Add to Side Deck' }),
          button(
            '',
            () => {
              const s = (['side', 'extra', 'main'] as Section[]).find((x) => list(x).some(([n]) => n === c.name));
              if (s) {
                remove(c.name, s);
                commit();
              }
            },
            { variant: 'ghost', small: true, icon: 'minus', title: 'Remove one copy', disabled: !copies(c.name) },
          ),
          h('span', { class: 'cd-copies' }, `${copies(c.name)} / ${c.limit ?? 3} in deck`),
        ]
      : null;
    detailHost.appendChild(cardDetail(c, { actions }));
  }

  function drawInfo() {
    clear(statsHost);
    if (!cur) return;
    const main = cur.main.map(([n, k]) => [findCard(n), k] as const).filter((x): x is readonly [CardData, number] => !!x[0]);
    let mon = 0,
      sp = 0,
      tr = 0,
      tuners = 0;
    const levels = new Map<number, number>();
    for (const [c, k] of main) {
      if (c.kind === 'monster') {
        mon += k;
        if (c.mtypes?.includes('tuner')) tuners += k;
        levels.set(c.level ?? 0, (levels.get(c.level ?? 0) ?? 0) + k);
      } else if (c.kind === 'spell') sp += k;
      else tr += k;
    }
    const total = Math.max(1, mon + sp + tr);
    const bar = (label: string, n: number, cls: string) =>
      h('div', { class: 'st-bar' }, h('span', { class: 'st-l' }, label), h('span', { class: 'st-track' }, h('i', { class: cls, style: { width: `${(n / total) * 100}%` } })), h('b', null, String(n)));
    const maxLv = Math.max(1, ...levels.values());
    const curve = h(
      'div',
      { class: 'st-curve' },
      [1, 2, 3, 4, 5, 6, 7, 8].map((lv) => {
        const n = lv === 8 ? [...levels].filter(([l]) => l >= 8).reduce((a, [, k]) => a + k, 0) : (levels.get(lv) ?? 0);
        return h('div', { class: 'st-col', title: `Level ${lv}${lv === 8 ? '+' : ''}: ${n}` }, h('span', { class: 'st-n' }, n ? String(n) : ''), h('i', { style: { height: `${(n / maxLv) * 100}%` } }), h('span', { class: 'st-lv' }, lv === 8 ? '8+' : String(lv)));
      }),
    );
    const extra = cur.extra.map(([n, k]) => [findCard(n), k] as const);
    const syn = extra.filter(([c]) => c?.mtypes?.includes('synchro')).reduce((a, [, k]) => a + k, 0);
    const fus = extra.filter(([c]) => c?.mtypes?.includes('fusion')).reduce((a, [, k]) => a + k, 0);
    const problems = validateDeck(cur);
    // probability of opening at least one tuner (5 cards)
    const pOpen = (k: number, N: number, draw = 5) => {
      if (!k || N < draw) return 0;
      let p = 1;
      for (let i = 0; i < draw; i++) p *= (N - k - i) / (N - i);
      return 1 - p;
    };
    statsHost.append(
      h('div', { class: 'section-title' }, h('h2', null, 'Deck statistics')),
      bar('Monsters', mon, 'k-monster'),
      bar('Spells', sp, 'k-spell'),
      bar('Traps', tr, 'k-trap'),
      h('div', { class: 'st-sub' }, 'Monster level curve'),
      curve,
      h(
        'div',
        { class: 'st-chips' },
        h('span', { class: 'stat-chip' }, h('b', null, String(tuners)), h('span', null, 'Tuners')),
        h('span', { class: 'stat-chip' }, h('b', null, String(syn)), h('span', null, 'Synchro')),
        h('span', { class: 'stat-chip' }, h('b', null, String(fus)), h('span', null, 'Fusion')),
        h('span', { class: 'stat-chip', title: 'Chance to open at least one Tuner in 5 cards' }, h('b', null, `${Math.round(pOpen(tuners, mon + sp + tr) * 100)}%`), h('span', null, 'Tuner open')),
      ),
      problems.length
        ? h('div', { class: 'st-problems' }, h('div', { class: 'st-sub bad' }, icon('warn'), ` ${problems.length} problem${problems.length > 1 ? 's' : ''}`), h('ul', null, problems.map((p) => h('li', null, p))))
        : h('div', { class: 'st-ok' }, icon('check'), ' This deck is legal for Edison Format.'),
    );
  }

  // ---------- deck operations
  function open(d: SavedDeck | null) {
    cur = d;
    if (d)
      try {
        localStorage.setItem(LAST_KEY, d.id);
      } catch {
        /* ignore */
      }
    drawHeader();
    drawDeck();
    drawInfo();
    browser.refresh();
  }
  function newBlank() {
    const d: SavedDeck = { id: newDeckId(), name: uniqueDeckName('New Deck'), main: [], extra: [], side: [], created: Date.now(), updated: Date.now() };
    saveCustomDeck(d);
    open(d);
    toast('New deck created.', 'success');
  }
  function choosePremade() {
    if (!PREMADE_DECKS.length) return toast('No premade decks available.', 'error');
    const grid = h('div', { class: 'premade-grid' });
    const m = modal('Start from a premade deck', grid, [{ label: 'Cancel' }], { wide: true });
    for (const p of PREMADE_DECKS)
      grid.appendChild(
        deckTile(premadeInfo(p), {
          onClick: () => {
            const d = copyOfPremade(p);
            saveCustomDeck(d);
            m.close();
            open(d);
            toast(`Copied ${p.name}.`, 'success');
          },
        }),
      );
  }
  function sortDeck() {
    if (!cur) return;
    for (const s of ['main', 'extra', 'side'] as Section[]) {
      const cards = sortCards(
        list(s)
          .map(([n]) => findCard(n))
          .filter((c): c is CardData => !!c),
        'type',
      );
      const counts = new Map(list(s));
      cur[s] = [...cards.map((c) => [c.name, counts.get(c.name)!] as Entry), ...list(s).filter(([n]) => !findCard(n))];
    }
    commit();
  }
  async function clearDeck() {
    if (!cur) return;
    if (!(await confirmDialog('Clear deck', `Remove every card from ${cur.name}?`, 'Clear', true))) return;
    cur.main = [];
    cur.extra = [];
    cur.side = [];
    commit();
  }
  async function deleteDeck() {
    if (!cur) return;
    if (!(await confirmDialog('Delete deck', `Delete ${cur.name}? This cannot be undone.`, 'Delete', true))) return;
    deleteCustomDeck(cur.id);
    toast('Deck deleted.');
    open(listCustomDecks()[0] ?? null);
  }
  function duplicateDeck() {
    if (!cur) return;
    const d: SavedDeck = { ...structuredClone(cur), id: newDeckId(), name: uniqueDeckName(cur.name + ' copy'), created: Date.now() };
    saveCustomDeck(d);
    open(d);
    toast('Deck duplicated.', 'success');
  }
  async function renameDeck() {
    if (!cur) return;
    const n = await promptDialog('Rename deck', 'Deck name', cur.name, 'Rename');
    if (n) {
      cur.name = n;
      commit();
      drawHeader();
    }
  }
  function exportDeck() {
    if (!cur) return;
    const text = exportDeckText(cur);
    const ta = h('textarea', { class: 'textarea', readonly: true, 'aria-label': 'Decklist' }, text);
    modal(
      `Export ${cur.name}`,
      h('div', { class: 'io-body' }, h('p', { class: 'muted' }, 'Plain-text decklist: one "count Card Name" per line, with #main / #extra / #side sections.'), ta),
      [
        {
          label: 'Download .txt',
          icon: 'download',
          onClick: () => {
            const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `${cur!.name.replace(/[^\w\- ]+/g, '')}.txt` });
            a.click();
            return false;
          },
        },
        {
          label: 'Copy to clipboard',
          variant: 'primary',
          icon: 'copy',
          onClick: () => {
            copyText(text, ta);
            return false;
          },
        },
      ],
      { wide: true },
    );
    setTimeout(() => ta.select(), 50);
  }
  function importDeck() {
    const ta = h('textarea', { class: 'textarea', placeholder: '#main\n3 Card Trooper\n1 Dark Armed Dragon\n…\n#extra\n1 Stardust Dragon\n#side\n2 Dimensional Prison', 'aria-label': 'Decklist to import' });
    const report = h('div', { class: 'io-report' });
    const preview = () => {
      const p = parseDeckText(ta.value);
      const n = deckCount(p.main) + deckCount(p.extra) + deckCount(p.side);
      clear(report);
      append(report, [
        h('span', null, `${deckCount(p.main)} main · ${deckCount(p.extra)} extra · ${deckCount(p.side)} side`),
        p.unknown.length ? h('span', { class: 'bad' }, ` · ${p.unknown.length} unknown: ${p.unknown.slice(0, 4).join(', ')}${p.unknown.length > 4 ? '…' : ''}`) : null,
        !n && ta.value.trim() ? h('span', { class: 'bad' }, ' · nothing recognised') : null,
      ]);
    };
    ta.addEventListener('input', preview);
    const doImport = (asNew: boolean) => {
      const p = parseDeckText(ta.value);
      if (!deckCount(p.main) && !deckCount(p.extra) && !deckCount(p.side)) {
        toast('No cards recognised in that text.', 'error');
        return false;
      }
      let d: SavedDeck;
      if (asNew || !cur) {
        d = { id: newDeckId(), name: uniqueDeckName(p.name || 'Imported Deck'), main: [], extra: [], side: [], created: Date.now(), updated: Date.now() };
      } else {
        d = cur;
        d.main = [];
        d.extra = [];
        d.side = [];
      }
      const prev = cur;
      cur = d;
      let rejected = 0;
      for (const s of ['main', 'extra', 'side'] as Section[]) for (const [n, k] of p[s]) for (let i = 0; i < k; i++) if (!add(n, s, true)) rejected++;
      cur = prev;
      saveCustomDeck(d);
      open(d);
      toast(`Imported ${d.name}${rejected ? ` (${rejected} card${rejected > 1 ? 's' : ''} over the limit skipped)` : ''}${p.unknown.length ? ` · ${p.unknown.length} unknown` : ''}.`, rejected || p.unknown.length ? 'info' : 'success', 4000);
      return true;
    };
    const actions: Parameters<typeof modal>[2] = [
      {
        label: 'Paste from clipboard',
        icon: 'clipboard',
        onClick: () => {
          navigator.clipboard
            ?.readText()
            .then((t) => {
              ta.value = t;
              preview();
            })
            .catch(() => toast('Clipboard access was blocked — paste with Ctrl+V instead.', 'error'));
          return false;
        },
      },
    ];
    if (cur) actions.push({ label: 'Replace current deck', onClick: () => doImport(false) });
    actions.push({ label: 'Import as new deck', variant: 'primary', icon: 'upload', onClick: () => doImport(true) });
    modal('Import decklist', h('div', { class: 'io-body' }, h('p', { class: 'muted' }, 'Paste a decklist. Lines look like "3 Card Name" (also "3x Card Name"); use #main, #extra and #side headers.'), ta, report), actions, { wide: true });
    setTimeout(() => ta.focus(), 50);
  }
  function testHand() {
    if (!cur) return;
    const pool: CardData[] = [];
    for (const [n, k] of cur.main) {
      const c = findCard(n);
      if (c) for (let i = 0; i < k; i++) pool.push(c);
    }
    if (pool.length < 6) return toast('Add at least 6 cards to draw a test hand.', 'error');
    const hand = h('div', { class: 'test-hand' });
    const draw = () => {
      const p = [...pool];
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
      }
      hand.replaceChildren(
        ...p.slice(0, 6).map((c, i) => h('div', { class: ['th-card', i === 5 && 'sixth'], style: { '--i': i } }, renderCard(c, { size: 'md' }), i === 5 ? h('span', { class: 'th-label' }, 'Draw (going 2nd)') : null)),
      );
    };
    draw();
    modal('Sample opening hand', hand, [
      { label: 'Close' },
      {
        label: 'Draw again',
        variant: 'primary',
        icon: 'shuffle',
        onClick: () => {
          draw();
          return false;
        },
      },
    ], { wide: true });
  }

  // ---------- header (deck switcher)
  const deckSel = h('select', { class: 'select db-switch', 'aria-label': 'Open deck' });
  deckSel.addEventListener('change', () => {
    const d = getCustomDeck(deckSel.value);
    if (d) open(d);
  });
  function drawHeader() {
    clear(deckSel);
    const ds = listCustomDecks().sort((a, b) => a.name.localeCompare(b.name));
    if (!ds.length) deckSel.appendChild(h('option', { value: '' }, 'No saved decks'));
    for (const d of ds) deckSel.appendChild(h('option', { value: d.id }, `${d.name} (${deckCount(d.main)})`));
    if (cur) deckSel.value = cur.id;
    deckSel.disabled = !ds.length;
  }
  const headerActions = h(
    'div',
    { class: 'db-head-actions' },
    deckSel,
    h(
      'button',
      {
        type: 'button',
        class: 'head-icon-btn',
        title: 'New deck',
        'aria-label': 'New deck',
        onclick: () => {
          const m = modal(
            'New deck',
            h(
              'div',
              { class: 'db-start-actions vertical' },
              button('Blank deck', () => (m.close(), newBlank()), { variant: 'primary', icon: 'plus' }),
              button('Copy a premade deck', () => (m.close(), choosePremade()), { variant: 'ghost', icon: 'copy' }),
              button('Import decklist', () => (m.close(), importDeck()), { variant: 'ghost', icon: 'upload' }),
            ),
            [],
          );
        },
      },
      icon('plus'),
    ),
  );
  void renameDeck;

  // ---------- mobile tabs
  const layout = h('div', { class: 'db-layout', dataset: { tab: mobileTab } }, infoCol, deckCol, browserCol);
  const tabs = segmented<'deck' | 'cards' | 'info'>(
    [
      { value: 'deck', label: 'Deck' },
      { value: 'cards', label: 'Add cards' },
      { value: 'info', label: 'Stats' },
    ],
    mobileTab,
    (t) => {
      mobileTab = t;
      layout.dataset.tab = t;
    },
    'Deck Builder view',
  );
  tabs.classList.add('db-tabs');

  const el = frame('Decks', { cls: 'deck-builder frame-wide', actions: headerActions, compact: true }, tabs, layout);

  drawHeader();
  drawDeck();
  drawDetail();
  drawInfo();

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      browser.focusSearch();
    }
  };
  document.addEventListener('keydown', onKey);
  return { el, dispose: () => document.removeEventListener('keydown', onKey), onShow: () => setTimeout(() => matchMedia('(hover: hover)').matches && browser.focusSearch(), 80) };
}

export function copyText(text: string, fallback?: HTMLTextAreaElement) {
  const done = () => toast('Copied to clipboard.', 'success');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => legacy());
  } else legacy();
  function legacy() {
    if (fallback) {
      fallback.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        toast('Copy failed — select the text and press Ctrl+C.', 'error');
      }
    }
  }
}

export const openDeckBuilderWith = (premadeId: string) => go('deck-builder', { from: premadeId });
