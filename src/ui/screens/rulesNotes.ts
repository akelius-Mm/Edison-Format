// "Rules updates": the card rulings that changed in the pre-tournament rules audit, in plain language, so players
// don't report a correct ruling as a bug. Shown once on Home (dismissible) and any time from Settings.
import { h, icon, modal } from './dom';

export const RULES_NOTES_KEY = 'edison.rulesNotes.v3';

export const RULES_NOTES_INTRO = 'Cards now play exactly as written in April 2010.';

export const RULES_NOTES: { deck: string; items: string[] }[] = [
  {
    deck: 'Every deck',
    items: [
      'Brain Control can take any face-up monster, including Synchro and Fusion monsters, Tokens and Dark Armed Dragon (its 2010 text; the “can be Normal Summoned” limit came later).',
      'Treeborn Frog can’t come back while you control a face-up Treeborn Frog, so only one returns per Standby Phase.',
      'An effect that Special Summons its own card (Plaguespreader Zombie, Treeborn Frog…) isn’t offered when that card can’t be Summoned, so you never pay its cost for nothing.',
      'Necrovalley (its 2010 text): cards in the Graveyard can’t be banished, and effects that target a card in the Graveyard are negated (Monster Reborn, Debris Dragon, Pot of Avarice…). Effects that don’t target still work: Treeborn Frog, Plaguespreader Zombie, Rekindling, Red-Eyes Darkness Metal Dragon, and Zombie World’s Type change in the Graveyard. Gravekeeper’s Priestess does the same while there’s no face-up Field Spell.',
    ],
  },
  {
    deck: 'Gladiator Beasts',
    items: [
      'Test Tiger can Special Summon itself from your hand while you control a face-up Gladiator Beast.',
      'Hoplomus is a Rock-Type with 700 ATK; Retiari is 1200 ATK / 800 DEF; Laquari is a Beast-Warrior; Heraklinos is FIRE Beast-Warrior.',
      'Bestiari, Murmillo and Equeste’s effects are mandatory: they activate even if the only targets are your own cards (Murmillo can target itself).',
      'Secutor works as written: only when Summoned by a Gladiator Beast’s effect, it must Summon 2 Gladiator Beasts from the Deck at the end of the Battle Phase, and stays on the field.',
      'Darius targets the monster in the Graveyard when it activates, so D.D. Crow and Necrovalley can stop it.',
      'Heraklinos does nothing if it is no longer face-up when its negation resolves.',
      'The Beast Test Tiger Summons counts as Summoned by a Gladiator Beast, even when it returned Elemental Hero Prisma.',
    ],
  },
  {
    deck: 'Blackwings',
    items: [
      'Blackwing Armor Master puts a Wedge Counter only on a monster it attacked, not on one that attacked it.',
      'Blackwing - Sirocco the Dawn: monsters Summoned after its effect resolves can’t attack that turn either.',
    ],
  },
  {
    deck: 'HERO / Dark Armed Dragon',
    items: [
      'Gemini monsters (Elemental Hero Neos Alius…) are Normal Monsters in the Graveyard and face-up on the field until Gemini Summoned, so Hero Blast can add Neos Alius.',
      'Elemental Hero Absolute Zero gains nothing from other copies of Absolute Zero.',
      'Destiny Hero - Malicious: you choose the position of the copy it Summons from your Deck.',
    ],
  },
  {
    deck: 'X-Sabers',
    items: [
      'XX-Saber Gottoms is Level 9: 1 Tuner + 1 or more non-Tuner EARTH monsters.',
      'Gottoms’ Emergency Call needs a face-up X-Saber on the field, and can Summon X-Sabers from either Graveyard.',
      'X-Saber Galahad is a Warrior-Type.',
    ],
  },
  {
    deck: 'Six Samurai',
    items: ['Gateway of the Six gets 2 Bushido Counters per Summon, not 2 per monster when several are Summoned together.'],
  },
  {
    deck: 'Plants & Machines',
    items: [
      'Tytannial, Princess of Camellias is WIND.',
      'Proto-Cyber Dragon is treated as “Cyber Dragon” while it is face-up on the field.',
      'Doomcaliber Knight is a Fiend-Type and can’t be Special Summoned.',
    ],
  },
  {
    deck: 'Zombies, Gravekeepers & Aliens',
    items: [
      'Zombie World makes monsters on the field and in the Graveyards Zombie-Type (also under Necrovalley).',
      'Red-Eyes Zombie Dragon only Special Summons a Zombie-Type monster it destroyed (any monster while Zombie World applies).',
      'Gravekeeper’s Descendant can only Tribute another face-up Gravekeeper’s monster.',
      'Alien Dog’s A-Counters work: a monster with A-Counters loses 300 ATK/DEF per counter while it battles Alien Dog.',
    ],
  },
];

/** One collapsed row per deck; tap a deck to read its changes. */
function notesList(): HTMLElement {
  return h(
    'div',
    { class: 'rn-list' },
    RULES_NOTES.map((g) =>
      h(
        'details',
        { class: 'rn-group' },
        h('summary', null, h('span', null, g.deck), h('span', { class: 'rn-count' }, String(g.items.length))),
        h('ul', null, g.items.map((t) => h('li', null, t))),
      ),
    ),
  );
}

function seen(): boolean {
  try {
    return !!localStorage.getItem(RULES_NOTES_KEY);
  } catch {
    return false;
  }
}

/** The one-time Home card (null once dismissed). */
export function rulesNotesCard(): HTMLElement | null {
  if (seen()) return null;
  const count = RULES_NOTES.reduce((a, g) => a + g.items.length, 0);
  const el = h('section', { class: 'rn-card', role: 'note', 'aria-label': 'Rules updates' });
  const dismiss = () => {
    try {
      localStorage.setItem(RULES_NOTES_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    el.classList.add('is-gone');
    setTimeout(() => el.remove(), 260);
  };
  // One compact row: tap it to read the changes, × to hide it for good.
  const open = h(
    'button',
    { type: 'button', class: 'rn-open', onclick: () => openRulesNotes() },
    h('span', { class: 'rn-icon' }, icon('scroll')),
    h('span', { class: 'rn-text' }, h('b', null, 'Rules updates'), h('small', null, `${count} rulings changed · tap to read`)),
  );
  el.append(open, h('button', { type: 'button', class: 'rn-x', 'aria-label': 'Dismiss rules updates', onclick: dismiss }, icon('x')));
  return el;
}

/** The full list in a sheet (Settings → Rules updates). */
export function openRulesNotes() {
  modal('Rules updates', h('div', { class: 'rn-sheet' }, h('p', { class: 'rn-intro' }, `${RULES_NOTES_INTRO} Tap a deck to see what changed. In a duel, tap a card you can’t use to see why.`), notesList()), [{ label: 'Done', variant: 'primary' }]);
}
