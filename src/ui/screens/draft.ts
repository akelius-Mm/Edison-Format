// Draft mode screens: home (setup / resume), pack opening, picking, deck building,
// the 3-round draft tournament against the AI drafters, and the final result.
// The event logic lives in src/draft; this file only drives and persists it.
import './draft.css';
import type { CardData } from '../../engine/card';
import {
  advanceRound,
  autoBuildHuman,
  card,
  createDraft,
  deckOf,
  deckProblems,
  describeDeck,
  fromIds,
  humanMatch,
  humanPack,
  humanRecord,
  isExtraDeck,
  isFoilRarity,
  makePick,
  markOpened,
  needsOpening,
  passDir,
  playerById,
  rarityOf,
  rarityRank,
  RARITY_NAME,
  recordHumanMatch,
  SEATS,
  sortForDisplay,
  standings,
  startTournament,
  totalPicks,
  TOURNEY_ROUNDS,
  type DeckIds,
  type DraftState,
  type PackCard,
  type Rarity,
} from '../../draft';
import { cardArtSrc, renderCard } from '../cards/render';
import { attachOfficialArt } from '../cards/officialArt';
import { zoomCard } from '../cards/zoom';
import type { DuelSide } from '../duel/api';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { button, confirmDialog, h, icon, modal, segmented, toast } from './dom';
import { AVATAR_PRESETS, SLEEVES } from './ext';
import { runMatch } from './match';
import { frame, go, type Screen } from './nav';
import { getCustomDeck, newDeckId, ordinal, recordMatch, recordTournament, saveCustomDeck, uniqueDeckName, type Entry } from './store';

const KEY = 'edison.draft.v1';
const FORM_KEY = 'edison.draft.form.v1';

interface DraftForm {
  mode: 'draft' | 'sealed';
  packs: 3 | 4;
  bestOf: 1 | 3;
}

// ------------------------------------------------------------------ persistence

function loadDraft(): DraftState | null {
  const s = loadJSON<DraftState | null>(KEY, null);
  if (!s || s.version !== 1 || !Array.isArray(s.players) || s.players.length !== SEATS || !Array.isArray(s.picks)) return null;
  return s;
}
function persist(s: DraftState) {
  saveJSON(KEY, s);
}
function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ motion

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 0 = instant. Follows Settings → animation speed and the system's reduced-motion setting. */
const speed = () => (reducedMotion() ? 0 : Math.max(0, Number(getSettings().animationSpeed ?? 1)));
const ms = (base: number) => Math.round(base * speed());
const sleep = (t: number) => (t > 0 ? new Promise<void>((r) => setTimeout(r, t)) : Promise.resolve());
const frame2 = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

// ------------------------------------------------------------------ small helpers

const modeLabel = (s: DraftState) => (s.mode === 'sealed' ? 'Sealed' : 'Booster Draft');
const deckDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const PACK_COVERS = ['Judgment Dragon', 'Dark Armed Dragon', 'Stardust Dragon', 'Blackwing Armor Master', 'Arcanite Magician', 'Gladiator Beast Heraklinos'];
const PACK_HUES = [220, 28, 352, 160, 265, 45];

function kindCounts(cards: CardData[]) {
  let m = 0;
  let sp = 0;
  let t = 0;
  let x = 0;
  for (const c of cards) {
    if (isExtraDeck(c)) x++;
    else if (c.kind === 'monster') m++;
    else if (c.kind === 'spell') sp++;
    else t++;
  }
  return { m, s: sp, t, x };
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Tap / double-tap / long-press on a card tile. Long-press (or right click, or V) views the card. */
function press(el: HTMLElement, on: { tap?: () => void; double?: () => void; long?: () => void }) {
  let timer = 0;
  let sx = 0;
  let sy = 0;
  let longFired = false;
  let lastTap = 0;
  const cancel = () => {
    clearTimeout(timer);
    el.classList.remove('is-press');
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    longFired = false;
    sx = e.clientX;
    sy = e.clientY;
    el.classList.add('is-press');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      longFired = true;
      el.classList.remove('is-press');
      try {
        navigator.vibrate?.(8);
      } catch {
        /* ignore */
      }
      on.long?.();
    }, 430);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!longFired) {
      cancel();
      on.long?.();
    }
  });
  // keep the app-wide double-click zoom out of the way
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  el.addEventListener('click', () => {
    if (longFired) {
      longFired = false;
      return;
    }
    const now = performance.now();
    if (on.double && now - lastTap < 330) {
      lastTap = 0;
      on.double();
      return;
    }
    lastTap = now;
    on.tap?.();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      on.tap?.();
    } else if (e.key === 'v' || e.key === 'V') on.long?.();
  });
}

/** A card in a grid: the card face, foil shimmer and rarity pill. */
function tile(c: CardData, r: Rarity | null, count = 1) {
  return h(
    'div',
    { class: 'dr-tile', role: 'button', tabindex: '0', 'aria-label': `${c.name}${r && r !== 'C' ? `, ${RARITY_NAME[r]}` : ''}${count > 1 ? `, ${count} copies` : ''}`, dataset: { r: r ?? 'C' } },
    renderCard(c, { size: 'sm' }),
    r && isFoilRarity(r) ? h('i', { class: 'dr-holo' }) : null,
    r && r !== 'C' ? h('span', { class: 'dr-rar' }, r) : null,
    count > 1 ? h('span', { class: 'dr-count' }, `×${count}`) : null,
  );
}

