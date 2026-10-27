// Guide (route `guide`): how the app works, where its rules and card pictures come from, and what to do when a card
// plays wrong. Opened from Home ("Guide · How the app works"), Settings → Help and How to Play.
// The section links scroll in code (the URL hash is the router's, so no #anchors).
import { FORBIDDEN, LIMITED, SEMI_LIMITED } from '../../cards/banlist';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../net/tourneyProtocol';
import { h, icon, type Child } from './dom';
import { DUR } from '../motion';
import { frame, go, type Params, type Screen } from './nav';
import './guide.css';

type SectionId = 'tabs' | 'duel' | 'online' | 'rules' | 'images' | 'wrong';

const ext = (href: string, label: Child) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
const b = (t: string) => h('b', null, t);
/** A link to another screen of the app. */
const to = (route: string, label: string, params?: Record<string, string>) => h('button', { type: 'button', class: 'gd-link', onclick: () => go(route, params) }, label);

function section(id: SectionId, title: string, ...body: Child[]) {
  return h('section', { class: 'gd-section', 'data-section': id, 'aria-labelledby': `gd-h-${id}` }, h('h2', { class: 'gd-h', id: `gd-h-${id}` }, title), ...body);
}
const steps = (...items: Child[]) => h('ol', { class: 'gd-steps' }, items.map((i) => h('li', null, h('span', null, i))));
const list = (...items: Child[]) => h('ul', { class: 'gd-list' }, items.map((i) => h('li', null, i)));

function tabsSection() {
  const tab = (name: string, ic: Parameters<typeof icon>[0], ...body: Child[]) => h('div', { class: 'gd-tab' }, h('div', { class: 'gd-tab-name' }, icon(ic), name), h('div', { class: 'gd-tab-body' }, ...body));
  return section(
    'tabs',
    'Getting around',
    h('p', { class: 'gd-muted' }, 'Five tabs along the bottom of the screen.'),
    h(
      'div',
      { class: 'gd-tabs' },
      tab(
        'Home',
        'home',
        h('p', null, 'Pick up an unfinished duel, see this week’s play, and open your cards: Packs, Draft, Decks and Binder.'),
        list(
          [b('Card Database'), ': search every card in the pool.'],
          [b('How to Play & Banlist'), ': the format, the duel rules and the full banlist with search.'],
          [b('Rules updates'), ': the rulings that changed recently, per deck (also under More).'],
          [b('Banlist · March 2010'), ' (near the bottom): opens the official list straight away.'],
          [b('Guide'), ': this page.'],
        ),
      ),
      tab(
        'Duel',
        'swords',
        list(
          [b('Duel vs AI'), ': choose your deck and the AI’s deck, Easy / Normal / Hard, single game or best of three.'],
          [b('Play a friend'), ': a 1-on-1 online duel with a room code.'],
          [b('Friends Locals'), `: a Swiss tournament for ${MIN_PLAYERS}–${MAX_PLAYERS} people, each on their own phone. One person hosts and runs it as organiser.`],
          [b('Locals Night, Events, Tournament'), ': solo events against AI duelists.'],
          [b('Watch AI vs AI'), ': two AI decks play each other, handy for testing a matchup.'],
        ),
      ),
      tab('Draft', 'cards', h('p', null, 'Draft and Sealed from 2010-era packs. Forbidden cards never show up in packs.')),
      tab('Decks', 'edit', h('p', null, 'Build and edit decks. The builder checks each deck against the banlist and the deck-size rules (40–60 Main, up to 15 Extra, up to 15 Side) and tells you what to fix.')),
      tab('More', 'gear', h('p', null, 'Settings: your name, response prompts, card pictures, sound and music, ', b('Report a problem'), ' and this Guide.')),
    ),
  );
}

