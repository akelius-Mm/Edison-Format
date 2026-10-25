// Draft mode screens: home (setup / resume), pack opening, picking, deck building,
// the 3-round draft tournament against the AI drafters, and the final result.
// The event logic lives in src/draft; this file only drives and persists it.
import { aiRating, recordLimitedResult } from '../../events/ratings';
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
  humanSideIds,
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
  sortForDisplay,
  standings,
  startTournament,
  totalPicks,
  checkSetup,
  currentRound,
  defaultCount,
  DRAFT_READY_SHARE,
  EDISON_PACK,
  edisonSetsFor,
  eventPacksLabel,
  fillerIds,
  finishRound,
  fitPlan,
  isRealPack,
  newestFirst,
  optionsLabel,
  optsOf,
  PACK_RANGE,
  packOption,
  packOptions,
  planLabel,
  planOf,
  presetOf,
  presetPlan,
  PRESETS,
  randomMix,
  resizePlan,
  sameForAll,
  seatsOf,
  totalRounds,
  type PackOption,
  type RealSize,
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
import { reconcileActiveDuel } from '../duel/resume';
import { resumeDuelCard } from './resumeCard';
import { frame, go, type Params, type Screen } from './nav';
import { packArt as setPackArt } from './collectionUi';
import { grantPrize } from '../../collection/api';
import { applySetup, customizeSheet, edisonPoolLabel, loadSetupForm, sameSetup, savedPresets, saveSetupForm, setupOf, stepper } from './draftSetup';
import { getCustomDeck, newDeckId, ordinal, recordMatch, recordTournament, saveCustomDeck, uniqueDeckName, type Entry } from './store';

const KEY = 'edison.draft.v1';

const DEV_KEY = 'edison.draft.devSets';
/** Dev override: offer incomplete real sets (turn on with #/draft?devsets=1). */
function devSetsOn() {
  try {
    return localStorage.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ persistence

function loadDraft(): DraftState | null {
  const s = loadJSON<DraftState | null>(KEY, null);
  if (!s || s.version !== 1 || !Array.isArray(s.players) || ![4, 6, 8].includes(s.players.length) || !Array.isArray(s.picks)) return null;
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

export function draftScreen(params: Params = {}): Screen {
  if (params.devsets === '1' || params.devsets === '0') {
    try {
      if (params.devsets === '1') localStorage.setItem(DEV_KEY, '1');
      else localStorage.removeItem(DEV_KEY);
    } catch {
      /* ignore */
    }
  }
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
  // A saved duel of this draft's current round: Home's card (resume=1) or "Leave and save" (view=hub)
  // lands on the round hub; resume=1 also picks the duel straight back up.
  const s0 = loadDraft();
  if (!s0 || s0.phase !== 'tournament') reconcileActiveDuel('draft', null);
  if (params.resume || params.view) history.replaceState(null, '', '#/draft');
  if (s0?.phase === 'tournament' && (params.view === 'hub' || params.resume === '1')) hubView(ctl, s0, params.resume === '1');
  else homeView(ctl, { customize: params.customize === '1' });
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
  const total = totalRounds(s);
  if (s.phase === 'tournament') return { line: `Round ${s.rounds.length} of ${total} · ${rec.text}`, p: (s.rounds.length - 1) / total };
  const place = standings(s).find((x) => x.id === 'p0')?.rank ?? 0;
  return { line: `Finished ${ordinal(place)} of ${seatsOf(s)} · ${rec.text}`, p: 1 };
}

/** A small booster for menus: the Edison Pack design or the real set's pack art. */
function packThumb(code: string, n = 0) {
  if (code === EDISON_PACK) return packArt(n, 'Edison Pack', '15 cards');
  return setPackArt(code);
}

/** Choose the booster for one pack round. Resolves with a set code, or null if dismissed. */
function choosePack(round: number, current: string, dev: boolean, realSize: RealSize): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const opts = packOptions(dev, realSize);
    const row = (o: PackOption) =>
      h(
        'button',
        {
          type: 'button',
          class: ['dr-setrow', o.code === current && 'on', !o.ready && 'soon'],
          disabled: !o.ready,
          onclick: () => {
            done = true;
            resolve(o.code);
            m.close();
          },
        },
        h('span', { class: 'dr-setrow-art' }, packThumb(o.code)),
        h(
          'span',
          { class: 'dr-setrow-text' },
          h('b', null, o.name),
          h('span', null, o.code === EDISON_PACK ? '15 cards · the Edison pool' : `${o.code} · ${o.cardsPerPack} cards · ${releaseYear(o.released)}`),
          o.code !== EDISON_PACK ? setStatus(o) : null,
        ),
        o.code === current ? icon('check') : null,
      );
    const ready = opts.filter((o) => o.ready);
    const soon = opts.filter((o) => !o.ready);
    const list = h(
      'div',
      { class: 'dr-root dr-setlist' },
      ready.map(row),
      soon.length ? h('div', { class: 'dr-setlist-h' }, 'Coming soon') : null,
      soon.map(row),
    );
    const m = modal(`Pack ${round + 1}`, list, [], { onClose: () => !done && resolve(null) });
  });
}