/** The booster pack wrapper (CSS-drawn, with a cover artwork window). */
function packArt(n: number, label: string, sub: string) {
  const cover = card(PACK_COVERS[n % PACK_COVERS.length].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const win = h('div', { class: 'dr-pack-window' }, h('img', { src: cardArtSrc(cover), alt: '', draggable: false }));
  attachOfficialArt(win, cover.name);
  return h(
    'div',
    { class: 'dr-pack', style: { '--h': String(PACK_HUES[n % PACK_HUES.length]) } },
    h('div', { class: 'dr-pack-top' }),
    h('div', { class: 'dr-pack-body' }, h('div', { class: 'dr-pack-mark' }, 'EDISON'), win, h('div', null, h('div', { class: 'dr-pack-name' }, label), h('div', { class: 'dr-pack-sub' }, sub))),
    h('div', { class: 'dr-pack-bottom' }),
    h('div', { class: 'dr-pack-sheen' }),
  );
}

// ------------------------------------------------------------------ screen controller

interface Ctl {
  root: HTMLElement;
  view: string;
  /** Changes every time a view is shown; async work checks it before touching the screen. */
  token: number;
  show: (el: HTMLElement, view: string, opts?: { immersive?: boolean }) => void;
  /** A fixed bottom bar for the current view (lives on <body>, removed with the view). */
  dock: (el: HTMLElement) => void;
  onLeave: (fn: () => void) => void;
}

export function draftScreen(): Screen {
  const root = h('div', { class: 'dr-root' });
  let leave: (() => void)[] = [];
  const runLeave = () => {
    for (const f of leave) {
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
    leave = [];
  };
  const ctl: Ctl = {
    root,
    view: '',
    token: 0,
    show(el, view, opts = {}) {
      runLeave();
      ctl.view = view;
      ctl.token++;
      document.body.classList.toggle('dr-immersive', !!opts.immersive);
      el.classList.add('dr-view-enter');
      root.replaceChildren(el);
      root.style.setProperty('--dock-h', '0px');
      window.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('dr-view-enter')));
    },
    dock(el) {
      el.classList.add('dr-dock');
      document.body.appendChild(el);
      root.querySelector('.frame-body')?.append(h('div', { class: 'dr-dock-spacer', 'aria-hidden': 'true' }));
      const sync = () => root.style.setProperty('--dock-h', `${el.offsetHeight}px`);
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
      ro?.observe(el);
      sync();
      leave.push(() => {
        ro?.disconnect();
        el.remove();
      });
    },
    onLeave(fn) {
      leave.push(fn);
    },
  };
  homeView(ctl);
  return {
    el: root,
    dispose() {
      ctl.token++;
      runLeave();
      document.body.classList.remove('dr-immersive');
    },
    onEscape() {
      if (ctl.view === 'home') return false;
      homeView(ctl);
      return true;
    },
  };
}

function resume(ctl: Ctl, s: DraftState) {
  if (s.phase === 'draft') return needsOpening(s) ? openView(ctl, s) : pickView(ctl, s);
  if (s.phase === 'build') return buildView(ctl, s);
  if (s.phase === 'tournament') return hubView(ctl, s);
  return finalView(ctl, s);
}

const backToHome = (ctl: Ctl) => ({ backTo: () => homeView(ctl), backLabel: 'Draft' });

// ------------------------------------------------------------------ home

function progressOf(s: DraftState): { line: string; p: number } {
  if (s.phase === 'draft') {
    if (s.mode === 'sealed') return { line: `${s.opened} of ${s.packCount} packs opened`, p: s.opened / s.packCount };
    return { line: `Pack ${s.round + 1} of ${s.packCount} · Pick ${s.pick + 1}`, p: s.picks[0].length / totalPicks(s) };
  }
  if (s.phase === 'build') return { line: `Deck building · ${plural(s.picks[0].length, 'card')}`, p: 1 };
  const rec = humanRecord(s);
  if (s.phase === 'tournament') return { line: `Round ${s.rounds.length} of ${TOURNEY_ROUNDS} · ${rec.text}`, p: (s.rounds.length - 1) / TOURNEY_ROUNDS };
  const place = standings(s).find((x) => x.id === 'p0')?.rank ?? 0;
  return { line: `Finished ${ordinal(place)} of ${SEATS} · ${rec.text}`, p: 1 };
}

function homeView(ctl: Ctl) {
  const s = loadDraft();
  const form: DraftForm = { mode: 'draft', packs: 4, bestOf: 1, ...loadJSON<Partial<DraftForm>>(FORM_KEY, {}) };
  const saveForm = () => saveJSON(FORM_KEY, form);

  const resumeCard = s
    ? (() => {
        const pr = progressOf(s);
        const done = s.phase === 'done';
        return h(
          'section',
          { class: 'dr-card dr-resume' },
          h('div', { class: 'dr-eyebrow' }, done ? 'Last event' : 'In progress'),
          h('div', { class: 'dr-resume-title' }, `${modeLabel(s)}${s.mode === 'draft' ? ` · ${s.packCount} packs` : ''}`),
          h('div', { class: 'dr-muted' }, pr.line),
          h('div', { class: 'dr-progress' }, h('i', { style: { '--p': `${Math.round(pr.p * 100)}%` } })),
          h(
            'div',
            { class: 'dr-btn-row' },
            button(done ? 'View results' : 'Resume', () => resume(ctl, s), { variant: 'primary', icon: done ? 'trophy' : 'play' }),
            button(
              done ? 'Clear' : 'Abandon',
              async () => {
                if (!done && !(await confirmDialog('Abandon this draft?', 'Your picks and results will be lost. A deck you already saved stays in your decks.', 'Abandon', true))) return;
                clearDraft();
                homeView(ctl);
              },
              { variant: 'subtle', icon: done ? 'x' : 'trash' },
            ),
          ),
        );
      })()
    : null;

  const packsOpt = h('div', { class: 'dr-opt' }, h('span', { class: 'dr-opt-label' }, 'Packs'), segmented<number>([{ value: 3, label: '3 packs' }, { value: 4, label: '4 packs' }], form.packs, (v) => ((form.packs = v as 3 | 4), saveForm(), sync()), 'Packs'));
  const heroTitle = h('h2', { class: 'dr-h2' });
  const heroText = h('p');
  const startBtn = button('Start draft', () => void start(), { variant: 'primary', icon: 'play', cls: 'dr-btn-wide' });
  const sync = () => {
    const sealed = form.mode === 'sealed';
    packsOpt.style.display = sealed ? 'none' : '';
    heroTitle.textContent = sealed ? 'Sealed' : 'Booster Draft';
    heroText.textContent = sealed
      ? 'Open six packs and build a 40-card deck from everything you pull. Then play three rounds against the AI duelists.'
      : `Eight duelists, ${form.packs} packs each. Take one card, pass the rest. Build 40 cards from your ${form.packs * 15} picks, then play three rounds.`;
    startBtn.querySelector('.ui-btn-label')!.textContent = sealed ? 'Open sealed pool' : 'Start draft';
  };

  const start = async () => {
    if (s && s.phase !== 'done' && !(await confirmDialog('Start a new event?', 'Your current draft will be abandoned.', 'Start new', true))) return;
    const st = getSettings();
    const ns = createDraft({
      mode: form.mode,
      packCount: form.packs,
      bestOf: form.bestOf,
      human: { name: st.playerName?.trim() || 'You', avatar: st.avatar, sleeve: st.sleeve },
      avatars: AVATAR_PRESETS,
      sleeves: SLEEVES.map((x) => x.id),
    });
    persist(ns);
    openView(ctl, ns);
  };

  const body = h(
    'div',
    { class: 'dr-home' },
    resumeCard,
    resumeCard ? h('div', { class: 'dr-section-title', style: { margin: '6px 0 -6px' } }, h('span', null, 'New event')) : null,
    h(
      'section',
      { class: 'dr-card dr-opts' },
      h('div', { class: 'dr-hero' }, packArt(0, 'Booster Pack', '15 cards'), h('div', null, heroTitle, heroText)),
      h('div', { class: 'dr-opt' }, h('span', { class: 'dr-opt-label' }, 'Format'), segmented([{ value: 'draft', label: 'Draft' }, { value: 'sealed', label: 'Sealed' }], form.mode, (v) => ((form.mode = v as DraftForm['mode']), saveForm(), sync()), 'Format')),
      packsOpt,
      h('div', { class: 'dr-opt' }, h('span', { class: 'dr-opt-label' }, 'Matches'), segmented<number>([{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }], form.bestOf, (v) => ((form.bestOf = v as 1 | 3), saveForm()), 'Matches')),
      startBtn,
    ),
    h('p', { class: 'dr-foot' }, 'Each pack: 11 Commons, 2 Rares, 1 Super Rare or better and 1 bonus card that is often an Extra Deck monster. Forbidden cards are not in packs.'),
    h(
      'div',
      { class: 'dr-rarity-key', 'aria-label': 'Rarities' },
      (['C', 'R', 'SR', 'UR', 'ScR'] as Rarity[]).map((r) => h('span', null, h('i', { class: 'dr-pip', dataset: { r } }), RARITY_NAME[r])),
    ),
  );
  sync();
  ctl.show(frame('Draft', { subtitle: 'Booster Draft and Sealed' }, body), 'home');
}

