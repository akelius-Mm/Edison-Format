import type { DeckDef } from './types';

// Real tournament decklists from the Edison format (TCG, March 2010 list / The Shining Darkness pool).
// Every list below is the card-for-card list published for the 75th Shonen Jump Championship,
// Edison, NJ (April 24-25, 2010; 2,700+ players). Sources are noted above each deck.
// Card counts are reproduced exactly; nothing has been added, removed or "fixed".
//
// Release-date audit (Edison legality = English TCG release on or before 2010-04-24): every card in these lists
// checks out. The ones that look post-Edison in most databases were legal through earlier promos:
//   Tragoedia                   Shonen Jump Vol. 7 #9 promo (JUMP-EN033, Sept. 2009), long before Turbo Pack 4
//   Chimeratech Fortress Dragon Shonen Jump Vol. 7 #3 promo (JUMP-EN031, March 2009), before Collectible Tins 2010
//   Beast King Barbaros         Shonen Jump Vol. 7 #6 promo (JUMP-EN032, May/June 2009), before Collectible Tins 2011
//   Thunder King Rai-Oh         Yu-Gi-Oh! GX Volume 2 promo (YG02-EN001, Nov. 2008), before Gold Series 3
//   Shield Crush                Premium Pack 1 (PP01-EN007, 2007), before Turbo Pack 5
// Cards that really are post-Edison are listed in POST_EDISON (src/cards/banlist.ts); none appear below.

const SJC_EDISON = 'Shonen Jump Championship Edison';
const SJC_EDISON_DATE = '2010-04-24';