function duelSection() {
  return section(
    'duel',
    'In a duel',
    list(
      [b('Tap a card'), ' to see what you can do with it. If something can’t be used right now, it shows ', b('greyed out with the reason'), ', for example “your monster can’t be Tributed”.'],
      [b('Press and hold a card'), ' to read it full size. In card lists, tap the magnifier or hold the card.'],
      [
        b('Response prompts'),
        ' (Settings): ',
        b('Smart'),
        ' always asks during chains, attacks and the Damage Step, and otherwise only at the moments a trick makes sense: your Standby Phase, the opponent’s Standby and End Phase, and right after they summon. ',
        b('Always'),
        ' asks at every chance to respond.',
      ],
      [b('Chain order'), ': when two or more of your effects trigger at the same moment, a sheet asks for their order. Tap them in Chain order: the last one you pick resolves first.'],
      [b('Shuffle your hand'), ': swipe sideways across it.'],
      [b('Flag button'), ' (top right): leave or concede, ', b('Settings'), ', or ', b('Report a problem'), '. A report saves the whole duel so it can be replayed exactly.'],
      [b('Settings in a duel'), ': response prompts, animation speed, sound, music, volume, haptics and card pictures open over the board and apply at once. The duel keeps going, and an online game is never paused: settings stay on your phone.'],
    ),
  );
}

function onlineSection() {
  return section(
    'online',
    'Playing friends',
    h('p', null, 'Phones connect directly to each other. The app only uses a server to find the other phone, plus a relay as a backup when a direct connection is blocked.'),
    steps(
      [b('Everyone on the same version.'), ' After an update, fully close the app (swipe it away) and reopen it. If two phones are on different versions, the app tells you to do this.'],
      [b('Set your name'), ' when the app asks. You can change it later in Settings or from the lobby.'],
      [b('Play a friend:'), ' one person taps Create room, the other types the code and taps Join. After the game, both tap ', b('Rematch'), ' to play again in the same room.'],
      [
        b('Friends Locals:'),
        ' the host creates the event and shares the code, everyone joins and picks a deck, then the host starts the first round. Each table connects on its own. If a table is stuck, the waiting screen says why and has a ',
        b('Retry'),
        ' button, and the organiser can ',
        b('Restart match'),
        ' from the Organiser tab.',
      ],
    ),
    h('p', { class: 'gd-note' }, b('Hotel, guest or school Wi-Fi'), ' often blocks phones from talking to each other. Put one phone on the other’s ', b('Personal Hotspot'), ' and it connects.'),
  );
}

function rulesSection() {
  const src = (what: string, ...body: Child[]) => h('div', { class: 'gd-src' }, h('div', { class: 'gd-src-what' }, what), h('p', null, ...body));
  return section(
    'rules',
    'Where the rules come from',
    h('p', null, 'The app plays the way the game was played at SJC Edison in April 2010, using the sources below and nothing else. Whenever a card’s behaviour depends on a ruling, the app’s code links to the ruling it follows, and each of those cards has an automatic test.'),
    h(
      'div',
      { class: 'gd-sources' },
      src('Card text', 'The English (US) printing that was current in April 2010, not the Japanese text and not later rewordings. That’s why Treeborn Frog can’t come back while you control a face-up Treeborn Frog, and Brain Control can take any face-up monster.'),
      src('Card rulings', ext('https://edisonrul.ing', 'edisonrul.ing'), ' has a page per card. The app uses its ', b('historical section'), ' first, which holds the 2010 Upper Deck and Konami rulings. Today’s Edison judge rulings are only used where the 2010 ones say nothing. About 1,300 cards were checked against it.'),
      src(
        'Game rules',
        'The Edison-era ',
        ext('https://www.edisonformat.com/rulebook.html', 'Official Rulebook v7.0'),
        ' and edisonformat.com’s ',
        ext('https://www.edisonformat.com/edison-rule-differences.html', 'Rule Differences Between Edison & Modern'),
        '. These cover the Damage Step, chains, missing the timing and LP costs.',
      ),
      src('Functional errata', ext('https://www.edisonformat.com/functional-errata.html', 'edisonformat.com/functional-errata'), ': cards whose Edison wording works differently from today’s, such as Ultimate Offering and Light and Darkness Dragon.'),
      src(
        'Banlist',
        'The official March 2010 TCG list, enforced exactly: ',
        b(`${FORBIDDEN.length} Forbidden, ${LIMITED.length} Limited, ${SEMI_LIMITED.length} Semi-Limited`),
        ' (',
        ext('https://www.edisonformat.com/banlist.html', 'edisonformat.com/banlist'),
        '; in the app: ',
        to('rules', 'How to Play → Banlist', { tab: 'banlist' }),
        '). Main, Side and Extra Deck count together. The real 2010 tournament decks in the app are legal as listed; the app’s own archetype decks were trimmed to fit.',
      ),
    ),
    h('p', { class: 'gd-muted' }, 'When a source doesn’t settle a case, the app keeps its current behaviour and the case goes on an open list rather than being guessed. About 250 cards have no 2010 rulings at all, so they follow their card text.'),
  );
}