// ------------------------------------------------------------------ pack opening

function openView(ctl: Ctl, s: DraftState) {
  const n = s.mode === 'sealed' ? s.opened : s.round;
  const pack: PackCard[] = s.packs[n][0];
  const burst = h('div', { class: 'dr-burst' });
  const packBtn = h('button', { type: 'button', class: 'dr-pack-btn', 'aria-label': 'Open pack' }, packArt(n, `Pack ${n + 1}`, `${modeLabel(s)} · 15 cards`), h('div', { class: 'dr-tap-hint' }, 'Tap to open'));
  const stage = h('div', { class: 'dr-stage' }, burst, packBtn);
  const fr = frame(`Pack ${n + 1} of ${s.packCount}`, { cls: 'dr-open', compact: true, ...backToHome(ctl) }, stage);
  const note = h('div', { class: 'dr-dock-note' }, s.mode === 'draft' ? `Tap the pack to open it · this pack passes ${passDir(n) === 1 ? 'left' : 'right'}` : `Tap the pack to open it · ${s.packCount - n - 1} more after this one`);
  const actions = h('div', { class: 'dr-btn-row' });
  const dock = h('div', null, h('div', { class: 'dr-dock-in' }, note, actions));
  ctl.show(fr, 'open', { immersive: true });
  ctl.dock(dock);

  let state: 'closed' | 'opening' | 'flipping' | 'done' = 'closed';
  let skip = false;
  let tiles: HTMLElement[] = [];

  const setActions = () => {
    actions.replaceChildren();
    if (state === 'closed') {
      actions.append(button('Open pack', () => void open(), { variant: 'primary', icon: 'cards', cls: 'dr-btn-wide' }));
      return;
    }
    if (state !== 'done') {
      actions.append(button('Reveal all', () => (skip = true), { variant: 'ghost', cls: 'dr-btn-wide' }));
      return;
    }
    // summary of the good stuff
    const foils = pack.filter((p) => p.r !== 'C' && p.r !== 'R').sort((a, b) => rarityRank(b.r) - rarityRank(a.r));
    note.replaceChildren(
      foils.length
        ? h('div', { class: 'dr-open-summary' }, foils.map((p) => h('span', null, h('i', { class: 'dr-pip', dataset: { r: p.r } }), h('b', null, card(p.id).name))))
        : 'Hold a card to view it',
    );
    if (s.mode === 'draft') {
      actions.append(button('Start picking', () => pickView(ctl, s), { variant: 'primary', icon: 'hand', cls: 'dr-btn-wide' }));
    } else if (s.phase === 'draft') {
      actions.append(
        button('Open all', () => {
          while (s.phase === 'draft') markOpened(s);
          persist(s);
          buildView(ctl, s, `All ${s.packCount} packs opened · ${s.picks[0].length} cards. Your best 40 are in — tap cards to swap.`);
        }, { variant: 'ghost' }),
        button('Next pack', () => openView(ctl, s), { variant: 'primary', icon: 'cards' }),
      );
    } else {
      actions.append(button('Build your deck', () => buildView(ctl, s, `${s.picks[0].length} cards opened. Your best 40 are in — tap cards to swap.`), { variant: 'primary', icon: 'edit', cls: 'dr-btn-wide' }));
    }
  };
  setActions();

  const makeCard = (p: PackCard) => {
    const c = card(p.id);
    const el = h(
      'div',
      { class: 'dr-ocard', dataset: { r: p.r }, role: 'button', tabindex: '-1', 'aria-label': c.name },
      h(
        'div',
        { class: 'dr-ocard-in' },
        h('div', { class: 'dr-ocard-back' }, renderCard(c, { faceDown: true, size: 'sm' })),
        h('div', { class: 'dr-ocard-front' }, renderCard(c, { size: 'sm' }), isFoilRarity(p.r) ? h('i', { class: 'dr-holo' }) : null),
      ),
      p.r !== 'C' ? h('span', { class: 'dr-rar' }, p.r) : null,
    );
    press(el, { tap: () => state === 'done' && el.classList.contains('is-up') && zoomCard(c), long: () => el.classList.contains('is-up') && zoomCard(c) });
    return el;
  };

  const open = async () => {
    if (state !== 'closed') return;
    const token = ctl.token;
    const alive = () => ctl.token === token;
    state = 'opening';
    setActions();
    note.textContent = 'Tap to reveal everything';
    markOpened(s);
    persist(s);
    const animate = speed() > 0;
    stage.style.setProperty('--t-shake', `${ms(240)}ms`);
    stage.style.setProperty('--t-tear', `${ms(420)}ms`);
    stage.style.setProperty('--t-drop', `${ms(520)}ms`);
    stage.style.setProperty('--t-burst', `${ms(760)}ms`);
    if (animate) {
      packBtn.classList.add('is-shake');
      await sleep(ms(240));
      packBtn.classList.remove('is-shake');
      packBtn.classList.add('is-torn');
      burst.classList.add('go');
      await sleep(ms(430));
      if (!alive()) return;
    }
    tiles = pack.map(makeCard);
    const grid = h('div', { class: 'dr-reveal' }, tiles);
    packBtn.remove();
    stage.append(grid);
    state = 'flipping';
    if (animate) {
      // deal from the pack: every card starts stacked in the middle and slides to its slot
      const sr = stage.getBoundingClientRect();
      const cx = sr.left + sr.width / 2;
      const cy = sr.top + sr.height / 2;
      tiles.forEach((t, i) => {
        const r = t.getBoundingClientRect();
        t.style.transform = `translate(${cx - (r.left + r.width / 2)}px, ${cy - (r.top + r.height / 2) + 30}px) rotate(${((i % 5) - 2) * 2}deg) scale(1.15)`;
        t.style.opacity = '0';
      });
      void grid.offsetWidth;
      await frame2();
      const step = ms(26);
      tiles.forEach((t, i) => {
        t.style.setProperty('--t-deal', `${ms(480)}ms`);
        t.style.setProperty('--d', `${i * step}ms`);
        t.classList.add('is-dealt');
        t.style.transform = '';
        t.style.opacity = '';
      });
      await sleep(ms(480) + step * tiles.length);
      if (!alive()) return;
    }
    // flip one by one; the rare slot slows down and shines
    for (const t of tiles) {
      if (skip || !animate) break;
      const r = t.dataset.r as Rarity;
      const big = r === 'UR' || r === 'ScR';
      const foil = isFoilRarity(r);
      if (foil) await sleep(ms(big ? 380 : 200));
      if (skip) break;
      t.style.setProperty('--t-flip', `${ms(foil ? (big ? 600 : 460) : 300)}ms`);
      t.classList.add('is-up');
      if (foil) t.classList.add('is-foil');
      await sleep(foil ? ms(big ? 900 : 560) : ms(80));
      if (!alive()) return;
    }
    for (const t of tiles) {
      if (!t.classList.contains('is-up')) {
        t.style.setProperty('--t-flip', `${ms(300)}ms`);
        t.classList.add('is-up');
        if (isFoilRarity(t.dataset.r as Rarity)) t.classList.add('is-foil');
      }
    }
    state = 'done';
    setActions();
  };
  packBtn.addEventListener('click', () => void open());
  stage.addEventListener('click', (e) => {
    if (state === 'flipping' || state === 'opening') {
      if (!(e.target as HTMLElement).closest('.dr-pack-btn')) skip = true;
    }
  });
  // Sealed resumed after the last pack: nothing to open.
  if (s.mode === 'sealed' && n >= s.packCount) buildView(ctl, s);
}

