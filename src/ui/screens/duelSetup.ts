// "Duel vs AI" setup screen, and the "Watch AI vs AI" exhibition setup.
import type { Difficulty } from '../../ai/ai';
import { PREMADE_DECKS } from '../../decks';
import type { DuelSide } from '../duel/api';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { ctaButton, deckArt, deckCarousel, deckGroups, deckShelf, linkButton, lobbySection, newPersona, opponentEditor, randomAvatar, stickyBar, type PersonaState } from './components';
import { confirmDialog, h, icon, segmented, toast } from './dom';
import { SLEEVES } from './ext';
import { rewardForDuel } from '../../collection';
import { runMatch, setupFromSaved, type MatchSetup } from './match';
import { clearActiveDuel, loadActiveDuel } from '../duel/resume';
import { announceReward } from './rewards';
import { frame, go, scrollToTop, type Screen } from './nav';
import { showResults } from './results';
import { allDeckInfos, premadeInfo, recordMatch, resolveDeck, toDeckList, type DeckInfo } from './store';
// Events agent: optional Ranked switch (Constructed rating).
import { aiRating, recordConstructedResult, signed } from '../../events/ratings';
import { iosRow } from './components';
import { toggle } from './dom';

const SETUP_KEY = 'edison.duelSetup.v1';
const EXHIBITION_KEY = 'edison.exhibition.v1';

interface DuelSetupState {
  myDeck: string | null;
  oppDeck: string | null; // null = random
  persona: PersonaState;
  bestOf: 1 | 3;
  /** Ranked: the result updates your Constructed rating (default Casual). */
  ranked?: boolean;
}

const TIER_W: Record<number, number> = { 1: 5, 2: 3, 3: 1.5 };
export function randomPremade(exclude?: string): DeckInfo | null {
  const pool = PREMADE_DECKS.filter((d) => d.id !== exclude);
  const list = pool.length ? pool : PREMADE_DECKS;
  if (!list.length) return null;
  const total = list.reduce((a, d) => a + TIER_W[d.tier], 0);
  let r = Math.random() * total;
  for (const d of list) {
    r -= TIER_W[d.tier];
    if (r <= 0) return premadeInfo(d);
  }
  return premadeInfo(list[list.length - 1]);
}

export const randomSleeve = () => SLEEVES[Math.floor(Math.random() * SLEEVES.length)]?.id ?? 'classic-red';

function deckFromKey(key: string | null): DeckInfo | null {
  if (!key) return null;
  const [kind, ...rest] = key.split(':');
  return resolveDeck({ kind: kind as 'premade' | 'custom', id: rest.join(':') });
}

/** Ask before playing with an illegal deck. */
export async function confirmDeckProblems(d: DeckInfo) {
  if (!d.problems.length) return true;
  return confirmDialog(
    'Deck is not tournament legal',
    `${d.name} has ${d.problems.length} problem${d.problems.length > 1 ? 's' : ''}: ${d.problems.slice(0, 3).join(' ')}${d.problems.length > 3 ? ' …' : ''} Play anyway?`,
    'Play anyway',
  );
}