function imagesSection() {
  return section(
    'images',
    'Card pictures',
    h(
      'p',
      null,
      'The app draws its own artwork for every card, so it works offline. With ',
      b('Settings → Display → Official card images'),
      ' switched on (the default), it looks each card up by name in the public ',
      b('YGOPRODeck'),
      ' card database and shows the official art, saved on your phone after the first time. If a picture can’t load because you’re offline or a network blocks it, the drawn art stays. The pictures are only for looks; a card’s rules come from the sources above, not from the image.',
    ),
  );
}

function wrongSection() {
  return section(
    'wrong',
    'Something looks wrong?',
    steps(
      [b('Tap the card.'), ' If an option is greyed out, the reason is right there. Often the play really isn’t legal, for example when your only monster can’t be Tributed.'],
      [b('Check its page'), ' on ', ext('https://edisonrul.ing', 'edisonrul.ing'), ' (search the card name). The historical section is what the app follows.'],
      [b('Report it'), ' from the flag button: ', b('Report a problem'), ' saves the duel so it can be replayed exactly. Add a screenshot and say which card and which phase.'],
    ),
  );
}

const TOC: [SectionId, string][] = [
  ['tabs', 'Getting around'],
  ['duel', 'In a duel'],
  ['online', 'Playing friends'],
  ['rules', 'Where rules come from'],
  ['images', 'Card pictures'],
  ['wrong', 'Something looks wrong'],
];

export function guideScreen(params: Params): Screen {
  const sections = h('div', { class: 'gd-sections' }, tabsSection(), duelSection(), onlineSection(), rulesSection(), imagesSection(), wrongSection());
  const jump = (id: SectionId, smooth = true) => {
    const target = sections.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!target) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' });
    target.querySelector<HTMLElement>('.gd-h')?.focus({ preventScroll: true });
  };
  const toc = h(
    'nav',
    { class: 'gd-toc', 'aria-label': 'Sections' },
    TOC.map(([id, label]) => h('button', { type: 'button', class: 'gd-toc-btn', 'data-target': id, onclick: () => jump(id) }, h('span', null, label), icon('chevron'))),
  );
  for (const hd of sections.querySelectorAll<HTMLElement>('.gd-h')) hd.tabIndex = -1;
  const el = frame(
    'Guide',
    { cls: 'guide-screen', subtitle: 'How the app works, where its rules and card pictures come from, and what to do when a card plays wrong.', eyebrow: 'For our playgroup' },
    h('div', { class: 'gd-stamps' }, h('span', null, 'Cards & rules as of SJC Edison · 24 Apr 2010'), h('span', null, 'Banlist · March 2010 TCG')),
    toc,
    sections,
    h('p', { class: 'gd-foot' }, 'Fan-made, non-commercial simulator. Not affiliated with the card game’s publisher.'),
  );
  // `#/guide?section=rules` opens at that section
  const start = TOC.find(([id]) => id === params.section)?.[0];
  // after the screen transition, once the leaving screen is gone (nav.ts mount)
  return { el, onShow: start ? () => window.setTimeout(() => el.isConnected && jump(start, false), DUR.base + 60) : undefined };
}
