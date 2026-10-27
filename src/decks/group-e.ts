// Premade decks: archetype group E. Ancient Gear (Geartown / Ancient Gear Golem) and a Gadget build that Tribute
// Summons the Ancient Gear Gadjiltrons with Gadgets. These are archetype builds (no `event`), not real placing lists.
// Cards the simulator did not have for them live in src/cards/sets/archetype-extras2.ts.
import type { DeckDef } from './types';

/** The usual Synchro toolbox (13 cards, Goyo Guardian for the Level 6 plays) for stolen Tuners and Brain Control. */
const TOOLBOX: [string, number][] = [
  ['Stardust Dragon', 2],
  ['Goyo Guardian', 1],
  ['Brionac, Dragon of the Ice Barrier', 1],
  ['Red Dragon Archfiend', 1],
  ['Black Rose Dragon', 1],
  ['Colossal Fighter', 1],
  ['Ancient Fairy Dragon', 1],
  ['Gaia Knight, the Force of Earth', 1],
  ['Magical Android', 1],
  ['Ally of Justice Catastor', 1],
  ['Mist Wurm', 1],
  ['Armory Arm', 1],
];

const ANCIENT_GEAR: DeckDef = {
  id: 'ancient-gear',
  name: 'Ancient Gear',
  archetype: 'Ancient Gear',
  tier: 3,
  color: '#9a7b4f',
  description:
    'Big Machines that the opponent cannot answer with traps. Every Ancient Gear that attacks stops Spells and Traps until the end of the Damage Step, so Mirror Force and Sakuretsu Armor stay face-down. Geartown makes Ancient Gear Beast and Engineer free Summons and Ancient Gear Golem a one-Tribute 3000-ATK piercer, and when Geartown is destroyed it Special Summons Gadjiltron Dragon straight from the Deck. Ancient Gear Special Summons copies of itself, Machine Duplication pulls two more from the Deck for Tributes, Ancient Gear Castle can stand in for the Tributes, and Polymerization turns Golem and two Gears into Ultimate Ancient Gear Golem.',
  main: [
    // Monsters (18)
    ['Ancient Gear Golem', 3],
    ['Ancient Gear Gadjiltron Dragon', 2],
    ['Ancient Gear Beast', 2],
    ['Ancient Gear Engineer', 2],
    ['Ancient Gear Knight', 2],
    ['Ancient Gear', 3],
    ['Cyber Dragon', 2],
    ['Card Trooper', 1],
    ['Sangan', 1],
    // Spells (16)
    ['Geartown', 3],
    ['Ancient Gear Castle', 1],
    ['Machine Duplication', 2],
    ['Polymerization', 1],
    ['Trade-In', 2],
    ['Pot of Avarice', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Brain Control', 1],
    ['Limiter Removal', 1],
    ['Book of Moon', 2],
    // Traps (6)
    ['Solemn Judgment', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 1],
  ],
  // No Tuners of its own: Ultimate Ancient Gear Golem, Chimeratech Fortress Dragon and the toolbox for stolen Tuners.
  extra: [['Ultimate Ancient Gear Golem', 2], ['Chimeratech Fortress Dragon', 1], ...TOOLBOX.filter(([n]) => n !== 'Armory Arm')],
  side: [
    // Ancient Gears already stop traps in battle; Royal Decree stops them everywhere else.
    ['Royal Decree', 2],
    // Graveyard hate for Zombies, Lightsworn and DAD.
    ['D.D. Crow', 2],
    // Treeborn Frog, Gladiator sets and flip monsters.
    ['Nobleman of Crossout', 2],
    ['Dust Tornado', 2],
    // DARK floodgate for Blackwings, Tele-DAD and Caius (the deck is all EARTH and LIGHT).
    ['Shadow-Imprisoning Mirror', 2],
    ['Light-Imprisoning Mirror', 1],
    // A second Cyber Dragon line against big boards, Machine answers for Gadgets.
    ['Proto-Cyber Dragon', 2],
    ['Smashing Ground', 1],
    ['Prohibition', 1],
  ],
};

const GADJILTRON_GADGETS: DeckDef = {
  id: 'gadjiltron-gadgets',
  name: 'Gadjiltron Gadgets',
  archetype: 'Gadget Gadjiltron',
  tier: 3,
  color: '#7f7348',
  description:
    'Gadgets as Tribute fodder instead of a toolbox. Every Gadget still searches the next one, but here they feed the two Ancient Gear Gadjiltrons, which gain an effect for each Gadget Tributed: Green makes Gadjiltron Chimera 2600 ATK and gives Gadjiltron Dragon piercing damage, Red burns after battle damage and Yellow burns for every monster destroyed. Geartown makes the Chimera a free Summon and the Dragon a one-Tribute 3000-ATK attacker that shuts off Spells and Traps, Machine Duplication turns a Machina Peacekeeper into three, and Machina Gearframe and Machina Fortress keep the hand full.',
  main: [
    // Monsters (21)
    ['Green Gadget', 3],
    ['Red Gadget', 3],
    ['Yellow Gadget', 3],
    ['Ancient Gear Gadjiltron Chimera', 3],
    ['Ancient Gear Gadjiltron Dragon', 2],
    ['Machina Gearframe', 2],
    ['Machina Peacekeeper', 2],
    ['Machina Fortress', 2],
    ['Card Trooper', 1],
    // Spells (11)
    ['Geartown', 2],
    ['Machine Duplication', 2],
    ['Pot of Avarice', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Book of Moon', 1],
    ['Limiter Removal', 1],
    ['Brain Control', 1],
    ['Solidarity', 1],
    // Traps (8)
    ['Solemn Judgment', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Call of the Haunted', 1],
  ],
  extra: [['Chimeratech Fortress Dragon', 2], ...TOOLBOX],
  side: [
    ['Royal Decree', 2],
    ['D.D. Crow', 2],
    ['Nobleman of Crossout', 2],
    ['Dust Tornado', 2],
    ['Shadow-Imprisoning Mirror', 2],
    // Cyber Dragon lines for Chimeratech Fortress Dragon against other Machines.
    ['Proto-Cyber Dragon', 2],
    ['Smashing Ground', 2],
    ['Spirit Reaper', 1],
  ],
};

const ZOMBIE_RECURSION: DeckDef = {
  id: 'zombie-recursion',
  name: 'Zombie Recursion',
  archetype: 'Zombie World',
  tier: 3,
  color: '#5a3d6e',
  description:
    'Big Zombies that will not stay dead. Pyramid Turtle pulls Vampire Lord, Red-Eyes Zombie Dragon or Il Blud from the Deck when it falls, Zombie Master pitches Ryu Kokki or Despair from the Dark and revives a Level 4, and Mezuki, Book of Life and Call of the Haunted bring back anything. Call of the Mummy drops a Level 5+ Zombie onto an empty field for free, Il Blud reanimates a Zombie every turn, Red-Eyes Zombie Dragon takes the monsters it destroys, and Zombie World turns every monster in both Graveyards into a Zombie, so Zombie Master and Il Blud can raise the opponent\'s dead as your own.',
  main: [
    // Monsters (21)
    ['Vampire Lord', 3],
    ['Red-Eyes Zombie Dragon', 2],
    ['Ryu Kokki', 2],
    ['Il Blud', 3],
    ['Despair from the Dark', 1],
    ['Zombie Master', 3],
    ['Mezuki', 1],
    ['Goblin Zombie', 2],
    ['Pyramid Turtle', 3],
    ['Spirit Reaper', 1],
    // Spells (12)
    ['Zombie World', 2],
    ['Call of the Mummy', 2],
    ['Book of Life', 3],
    ['Foolish Burial', 1],
    ['Allure of Darkness', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Book of Moon', 1],
    // Traps (7)
    ['Solemn Judgment', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Bottomless Trap Hole', 2],
    ['Call of the Haunted', 1],
    ['Sakuretsu Armor', 1],
  ],
  // No Plaguespreader: Synchros come from stolen Tuners (Book of Life, Call of the Haunted, Zombie World on Brain Control targets).
  extra: [['Revived King Ha Des', 1], ['Thought Ruler Archfiend', 1], ...TOOLBOX],
  side: [
    // Graveyard hate for Lightsworn and DAD; the deck's own Graveyard is its resource, so no Macro Cosmos.
    ['D.D. Crow', 2],
    ['Kycoo the Ghost Destroyer', 2],
    // Machine answers for Gadgets.
    ['Cyber Dragon', 2],
    // LIGHT floodgate for Lightsworn and Judgment Dragon (the deck is all DARK).
    ['Light-Imprisoning Mirror', 2],
    // Treeborn Frog and set monsters; Ryu Kokki already handles Warriors and Spellcasters.
    ['Nobleman of Crossout', 2],
    // Search-and-Synchro hate.
    ['Thunder King Rai-Oh', 2],
    ['Dust Tornado', 2],
    ['Necro Gardna', 1],
  ],
};

export const DECKS: DeckDef[] = [ANCIENT_GEAR, GADJILTRON_GADGETS, ZOMBIE_RECURSION];
