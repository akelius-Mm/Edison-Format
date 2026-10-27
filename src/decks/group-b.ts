import type { DeckDef } from './types';

// Archetype group B: Blackwings, X-Sabers, Gladiator Beasts.
// Lists are modelled on Edison-era (April 2010 TCG list) tournament builds.

export const DECKS: DeckDef[] = [
  {
    id: 'blackwings',
    name: 'Blackwings',
    archetype: 'Blackwing Synchro Swarm',
    description:
      'Fast, aggressive swarm. Normal Summon a Blackwing, Special Summon Bora and Gale off it, halve the opposing wall with Gale and Synchro into Armor Master or Stardust. Black Whirlwind turns every Normal Summon into a search, Shura pulls a fresh Blackwing out of the Deck after each kill, Kalut wins the Damage Step and Icarus Attack trades a spent bird for two of the opponent\'s cards.',
    tier: 1,
    color: '#2b3a67',
    main: [
      // Monsters (18)
      ['Blackwing - Kalut the Moon Shadow', 3],
      ['Blackwing - Shura the Blue Flame', 3],
      ['Blackwing - Bora the Spear', 3],
      ['Blackwing - Sirocco the Dawn', 3],
      ['Blackwing - Gale the Whirlwind', 1],
      ['Blackwing - Blizzard the Far North', 3],
      ['Sangan', 1],
      ['Gorz the Emissary of Darkness', 1],
      // Spells (11)
      ['Black Whirlwind', 2],
      ['Pot of Avarice', 1],
      ['Mystical Space Typhoon', 1],
      ['Heavy Storm', 1],
      ['Brain Control', 1],
      ['Book of Moon', 2],
      ['Smashing Ground', 2],
      ['Lightning Vortex', 1],
      // Traps (11)
      ['Icarus Attack', 3],
      ['Mirror Force', 1],
      ['Torrential Tribute', 1],
      ['Solemn Judgment', 1],
      ['Dimensional Prison', 2],
      ['Bottomless Trap Hole', 2],
      ['Call of the Haunted', 1],
    ],
    extra: [
      ['Blackwing Armor Master', 2],
      ['Blackwing Armed Wing', 1],
      ['Blackwing - Silverwind the Ascendant', 1],
      ['Stardust Dragon', 1],
      ['Brionac, Dragon of the Ice Barrier', 1],
      ['Black Rose Dragon', 1],
      ['Red Dragon Archfiend', 1],
      ['Ancient Fairy Dragon', 1],
      ['Thought Ruler Archfiend', 1],
      ['Colossal Fighter', 1],
      ['Ally of Justice Catastor', 1],
      ['Goyo Guardian', 1],
      ['Magical Android', 1],
      ['Mist Wurm', 1],
    ],
    side: [
      // Graveyard hate: the deck barely uses its own GY, so Macro Cosmos is nearly free.
      ['D.D. Crow', 2],
      ['Macro Cosmos', 2],
      // Clears Gladiator War Chariot / Bottomless walls for a swarm turn (unlike Royal Decree, keeps Icarus Attack live).
      ['Trap Stun', 2],
      // LIGHT floodgate for Lightsworn and Judgment Dragon (Blackwings are DARK, so it never hits you).
      ['Light-Imprisoning Mirror', 2],
      // Machine answers for Gadgets.
      ['Cyber Dragon', 2],
      // Treeborn Frog, set Gadgets and flip monsters.
      ['Nobleman of Crossout', 2],
      ['Dust Tornado', 2],
      ['Starlight Road', 1],
    ],
  },
  {
    id: 'x-sabers',
    name: 'X-Sabers',
    archetype: 'X-Saber Synchro',
    description:
      'EARTH Beast-Warrior beatdown that floods the board for Synchros. Marauding Captain drops a second monster from the hand, two face-up Sabers bring out Faultroll, which revives a fallen comrade every turn, and Gottoms\' Emergency Call returns two at once. Airbellum and Plaguespreader Zombie tune into Hyunlei to clear backrow, Gottoms to shred the hand, or Goyo Guardian to steal monsters, while Galahad and Anu Piranha keep the beats coming.',
    tier: 2,
    color: '#b8862b',
    main: [
      // Monsters (18)
      ['X-Saber Airbellum', 3],
      ['Marauding Captain', 3],
      ['XX-Saber Faultroll', 2],
      ['X-Saber Anu Piranha', 2],
      ['X-Saber Galahad', 3],
      ['X-Saber Uruz', 1],
      ['Plaguespreader Zombie', 1],
      ['Sangan', 1],
      ['Gorz the Emissary of Darkness', 1],
      ['Card Trooper', 1],
      // Spells (12)
      ["Gottoms' Emergency Call", 3],
      ['Pot of Avarice', 1],
      ['Mystical Space Typhoon', 1],
      ['Heavy Storm', 1],
      ['Brain Control', 1],
      ['Book of Moon', 2],
      ['Smashing Ground', 2],
      ['Lightning Vortex', 1],
      // Traps (10)
      ['Solemn Judgment', 1],
      ['Mirror Force', 1],
      ['Torrential Tribute', 1],
      ['Bottomless Trap Hole', 2],
      ['Dimensional Prison', 2],
      ['Call of the Haunted', 1],
      ['Saber Slash', 1],
      ['Trap Dustshoot', 1],
    ],
    extra: [
      ['XX-Saber Gottoms', 2],
      ['XX-Saber Hyunlei', 2],
      ['Goyo Guardian', 1],
      ['Mist Wurm', 1],
      ['Stardust Dragon', 1],
      ['Brionac, Dragon of the Ice Barrier', 1],
      ['Black Rose Dragon', 1],
      ['Red Dragon Archfiend', 1],
      ['Ancient Fairy Dragon', 1],
      ['Thought Ruler Archfiend', 1],
      ['Colossal Fighter', 1],
      ['Magical Android', 1],
      ['Gaia Knight, the Force of Earth', 1],
    ],
    side: [
      // Lightsworn and Zombie graveyard hate.
      ['D.D. Crow', 2],
      // Blocks the opposing Plant / Blackwing searches and synchro turns (the Saber engine does not search).
      ['Thunder King Rai-Oh', 2],
      // Anti-trap for Gladiator Beasts and control; Saber Slash / traps get sided out.
      ['Royal Decree', 2],
      // Machine answers for Gadgets.
      ['Cyber Dragon', 2],
      // LIGHT floodgate for Lightsworn and Judgment Dragon (Sabers are EARTH).
      ['Light-Imprisoning Mirror', 2],
      // Protects a Faultroll / Hyunlei board from Judgment Dragon and Heavy Storm.
      ['Starlight Road', 1],
      // Treeborn Frog and set monsters.
      ['Nobleman of Crossout', 2],
      ['Dust Tornado', 2],
    ],
  },
  {
    id: 'gladiator-beasts',
    name: 'Gladiator Beasts',
    archetype: 'Gladiator Beast Control',
    description:
      'Grinding control built on tag-outs: every Gladiator Beast that battles shuffles itself back at the end of the Battle Phase and swaps in a fresh one whose effect fires on arrival. Bestiari pops backrow, Murmillo destroys monsters, Darius revives and Laquari hits for 2100. Test Tiger forces a tag-out in the Main Phase, Bestiari plus any partner become Gyzarus to blow up two cards, and three War Chariots plus a full set of hard traps keep the opponent\'s effects in check.',
    tier: 1,
    color: '#a33a24',
    main: [
      // Monsters (17)
      ['Gladiator Beast Bestiari', 1],
      ['Gladiator Beast Darius', 3],
      ['Gladiator Beast Laquari', 3],
      ['Gladiator Beast Murmillo', 2],
      ['Gladiator Beast Hoplomus', 1],
      ['Gladiator Beast Equeste', 1],
      ['Gladiator Beast Secutor', 1],
      ['Test Tiger', 3],
      ['Sangan', 1],
      ['Gorz the Emissary of Darkness', 1],
      // Spells (11)
      ['Gladiator Proving Ground', 2],
      ['Pot of Avarice', 1],
      ['Mystical Space Typhoon', 1],
      ['Heavy Storm', 1],
      ['Brain Control', 1],
      ['Book of Moon', 2],
      ['Smashing Ground', 2],
      ['Lightning Vortex', 1],
      // Traps (12)
      ['Gladiator Beast War Chariot', 3],
      ['Solemn Judgment', 1],
      ['Mirror Force', 1],
      ['Torrential Tribute', 1],
      ['Bottomless Trap Hole', 2],
      ['Dimensional Prison', 3],
      ['Trap Dustshoot', 1],
    ],
    extra: [
      ['Gladiator Beast Gyzarus', 3],
      ['Gladiator Beast Heraklinos', 2],
      // Toolbox for stolen or sided monsters (Brain Control, sided Cyber Dragon), as in Jake Mattern's Prismadiators.
      ['Chimeratech Fortress Dragon', 3],
      ['Stardust Dragon', 2],
      ['Goyo Guardian', 1],
      ['Brionac, Dragon of the Ice Barrier', 1],
      ['Colossal Fighter', 1],
      ['Black Rose Dragon', 1],
      ['Magical Android', 1],
    ],
    side: [
      // Lightsworn and Zombie graveyard hate (Darius is the only own-GY card).
      ['D.D. Crow', 2],
      // Machine answers for Gadgets; also opens Chimeratech Fortress Dragon.
      ['Cyber Dragon', 2],
      // Extra Hoplomus for slower control matchups.
      ['Gladiator Beast Hoplomus', 1],
      // Treeborn Frog and set monsters.
      ['Nobleman of Crossout', 2],
      // Blocks Plant / Blackwing searches and synchro turns (tag-outs summon from the Deck, not search).
      ['Thunder King Rai-Oh', 2],
      ['Dust Tornado', 2],
      // Attribute floodgates: LIGHT for Lightsworn, DARK for Blackwings / Tele-DAD (Gladiators are EARTH).
      ['Light-Imprisoning Mirror', 2],
      ['Shadow-Imprisoning Mirror', 2],
    ],
  },
];