// ------------------------------------------------------------------ picking

function pickView(ctl: Ctl, s: DraftState) {
  let sel: number | null = null;
  let busy = false;
  let tiles: HTMLElement[] = [];

  const progress = h('i');
  const passChip = h('span', { class: 'dr-pass' });
  const pickLine = h('span');
  const grid = h('div', { class: 'dr-grid', role: 'listbox', 'aria-label': 'Cards in this pack' });
  const body = h(
    'div',
    null,
    h('div', { class: 'dr-pickhead' }, h('div', { class: 'dr-progress' }, progress), h('div', { class: 'dr-pickhead-row' }, pickLine, passChip)),
    grid,
  );
  const fr = frame('Pick', { cls: 'dr-pick', compact: true, ...backToHome(ctl) }, body);
  const setTitle = (t: string) => fr.querySelectorAll('.frame-title, .frame-large-title').forEach((x) => (x.textContent = t));

  // dock: picks drawer + selection + actions
  const countsEl = h('span', { class: 'dr-muted' });
  const picksNum = h('b');
  const picksBar = h('button', { type: 'button', class: 'dr-picks-bar', 'aria-expanded': 'false' }, picksNum, countsEl, icon('back'));
  const scroller = h('div', { class: 'dr-picks-scroll' });
  const strip = h('div', { class: 'dr-picks-strip' }, h('div', null, scroller));
  const selName = h('div', { class: 'dr-selname' });
  const viewBtn = button('View', () => sel != null && zoomCard(card(humanPack(s)[sel].id)), { variant: 'ghost', icon: 'eye' });
  const pickBtn = button('Pick', () => sel != null && void confirm(sel), { variant: 'primary', icon: 'check' });
  const dock = h('div', null, h('div', { class: 'dr-dock-in' }, picksBar, strip, selName, h('div', { class: 'dr-btn-row' }, viewBtn, pickBtn)));
  let drawerOpen = loadJSON<boolean>('edison.draft.drawer', false);
  const setDrawer = (v: boolean) => {
    drawerOpen = v;
    dock.classList.toggle('is-open', v);
    picksBar.setAttribute('aria-expanded', String(v));
    saveJSON('edison.draft.drawer', v);
  };
  picksBar.addEventListener('click', () => setDrawer(!drawerOpen));

  ctl.show(fr, 'pick', { immersive: true });
  ctl.dock(dock);
  setDrawer(drawerOpen);

  const mini = (p: PackCard, fresh = false) => {
    const c = card(p.id);
    const el = h('div', { class: ['dr-mini', fresh && 'is-new'], dataset: { r: p.r }, title: c.name }, renderCard(c, { size: 'xs' }));
    press(el, { tap: () => zoomCard(c), long: () => zoomCard(c) });
    return el;
  };
  const renderPicks = () => {
    const picks = s.picks[0];
    scroller.replaceChildren(...(picks.length ? [...picks].reverse().map((p) => mini(p)) : [h('div', { class: 'dr-empty-strip' }, 'Cards you pick show up here.')]));
    updateCounts();
  };
  const updateCounts = () => {
    const k = kindCounts(s.picks[0].map((p) => card(p.id)));
    picksNum.textContent = `Your picks · ${s.picks[0].length}`;
    countsEl.textContent = s.picks[0].length ? [`${k.m} M`, `${k.s} S`, `${k.t} T`, k.x ? `${k.x} Extra` : ''].filter(Boolean).join(' · ') : 'None yet';
  };

  const updateHeader = () => {
    const pack = humanPack(s);
    setTitle(`Pack ${s.round + 1} · Pick ${s.pick + 1} of ${pack.length + s.pick}`);
    pickLine.textContent = `Pick ${s.picks[0].length + 1} of ${totalPicks(s)} overall`;
    progress.style.setProperty('--p', `${(s.picks[0].length / totalPicks(s)) * 100}%`);
    const left = passDir(s.round) === 1;
    passChip.className = `dr-pass ${left ? 'left' : 'right'}`;
    passChip.replaceChildren(icon('back'), left ? 'Passing left' : 'Passing right');
  };

  const select = (i: number | null) => {
    sel = i;
    tiles.forEach((t, j) => {
      t.classList.toggle('is-sel', j === i);
      t.setAttribute('aria-selected', String(j === i));
    });
    grid.classList.toggle('has-sel', i != null);
    pickBtn.disabled = i == null;
    viewBtn.disabled = i == null;
    if (i == null) selName.replaceChildren('Tap a card to select it · double-tap to pick · hold to view');
    else {
      const p = humanPack(s)[i];
      selName.replaceChildren(h('b', null, card(p.id).name), p.r !== 'C' ? ` · ${RARITY_NAME[p.r]}` : '');
    }
  };

  const renderPack = async (enterDir = 0) => {
    const pack = humanPack(s);
    tiles = pack.map((p, i) => {
      const t = tile(card(p.id), p.r);
      t.setAttribute('role', 'option');
      press(t, { tap: () => !busy && select(i), double: () => !busy && void confirm(i), long: () => zoomCard(card(p.id)) });
      return t;
    });
    if (enterDir && speed() > 0) {
      tiles.forEach((t, i) => {
        t.classList.add('is-in');
        t.style.setProperty('--dir', String(enterDir));
        t.style.setProperty('--d', `${i * ms(18)}ms`);
        t.style.setProperty('--t-pass', `${ms(360)}ms`);
      });
    }
    if (enterDir && window.scrollY > 0) window.scrollTo({ top: 0, behavior: speed() > 0 ? 'smooth' : 'auto' });
    grid.replaceChildren(...tiles);
    select(null);
    updateHeader();
    if (enterDir && speed() > 0) {
      await frame2();
      tiles.forEach((t) => t.classList.add('go'));
      await sleep(ms(360) + ms(18) * tiles.length);
      tiles.forEach((t) => t.classList.remove('is-in', 'go'));
    }
  };

  const confirm = async (i: number) => {
    if (busy) return;
    const pack = humanPack(s);
    const p = pack[i];
    if (!p) return;
    busy = true;
    select(i);
    const t = tiles[i];
    const dir = passDir(s.round);
    const awayDir = dir === 1 ? -1 : 1;
    const token = ctl.token;
    const prevRound = s.round;
    makePick(s, i);
    persist(s);
    if (speed() > 0) {
      const tr = t.getBoundingClientRect();
      const br = picksBar.getBoundingClientRect();
      t.style.setProperty('--tx', `${br.left + 48 - (tr.left + tr.width / 2)}px`);
      t.style.setProperty('--ty', `${br.top + br.height / 2 - (tr.top + tr.height / 2)}px`);
      t.style.setProperty('--t-take', `${ms(420)}ms`);
      t.classList.add('is-taken');
      await sleep(ms(330));
      if (ctl.token !== token) return;
    }
    // picks drawer
    const first = scroller.querySelector('.dr-empty-strip');
    if (first) first.remove();
    scroller.prepend(mini(p, true));
    scroller.scrollTo({ left: 0, behavior: 'smooth' });
    updateCounts();
    picksBar.classList.remove('bump');
    void picksBar.offsetWidth;
    picksBar.classList.add('bump');
    // the rest of the pack moves on
    if (speed() > 0) {
      grid.classList.remove('has-sel');
      tiles.forEach((x, j) => {
        if (x === t) return;
        x.style.setProperty('--dir', String(awayDir));
        x.style.setProperty('--d', `${j * ms(12)}ms`);
        x.style.setProperty('--t-pass', `${ms(300)}ms`);
        x.classList.add('is-away');
      });
      await sleep(ms(300) + ms(12) * tiles.length);
      if (ctl.token !== token) return;
    }
    if (s.phase === 'build') {
      buildView(ctl, s, `Draft complete · ${s.picks[0].length} cards. Your best 40 are in — tap cards to swap.`);
      return;
    }
    if (s.round !== prevRound) {
      openView(ctl, s);
      return;
    }
    await renderPack(-awayDir);
    if (ctl.token !== token) return;
    busy = false;
    // the last card of a pack is taken automatically
    if (humanPack(s).length === 1) {
      select(0);
      selName.replaceChildren(h('b', null, card(humanPack(s)[0].id).name), ' · last card, added for you');
      await sleep(Math.max(ms(700), 250));
      if (ctl.token !== token) return;
      void confirm(0);
    }
  };

  renderPicks();
  void renderPack();
  if (humanPack(s).length === 1) setTimeout(() => void confirm(0), 300);
}