// Source: https://yugiohtopdecks.com/deck/2302 (Built by Jeff Jones, 2010 SJ Edison, 1st Place)
// Side deck cross-checked against the Top 16 deck list repost at http://www.frontini.it/forum/forum_posts.asp?TID=80580
const jeffJones: DeckDef = {
  id: 't-sjc-edison-1st',
  name: 'Quickdraw Dandywarrior (Jeff Jones)',
  archetype: 'Plant Synchro',
  tier: 1,
  color: '#3f9b4b',
  description:
    "Won SJC Edison with the deck that defined the format. Quickdraw Synchron, Dandylion and Lonefire Blossom make Fluff Tokens and synchros out of nothing, Debris Dragon revives the discards, and three Pot of Avarice keep the engine running in long games. Two Caius and a Light and Darkness Dragon give it non-synchro threats, and Super-Nimble Mega Hamster fetches Card Trooper or Morphing Jar.",
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: '1st', pilot: 'Jeff Jones' },
  main: [
    // Monsters (21)
    ['Ryko, Lightsworn Hunter', 3],
    ['Caius the Shadow Monarch', 2],
    ['Dandylion', 2],
    ['Debris Dragon', 2],
    ['Lonefire Blossom', 2],
    ['Quickdraw Synchron', 2],
    ['Super-Nimble Mega Hamster', 2],
    ['Card Trooper', 1],
    ['Light and Darkness Dragon', 1],
    ['Morphing Jar', 1],
    ['Night Assailant', 1],
    ['Sangan', 1],
    ['Tytannial, Princess of Camellias', 1],
    // Spells (9)
    ['Pot of Avarice', 3],
    ['Book of Moon', 2],
    ['Brain Control', 1],
    ['Foolish Burial', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (11)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Dust Tornado', 2],
    ['Call of the Haunted', 1],
    ['Mirror Force', 1],
    ['Solemn Judgment', 1],
    ['Starlight Road', 1],
    ['Torrential Tribute', 1],
  ],
  extra: [
    ['Stardust Dragon', 3],
    ['Drill Warrior', 2],
    ['Iron Chain Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Ancient Fairy Dragon', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Junk Archer', 1],
    ['Nitro Warrior', 1],
    ['Red Dragon Archfiend', 1],
    ['Turbo Warrior', 1],
  ],
  side: [
    ['Consecrated Light', 2],
    ['D.D. Crow', 2],
    ['My Body as a Shield', 2],
    ['System Down', 2],
    ["Gottoms' Emergency Call", 2],
    ['Pulling the Rug', 2],
    ['Swallow Flip', 2],
    ['Trap Hole', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2303 (Built by Renaldo Lainez, 2010 SJ Edison, 2nd Place)
// The published list has no Extra Deck, so none is included here.
const renaldoLainez: DeckDef = {
  id: 't-sjc-edison-2nd',
  name: 'Doomcaliber Gadgets (Renaldo Lainez)',
  archetype: 'Gadget Control',
  tier: 1,
  color: '#8a8f98',
  description:
    'Runner-up at SJC Edison. Nine Gadgets chain into each other for endless card advantage, three Doomcaliber Knight negate monster effects, and a wall of Fissure, Smashing Ground, Hammer Shot and two Royal Oppression shuts down synchro decks. Tragoedia and Gorz punish big hits.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: '2nd', pilot: 'Renaldo Lainez' },
  main: [
    // Monsters (18)
    ['Doomcaliber Knight', 3],
    ['Green Gadget', 3],
    ['Red Gadget', 3],
    ['Yellow Gadget', 3],
    ['Cyber Dragon', 2],
    ['Blackwing - Gale the Whirlwind', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Plaguespreader Zombie', 1],
    ['Tragoedia', 1],
    // Spells (12)
    ['Fissure', 3],
    ['Smashing Ground', 3],
    ['Hammer Shot', 2],
    ['Heavy Storm', 1],
    ['Lightning Vortex', 1],
    ['Limiter Removal', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (10)
    ['Dimensional Prison', 3],
    ['Bottomless Trap Hole', 2],
    ['Royal Oppression', 2],
    ['Mirror Force', 1],
    ['Phoenix Wing Wind Blast', 1],
    ['Torrential Tribute', 1],
  ],
  extra: [],
  side: [
    ['Thunder King Rai-Oh', 2],
    ['Creature Swap', 2],
    ['Nobleman of Crossout', 2],
    ['Soul Taker', 2],
    ['Burden of the Mighty', 1],
    ['Hammer Shot', 1],
    ['Pulling the Rug', 2],
    ['Swallow Flip', 2],
    ['Starlight Road', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2304 (Built by Billy Brake, 2010 SJ Edison, 3rd - 4th Place)
const billyBrake: DeckDef = {
  id: 't-sjc-edison-top4-brake',
  name: 'Caliber Cat (Billy Brake)',
  archetype: 'Synchro Cat',
  tier: 1,
  color: '#c07a2c',
  description:
    'Top 4 at SJC Edison. Rescue Cat and three X-Saber Airbellum (via Summoner Monk and Gravekeeper\'s Spy chains) feed a synchro toolbox headed by two Arcanite Magician, while three Doomcaliber Knight and Gravekeeper\'s Spy keep the board clogged. Caius, Dark Armed Dragon and Chaos Sorcerer provide the punch.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 4', pilot: 'Billy Brake' },
  main: [
    // Monsters (21)
    ['Doomcaliber Knight', 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['X-Saber Airbellum', 3],
    ['Cyber Dragon', 2],
    ["Gravekeeper's Spy", 2],
    ['Caius the Shadow Monarch', 1],
    ['Chaos Sorcerer', 1],
    ['Dark Armed Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ["Gravekeeper's Descendant", 1],
    ['Rescue Cat', 1],
    ['Sangan', 1],
    ['Summoner Monk', 1],
    // Spells (10)
    ['Book of Moon', 2],
    ['Pot of Avarice', 2],
    ['Allure of Darkness', 1],
    ['Brain Control', 1],
    ['Heavy Storm', 1],
    ['Mind Control', 1],
    ['Mystical Space Typhoon', 1],
    ['Smashing Ground', 1],
    // Traps (10)
    ['Dimensional Prison', 3],
    ['Bottomless Trap Hole', 2],
    ['Dust Tornado', 1],
    ['My Body as a Shield', 1],
    ['Solemn Judgment', 1],
    ['Starlight Road', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Arcanite Magician', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Red Dragon Archfiend', 1],
    ['Thought Ruler Archfiend', 1],
  ],
  side: [
    ['Beast King Barbaros', 3],
    ['D.D. Crow', 1],
    ['Thunder King Rai-Oh', 1],
    ['Shield Crush', 1],
    ['Skill Drain', 2],
    ["Tuner's Scheme", 2],
    ['Dust Tornado', 1],
    ['Light-Imprisoning Mirror', 1],
    ['Mirror Force', 1],
    ['Royal Oppression', 1],
    ['Starlight Road', 1],
  ],
};

// Source (main deck): Konami event coverage deck profile,
// https://yugiohblog.konami.com/2010/04/deck-profile-sorosh-saberians-quickdraw-dandywarrior-deck/
// Extra/side deck: https://yugiohtopdecks.com/deck/2305 (Sorosh Saberian, 2010 SJ Edison, 3rd - 4th Place).
// (The topdecks main deck omits the Call of the Haunted that Konami's profile lists, leaving 39 cards.)
const soroshSaberian: DeckDef = {
  id: 't-sjc-edison-top4-saberian',
  name: 'Quickdraw Dandywarrior (Sorosh Saberian)',
  archetype: 'Plant Synchro',
  tier: 1,
  color: '#5aa84e',
  description:
    'Top 4 at SJC Edison. A heavier-hitting Quickdraw build: three Caius and three Debris Dragon, Fluff Tokens for tribute fodder, and Cyber Valley plus Battle Fader for defence. Quickdraw Synchron turns into Drill Warrior and Turbo Warrior; three Stardust Dragon and two Ancient Fairy Dragon round out the Extra Deck.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 4', pilot: 'Sorosh Saberian' },
  main: [
    // Monsters (20)
    ['Ryko, Lightsworn Hunter', 3],
    ['Caius the Shadow Monarch', 3],
    ['Debris Dragon', 3],
    ['Quickdraw Synchron', 2],
    ['Dandylion', 2],
    ['Lonefire Blossom', 2],
    ['Cyber Valley', 1],
    ['Morphing Jar', 1],
    ['Battle Fader', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Tytannial, Princess of Camellias', 1],
    // Spells (9)
    ['Pot of Avarice', 2],
    ['Book of Moon', 2],
    ['Charge of the Light Brigade', 1],
    ['Brain Control', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Foolish Burial', 1],
    // Traps (11)
    ['Dimensional Prison', 3],
    ['Bottomless Trap Hole', 2],
    ['Dust Tornado', 2],
    ['Call of the Haunted', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Solemn Judgment', 1],
  ],
  extra: [
    ['Stardust Dragon', 3],
    ['Ancient Fairy Dragon', 2],
    ['Drill Warrior', 2],
    ['Iron Chain Dragon', 2],
    ['Black Rose Dragon', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Nitro Warrior', 1],
    ['Red Dragon Archfiend', 1],
    ['Road Warrior', 1],
    ['Turbo Warrior', 1],
  ],
  side: [
    ['Battle Fader', 1],
    ['Cyber Dragon', 2],
    ['Legendary Jujitsu Master', 3],
    ['Mobius the Frost Monarch', 3],
    ['Soul Exchange', 2],
    ['System Down', 1],
    ['Starlight Road', 1],
    ['Trap Hole', 2],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2309 (Built by Edwin Ortiz, 2010 SJ Edison, 5th - 8th Place)
const edwinOrtiz: DeckDef = {
  id: 't-sjc-edison-top8-ortiz',
  name: 'Flamvell Synchros (Edwin Ortiz)',
  archetype: 'Flamvell',
  tier: 2,
  color: '#d2502a',
  description:
    'Top 8 at SJC Edison. Flamvell Firedog and Flamvell Magician make easy synchros, and three Rekindling bring back a whole row of 200-DEF FIRE monsters at once for Flamvell Uruquizas, Brionac or Goyo. Caius, Gravekeeper\'s Spy and three Book of Moon keep it competitive.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 8', pilot: 'Edwin Ortiz' },
  main: [
    // Monsters (21)
    ['Caius the Shadow Monarch', 3],
    ['Flamvell Firedog', 3],
    ['Flamvell Magician', 3],
    ["Gravekeeper's Spy", 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['Blackwing - Gale the Whirlwind', 1],
    ['Chaos Sorcerer', 1],
    ['Cyber Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ["Gravekeeper's Descendant", 1],
    ['Super-Nimble Mega Hamster', 1],
    // Spells (10)
    ['Book of Moon', 3],
    ['Rekindling', 3],
    ['Brain Control', 1],
    ['Heavy Storm', 1],
    ['Mind Control', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (9)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Dust Tornado', 1],
    ['Mirror Force', 1],
    ['Royal Oppression', 1],
    ['Solemn Judgment', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Colossal Fighter', 2],
    ['Ally of Justice Catastor', 1],
    ['Arcanite Magician', 1],
    ['Black Rose Dragon', 1],
    ['Blackwing Armor Master', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Flamvell Uruquizas', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Red Dragon Archfiend', 1],
    ['Stardust Dragon', 1],
    ['Thought Ruler Archfiend', 1],
  ],
  side: [
    ['Banisher of the Radiance', 2],
    ['Cyber Dragon', 1],
    ['Legendary Jujitsu Master', 2],
    ['Lightning Vortex', 1],
    ['System Down', 2],
    ['Consecrated Light', 2],
    ['Light-Imprisoning Mirror', 2],
    ['Pulling the Rug', 2],
    ['Torrential Tribute', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2307 (Built by Jarel Winston, 2010 SJ Edison, 5th - 8th Place)
const jarelWinston: DeckDef = {
  id: 't-sjc-edison-top8-winston',
  name: 'Lightsworn Monarchs (Jarel Winston)',
  archetype: 'Lightsworn Monarch',
  tier: 1,
  color: '#c9a227',
  description:
    'Top 8 at SJC Edison. Lightsworn milling with Ryko, Lyla, Jain and two Solar Recharge, backed by three Caius and two Thestalos for tribute-summon pressure. Dandylion and Treeborn Frog supply free tribute fodder, Hamster and Debris Dragon add synchro plays.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 8', pilot: 'Jarel Winston' },
  main: [
    // Monsters (24)
    ['Caius the Shadow Monarch', 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['Cyber Dragon', 2],
    ['Dandylion', 2],
    ['Jain, Lightsworn Paladin', 2],
    ['Lyla, Lightsworn Sorceress', 2],
    ['Super-Nimble Mega Hamster', 2],
    ['Thestalos the Firestorm Monarch', 2],
    ['Blackwing - Gale the Whirlwind', 1],
    ['Card Trooper', 1],
    ['Debris Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Sangan', 1],
    ['Treeborn Frog', 1],
    // Spells (10)
    ['Pot of Avarice', 3],
    ['Book of Moon', 2],
    ['Solar Recharge', 2],
    ['Brain Control', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (8)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Phoenix Wing Wind Blast', 2],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
  ],
  extra: [
    ['Chimeratech Fortress Dragon', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Ancient Fairy Dragon', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Red Dragon Archfiend', 1],
    ['Thought Ruler Archfiend', 1],
    ['Zeman the Ape King', 1],
  ],
  side: [
    ['D.D. Crow', 2],
    ['Legendary Jujitsu Master', 2],
    ['Prohibition', 1],
    ['Soul Exchange', 1],
    ['Dust Tornado', 3],
    ['Consecrated Light', 2],
    ['Royal Oppression', 2],
    ['Trap Hole', 2],
  ],
};

// Source: Konami event coverage deck profile,
// https://yugiohblog.konami.com/2010/sjc/10-04-75thsjc/deck-profile-jake-matterns-prismadiator-deck/
// (Jake Mattern, 2010 SJ Edison, 5th - 8th Place; placing per https://yugiohtopdecks.com/deck/2308)
const jakeMattern: DeckDef = {
  id: 't-sjc-edison-top8-mattern',
  name: 'Prismadiators (Jake Mattern)',
  archetype: 'Gladiator Beast',
  tier: 1,
  color: '#b0402a',
  description:
    'Top 8 at SJC Edison. Gladiator Beasts with an Elemental Hero Prisma engine: Prisma sends Gladiators from the Deck to the Graveyard to fuse into Gyzarus and Heraklinos, Test Tiger tags in Gladiators straight from the hand, and a 17-trap backrow of Dimensional Prison, Dust Tornado and Compulsory Evacuation Device grinds opponents out.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 8', pilot: 'Jake Mattern' },
  main: [
    // Monsters (17)
    ['Test Tiger', 3],
    ['Gladiator Beast Laquari', 2],
    ['Gladiator Beast Darius', 2],
    ['Elemental Hero Prisma', 2],
    ['Gladiator Beast Equeste', 1],
    ['Gladiator Beast Bestiari', 1],
    ['Gladiator Beast Retiari', 1],
    ['Gladiator Beast Murmillo', 1],
    ['Gladiator Beast Hoplomus', 1],
    ['Gladiator Beast Secutor', 1],
    ['Elemental Hero Stratos', 1],
    ['Morphing Jar', 1],
    // Spells (8)
    ['Book of Moon', 3],
    ['Enemy Controller', 2],
    ['Reinforcement of the Army', 1],
    ['Mystical Space Typhoon', 1],
    ['Cold Wave', 1],
    // Traps (17)
    ['Dimensional Prison', 3],
    ['Dust Tornado', 3],
    ['Gladiator Beast War Chariot', 2],
    ['Bottomless Trap Hole', 2],
    ['Compulsory Evacuation Device', 2],
    ['Starlight Road', 2],
    ['Solemn Judgment', 1],
    ['Trap Dustshoot', 1],
    ['Call of the Haunted', 1],
  ],
  extra: [
    ['Gladiator Beast Heraklinos', 3],
    ['Gladiator Beast Gyzarus', 3],
    ['Chimeratech Fortress Dragon', 3],
    ['Stardust Dragon', 2],
    ['Colossal Fighter', 1],
    ['Black Rose Dragon', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
  ],
  side: [
    ['D.D. Warrior Lady', 2],
    ['Cyber Dragon', 2],
    ['Gladiator Beast Hoplomus', 1],
    ['Nobleman of Crossout', 3],
    ['Brain Control', 1],
    ['Pole Position', 2],
    ['Pulling the Rug', 2],
    ['Trap Hole', 2],
  ],
};

export const DECKS: DeckDef[] = [jeffJones, renaldoLainez, billyBrake, soroshSaberian, edwinOrtiz, jarelWinston, jakeMattern];