export function duelSetupScreen(params: Record<string, string> = {}): Screen {
  if (params.resume === '1') {
    // Home's "Duel in progress" card: pick the saved duel up straight away
    history.replaceState(null, '', '#/duel');
    setTimeout(() => {
      if (!resumeVsAI()) toast('That duel can no longer be resumed.', 'error');
    }, 0);
  }
  const s = getSettings();
  const saved = loadJSON<Partial<DuelSetupState>>(SETUP_KEY, {});
  const decks = allDeckInfos();
  const st: DuelSetupState = {
    myDeck: saved.myDeck && decks.some((d) => d.key === saved.myDeck) ? saved.myDeck : null,
    oppDeck: saved.oppDeck && decks.some((d) => d.key === saved.oppDeck) ? saved.oppDeck : null,
    persona: saved.persona?.name ? { ...saved.persona, difficulty: saved.persona.difficulty ?? s.defaultDifficulty } : newPersona(s.defaultDifficulty),
    bestOf: saved.bestOf === 3 ? 3 : 1,
    ranked: saved.ranked === true,
  };
  const persist = () => saveJSON(SETUP_KEY, st);
  let step: 1 | 2 = 1;

  // ---- step indicator
  const stepBtn = (n: 1 | 2, label: string) =>
    h(
      'button',
      { type: 'button', class: 'flow-step-btn', onclick: () => (n === 1 ? show(1) : st.myDeck ? show(2) : toast('Choose your deck first.', 'error')) },
      h('span', { class: 'flow-num' }, String(n)),
      h('span', null, label),
    );
  const s1 = stepBtn(1, 'Your deck');
  const s2 = stepBtn(2, 'Opponent');
  const steps = h('nav', { class: 'flow-steps', 'aria-label': 'Setup steps' }, s1, h('span', { class: 'flow-line', 'aria-hidden': 'true' }), s2);
  const stage = h('div', { class: 'flow-stage' });

  // ---- step 1: your deck
  function deckStep() {
    const groups = deckGroups(decks);
    const rows = groups.filter((g) => g.decks.length).length;
    return h(
      'div',
      { class: ['flow-pane', rows <= 2 && 'flow-roomy'] },
      ...groups
        .filter((g) => g.decks.length)
        .map((g) =>
          lobbySection(
            g.title,
            g.key === 'mine' ? linkButton('Deck Builder', () => go('deck-builder')) : h('span', { class: 'lob-count' }, String(g.decks.length)),
            deckCarousel(
              g.decks,
              st.myDeck,
              (d) => {
                st.myDeck = d?.key ?? null;
                persist();
                if (d) setTimeout(() => show(2), 140);
              },
              { keepOrder: true, label: `Your deck: ${g.title}`, newDeck: g.key === 'mine' ? () => go('deck-builder') : undefined },
            ),
          ),
        ),
      groups[0].decks.length
        ? null
        : h(
            'button',
            { type: 'button', class: 'home-row flow-build', onclick: () => go('deck-builder') },
            h('span', { class: 'home-row-icon' }, icon('plus')),
            h('span', { class: 'home-row-label' }, 'Build your own deck'),
            icon('chevron'),
          ),
    );
  }

  // ---- step 2: opponent
  const matchup = h('div', { class: 'mu' });
  const drawMatchup = () => {
    const mine = deckFromKey(st.myDeck);
    const opp = deckFromKey(st.oppDeck);
    const side = (d: DeckInfo | null, who: string, name: string, onclick?: () => void) =>
      h(
        onclick ? 'button' : 'div',
        { class: 'mu-side', type: onclick ? 'button' : undefined, onclick, title: onclick ? 'Change your deck' : undefined },
        d ? deckArt(d, 'mu-art') : h('span', { class: 'mu-art mu-art--random' }, icon('dice')),
        h('span', { class: 'mu-text' }, h('span', { class: 'mu-who' }, who), h('b', null, name)),
      );
    matchup.replaceChildren(
      side(mine, 'You', mine?.name ?? 'No deck', () => show(1)),
      h('span', { class: 'mu-vs' }, 'vs'),
      side(opp, st.persona.name, opp?.name ?? 'Random deck'),
    );
  };
  const changed = () => {
    persist();
    drawMatchup();
  };
  function oppStep() {
    drawMatchup();
    return h(
      'div',
      { class: 'flow-pane flow-opp' },
      matchup,
      lobbySection('Opponent deck', null, deckShelf(decks, st.oppDeck, (d) => ((st.oppDeck = d?.key ?? null), changed()), { random: true, label: 'Opponent deck' })),
      h('div', { class: 'lob-group opp-group' }, opponentEditor(st.persona, changed, { hideDifficulty: true })),
      h('div', { class: 'lob-group' }, iosRow('Ranked', 'Counts toward your Constructed rating', toggle(!!st.ranked, (v) => ((st.ranked = v), changed()), 'Ranked'))),
      stickyBar(
        h(
          'div',
          { class: 'flow-opts' },
          segmented<Difficulty>(
            [
              { value: 'easy', label: 'Easy', hint: 'Makes mistakes, plays loosely' },
              { value: 'normal', label: 'Normal', hint: 'Thinks a few plays ahead' },
              { value: 'hard', label: 'Hard', hint: 'Reads your set cards, plans two turns ahead' },
            ],
            st.persona.difficulty,
            (v) => ((st.persona.difficulty = v), changed()),
            'AI difficulty',
          ),
          segmented<1 | 3>(
            [
              { value: 1, label: 'Single', hint: 'One game' },
              { value: 3, label: 'Bo3', hint: 'Best of three: first to two wins' },
            ],
            st.bestOf,
            (v) => ((st.bestOf = v), changed()),
            'Match format',
          ),
        ),
        ctaButton('Duel', () => void start(), 'swords'),
      ),
    );
  }

  function show(n: 1 | 2) {
    if (n === 2 && !deckFromKey(st.myDeck)) n = 1;
    const dir = n > step ? 'fwd' : n < step ? 'back' : '';
    step = n;
    const pane = n === 1 ? deckStep() : oppStep();
    if (dir) pane.classList.add(`flow-${dir}`);
    stage.replaceChildren(pane);
    s1.classList.toggle('on', n === 1);
    s2.classList.toggle('on', n === 2);
    s1.classList.toggle('done', n === 2);
    s1.setAttribute('aria-current', n === 1 ? 'step' : 'false');
    s2.setAttribute('aria-current', n === 2 ? 'step' : 'false');
    const lbl = el.querySelector('.frame-back-label');
    if (lbl) lbl.textContent = n === 2 ? 'Deck' : 'Duel';
    el.querySelector('.frame-back')?.setAttribute('aria-label', n === 2 ? 'Back to deck choice' : 'Back to Duel');
    if (dir) scrollToTop();
  }

  async function start() {
    const mine = deckFromKey(st.myDeck);
    if (!mine) return show(1);
    if (!(await confirmDeckProblems(mine))) return;
    const opp = deckFromKey(st.oppDeck) ?? randomPremade();
    if (!opp) return toast('No opponent decks are available yet.', 'error');
    await playVsAI(mine, opp, { ...st.persona }, st.bestOf, !!st.ranked);
  }

  const el = frame('Duel vs AI', { cls: 'lobby-screen duel-flow', compact: true, backTo: () => (step === 2 ? show(1) : go('title')), backLabel: 'Play' }, steps, stage);
  show(1);
  return {
    el,
    onEscape: () => {
      if (step !== 2) return false;
      show(1);
      return true;
    },
  };
}