// ------------------------------------------------------------------ deck building

type BuildTab = 'deck' | 'pool';
type BuildFilter = 'all' | 'monster' | 'spell' | 'trap' | 'extra';

function buildView(ctl: Ctl, s: DraftState, intro?: string) {
  if (!s.deck) {
    s.deck = autoBuildHuman(s);
    persist(s);
  }
  let tab: BuildTab = 'deck';
  let filter: BuildFilter = 'all';
  const deck = s.deck;
  const rarityOfId = new Map<string, Rarity>();
  for (const p of s.picks[0]) {
    const cur = rarityOfId.get(p.id);
    if (!cur || rarityRank(p.r) > rarityRank(cur)) rarityOfId.set(p.id, p.r);
  }

  const poolIds = () => {
    const left = new Map<string, number>();
    for (const p of s.picks[0]) left.set(p.id, (left.get(p.id) ?? 0) + 1);
    for (const id of [...deck.main, ...deck.extra]) left.set(id, (left.get(id) ?? 0) - 1);
    const out: string[] = [];
    for (const [id, n] of left) for (let i = 0; i < n; i++) out.push(id);
    return out;
  };

  const statMain = h('div', { class: 'dr-stat' });
  const statExtra = h('div', { class: 'dr-stat' });
  const breakdown = h('div', { class: 'dr-breakdown' });
  const segWrap = h('div', { style: { flex: '1', display: 'flex' } });
  const chips = h('div', { class: 'dr-chips', role: 'tablist', 'aria-label': 'Filter' });
  const content = h('div');
  const hint = h('p', { class: 'dr-hint' });
  const body = h(
    'div',
    null,
    h('div', { class: 'dr-deckstats' }, statMain, statExtra, breakdown),
    h(
      'div',
      { class: 'dr-toolbar' },
      button(
        'Auto-build',
        () => {
          const d = autoBuildHuman(s);
          deck.main = d.main;
          deck.extra = d.extra;
          persist(s);
          toast('Built the best 40 from your picks');
          render();
        },
        { variant: 'ghost', icon: 'refresh', small: true },
      ),
      button(
        'Clear',
        () => {
          deck.main = [];
          deck.extra = [];
          persist(s);
          tab = 'pool';
          render();
        },
        { variant: 'subtle', icon: 'trash', small: true },
      ),
    ),
    h('div', { class: 'dr-toolbar' }, segWrap),
    chips,
    hint,
    content,
  );
  const fr = frame('Build your deck', { cls: 'dr-build', compact: true, ...backToHome(ctl) }, body);
  const note = h('div', { class: 'dr-dock-note' });
  const startBtn = button('Start tournament', () => void start(), { variant: 'primary', icon: 'trophy', cls: 'dr-btn-wide' });
  const dock = h('div', null, h('div', { class: 'dr-dock-in' }, note, startBtn));
  ctl.show(fr, 'build', { immersive: true });
  ctl.dock(dock);

  const matches = (c: CardData) =>
    filter === 'all' || (filter === 'extra' ? isExtraDeck(c) : !isExtraDeck(c) && c.kind === filter);

  const groupTiles = (ids: string[], onTap: (id: string) => void) => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const cards = sortForDisplay([...counts.keys()].map(card)).filter(matches);
    if (!cards.length) return null;
    return h(
      'div',
      { class: 'dr-grid' },
      cards.map((c) => {
        const t = tile(c, rarityOfId.get(c.id) ?? rarityOf(c), counts.get(c.id));
        press(t, { tap: () => onTap(c.id), long: () => zoomCard(c) });
        return t;
      }),
    );
  };

  const remove = (id: string) => {
    const list = isExtraDeck(card(id)) ? deck.extra : deck.main;
    const i = list.lastIndexOf(id);
    if (i >= 0) list.splice(i, 1);
    persist(s);
    render();
  };
  const add = (id: string) => {
    const c = card(id);
    if (isExtraDeck(c)) {
      if (deck.extra.length >= 15) return toast('The Extra Deck is full (15)', 'error');
      deck.extra.push(id);
    } else {
      if (deck.main.length >= 60) return toast('The Main Deck is full (60)', 'error');
      deck.main.push(id);
    }
    persist(s);
    render();
  };

  const render = () => {
    const main = deck.main.map(card);
    const k = kindCounts(main);
    const pool = poolIds();
    statMain.className = ['dr-stat', main.length < 40 && 'low'].filter(Boolean).join(' ');
    statMain.replaceChildren(h('b', null, String(main.length)), h('span', null, 'Main'));
    statExtra.replaceChildren(h('b', null, String(deck.extra.length)), h('span', null, 'Extra'));
    breakdown.replaceChildren(h('div', null, h('b', null, plural(k.m, 'Monster'))), h('div', null, `${plural(k.s, 'Spell')} · ${plural(k.t, 'Trap')}`));
    segWrap.replaceChildren(
      segmented<BuildTab>(
        [
          { value: 'deck', label: `Deck · ${main.length + deck.extra.length}` },
          { value: 'pool', label: `Pool · ${pool.length}` },
        ],
        tab,
        (v) => ((tab = v), render()),
        'Deck or pool',
      ),
    );
    const src = tab === 'deck' ? [...deck.main, ...deck.extra] : pool;
    const srcCards = src.map(card);
    const cnt = (f: BuildFilter) => srcCards.filter((c) => f === 'all' || (f === 'extra' ? isExtraDeck(c) : !isExtraDeck(c) && c.kind === f)).length;
    chips.replaceChildren(
      ...(['all', 'monster', 'spell', 'trap', 'extra'] as BuildFilter[]).map((f) =>
        h(
          'button',
          { type: 'button', class: ['dr-chip', filter === f && 'on'], role: 'tab', 'aria-selected': String(filter === f), onclick: () => ((filter = f), render()) },
          { all: 'All', monster: 'Monsters', spell: 'Spells', trap: 'Traps', extra: 'Extra' }[f],
          h('i', null, String(cnt(f))),
        ),
      ),
    );
    hint.textContent = tab === 'deck' ? 'Tap a card to take it out of your deck. Hold to view.' : 'Tap a card to add it to your deck. Hold to view.';
    if (tab === 'deck') {
      const mainGrid = groupTiles(deck.main, remove);
      const extraGrid = groupTiles(deck.extra, remove);
      content.replaceChildren(
        ...([
        mainGrid || filter !== 'extra' ? h('div', { class: 'dr-section-title' }, h('span', null, 'Main Deck'), h('b', null, String(deck.main.length))) : null,
        mainGrid ?? (filter !== 'extra' ? h('div', { class: 'dr-empty' }, 'No cards here. Add some from your pool.') : null),
        extraGrid || filter === 'all' || filter === 'extra' ? h('div', { class: 'dr-section-title' }, h('span', null, 'Extra Deck'), h('b', null, `${deck.extra.length} / 15`)) : null,
        extraGrid ?? (filter === 'all' || filter === 'extra' ? h('div', { class: 'dr-empty' }, 'No Synchro or Fusion monsters in your deck.') : null),
        ].filter(Boolean) as HTMLElement[]),
      );
      content.firstElementChild?.setAttribute('style', 'margin-top:0');
    } else {
      content.replaceChildren(groupTiles(pool, add) ?? h('div', { class: 'dr-empty' }, pool.length ? 'Nothing matches this filter.' : 'Every card you picked is in your deck.'));
    }
    const problems = deckProblems(s, deck);
    note.className = ['dr-dock-note', problems.length && 'warn', intro && 'intro'].filter(Boolean).join(' ');
    note.replaceChildren(
      intro ? intro : problems.length ? problems[0] : h('span', null, h('b', null, 'Ready'), ` · ${main.length} + ${deck.extra.length} Extra · ${modeLabel(s)}`),
    );
    intro = undefined;
    startBtn.disabled = problems.length > 0;
  };

  const start = async () => {
    const problems = deckProblems(s, deck);
    if (problems.length) return toast(problems[0], 'error');
    s.savedDeckId = saveDraftDeck(s, deck);
    startTournament(s, { main: [...deck.main], extra: [...deck.extra] });
    persist(s);
    toast(`Saved as “${deckNameOf(s)}” in your decks`, 'success');
    hubView(ctl, s);
  };

  render();
}

