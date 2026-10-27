// How to Play: Edison Format summary, duel rules, card pool and the banlist viewer.
import { findCard } from '../../cards';
import { FORBIDDEN, LIMITED, SEMI_LIMITED } from '../../cards/banlist';
import { PREMADE_DECKS } from '../../decks';
import { artInto, cardDetail, deckArt, eventShort, tierBadge } from './components';
import { premadeInfo } from './store';
import { button, clear, h, icon, modal, type Child } from './dom';
import { renderCard } from './ext';
import { frame, go, type Params, type Screen } from './nav';

type Tab = 'format' | 'rules' | 'pool' | 'banlist' | 'controls';

export function rulesScreen(params: Params): Screen {
  let tab: Tab = (['format', 'rules', 'pool', 'banlist', 'controls'] as Tab[]).includes(params.tab as Tab) ? (params.tab as Tab) : 'format';
  const body = h('div', { class: 'rules-body' });
  const tabs = h('div', { class: 'chip-tabs', role: 'tablist', 'aria-label': 'Sections' });
  const TABS: [Tab, string, Parameters<typeof icon>[0]][] = [
    ['format', 'The format', 'bolt'],
    ['rules', 'Duel rules', 'scroll'],
    ['pool', 'Card pool', 'cards'],
    ['banlist', 'Banlist', 'warn'],
    ['controls', 'Controls', 'keyboard'],
  ];
  const draw = () => {
    clear(tabs);
    for (const [t, l] of TABS)
      tabs.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: ['chip-tab', tab === t && 'on'],
            role: 'tab',
            'aria-selected': String(tab === t),
            onclick: () => {
              tab = t;
              history.replaceState(null, '', `#/rules?tab=${t}`);
              draw();
            },
          },
          l,
        ),
      );
    tabs.querySelector<HTMLElement>('.chip-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    clear(body);
    body.appendChild(tab === 'format' ? formatTab() : tab === 'rules' ? rulesTab() : tab === 'pool' ? poolTab() : tab === 'banlist' ? banlistTab() : controlsTab());
  };
  draw();
  const el = frame('How to Play', { subtitle: 'The Edison Format, its rules and its Forbidden & Limited list', cls: 'rules rules-screen' }, tabs, body);
  return { el };
}

const card = (title: string, ...children: Child[]) => h('article', { class: 'rule-card' }, h('h3', null, title), ...children);
const p = (...c: Child[]) => h('p', null, ...c);
const ul = (...items: Child[]) => h('ul', null, items.map((i) => h('li', null, i)));

function formatTab() {
  return h(
    'div',
    { class: 'rules-grid' },
    h(
      'article',
      { class: 'rule-hero' },
      artInto(h('div', { class: 'rule-hero-art', 'aria-hidden': 'true' }), 'Dark Armed Dragon'),
      h('div', { class: 'title-eyebrow' }, 'April 2010'),
      h('h2', null, 'What is Edison Format?'),
      p(
        'Edison Format recreates competitive play as it was at the ',
        h('b', null, 'Shonen Jump Championship in Edison, New Jersey (April 2010)'),
        ' — the last major event before the next set arrived. Players use only the cards that existed at that time, under the Forbidden & Limited list that was in force then.',
      ),
      p(
        'It is remembered as a balanced, interactive Synchro-era metagame: many strategies were viable, power cards were limited to one copy, and games were decided by careful resource trades rather than one-turn combos.',
      ),
    ),
    card('Why players love it', ul('A wide, healthy meta: Plants, Blackwings, Lightsworn, Monarchs, Tele-DAD, Gladiator Beasts and more.', 'Synchro Summoning without Xyz, Pendulum or Link monsters.', 'Strong staple cards are Limited, so every copy matters.', 'Games reward reads, chain timing and good side-decking.')),
    card('Deck construction', ul('Main Deck: 40 to 60 cards.', 'Extra Deck: up to 15 Fusion and Synchro monsters.', 'Side Deck: up to 15 cards.', 'At most 3 copies of a card, fewer if Limited (1) or Semi-Limited (2). Forbidden cards cannot be used.')),
    card('Match structure', ul('Single games or best-of-three matches.', 'Game 1: a coin toss decides who goes first.', 'Games 2 and 3: the loser of the previous game chooses to go first or second.', 'Tournaments use Swiss rounds followed by a single-elimination top cut.')),
    h('div', { class: 'rule-cta' }, button('View the banlist', () => go('rules', { tab: 'banlist' }), { variant: 'ghost', icon: 'warn' }), button('Start a duel', () => go('duel'), { variant: 'primary', icon: 'swords' })),
  );
}

