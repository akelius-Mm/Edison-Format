import type { DeckDef } from './types';

// More real tournament decklists from the Edison format (TCG, March 2010 list).
// These are the remaining published lists from the 75th Shonen Jump Championship, Edison, NJ
// (April 24-25, 2010; 2,700+ players): the Top 8 list missing from tournament.ts and the Top 16.
//
// Source for every list: the YugiohTopDecks deck page named above it (yugiohtopdecks.com is offline; the exact
// card counts were read from the archived JSON export at https://github.com/CalciumKid/YTDDecks, decks/deck_<id>.json).
// Card counts are reproduced exactly; nothing has been added, removed or 'fixed'. Main Decks over 40 are as published.
//
// Two SJC Edison Top 16 lists are not included because the published Main Deck is short of 40 cards
// (incomplete transcription): Ira D. Jones' Gladiator Beasts (38, deck 2311) and Thai Bui's Lightsworn (39, deck 2316).
// Both are in tournament3.ts, completed from Format Library's copy of the Konami deck lists.
//
// Cards still waiting on other card batches (these decks validate once they are merged):
//   Archlord Kristya (Stardust Overdrive) - LaMartina; Blackwing - Vayu the Emblem of Honor (Ancient Prophecy) - Ortiz;
//   Solidarity (Ancient Prophecy) - Gilmore.

const SJC_EDISON = 'Shonen Jump Championship Edison';
const SJC_EDISON_DATE = '2010-04-24';