function toEntries(ids: string[]): Entry[] {
  const m = new Map<string, number>();
  for (const id of ids) {
    const n = card(id).name;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m];
}

/** Save (or update) the drafted deck in the Deck Builder's saved decks. Returns its id. */
function saveDraftDeck(s: DraftState, d: DeckIds): string {
  const existing = s.savedDeckId ? getCustomDeck(s.savedDeckId) : undefined;
  const now = Date.now();
  const deck = existing ?? {
    id: newDeckId(),
    name: uniqueDeckName(`${s.mode === 'sealed' ? 'Sealed' : 'Draft'} – ${deckDate(s.created)}`),
    main: [] as Entry[],
    extra: [] as Entry[],
    side: [] as Entry[],
    created: now,
    updated: now,
  };
  deck.main = toEntries(d.main);
  deck.extra = toEntries(d.extra);
  saveCustomDeck(deck);
  return deck.id;
}

function deckNameOf(s: DraftState) {
  return (s.savedDeckId && getCustomDeck(s.savedDeckId)?.name) || `Draft – ${deckDate(s.created)}`;
}

function deckModal(title: string, ids: DeckIds) {
  const d = fromIds(ids);
  const grid = (cards: CardData[]) => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    return h(
      'div',
      { class: 'dr-grid' },
      sortForDisplay([...counts.keys()].map(card)).map((c) => {
        const t = tile(c, null, counts.get(c.id));
        press(t, { tap: () => zoomCard(c), long: () => zoomCard(c) });
        return t;
      }),
    );
  };
  const k = kindCounts(d.main);
  modal(
    title,
    h(
      'div',
      { class: 'dr-root dr-modal-scroll', style: { maxHeight: '64vh', overflowY: 'auto', padding: '4px 4px 12px' } },
      h('div', { class: 'dr-section-title', style: { marginTop: '0' } }, h('span', null, `Main Deck · ${d.main.length}`), h('span', null, `${k.m} M · ${k.s} S · ${k.t} T`)),
      grid(d.main),
      d.extra.length ? h('div', { class: 'dr-section-title' }, h('span', null, `Extra Deck · ${d.extra.length}`)) : null,
      d.extra.length ? grid(d.extra) : null,
    ),
    [{ label: 'Close', variant: 'ghost' }],
    { wide: true },
  );
}