interface VsAIMeta {
  mine: string;
  mineName: string;
  opp: string;
  oppName: string;
  persona: PersonaState;
  ranked: boolean;
}

export async function playVsAI(mine: DeckInfo, opp: DeckInfo, persona: PersonaState, bestOf: 1 | 3, ranked = false) {
  const s = getSettings();
  const sides: [DuelSide, DuelSide] = [
    { name: s.playerName, deck: toDeckList(mine), avatar: s.avatar, sleeve: s.sleeve, control: 'human', title: mine.name },
    { name: persona.name, deck: toDeckList(opp), avatar: persona.avatar, sleeve: randomSleeve(), control: persona.difficulty, title: opp.name },
  ];
  const meta: VsAIMeta = { mine: mine.key, mineName: mine.name, opp: opp.key, oppName: opp.name, persona: { ...persona }, ranked };
  const setup: MatchSetup = {
    sides,
    bestOf,
    caption: `vs ${persona.name} (${opp.name})`,
    stats: { deckKey: mine.key, deckName: mine.name },
    resume: { kind: 'vsai', key: `vsai:${Date.now().toString(36)}`, route: 'duel', meta: meta as unknown as Record<string, unknown> },
  };
  await playVsAISetup(setup);
}

/** Resume the saved Duel vs AI (Home's "Duel in progress" card). False when there is none. */
export function resumeVsAI(): boolean {
  const d = loadActiveDuel();
  if (!d || d.tag.kind !== 'vsai' || !d.tag.meta) return false;
  const setup = setupFromSaved(d);
  if (!setup) {
    clearActiveDuel();
    return false;
  }
  void playVsAISetup(setup);
  return true;
}