// Source: https://yugiohtopdecks.com/deck/2306 (Built by Jerry Wang, 2010 SJ Edison, 5th - 8th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2306.json
const jerryWang: DeckDef = {
  id: 't-sjc-edison-top8-wang',
  name: 'Quickdraw Dandywarrior (Jerry Wang)',
  archetype: 'Plant Synchro',
  tier: 1,
  color: '#4f8f3a',
  description:
    'The third Quickdraw Dandywarrior in the SJC Edison Top 8, and the most monster-heavy. Quickdraw Synchron, Dandylion, Lonefire Blossom and Debris Dragon build synchros, two Light and Darkness Dragon and three Caius add non-synchro threats, and Enemy Controller can steal a monster for synchro material. The side deck adds two Light-Imprisoning Mirror and an Electric Virus.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 8', pilot: 'Jerry Wang' },
  main: [
    // Monsters (22)
    ['Caius the Shadow Monarch', 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['Dandylion', 2],
    ['Debris Dragon', 2],
    ['Light and Darkness Dragon', 2],
    ['Lonefire Blossom', 2],
    ['Quickdraw Synchron', 2],
    ['Super-Nimble Mega Hamster', 2],
    ['Morphing Jar', 1],
    ['Sangan', 1],
    ['Treeborn Frog', 1],
    ['Tytannial, Princess of Camellias', 1],
    // Spells (10)
    ['Book of Moon', 2],
    ['Pot of Avarice', 2],
    ['Brain Control', 1],
    ['Charge of the Light Brigade', 1],
    ['Enemy Controller', 1],
    ['Foolish Burial', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (9)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Mirror Force', 1],
    ['Phoenix Wing Wind Blast', 1],
    ['Solemn Judgment', 1],
    ['Torrential Tribute', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Drill Warrior', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Ancient Fairy Dragon', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Goyo Guardian', 1],
    ['Iron Chain Dragon', 1],
    ['Junk Archer', 1],
    ['Nitro Warrior', 1],
    ['Red Dragon Archfiend', 1],
    ['Turbo Warrior', 1],
  ],
  side: [
    ['Cyber Dragon', 2],
    ['D.D. Crow', 2],
    ['Dust Tornado', 2],
    ['Legendary Jujitsu Master', 2],
    ['Light-Imprisoning Mirror', 2],
    ['Nobleman of Crossout', 2],
    ['Breaker the Magical Warrior', 1],
    ['Electric Virus', 1],
    ['System Down', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2310 (Built by Rex Mendoza, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2310.json
const rexMendoza: DeckDef = {
  id: 't-sjc-edison-top16-mendoza',
  name: 'Gravekeeper Burn (Rex Mendoza)',
  archetype: 'Anti-Meta Burn',
  tier: 3,
  color: '#7a6a4f',
  description:
    "The anti-meta deck of the SJC Edison Top 16. Necrovalley and Royal Tribute shut off the Graveyard and strip monsters from both hands, while Gravity Bind, Level Limit - Area B, Messenger of Peace, two Skill Drain and two Dark Bribe stall the synchro decks. Three Wave-Motion Cannon, Ceasefire and Magic Cylinder burn for the win. Gravekeeper's Spy, Cyber Valley and Battle Fader hold the field.",
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Rex Mendoza' },
  main: [
    // Monsters (13)
    ["Gravekeeper's Spy", 3],
    ['Cyber Valley', 2],
    ["Gravekeeper's Commandant", 2],
    ['Battle Fader', 1],
    ['Blackwing - Gale the Whirlwind', 1],
    ["Gravekeeper's Descendant", 1],
    ["Gravekeeper's Guard", 1],
    ['Morphing Jar', 1],
    ['Sangan', 1],
    // Spells (14)
    ['Book of Moon', 3],
    ['Wave-Motion Cannon', 3],
    ['Necrovalley', 2],
    ['Royal Tribute', 2],
    ['Gold Sarcophagus', 1],
    ['Level Limit - Area B', 1],
    ['Messenger of Peace', 1],
    ['Smashing Ground', 1],
    // Traps (14)
    ['Bottomless Trap Hole', 2],
    ['Dark Bribe', 2],
    ['Skill Drain', 2],
    ['Starlight Road', 2],
    ['Ceasefire', 1],
    ['Gravity Bind', 1],
    ['Magic Cylinder', 1],
    ['Mirror Force', 1],
    ['Solemn Judgment', 1],
    ['Torrential Tribute', 1],
  ],
  extra: [
    ['Arcanite Magician', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Ancient Fairy Dragon', 1],
    ['Black Rose Dragon', 1],
    ['Blackwing Armor Master', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Mist Wurm', 1],
    ['Thought Ruler Archfiend', 1],
  ],
  side: [
    ['X-Saber Airbellum', 3],
    ['Caius the Shadow Monarch', 2],
    ['Brain Control', 1],
    ['Cyber Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Heavy Storm', 1],
    ['Legendary Jujitsu Master', 1],
    ['Mind Control', 1],
    ['Mystical Space Typhoon', 1],
    ['Pot of Avarice', 1],
    ['Rescue Cat', 1],
    ['Ryko, Lightsworn Hunter', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2312 (Built by Daniel LaMartina, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2312.json
const danielLaMartina: DeckDef = {
  id: 't-sjc-edison-top16-lamartina',
  name: 'Lightsworn (Daniel LaMartina)',
  archetype: 'Lightsworn',
  tier: 2,
  color: '#e3c76b',
  description:
    'A Lightsworn deck from the SJC Edison Top 16 with a Fairy package: three Celestia, two Honest, Archlord Kristya and Dimensional Alchemist sit beside the usual Lightsworn engine and two Judgment Dragon. Two Beckoning Light refill the hand from the milled LIGHT monsters, two Gold Sarcophagus set up Judgment Dragon, and Giant Trunade and Cold Wave clear the way.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Daniel LaMartina' },
  main: [
    // Monsters (24)
    ['Celestia, Lightsworn Angel', 3],
    ['Wulf, Lightsworn Beast', 3],
    ['Honest', 2],
    ['Judgment Dragon', 2],
    ['Lyla, Lightsworn Sorceress', 2],
    ['Ryko, Lightsworn Hunter', 2],
    ['Archlord Kristya', 1],
    ['Aurkus, Lightsworn Druid', 1],
    ['Card Trooper', 1],
    ['Dimensional Alchemist', 1],
    ['Ehren, Lightsworn Monk', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Jain, Lightsworn Paladin', 1],
    ['Lumina, Lightsworn Summoner', 1],
    ['Necro Gardna', 1],
    ['Plaguespreader Zombie', 1],
    // Spells (12)
    ['Solar Recharge', 3],
    ['Gold Sarcophagus', 2],
    ['Brain Control', 1],
    ['Charge of the Light Brigade', 1],
    ['Cold Wave', 1],
    ['Foolish Burial', 1],
    ['Giant Trunade', 1],
    ['Heavy Storm', 1],
    ['Pot of Avarice', 1],
    // Traps (6)
    ['Beckoning Light', 2],
    ['Dimensional Prison', 2],
    ['Call of the Haunted', 1],
    ['Consecrated Light', 1],
  ],
  extra: [
    ['Ally of Justice Catastor', 1],
    ['Arcanite Magician', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Colossal Fighter', 1],
    ['Flamvell Uruquizas', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Red Dragon Archfiend', 1],
    ['Stardust Dragon', 1],
    ['Tempest Magician', 1],
    ['Thought Ruler Archfiend', 1],
  ],
  side: [
    ['Consecrated Light', 2],
    ['Cyber Dragon', 2],
    ['D.D. Crow', 2],
    ['My Body as a Shield', 2],
    ['Nobleman of Crossout', 2],
    ['Royal Decree', 2],
    ['System Down', 2],
    ['Torrential Tribute', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2313 (Built by Chris Pittao, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2313.json
const chrisPittao: DeckDef = {
  id: 't-sjc-edison-top16-pittao',
  name: 'Twilight (Chris Pittao)',
  archetype: 'Twilight',
  tier: 2,
  color: '#6b5aa6',
  description:
    'Lightsworn and Chaos: three Lyla and three Ryko mill the deck with Solar Recharge, and the DARK monsters they bin power Dark Armed Dragon, Chaos Sorcerer and Allure of Darkness. Three Caius and two Super-Nimble Mega Hamster round out the monsters, and a light trap line of Bottomless, Dimensional Prison, Mirror Force and Royal Oppression protects them. The side runs three Mirror of Oaths and Needle Ceiling.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Chris Pittao' },
  main: [
    // Monsters (22)
    ['Caius the Shadow Monarch', 3],
    ['Lyla, Lightsworn Sorceress', 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['Super-Nimble Mega Hamster', 2],
    ['Blackwing - Gale the Whirlwind', 1],
    ['Card Trooper', 1],
    ['Celestia, Lightsworn Angel', 1],
    ['Chaos Sorcerer', 1],
    ['Dark Armed Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Necro Gardna', 1],
    ['Plaguespreader Zombie', 1],
    ['Sangan', 1],
    ['Spirit Reaper', 1],
    ['Wulf, Lightsworn Beast', 1],
    // Spells (12)
    ['Book of Moon', 3],
    ['Solar Recharge', 3],
    ['Pot of Avarice', 2],
    ['Allure of Darkness', 1],
    ['Brain Control', 1],
    ['Charge of the Light Brigade', 1],
    ['Heavy Storm', 1],
    // Traps (6)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Mirror Force', 1],
    ['Royal Oppression', 1],
  ],
  extra: [
    ['Ally of Justice Catastor', 1],
    ['Arcanite Magician', 1],
    ['Armory Arm', 1],
    ['Black Rose Dragon', 1],
    ['Blackwing Armor Master', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Red Dragon Archfiend', 1],
    ['Stardust Dragon', 1],
    ['Tempest Magician', 1],
    ['Thought Ruler Archfiend', 1],
  ],
  side: [
    ['Legendary Jujitsu Master', 3],
    ['Mirror of Oaths', 3],
    ['System Down', 3],
    ['Trap Hole', 3],
    ['Needle Ceiling', 2],
    ['Royal Oppression', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2314 (Built by Bryan Ortiz, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2314.json
const bryanOrtiz: DeckDef = {
  id: 't-sjc-edison-top16-ortiz',
  name: 'Blackwings (Bryan Ortiz)',
  archetype: 'Blackwing',
  tier: 1,
  color: '#2b2f45',
  description:
    'Full Blackwing swarm: three each of Blizzard, Bora, Kalut, Shura and Sirocco plus two Vayu and Gale make Blackwing Armor Master, Armed Wing and Silverwind every turn. Black Whirlwind and Allure keep the hand full, three Icarus Attack and two Royal Oppression control the board, and Dark Armed Dragon is the finisher.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Bryan Ortiz' },
  main: [
    // Monsters (19)
    ['Blackwing - Blizzard the Far North', 3],
    ['Blackwing - Bora the Spear', 3],
    ['Blackwing - Kalut the Moon Shadow', 3],
    ['Blackwing - Shura the Blue Flame', 3],
    ['Blackwing - Sirocco the Dawn', 3],
    ['Blackwing - Vayu the Emblem of Honor', 2],
    ['Blackwing - Gale the Whirlwind', 1],
    ['Dark Armed Dragon', 1],
    // Spells (9)
    ['Book of Moon', 3],
    ['Black Whirlwind', 2],
    ['Allure of Darkness', 1],
    ['Brain Control', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (12)
    ['Icarus Attack', 3],
    ['Bottomless Trap Hole', 2],
    ['Royal Oppression', 2],
    ['Delta Crow - Anti Reverse', 1],
    ['Mirror Force', 1],
    ['My Body as a Shield', 1],
    ['Torrential Tribute', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Blackwing Armed Wing', 3],
    ['Blackwing Armor Master', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Black Rose Dragon', 1],
    ['Blackwing - Silverwind the Ascendant', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
  ],
  side: [
    ['System Down', 3],
    ['Legendary Jujitsu Master', 2],
    ['Nobleman of Crossout', 2],
    ['Skill Drain', 2],
    ['Trap Hole', 2],
    ['Chain Disappearance', 1],
    ['Delta Crow - Anti Reverse', 1],
    ['Starlight Road', 1],
    ['The Transmigration Prophecy', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2315 (Built by Miguel Garcia, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2315.json
const miguelGarcia: DeckDef = {
  id: 't-sjc-edison-top16-garcia',
  name: 'Synchro Cat (Miguel Garcia)',
  archetype: 'Synchro Cat',
  tier: 2,
  color: '#b5763a',
  description:
    "Synchro Cat without Doomcaliber Knight. Three Gravekeeper's Spy, three X-Saber Airbellum, Rescue Cat and Summoner Monk build Level 7 synchros like two Arcanite Magician, with Gravekeeper's Descendant, Ryko and Super-Nimble Mega Hamster for disruption. Two Cyber Dragon feed two Chimeratech Fortress Dragon, and Caius, Chaos Sorcerer and Dark Armed Dragon close games.",
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Miguel Garcia' },
  main: [
    // Monsters (20)
    ["Gravekeeper's Spy", 3],
    ['X-Saber Airbellum', 3],
    ['Cyber Dragon', 2],
    ['Ryko, Lightsworn Hunter', 2],
    ['Super-Nimble Mega Hamster', 2],
    ['Caius the Shadow Monarch', 1],
    ['Chaos Sorcerer', 1],
    ['Dark Armed Dragon', 1],
    ['Gorz the Emissary of Darkness', 1],
    ["Gravekeeper's Descendant", 1],
    ['Plaguespreader Zombie', 1],
    ['Rescue Cat', 1],
    ['Summoner Monk', 1],
    // Spells (12)
    ['Book of Moon', 3],
    ['Gold Sarcophagus', 2],
    ['Pot of Avarice', 2],
    ['Brain Control', 1],
    ['Cold Wave', 1],
    ['Heavy Storm', 1],
    ['Mind Control', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (8)
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 1],
    ['Mirror Force', 1],
    ['Solemn Judgment', 1],
    ['Starlight Road', 1],
    ['Torrential Tribute', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Arcanite Magician', 2],
    ['Chimeratech Fortress Dragon', 2],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Black Rose Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Red Dragon Archfiend', 1],
  ],
  side: [
    ['Breaker the Magical Warrior', 2],
    ['Dust Tornado', 2],
    ['Legendary Jujitsu Master', 2],
    ['Mirror of Oaths', 2],
    ['Nobleman of Crossout', 2],
    ['Trap Hole', 2],
    ['D.D. Crow', 1],
    ['Starlight Road', 1],
    ['Tragoedia', 1],
  ],
};

// Source: https://yugiohtopdecks.com/deck/2317 (Built by Enye Gilmore, 2010 SJ Edison, 9th - 16th Place)
// Card counts: https://raw.githubusercontent.com/CalciumKid/YTDDecks/main/decks/deck_2317.json
const enyeGilmore: DeckDef = {
  id: 't-sjc-edison-top16-gilmore',
  name: 'Machina Gadgets (Enye Gilmore)',
  archetype: 'Machina Gadget',
  tier: 2,
  color: '#6d7b86',
  description:
    'A 44-card Machine toolbox. Nine Gadgets chain into each other, Machina Gearframe fetches Machina Fortress, and Fortress revives itself by discarding Gadgets. Three Solidarity pump every Machine, three Creature Swap and three Nobleman of Crossout handle threats, and two Royal Oppression with three Dimensional Prison shut down synchro decks. Three Chimeratech Fortress Dragon in the Extra Deck answer an opposing Cyber Dragon by fusing it with Machines on either field.',
  event: { name: SJC_EDISON, date: SJC_EDISON_DATE, place: 'Top 16', pilot: 'Enye Gilmore' },
  main: [
    // Monsters (16)
    ['Green Gadget', 3],
    ['Machina Gearframe', 3],
    ['Red Gadget', 3],
    ['Yellow Gadget', 3],
    ['Machina Fortress', 2],
    ['Machina Peacekeeper', 2],
    // Spells (14)
    ['Creature Swap', 3],
    ['Nobleman of Crossout', 3],
    ['Smashing Ground', 3],
    ['Solidarity', 3],
    ['Limiter Removal', 1],
    ['Mystical Space Typhoon', 1],
    // Traps (14)
    ['Dimensional Prison', 3],
    ['Bottomless Trap Hole', 2],
    ['Royal Oppression', 2],
    ['Ultimate Offering', 2],
    ['Mirror Force', 1],
    ['Solemn Judgment', 1],
    ['Starlight Road', 1],
    ['Torrential Tribute', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Chimeratech Fortress Dragon', 3],
    ['Stardust Dragon', 2],
    ['Ally of Justice Catastor', 1],
    ['Black Rose Dragon', 1],
    ['Blackwing Armor Master', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Colossal Fighter', 1],
    ['Goyo Guardian', 1],
    ['Power Tool Dragon', 1],
  ],
  side: [
    ['Caius the Shadow Monarch', 3],
    ['Proto-Cyber Dragon', 3],
    ['Cyber Dragon', 2],
    ['Dust Tornado', 2],
    ['Shadow-Imprisoning Mirror', 2],
    ['Cold Wave', 1],
    ['Heavy Storm', 1],
    ['Starlight Road', 1],
  ],
};

export const DECKS: DeckDef[] = [jerryWang, rexMendoza, danielLaMartina, chrisPittao, bryanOrtiz, miguelGarcia, enyeGilmore];