// ------------------------------------------------------------------ tournament hub

function standingsList(s: DraftState) {
  const st = standings(s);
  return h(
    'div',
    { class: 'dr-list' },
    st.map((r) => {
      const p = playerById(s, r.id);
      const desc = describeDeck(deckOf(s, r.id));
      return h(
        'div',
        { class: ['dr-row', p.human && 'me'] },
        h('span', { class: 'dr-row-rank' }, String(r.rank)),
        h('div', { class: 'dr-row-name' }, h('b', null, p.human ? `${p.name} (you)` : p.name), h('span', null, desc)),
        h('div', { class: 'dr-row-end' }, `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`, h('span', null, `${r.mp} pts`)),
      );
    }),
  );
}

function scoreOf(m: { games: { winner: 0 | 1 | null }[] }) {
  const a = m.games.filter((g) => g.winner === 0).length;
  const b = m.games.filter((g) => g.winner === 1).length;
  return { a, b };
}

function hubView(ctl: Ctl, s: DraftState) {
  const n = s.rounds.length;
  const m = humanMatch(s);
  if (!m || !m.b) return finalView(ctl, s);
  const opp = playerById(s, m.b);
  const myDeck = deckOf(s, 'p0');
  const oppDeck = deckOf(s, m.b);
  const rec = humanRecord(s);
  const done = !!m.result;
  const sc = scoreOf(m);
  const tag = m.result === 'a' ? h('span', { class: 'dr-result-tag w' }, 'Won') : m.result === 'b' ? h('span', { class: 'dr-result-tag l' }, 'Lost') : m.result === 'draw' ? h('span', { class: 'dr-result-tag d' }, 'Draw') : null;

  const actions = h('div', { class: 'dr-btn-row' });
  const busy = h('div', { class: 'dr-busy', style: { display: 'none' } }, h('i', { class: 'dr-spinner' }), 'Other tables are finishing…');
  if (!done) {
    actions.append(button(n === 1 ? 'Start round 1' : `Start round ${n}`, () => void play(), { variant: 'primary', icon: 'swords', cls: 'dr-btn-wide' }));
  } else if (s.phase === 'done') {
    actions.append(button('Final results', () => finalView(ctl, s), { variant: 'primary', icon: 'trophy', cls: 'dr-btn-wide' }));
  } else {
    actions.append(
      button(
        `Round ${n + 1}`,
        () => {
          advanceRound(s);
          persist(s);
          hubView(ctl, s);
        },
        { variant: 'primary', icon: 'play', cls: 'dr-btn-wide' },
      ),
    );
  }

  const matchCard = h(
    'section',
    { class: 'dr-match' },
    h('div', { class: 'dr-eyebrow' }, `Your match · ${s.bestOf === 3 ? 'Best of 3' : 'Best of 1'}`),
    h(
      'div',
      { class: 'dr-vs' },
      h('div', { class: 'dr-vs-side' }, h('div', { class: 'dr-vs-name' }, 'You'), h('div', { class: 'dr-vs-deck' }, describeDeck(myDeck))),
      done ? h('div', { class: 'dr-vs-score' }, `${sc.a}–${sc.b}`) : h('div', { class: 'dr-vs-mid' }, 'VS'),
      h('div', { class: 'dr-vs-side' }, h('div', { class: 'dr-vs-name' }, opp.name), h('div', { class: 'dr-vs-deck' }, `${opp.title}`)),
    ),
    done ? h('div', { class: 'dr-result-line' }, tag, m.games.length ? m.games[m.games.length - 1].reason : '') : null,
    actions,
    busy,
    h('div', { class: 'dr-btn-row' }, button('Your deck', () => deckModal(deckNameOf(s), s.deck!), { variant: 'ghost', icon: 'cards', small: true }), button('Your picks', () => deckModal('Your picks', { main: s.picks[0].map((p) => p.id).filter((id) => !isExtraDeck(card(id))), extra: s.picks[0].map((p) => p.id).filter((id) => isExtraDeck(card(id))) }), { variant: 'subtle', icon: 'list', small: true })),
  );

  const pairings = h(
    'div',
    { class: 'dr-list' },
    s.rounds[n - 1].map((x) => {
      const A = playerById(s, x.a);
      const B = x.b ? playerById(s, x.b) : null;
      const p = scoreOf(x);
      return h(
        'div',
        { class: ['dr-pair', x.a === 'p0' && 'me'] },
        h('span', { class: x.result === 'a' ? 'won' : '' }, A.human ? 'You' : A.name),
        h('span', { class: 'dr-pair-mid' }, x.result ? `${p.a}–${p.b}` : 'vs'),
        h('span', { class: x.result === 'b' ? 'won' : '' }, B ? B.name : 'Bye'),
      );
    }),
  );

  const body = h(
    'div',
    { class: 'dr-hub' },
    matchCard,
    h('div', { class: 'dr-section-title' }, h('span', null, `Round ${n} pairings`), h('span', null, done ? 'Final' : 'In progress')),
    pairings,
    h('div', { class: 'dr-section-title' }, h('span', null, 'Standings'), h('b', null, `You ${rec.text}`)),
    standingsList(s),
  );
  ctl.show(frame(`Round ${n}`, { eyebrow: `${modeLabel(s)} · Round ${n} of ${TOURNEY_ROUNDS}`, subtitle: `Playing “${deckNameOf(s)}” · ${rec.text}`, ...backToHome(ctl) }, body), 'hub');

  async function play() {
    if (!m || !m.b) return;
    const st = getSettings();
    const me = s.players[0];
    const deckName = deckNameOf(s);
    const sides: [DuelSide, DuelSide] = [
      { name: me.name, deck: myDeck, avatar: st.avatar, sleeve: st.sleeve, control: 'human', title: deckName },
      { name: opp.name, deck: oppDeck, avatar: opp.avatar, sleeve: opp.sleeve, control: 'normal', title: describeDeck(oppDeck) },
    ];
    const out = await runMatch({
      sides,
      bestOf: s.bestOf,
      caption: `Draft · Round ${n} – vs ${opp.name}`,
      stats: s.savedDeckId ? { deckKey: `custom:${s.savedDeckId}`, deckName } : undefined,
    });
    const token = ctl.token;
    actions.style.display = 'none';
    busy.style.display = '';
    await recordHumanMatch(s, out.games, out.result);
    persist(s);
    const r = scoreOf({ games: out.games });
    recordMatch({
      date: Date.now(),
      deckName,
      oppName: opp.name,
      oppDeck: describeDeck(oppDeck),
      result: out.result === 'a' ? 'W' : out.result === 'b' ? 'L' : 'D',
      score: `${r.a}-${r.b}`,
      context: `Draft · Round ${n}`,
    });
    if (ctl.token === token) hubView(ctl, s);
  }
}