function rulesTab() {
  return h(
    'div',
    { class: 'rules-grid' },
    card('Winning', ul('Each player starts with 8000 Life Points. Reduce your opponent to 0 to win.', 'A player who must draw from an empty Deck loses.', 'In this simulator a game that reaches the turn limit is a draw.')),
    card(
      'Turn structure',
      ul(
        h('span', null, h('b', null, 'Draw Phase'), ' — draw 1 card (the player going first skips this draw on turn 1).'),
        h('span', null, h('b', null, 'Standby Phase'), ' — upkeep effects resolve.'),
        h('span', null, h('b', null, 'Main Phase 1'), ' — summon, set and activate cards.'),
        h('span', null, h('b', null, 'Battle Phase'), ' — attack with your monsters (not on the very first turn).'),
        h('span', null, h('b', null, 'Main Phase 2'), ' — another chance to summon and set.'),
        h('span', null, h('b', null, 'End Phase'), ' — discard down to 6 cards in hand.'),
      ),
    ),
    card('Summoning', ul('One Normal Summon or Set per turn.', 'Level 5–6 monsters need 1 Tribute; Level 7 or higher need 2.', 'Synchro Summon: send a Tuner plus non-Tuners from your field whose Levels add up exactly to the Synchro monster’s Level.', 'Fusion monsters are usually summoned with Polymerization or their own procedure.')),
    card('Field', ul('5 Monster Zones and 5 Spell & Trap Zones per player.', 'A Field Zone for Field Spells.', 'Graveyard, Deck, Extra Deck and banished cards are public or semi-public zones you can inspect.')),
    card('Chains & timing', ul('Activating a card or effect can be answered by the opponent, building a chain that resolves last-in, first-out.', 'Spell Speed 1 cannot respond to anything; Quick effects and Traps are Spell Speed 2; Counter Traps are Spell Speed 3.', 'Optional “When … you can” effects can miss the timing if something else happened last.', 'Only certain effects (like stat changes or damage-step-specific cards) can be used in the Damage Step.')),
    card('Battle', ul('Attack-position monsters can attack once per turn.', 'ATK vs ATK: the lower one is destroyed and its controller takes the difference.', 'ATK vs DEF: if ATK is higher the defender is destroyed with no damage; if lower, the attacker’s controller takes the difference.', 'Face-down monsters are flipped face-up when attacked.')),
  );
}

function poolTab() {
  const decks = [...PREMADE_DECKS].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  return h(
    'div',
    { class: 'rules-grid' },
    card(
      'Card pool',
      p('Cards released in the TCG up to the April 2010 Edison event — through ', h('b', null, 'The Shining Darkness'), ' and the products available alongside it (tins, starter and structure decks, Duel Terminal and Hidden Arsenal releases, promotional cards).'),
      p('No Xyz, Pendulum or Link monsters exist yet. Extra Decks are built from Synchro and Fusion monsters.'),
    ),
    card('Defining cards of the era', ul('Synchros: Stardust Dragon, Brionac, Goyo Guardian, Black Rose Dragon, Thought Ruler Archfiend.', 'Power spells: Heavy Storm, Brain Control, Giant Trunade, Mystical Space Typhoon — each Limited to one. Dark Hole and Monster Reborn are Forbidden.', 'Defensive traps: Mirror Force, Solemn Judgment, Bottomless Trap Hole, Torrential Tribute.', 'Utility monsters: Sangan, Card Trooper, Gorz the Emissary of Darkness, Tragoedia.')),
    h(
      'article',
      { class: 'rule-card wide' },
      h('h3', null, 'The premade decks'),
      decks.length
        ? h(
            'div',
            { class: 'pool-decks' },
            decks.map((d) =>
              h(
                'div',
                { class: 'pool-deck', style: { '--deck': d.color } },
                deckArt(premadeInfo(d), 'pool-art'),
                h(
                  'div',
                  { class: 'pool-deck-main' },
                  h('div', { class: 'pool-deck-head' }, h('b', null, d.name), tierBadge(d.tier)),
                  h('div', { class: 'pool-deck-arch' }, d.event ? `${d.event.place} · ${eventShort(d.event)}` : d.archetype),
                  h('p', null, d.description),
                  button('Copy to Deck Builder', () => go('deck-builder', { from: d.id }), { variant: 'subtle', small: true, icon: 'copy' }),
                ),
              ),
            ),
          )
        : p('Premade decks are not available yet.'),
    ),
  );
}