const releaseYear = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '');

function setStatus(o: PackOption) {
  const pct = Math.round((o.playable / o.printed) * 100);
  return o.ready && o.playable / o.printed >= DRAFT_READY_SHARE
    ? h('span', { class: 'dr-setstatus ready' }, 'Ready')
    : o.ready
      ? h('span', { class: 'dr-setstatus dev' }, `Dev override · ${o.playable} of ${o.printed} cards`)
      : h('span', { class: 'dr-setstatus' }, `Coming soon · ${pct}% of cards ready`);
}

const NUM_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

function homeView(ctl: Ctl, opts: { customize?: boolean } = {}) {
  const s = loadDraft();
  const dev = devSetsOn();
  const f = loadSetupForm(dev);
  const setup = () => setupOf(f);

  const resumeCard = s
    ? (() => {
        const pr = progressOf(s);
        const done = s.phase === 'done';
        return h(
          'section',
          { class: 'dr-card dr-resume' },
          h('div', { class: 'dr-eyebrow' }, done ? 'Last event' : 'In progress'),
          h('div', { class: 'dr-resume-title' }, `${modeLabel(s)} · ${eventPacksLabel(s)}`),
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

  const heroArt = h('div', { class: 'dr-hero-art' });
  const heroTitle = h('h2', { class: 'dr-h2' });
  const heroText = h('p');
  const presetRow = h('div', { class: 'dr-presets', role: 'radiogroup', 'aria-label': 'Boosters' });
  const strip = h('div', { class: 'dr-packstrip', 'aria-label': 'Pack for each round' });
  const countWrap = h('div', { class: 'dr-opt-end' });
  const summary = h('div', { class: 'dr-plan-summary', role: 'status' });
  const customDetail = h('span');
  const foot = h('p', { class: 'dr-foot' });
  const startBtn = button('Start draft', () => void start(), { variant: 'primary', icon: 'play', cls: 'dr-btn-wide' });

  const commit = () => {
    saveSetupForm(f);
    sync();
  };
  const setPlan = (plan: string[]) => {
    f.plans[f.mode] = plan;
    commit();
  };
  /** Use `gen(n)` for the plan, adding packs if it would hand out too few cards. */
  const fill = (gen: (n: number) => string[], n = setup().plan.length) => setPlan(fitPlan(gen, n, setup()));

  const quick = h(
    'div',
    { class: 'dr-quick', role: 'group', 'aria-label': 'Fill every pack' },
    h('button', { type: 'button', class: 'dr-qbtn', title: 'Same for every pack', 'aria-label': 'Same for every pack', onclick: () => fill(sameForAll(setup().plan)) }, 'Same for all'),
    h('button', { type: 'button', class: 'dr-qbtn', onclick: () => fill(newestFirst(dev)) }, 'Newest first'),
    h('button', { type: 'button', class: 'dr-qbtn', onclick: () => fill(randomMix(dev)) }, icon('shuffle'), 'Random mix'),
  );

  const sync = () => {
    const x = setup();
    const chk = checkSetup(x, dev);
    const sealed = x.mode === 'sealed';
    const real = x.plan.some(isRealPack);
    const n = x.plan.length;
    const rounds = x.tourney === 'single' ? 'a single-elimination bracket' : 'three Swiss rounds';
    heroArt.replaceChildren(packThumb(x.plan[0] ?? EDISON_PACK));
    heroTitle.textContent = sealed ? 'Sealed' : 'Booster Draft';
    heroText.textContent = sealed
      ? `Open ${n} packs — ${chk.cards} cards — and build a 40-card deck from everything you pull. Then play ${rounds} against ${x.seats - 1} AI duelists.`
      : `${NUM_WORDS[x.seats]} duelists, ${n} packs each. Take one card, pass the rest. Build 40 cards from your ${chk.cards} picks, then play ${rounds}.`;
    // presets: built-in boosters, then the player's saved setups
    const saved = savedPresets();
    const savedOn = saved.find((p) => sameSetup(p.setup, x));
    const cur = savedOn ? null : presetOf(x.plan);
    presetRow.classList.toggle('scroll', saved.length + PRESETS.length > 3);
    presetRow.replaceChildren(
      ...PRESETS.map((p) => {
        const ready = p.sets.every((c) => packOption(c, dev).ready);
        return h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(cur === p.id),
            class: ['dr-preset', cur === p.id && 'on'],
            disabled: !ready,
            onclick: () => {
              const wantReal = p.sets.some(isRealPack);
              fill((k) => presetPlan(p.id, k), wantReal === real ? n : defaultCount(x.mode, wantReal, x.realSize));
            },
          },
          h('span', { class: 'dr-preset-art' }, p.sets.map((c) => packThumb(c))),
          h('span', { class: 'dr-preset-label' }, p.label),
          ready ? null : h('span', { class: 'dr-preset-soon' }, 'Coming soon'),
        );
      }),
      ...saved.map((p) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(savedOn === p),
            class: ['dr-preset', 'saved', savedOn === p && 'on'],
            title: `${p.name}: ${planLabel(p.setup.plan)} · ${optionsLabel(p.setup)}`,
            onclick: () => {
              applySetup(f, p.setup);
              formatSeg.setValue(f.mode);
              commit();
            },
          },
          h('span', { class: 'dr-preset-art' }, [...new Set(p.setup.plan)].slice(0, 3).map((c) => packThumb(c))),
          h('span', { class: 'dr-preset-label' }, p.name),
          h('span', { class: 'dr-preset-sub' }, `${p.setup.mode === 'sealed' ? 'Sealed' : `${p.setup.seats}p`} · Bo${p.setup.bestOf}`),
        ),
      ),
    );
    // one tile per pack round
    strip.replaceChildren(
      ...x.plan.map((code, i) =>
        h(
          'button',
          {
            type: 'button',
            class: ['dr-striptile', !packOption(code, dev).ready && 'soon'],
            'aria-label': `Pack ${i + 1}: ${packOption(code).name}. Change`,
            onclick: async () => {
              const pick = await choosePack(i, code, dev, x.realSize);
              if (!pick || pick === code) return;
              const next = [...setup().plan];
              next[i] = pick;
              fill((k) => resizePlan(next, k), next.length);
            },
          },
          packThumb(code, i),
          h('span', { class: 'dr-striptile-n' }, `${i + 1} · ${code === EDISON_PACK ? 'Edison' : code}`),
        ),
      ),
    );
    const [lo, hi] = PACK_RANGE[x.mode];
    countWrap.replaceChildren(stepper(n, lo, hi, (v) => setPlan(resizePlan(setup().plan, v)), 'packs per player'));
    quick.classList.toggle('one', n < 2);
    summary.textContent = chk.ok ? chk.summary : chk.problems[0];
    summary.classList.toggle('warn', !chk.ok);
    const pool = x.plan.includes(EDISON_PACK) && x.edisonPool !== 'all' ? ` · Edison Pack: ${edisonPoolLabel(x)}` : '';
    customDetail.textContent = `${optionsLabel(x)}${x.realSize === 15 && real ? ' · 15-card boosters' : ''}${pool}`;
    startBtn.disabled = !chk.ok;
    foot.textContent = real
      ? `Real boosters have ${x.realSize === 15 ? '15 cards: the printed 9 with the set’s rarities and odds, plus 6 commons' : '9 cards with the set’s printed rarities and pack odds'}. The Edison Pack has 15: 11 Commons, 2 Rares, 1 Super Rare or better and a bonus card. Forbidden cards are never in packs.`
      : 'Each pack: 11 Commons, 2 Rares, 1 Super Rare or better and 1 bonus card that is often an Extra Deck monster. Forbidden cards are not in packs.';
    startBtn.querySelector('.ui-btn-label')!.textContent = sealed ? 'Open sealed pool' : 'Start draft';
  };

  const start = async () => {
    const x = setup();
    if (!checkSetup(x, dev).ok) return;
    if (s && s.phase !== 'done' && !(await confirmDialog('Start a new event?', 'Your current draft will be abandoned.', 'Start new', true))) return;
    const st = getSettings();
    const ns = createDraft({
      mode: x.mode,
      plan: x.plan,
      bestOf: x.bestOf,
      seats: x.seats,
      opts: { tourney: x.tourney, ai: x.ai, fillers: x.fillers, realSize: x.realSize, edisonSets: edisonSetsFor(x.edisonPool, x.edisonSets) },
      human: { name: st.playerName?.trim() || 'You', avatar: st.avatar, sleeve: st.sleeve },
      avatars: AVATAR_PRESETS,
      sleeves: SLEEVES.map((x) => x.id),
    });
    persist(ns);
    openView(ctl, ns);
  };

  const all = packOptions(dev).filter((o) => o.code !== EDISON_PACK);
  const soon = all.filter((o) => !o.ready);
  const setsInfo = h(
    'section',
    { class: 'dr-card dr-sets' },
    h('div', { class: 'dr-opt-label' }, 'Real boosters · Edison-legal'),
    all
      .filter((o) => o.ready)
      .map((o) =>
        h(
          'div',
          { class: ['dr-setrow', 'static'] },
          h('span', { class: 'dr-setrow-art' }, packThumb(o.code)),
          h('span', { class: 'dr-setrow-text' }, h('b', null, o.name), h('span', null, `${o.code} · ${o.cardsPerPack} cards · ${releaseYear(o.released)}`), setStatus(o)),
        ),
      ),
    soon.length
      ? h(
          'div',
          { class: 'dr-soon' },
          h('div', { class: 'dr-soon-h' }, h('b', null, 'Coming soon'), h('span', null, 'Joins Draft when its cards are ready')),
          h('div', { class: 'dr-soon-list' }, soon.map((o) => h('span', { class: 'dr-soon-chip', title: o.name }, o.code, h('i', null, `${Math.round((o.playable / o.printed) * 100)}%`)))),
        )
      : null,
    dev ? h('p', { class: 'dr-foot', style: { textAlign: 'left', margin: '0' } }, 'Dev override is on: incomplete sets can be drafted (packs repeat cards). Open #/draft?devsets=0 to turn it off.') : null,
  );

  const formatSeg = segmented(
    [
      { value: 'draft', label: 'Draft' },
      { value: 'sealed', label: 'Sealed' },
    ],
    f.mode,
    (v) => {
      f.mode = v as 'draft' | 'sealed';
      commit();
    },
    'Format',
  );
  const openCustomize = () => customizeSheet(f, dev, sync);
  const customRow = h(
    'button',
    { type: 'button', class: 'dr-custom', onclick: openCustomize },
    h('span', { class: 'dr-custom-ic' }, icon('gear')),
    h('span', { class: 'dr-custom-text' }, h('b', null, 'Customize'), customDetail),
    icon('chevron', 'icon dr-custom-chev'),
  );

  const body = h(
    'div',
    { class: 'dr-home' },
    resumeCard,
    resumeCard ? h('div', { class: 'dr-section-title', style: { margin: '6px 0 -6px' } }, h('span', null, 'New event')) : null,
    h(
      'section',
      { class: 'dr-card dr-opts' },
      h('div', { class: 'dr-hero' }, heroArt, h('div', null, heroTitle, heroText)),
      h('div', { class: 'dr-opt' }, h('span', { class: 'dr-opt-label' }, 'Format'), formatSeg),
      h('div', { class: 'dr-opt' }, h('span', { class: 'dr-opt-label' }, 'Boosters'), presetRow),
      h(
        'div',
        { class: 'dr-opt' },
        h('div', { class: 'dr-opt-head' }, h('span', { class: 'dr-opt-label' }, 'Packs · tap one to change it'), countWrap),
        strip,
        quick,
        summary,
      ),
      customRow,
      startBtn,
    ),
    foot,
    h(
      'div',
      { class: 'dr-rarity-key', 'aria-label': 'Rarities' },
      (['C', 'R', 'SR', 'UR', 'ScR'] as Rarity[]).map((r) => h('span', null, h('i', { class: 'dr-pip', dataset: { r } }), RARITY_NAME[r])),
    ),
    setsInfo,
  );
  sync();
  ctl.show(frame('Draft', { subtitle: 'Booster Draft and Sealed' }, body), 'home');
  if (opts.customize) setTimeout(openCustomize, 60);
}