async function playVsAISetup(setup: MatchSetup) {
  const m = setup.resume!.meta as unknown as VsAIMeta;
  const { persona, ranked } = m;
  const bestOf = setup.bestOf;
  const outcome = await runMatch(setup);
  const res = outcome.result === 'a' ? 'W' : outcome.result === 'b' ? 'L' : 'D';
  const wa = outcome.games.filter((g) => g.winner === 0).length;
  const wb = outcome.games.filter((g) => g.winner === 1).length;
  recordMatch({ date: Date.now(), deckName: m.mineName, oppName: persona.name, oppDeck: m.oppName, result: res, score: `${wa}-${wb}`, context: ranked ? 'Duel vs AI · Ranked' : 'Duel vs AI' });
  const rated = ranked ? recordConstructedResult(aiRating(persona.difficulty), res) : null;
  const rematch = () => {
    const mine = deckFromKey(m.mine);
    const opp = deckFromKey(m.opp);
    if (mine && opp) void playVsAI(mine, opp, persona, bestOf, ranked);
    else go('duel');
  };
  showResults({
    setup,
    outcome,
    human: 0,
    context: `Duel vs AI · ${persona.difficulty[0].toUpperCase() + persona.difficulty.slice(1)}${rated ? ` · Ranked · Rating ${rated.after} (${signed(rated.delta)})` : ''}`,
    actions: [
      { label: 'Rematch', variant: 'primary', icon: 'refresh', onClick: rematch },
      { label: 'New duel', icon: 'swords', onClick: () => go('duel') },
      { label: 'Home', icon: 'home', onClick: () => go('title') },
    ],
  });
  announceReward(rewardForDuel({ won: res === 'W', mode: bestOf > 1 ? 'match' : 'duel' }));
}

// ------------------------------------------------------------------ exhibition

interface ExhibitionSide {
  deck: string | null;
  persona: PersonaState;
}

export function exhibitionScreen(): Screen {
  const saved = loadJSON<{ a?: ExhibitionSide; b?: ExhibitionSide; bestOf?: 1 | 3 }>(EXHIBITION_KEY, {});
  const decks = allDeckInfos();
  const mk = (x?: ExhibitionSide): ExhibitionSide => ({
    deck: x?.deck && decks.some((d) => d.key === x.deck) ? x.deck : null,
    persona: x?.persona?.name ? x.persona : newPersona('normal'),
  });
  const st = { a: mk(saved.a), b: mk(saved.b), bestOf: (saved.bestOf === 3 ? 3 : 1) as 1 | 3 };
  while (st.b.persona.avatar === st.a.persona.avatar) st.b.persona.avatar = randomAvatar();
  const persist = () => saveJSON(EXHIBITION_KEY, st);

  const side = (x: ExhibitionSide, label: string) => [
    lobbySection(label, null, h('div', { class: 'lob-group' }, opponentEditor(x.persona, persist, { nameLabel: `${label} name` }))),
    deckShelf(decks, x.deck, (d) => ((x.deck = d?.key ?? null), persist()), { random: true, label: `${label} deck` }),
  ];

  async function start() {
    const a = deckFromKey(st.a.deck) ?? randomPremade();
    const b = deckFromKey(st.b.deck) ?? randomPremade(a?.ref.id);
    if (!a || !b) return toast('No decks are available yet.', 'error');
    await watch(a, b);
  }

  async function watch(a: DeckInfo, b: DeckInfo) {
    const sides: [DuelSide, DuelSide] = [
      { name: st.a.persona.name, deck: toDeckList(a), avatar: st.a.persona.avatar, sleeve: randomSleeve(), control: st.a.persona.difficulty as Difficulty, title: a.name },
      { name: st.b.persona.name, deck: toDeckList(b), avatar: st.b.persona.avatar, sleeve: randomSleeve(), control: st.b.persona.difficulty as Difficulty, title: b.name },
    ];
    const setup: MatchSetup = { sides, bestOf: st.bestOf, caption: `Exhibition match` };
    const outcome = await runMatch(setup);
    showResults({
      setup,
      outcome,
      human: null,
      context: 'Exhibition match',
      actions: [
        { label: 'Watch again', variant: 'primary', icon: 'refresh', onClick: () => void watch(a, b) },
        { label: 'New match', icon: 'eye', onClick: () => go('exhibition') },
        { label: 'Home', icon: 'home', onClick: () => go('title') },
      ],
    });
  }

  const el = frame(
    'Watch AI vs AI',
    { subtitle: 'Spectate an exhibition between two AI duelists', cls: 'lobby-screen', backTo: () => go('title'), backLabel: 'Play' },
    side(st.a, 'Duelist A'),
    side(st.b, 'Duelist B'),
    lobbySection(
      'Format',
      null,
      segmented<1 | 3>(
        [
          { value: 1, label: 'Single game' },
          { value: 3, label: 'Best of 3' },
        ],
        st.bestOf,
        (v) => ((st.bestOf = v), persist()),
        'Match format',
      ),
    ),
    stickyBar(h('div', { class: 'lob-bar-sum' }, icon('eye'), h('span', null, ' You spectate — the duel plays itself.')), ctaButton('Start exhibition', () => void start(), 'play')),
  );
  return { el };
}