// ------------------------------------------------------------------ final

function finalView(ctl: Ctl, s: DraftState) {
  const st = standings(s);
  const me = st.find((x) => x.id === 'p0');
  const place = me?.rank ?? SEATS;
  const rec = humanRecord(s);
  if (!s.recorded && s.phase === 'done') {
    s.recorded = true;
    persist(s);
    const champ = playerById(s, st[0].id);
    recordTournament({
      id: s.id,
      name: `${modeLabel(s)} – ${deckDate(s.created)}`,
      date: Date.now(),
      size: SEATS,
      place,
      record: rec.text,
      deckName: deckNameOf(s),
      champion: champ.human ? 'You' : champ.name,
    });
  }
  const headline = place === 1 ? `Champion · ${rec.text}` : `Record ${rec.text}`;
  const body = h(
    'div',
    { class: 'dr-final' },
    h(
      'div',
      { class: 'dr-place' },
      h('div', { class: 'dr-eyebrow' }, `${modeLabel(s)} · ${SEATS} players`),
      h('div', { class: 'dr-place-big' }, ordinal(place)),
      h('div', { class: 'dr-place-sub' }, headline),
      h('div', { class: 'dr-place-deck' }, `Your deck is saved as “${deckNameOf(s)}”.`),
    ),
    h(
      'div',
      { class: 'dr-btn-row' },
      button(
        'New draft',
        () => {
          clearDraft();
          homeView(ctl);
        },
        { variant: 'primary', icon: 'cards' },
      ),
      button('Deck Builder', () => go('deck-builder', s.savedDeckId ? { deck: s.savedDeckId } : {}), { variant: 'ghost', icon: 'edit' }),
    ),
    h('div', { class: 'dr-section-title' }, h('span', null, 'Final standings'), h('b', null, rec.text)),
    standingsList(s),
    h(
      'div',
      { class: 'dr-section-title' },
      h('span', null, 'Rounds'),
    ),
    h(
      'div',
      { class: 'dr-list' },
      s.rounds.map((r, i) => {
        const m = r.find((x) => x.a === 'p0');
        if (!m || !m.b) return null;
        const sc = scoreOf(m);
        return h(
          'div',
          { class: 'dr-pair' },
          h('span', null, `Round ${i + 1}`),
          h('span', { class: 'dr-pair-mid' }, `${sc.a}–${sc.b}`),
          h('span', { class: m.result === 'a' ? 'won' : '' }, `${m.result === 'a' ? 'Won' : m.result === 'b' ? 'Lost' : 'Draw'} vs ${playerById(s, m.b).name}`),
        );
      }),
    ),
  );
  ctl.show(frame('Results', { subtitle: deckNameOf(s), ...backToHome(ctl) }, body), 'final');
}