// ------------------------------------------------------------------ pack opening

function openView(ctl: Ctl, s: DraftState) {
  const n = s.mode === 'sealed' ? s.opened : s.round;
  const pack: PackCard[] = s.packs[n][0];
  const burst = h('div', { class: 'dr-burst' });
  const code = planOf(s)[n] ?? EDISON_PACK;
  const opt = packOption(code);
  // A real booster tears like the Edison Pack: two clipped copies of its art, top strip and body.
  const visual =
    code === EDISON_PACK
      ? packArt(n, `Pack ${n + 1}`, `${modeLabel(s)} · ${pack.length} cards`)
      : h('div', { class: 'dr-rpack' }, h('div', { class: 'dr-rpack-body' }, setPackArt(code)), h('div', { class: 'dr-rpack-top' }, setPackArt(code)), h('div', { class: 'dr-pack-sheen' }));
  const packBtn = h('button', { type: 'button', class: 'dr-pack-btn', 'aria-label': `Open ${opt.name} pack` }, visual, h('div', { class: 'dr-tap-hint' }, code === EDISON_PACK ? 'Tap to open' : `${opt.name} · tap to open`));
  const stage = h('div', { class: 'dr-stage' }, burst, packBtn);
  const fr = frame(`Pack ${n + 1} of ${s.packCount}`, { cls: 'dr-open', compact: true, ...backToHome(ctl) }, stage);
  const note = h('div', { class: 'dr-dock-note' }, s.mode === 'draft' ? `${pack.length} cards · this pack passes ${passDir(n) === 1 ? 'left' : 'right'}` : `${pack.length} cards · ${s.packCount - n - 1} more after this one`);
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
    const grid = h('div', { class: ['dr-reveal', tiles.length <= 9 && 'dr-reveal--9'] }, tiles);
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
      // Small pools (9-card boosters) may not reach 40: plain monsters are free to add, like basic lands.
      const mainPicks = s.picks[0].filter((p) => !isExtraDeck(card(p.id))).length;
      const fill = fillerIds(s);
      if (mainPicks < 40 && fill.length && (filter === 'all' || filter === 'monster')) {
        content.append(
          h('div', { class: 'dr-section-title' }, h('span', null, 'Basic monsters'), h('span', null, 'free · any number')),
          h(
            'div',
            { class: 'dr-grid' },
            fill.map((id) => {
              const c = card(id);
              const t = tile(c, null);
              press(t, { tap: () => add(id), long: () => zoomCard(c) });
              return t;
            }),
          ),
        );
      }
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
  deck.format = 'draft';
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

function pairingsList(s: DraftState, n: number) {
  return h(
    'div',
    { class: 'dr-list' },
    s.rounds[n - 1].map((x) => {
      const A = playerById(s, x.a);
      const B = x.b ? playerById(s, x.b) : null;
      const p = scoreOf(x);
      return h(
        'div',
        { class: ['dr-pair', x.a === 'p0' && 'me'] },
        h('span', { class: x.result === 'a' && B ? 'won' : '' }, A.human ? 'You' : A.name),
        h('span', { class: 'dr-pair-mid' }, !B ? '' : x.result ? `${p.a}–${p.b}` : 'vs'),
        h('span', { class: x.result === 'b' ? 'won' : '' }, B ? B.name : 'Bye'),
      );
    }),
  );
}

function hubEyebrow(s: DraftState, n: number) {
  const total = totalRounds(s);
  const ko = optsOf(s).tourney === 'single';
  const label = ko ? (n === total ? 'Final' : n === total - 1 ? 'Semifinal' : `Round ${n} of ${total}`) : `Round ${n} of ${total}`;
  return `${modeLabel(s)} · ${label}`;
}

/** Single elimination: the human has a bye this round. */
function byeView(ctl: Ctl, s: DraftState) {
  const n = s.rounds.length;
  const rec = humanRecord(s);
  const pending = currentRound(s)?.some((m) => !m.result);
  const actions = h('div', { class: 'dr-btn-row' });
  const busy = h('div', { class: 'dr-busy', style: { display: 'none' } }, h('i', { class: 'dr-spinner' }), 'Other tables are playing…');
  if (pending)
    actions.append(
      button(
        'Play out the round',
        async () => {
          const token = ctl.token;
          actions.style.display = 'none';
          busy.style.display = '';
          await finishRound(s);
          persist(s);
          if (ctl.token === token) hubView(ctl, s);
        },
        { variant: 'primary', icon: 'play', cls: 'dr-btn-wide' },
      ),
    );
  else if (s.phase === 'done') actions.append(button('Final results', () => finalView(ctl, s), { variant: 'primary', icon: 'trophy', cls: 'dr-btn-wide' }));
  else
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
  const body = h(
    'div',
    { class: 'dr-hub' },
    h(
      'section',
      { class: 'dr-match' },
      h('div', { class: 'dr-eyebrow' }, 'Your match'),
      h('div', { class: 'dr-resume-title' }, 'Bye · you advance'),
      h('div', { class: 'dr-muted' }, 'An odd number of duelists are left, so you skip this round and count it as a win.'),
      actions,
      busy,
    ),
    h('div', { class: 'dr-section-title' }, h('span', null, `Round ${n} pairings`), h('span', null, pending ? 'In progress' : 'Final')),
    pairingsList(s, n),
    h('div', { class: 'dr-section-title' }, h('span', null, 'Standings'), h('b', null, `You ${rec.text}`)),
    standingsList(s),
  );
  ctl.show(frame(`Round ${n}`, { eyebrow: hubEyebrow(s, n), subtitle: `Playing “${deckNameOf(s)}” · ${rec.text}`, ...backToHome(ctl) }, body), 'hub');
}

/** The saved-duel key of a draft round's match. */
const duelKey = (s: DraftState, n: number) => `draft:${s.id}:r${n}`;

function hubView(ctl: Ctl, s: DraftState, autoResume = false) {
  const n = s.rounds.length;
  const m = humanMatch(s);
  const saved = reconcileActiveDuel('draft', m && m.b && !m.result ? duelKey(s, n) : null);
  if (autoResume && !saved) toast('That duel can no longer be resumed.', 'error');
  if (!m) return finalView(ctl, s);
  if (!m.b) return byeView(ctl, s);
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
    actions.append(button(saved ? 'Resume match' : n === 1 ? 'Start round 1' : `Start round ${n}`, () => void play(), { variant: 'primary', icon: saved ? 'play' : 'swords', cls: 'dr-btn-wide' }));
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

  const body = h(
    'div',
    { class: 'dr-hub' },
    saved && !done ? resumeDuelCard(saved, { onResume: () => void play(), cls: 'mode-resume' }) : null,
    matchCard,
    h('div', { class: 'dr-section-title' }, h('span', null, `Round ${n} pairings`), h('span', null, done ? 'Final' : 'In progress')),
    pairingsList(s, n),
    h('div', { class: 'dr-section-title' }, h('span', null, 'Standings'), h('b', null, `You ${rec.text}`)),
    standingsList(s),
  );
  ctl.show(frame(`Round ${n}`, { eyebrow: hubEyebrow(s, n), subtitle: `Playing “${deckNameOf(s)}” · ${rec.text}`, ...backToHome(ctl) }, body), 'hub');
  if (autoResume && saved && !done) setTimeout(() => void play(), 0);

  async function play() {
    if (!m || !m.b) return;
    const st = getSettings();
    const me = s.players[0];
    const deckName = deckNameOf(s);
    const sides: [DuelSide, DuelSide] = [
      { name: me.name, deck: { ...myDeck, side: humanSideIds(s).map(card) }, avatar: st.avatar, sleeve: st.sleeve, control: 'human', title: deckName },
      { name: opp.name, deck: oppDeck, avatar: opp.avatar, sleeve: opp.sleeve, control: optsOf(s).ai, title: describeDeck(oppDeck) },
    ];
    const out = await runMatch({
      sides,
      bestOf: s.bestOf,
      caption: `Draft · Round ${n} – vs ${opp.name}`,
      stats: s.savedDeckId ? { deckKey: `custom:${s.savedDeckId}`, deckName } : undefined,
      resume: { kind: 'draft', key: duelKey(s, n), route: 'draft', params: { view: 'hub' } },
      limited: true,
    });
    const token = ctl.token;
    actions.style.display = 'none';
    busy.style.display = '';
    await recordHumanMatch(s, out.games, out.result);
    persist(s);
    const r = scoreOf({ games: out.games });
    const res = out.result === 'a' ? 'W' : out.result === 'b' ? 'L' : 'D';
    recordLimitedResult(aiRating(optsOf(s).ai), res); // Limited rating
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

/** Event prize: a pack per match win (+1 for the champion) and Duel Points for taking part. */
function prizeFor(place: number, wins: number) {
  return { packs: wins + (place === 1 ? 1 : 0), coins: 50 + 50 * wins };
}

function finalView(ctl: Ctl, s: DraftState) {
  const st = standings(s);
  const me = st.find((x) => x.id === 'p0');
  const place = me?.rank ?? seatsOf(s);
  const rec = humanRecord(s);
  if (!s.recorded && s.phase === 'done') {
    s.recorded = true;
    persist(s);
    const champ = playerById(s, st[0].id);
    recordTournament({
      id: s.id,
      name: `${modeLabel(s)} – ${deckDate(s.created)}`,
      date: Date.now(),
      size: seatsOf(s),
      place,
      record: rec.text,
      deckName: deckNameOf(s),
      champion: champ.human ? 'You' : champ.name,
    });
    const prize = prizeFor(place, rec.w);
    if (prize.packs || prize.coins) grantPrize({ ...prize, reason: `${modeLabel(s)} · ${ordinal(place)} place` });
  }
  const prize = prizeFor(place, rec.w);
  const headline = place === 1 ? `Champion · ${rec.text}` : `Record ${rec.text}`;
  const body = h(
    'div',
    { class: 'dr-final' },
    h(
      'div',
      { class: 'dr-place' },
      h('div', { class: 'dr-eyebrow' }, `${modeLabel(s)} · ${seatsOf(s)} players${optsOf(s).tourney === 'single' ? ' · single elimination' : ''}`),
      h('div', { class: 'dr-place-big' }, ordinal(place)),
      h('div', { class: 'dr-place-sub' }, headline),
      h('div', { class: 'dr-place-deck' }, `Prize: ${[prize.packs ? plural(prize.packs, 'pack') : '', prize.coins ? `${prize.coins} DP` : ''].filter(Boolean).join(' · ')}`),
      h('div', { class: 'dr-place-deck', style: { marginTop: '2px' } }, `Your deck is saved as “${deckNameOf(s)}”.`),
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
        if (!m) return null;
        if (!m.b) return h('div', { class: 'dr-pair' }, h('span', null, `Round ${i + 1}`), h('span', { class: 'dr-pair-mid' }, ''), h('span', { class: 'won' }, 'Bye'));
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
