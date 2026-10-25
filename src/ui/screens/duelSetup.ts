// "Duel vs AI" setup screen, and the "Watch AI vs AI" exhibition setup.
import type { Difficulty } from '../../ai/ai';
import { PREMADE_DECKS } from '../../decks';
import type { DuelSide } from '../duel/api';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { deckPicker, newPersona, personaEditor, randomAvatar, type PersonaState } from './components';
import { button, confirmDialog, h, icon, segmented, toast } from './dom';
import { SLEEVES, renderAvatar } from './ext';
import { runMatch, type MatchSetup } from './match';
import { frame, go, type Screen } from './nav';
import { showResults } from './results';
import { allDeckInfos, premadeInfo, recordMatch, resolveDeck, toDeckList, type DeckInfo } from './store';

const SETUP_KEY = 'edison.duelSetup.v1';
const EXHIBITION_KEY = 'edison.exhibition.v1';

interface DuelSetupState {
  myDeck: string | null;
  oppDeck: string | null; // null = random
  persona: PersonaState;
  bestOf: 1 | 3;
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

export function duelSetupScreen(): Screen {
  const s = getSettings();
  const saved = loadJSON<Partial<DuelSetupState>>(SETUP_KEY, {});
  const decks = allDeckInfos();
  const st: DuelSetupState = {
    myDeck: saved.myDeck && decks.some((d) => d.key === saved.myDeck) ? saved.myDeck : (decks[0]?.key ?? null),
    oppDeck: saved.oppDeck && decks.some((d) => d.key === saved.oppDeck) ? saved.oppDeck : null,
    persona: saved.persona?.name ? { ...saved.persona, difficulty: saved.persona.difficulty ?? s.defaultDifficulty } : newPersona(s.defaultDifficulty),
    bestOf: saved.bestOf === 3 ? 3 : 1,
  };
  const persist = () => saveJSON(SETUP_KEY, st);

  const summary = h('div', { class: 'setup-summary' });
  const drawSummary = () => {
    const mine = deckFromKey(st.myDeck);
    const opp = deckFromKey(st.oppDeck);
    summary.replaceChildren(
      h('span', null, h('b', null, mine?.name ?? 'No deck'), ' vs ', h('b', null, opp?.name ?? 'Random deck')),
      h('span', { class: 'muted' }, ` · ${st.persona.name} (${st.persona.difficulty}) · ${st.bestOf === 3 ? 'Best of 3' : 'Single game'}`),
    );
    startBtn.disabled = !mine;
  };

  const myPanel = h(
    'section',
    { class: 'setup-panel you' },
    h(
      'header',
      { class: 'setup-head' },
      h('span', { class: 'avatar-ring' }, renderAvatar(s.avatar, 56)),
      h('div', null, h('div', { class: 'setup-role' }, 'You'), h('div', { class: 'setup-name' }, s.playerName)),
      button('Deck Builder', () => go('deck-builder'), { variant: 'ghost', icon: 'cards', small: true }),
    ),
    h('div', { class: 'setup-label' }, 'Choose your deck'),
    deckPicker(
      decks,
      st.myDeck,
      (d) => {
        st.myDeck = d.key;
        persist();
        drawSummary();
      },
      { emptyText: 'No decks yet — build one in the Deck Builder.' },
    ),
  );

  const oppPanel = h(
    'section',
    { class: 'setup-panel opp' },
    h('header', { class: 'setup-head' }, h('div', null, h('div', { class: 'setup-role' }, 'Opponent'), h('div', { class: 'setup-name' }, 'AI Duelist'))),
    personaEditor(st.persona, () => {
      persist();
      drawSummary();
    }),
    h('div', { class: 'setup-label' }, 'Opponent deck'),
    deckPicker(
      decks,
      st.oppDeck,
      (d) => {
        st.oppDeck = d.key;
        persist();
        drawSummary();
      },
      {
        randomOption: {
          selected: st.oppDeck == null,
          onSelect: () => {
            st.oppDeck = null;
            persist();
            drawSummary();
          },
        },
      },
    ),
  );

  const startBtn = button('Start duel', () => void start(), { variant: 'primary', icon: 'swords', cls: 'ui-btn-lg start-btn' });
  const formatSeg = segmented<1 | 3>(
    [
      { value: 1, label: 'Single game' },
      { value: 3, label: 'Best of 3' },
    ],
    st.bestOf,
    (v) => {
      st.bestOf = v;
      persist();
      drawSummary();
    },
    'Match format',
  );

  async function start() {
    const mine = deckFromKey(st.myDeck);
    if (!mine) return toast('Choose a deck first.', 'error');
    if (!(await confirmDeckProblems(mine))) return;
    const opp = deckFromKey(st.oppDeck) ?? randomPremade();
    if (!opp) return toast('No opponent decks are available yet.', 'error');
    await playVsAI(mine, opp, { ...st.persona }, st.bestOf);
  }

  const el = frame(
    'Duel vs AI',
    { subtitle: 'Pick your deck and an opponent', cls: 'duel-setup' },
    h(
      'div',
      { class: 'setup-grid' },
      myPanel,
      h('div', { class: 'setup-vs', 'aria-hidden': 'true' }, h('span', null, 'VS')),
      oppPanel,
    ),
    h(
      'div',
      { class: 'setup-bar' },
      h('div', { class: 'setup-bar-left' }, h('span', { class: 'field-label' }, 'Format'), formatSeg),
      summary,
      startBtn,
    ),
  );
  drawSummary();
  return { el };
}

export async function playVsAI(mine: DeckInfo, opp: DeckInfo, persona: PersonaState, bestOf: 1 | 3) {
  const s = getSettings();
  const sides: [DuelSide, DuelSide] = [
    { name: s.playerName, deck: toDeckList(mine), avatar: s.avatar, sleeve: s.sleeve, control: 'human', title: mine.name },
    { name: persona.name, deck: toDeckList(opp), avatar: persona.avatar, sleeve: randomSleeve(), control: persona.difficulty, title: opp.name },
  ];
  const setup: MatchSetup = {
    sides,
    bestOf,
    caption: `vs ${persona.name} (${opp.name})`,
    stats: { deckKey: mine.key, deckName: mine.name },
  };
  const outcome = await runMatch(setup);
  const res = outcome.result === 'a' ? 'W' : outcome.result === 'b' ? 'L' : 'D';
  const wa = outcome.games.filter((g) => g.winner === 0).length;
  const wb = outcome.games.filter((g) => g.winner === 1).length;
  recordMatch({ date: Date.now(), deckName: mine.name, oppName: persona.name, oppDeck: opp.name, result: res, score: `${wa}-${wb}`, context: 'Duel vs AI' });
  showResults({
    setup,
    outcome,
    human: 0,
    context: `Duel vs AI · ${persona.difficulty[0].toUpperCase() + persona.difficulty.slice(1)}`,
    actions: [
      { label: 'Rematch', variant: 'primary', icon: 'refresh', onClick: () => void playVsAI(mine, opp, persona, bestOf) },
      { label: 'Change setup', icon: 'swords', onClick: () => go('duel') },
      { label: 'Main menu', icon: 'back', onClick: () => go('title') },
    ],
  });
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

  const sidePanel = (x: ExhibitionSide, label: string, cls: string) =>
    h(
      'section',
      { class: ['setup-panel', cls] },
      h('header', { class: 'setup-head' }, h('div', null, h('div', { class: 'setup-role' }, label), h('div', { class: 'setup-name' }, 'AI Duelist'))),
      personaEditor(x.persona, persist),
      h('div', { class: 'setup-label' }, 'Deck'),
      deckPicker(decks, x.deck, (d) => ((x.deck = d.key), persist()), { randomOption: { selected: x.deck == null, onSelect: () => ((x.deck = null), persist()) } }),
    );

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
        { label: 'New exhibition', icon: 'eye', onClick: () => go('exhibition') },
        { label: 'Main menu', icon: 'back', onClick: () => go('title') },
      ],
    });
  }

  const el = frame(
    'Watch AI vs AI',
    { subtitle: 'Spectate an exhibition between two AI duelists', cls: 'duel-setup' },
    h('div', { class: 'setup-grid' }, sidePanel(st.a, 'Duelist A', 'you'), h('div', { class: 'setup-vs', 'aria-hidden': 'true' }, h('span', null, 'VS')), sidePanel(st.b, 'Duelist B', 'opp')),
    h(
      'div',
      { class: 'setup-bar' },
      h(
        'div',
        { class: 'setup-bar-left' },
        h('span', { class: 'field-label' }, 'Format'),
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
      h('div', { class: 'setup-summary muted' }, icon('eye'), ' You will spectate; the duel plays itself.'),
      button('Start exhibition', () => void start(), { variant: 'primary', icon: 'play', cls: 'ui-btn-lg start-btn' }),
    ),
  );
  return { el };
}