function banlistTab() {
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Filter the list…', 'aria-label': 'Filter banlist' });
  const cols = h('div', { class: 'ban-cols' });
  const col = (title: string, cls: string, desc: string, names: string[]) => {
    const f = q.value.trim().toLowerCase();
    const shown = [...names].sort().filter((n) => !f || n.toLowerCase().includes(f));
    return h(
      'section',
      { class: ['ban-col', cls] },
      h('header', null, h('h3', null, title, h('span', { class: 'ban-n' }, String(names.length))), h('div', { class: 'ban-desc' }, desc)),
      h(
        'div',
        { class: 'ban-list' },
        shown.map((n) => {
          const c = findCard(n);
          return h(
            'button',
            {
              type: 'button',
              class: ['ban-item', !c && 'missing', c && `kind-${c.kind}`],
              disabled: !c,
              title: c ? 'View card' : 'Not in the simulator card pool',
              onclick: () => c && modal(c.name, cardDetail(c, { size: 'lg' }), [{ label: 'Close' }], { wide: true, cls: 'card-modal' }),
            },
            c ? h('span', { class: 'ban-thumb' }, renderCard(c, { size: 'xs' })) : h('span', { class: 'ban-thumb empty-thumb' }),
            h('span', null, n),
          );
        }),
        shown.length ? null : h('div', { class: 'muted ban-none' }, 'No matches'),
      ),
    );
  };
  const draw = () => {
    clear(cols);
    cols.append(
      col('Forbidden', 'forbidden', 'Cannot be used in your Deck, Extra Deck or Side Deck.', FORBIDDEN),
      col('Limited', 'limited', 'Maximum 1 copy across Main, Extra and Side.', LIMITED),
      col('Semi-Limited', 'semi', 'Maximum 2 copies.', SEMI_LIMITED),
    );
  };
  q.addEventListener('input', draw);
  draw();
  return h(
    'div',
    { class: 'banlist' },
    h('div', { class: 'ban-top' }, h('p', { class: 'muted' }, 'The Forbidden & Limited list in effect for Edison Format (March 2010 TCG list). Tap a card to view it. Every other card is unlimited (3 copies).'), q),
    cols,
  );
}

function controlsTab() {
  const k = (...keys: string[]) => h('span', { class: 'keys' }, keys.map((x) => h('span', { class: 'kbd' }, x)));
  const r = (keys: Node, what: string) => h('div', { class: 'ctl-row' }, keys, h('span', null, what));
  // Phones and tablets: touch gestures instead of keys and clicks.
  if (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches)
    return h(
      'div',
      { class: 'rules-grid' },
      card('Deck Builder', ul('Tap a card in Add cards to put it in your deck.', 'Tap a card in your deck to select it, then use the bar to add or remove copies or move it to the Side Deck.', 'Press and hold a deck card to remove one copy.')),
      card(
        'Duels',
        ul(
          'Tap a card to see what you can do with it (summon, set, activate, attack).',
          'Press and hold a card to read it. In card lists, tap the magnifier or hold the card.',
          'Tap a Graveyard, Banished or Extra Deck pile to look through it.',
          'When you can respond to your opponent, a prompt appears — choose a card or pass.',
          'Settings → Response prompts controls how often the game stops to ask you.',
          'You can surrender from the flag button; in a best-of-three you may also concede the match between games.',
        ),
      ),
    );
  return h(
    'div',
    { class: 'rules-grid' },
    card('Menus', r(k('↑', '↓'), 'Move between menu items'), r(k('Enter'), 'Select'), r(k('1', '–', '8'), 'Jump to a main-menu entry'), r(k('Esc'), 'Back to the main menu / close a dialog'), r(k('Tab'), 'Move focus between controls')),
    card('Deck Builder', r(k('Click'), 'Add a card to the Main / Extra Deck'), r(k('Shift', 'Click'), 'Add a card to the Side Deck (or right-click)'), r(k('Right-click'), 'Remove a card from your deck'), r(k('Del'), 'Remove the focused deck card'), r(k('Drag'), 'Move cards between sections, or back to the list to remove'), r(k('Ctrl', 'F'), 'Focus the card search')),
    card('Duels', ul('Click a card to see what you can do with it (summon, set, activate, attack).', 'When you can respond to your opponent, a prompt appears — choose a card or pass.', 'Settings → Response prompts controls how often the game stops to ask you.', 'You can surrender from the duel menu; in a best-of-three you may also concede the match between games.')),
  );
}
