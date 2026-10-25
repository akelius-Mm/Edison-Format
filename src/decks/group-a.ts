import type { DeckDef } from './types';

// Archetype group A: Quickdraw Plant, Zombie Synchro, Lightsworn.
// Lists are modelled on Edison-format (April 2010) tournament builds, adjusted to the card pool.

const quickdrawPlant: DeckDef = {
  id: 'quickdraw-plant',
  name: 'Quickdraw Plant',
  archetype: 'Plant Synchro',
  tier: 1,
  color: '#4caf50',
  description:
    'The Edison synchro toolbox. Quickdraw Synchron special summons itself by dumping Dandylion or Level Eater, Lonefire Blossom chains Plants out of the Deck, and Debris Dragon revives the discarded Plants for instant Drill Warrior, Black Rose Dragon or Stardust Dragon. Fluff Tokens, Level Eater and Plaguespreader keep feeding more synchros, with Dark Armed Dragon as the finisher.',
  main: [
    // Monsters (19)
    ['Quickdraw Synchron', 3],
    ['Lonefire Blossom', 3],
    ['Dandylion', 3],
    ['Debris Dragon', 2],
    ['Level Eater', 2],
    ['Plaguespreader Zombie', 1],
    ['Tytannial, Princess of Camellias', 1],
    ['Card Trooper', 1],
    ['Sangan', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Dark Armed Dragon', 1],
    // Spells (12)
    ['Foolish Burial', 1],
    ['Allure of Darkness', 1],
    ['Gold Sarcophagus', 1],
    ['Pot of Avarice', 1],
    ['Monster Reborn', 1],
    ['Brain Control', 1],
    ['Dark Hole', 1],
    ['Smashing Ground', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Book of Moon', 1],
    ['Scapegoat', 1],
    // Traps (9)
    ['Solemn Judgment', 1],
    ['Dimensional Prison', 2],
    ['Bottomless Trap Hole', 2],
    ['Torrential Tribute', 1],
    ['Mirror Force', 1],
    ['Call of the Haunted', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Stardust Dragon', 2],
    ['Drill Warrior', 2],
    ['Black Rose Dragon', 1],
    ['Red Dragon Archfiend', 1],
    ['Ancient Fairy Dragon', 1],
    ['Nitro Warrior', 1],
    ['Turbo Warrior', 1],
    ['Junk Warrior', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Thought Ruler Archfiend', 1],
    ['Colossal Fighter', 1],
    ['Magical Android', 1],
    ['Goyo Guardian', 1],
  ],
  side: [
    // Graveyard hate for Lightsworn, Zombies and opposing Debris Dragon lines.
    ['D.D. Crow', 2],
    // Machine answers and big bodies for Gadgets and the mirror.
    ['Cyber Dragon', 2],
    ['Legendary Jujitsu Master', 2],
    // Shuts off searches (Black Whirlwind, Charge, Sarcophagus) and Synchro Summons in the mirror.
    ['Thunder King Rai-Oh', 2],
    // Backrow answers for Gladiator Beasts and trap-heavy control.
    ['Dust Tornado', 2],
    // LIGHT floodgate for Lightsworn and Judgment Dragon (the Plants are WIND / FIRE).
    ['Light-Imprisoning Mirror', 2],
    // Protects a synchro board from Judgment Dragon, Heavy Storm and Black Rose Dragon.
    ['Starlight Road', 1],
    // Treeborn Frog, Gladiator sets and flip monsters.
    ['Nobleman of Crossout', 2],
  ],
};

const zombies: DeckDef = {
  id: 'zombies',
  name: 'Zombie Synchro',
  archetype: 'Zombie',
  tier: 2,
  color: '#7b4ea3',
  description:
    'Grind-heavy Zombie recursion. Zombie Master discards and revives, Goblin Zombie searches whenever it leaves the field, Mezuki and Book of Life bring the dead back, and Plaguespreader Zombie climbs back every Standby Phase to make Doomkaiser Dragon and other synchros. Pyramid Turtle pulls Vampire Lord or Red-Eyes Zombie Dragon from the Deck.',
  main: [
    // Monsters (19)
    ['Zombie Master', 3],
    ['Goblin Zombie', 3],
    ['Mezuki', 3],
    ['Pyramid Turtle', 2],
    ['Plaguespreader Zombie', 1],
    ['Vampire Lord', 1],
    ['Red-Eyes Zombie Dragon', 1],
    ['Spirit Reaper', 1],
    ['Card Trooper', 1],
    ['Sangan', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Dark Armed Dragon', 1],
    // Spells (13)
    ['Book of Life', 2],
    ['Foolish Burial', 1],
    ['Allure of Darkness', 1],
    ['Pot of Avarice', 1],
    ['Monster Reborn', 1],
    ['Brain Control', 1],
    ['Dark Hole', 1],
    ['Smashing Ground', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Book of Moon', 1],
    ['Gold Sarcophagus', 1],
    // Traps (8)
    ['Solemn Judgment', 1],
    ['Bottomless Trap Hole', 2],
    ['Torrential Tribute', 1],
    ['Mirror Force', 1],
    ['Call of the Haunted', 1],
    ['Dimensional Prison', 1],
    ['Sakuretsu Armor', 1],
  ],
  extra: [
    ['Doomkaiser Dragon', 2],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Gaia Knight, the Force of Earth', 1],
    ['Black Rose Dragon', 1],
    ['Ancient Fairy Dragon', 1],
    ['Exploder Dragonwing', 1],
    ['Ally of Justice Catastor', 1],
    ['Magical Android', 1],
    ['Mist Wurm', 1],
    ['Goyo Guardian', 1],
    ['Stardust Dragon', 1],
    ['Red Dragon Archfiend', 1],
    ['Colossal Fighter', 1],
    ['Iron Chain Dragon', 1],
  ],
  side: [
    // Lightsworn and opposing Zombie / DAD graveyards (Kycoo banishes only the opponent's cards).
    ['D.D. Crow', 2],
    ['Kycoo the Ghost Destroyer', 2],
    // Machine answers for Gadgets.
    ['Cyber Dragon', 2],
    // LIGHT floodgate for Lightsworn and Judgment Dragon.
    ['Light-Imprisoning Mirror', 2],
    // Treeborn Frog and set monsters.
    ['Nobleman of Crossout', 2],
    // Backrow answers and anti-trap for Gladiator Beasts' War Chariot and control.
    ['Dust Tornado', 2],
    ['Trap Stun', 2],
    // Name the opponent's key card (Black Whirlwind, Solar Recharge, Gottoms' Emergency Call).
    ['Prohibition', 1],
  ],
};

const lightsworn: DeckDef = {
  id: 'lightsworn',
  name: 'Lightsworn',
  archetype: 'Lightsworn',
  tier: 1,
  color: '#e6b422',
  description:
    'Mill yourself into power. Solar Recharge, Charge of the Light Brigade, Ryko and the End Phase mills of Lumina and friends fill the Graveyard with different Lightsworn names, Wulf jumps out of the Deck, and Judgment Dragon arrives to wipe the field. Necro Gardna and Honest punish attacks, Plaguespreader adds synchro reach.',
  main: [
    // Monsters (22)
    ['Judgment Dragon', 3],
    ['Ryko, Lightsworn Hunter', 3],
    ['Lumina, Lightsworn Summoner', 2],
    ['Wulf, Lightsworn Beast', 2],
    ['Garoth, Lightsworn Warrior', 1],
    ['Lyla, Lightsworn Sorceress', 1],
    ['Jain, Lightsworn Paladin', 1],
    ['Celestia, Lightsworn Angel', 1],
    ['Necro Gardna', 2],
    ['Honest', 2],
    ['Plaguespreader Zombie', 1],
    ['Card Trooper', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Ehren, Lightsworn Monk', 1],
    // Spells (11)
    ['Charge of the Light Brigade', 1],
    ['Solar Recharge', 3],
    ['Pot of Avarice', 1],
    ['Monster Reborn', 1],
    ['Brain Control', 1],
    ['Dark Hole', 1],
    ['Heavy Storm', 1],
    ['Mystical Space Typhoon', 1],
    ['Book of Moon', 1],
    // Traps (7)
    ['Solemn Judgment', 1],
    ['Bottomless Trap Hole', 2],
    ['Torrential Tribute', 1],
    ['Mirror Force', 1],
    ['Call of the Haunted', 1],
    ['Dimensional Prison', 1],
  ],
  extra: [
    ['Stardust Dragon', 2],
    ['Red Dragon Archfiend', 1],
    ['Colossal Fighter', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Gaia Knight, the Force of Earth', 1],
    ['Explosive Magician', 1],
    ['Black Rose Dragon', 1],
    ['Ancient Fairy Dragon', 1],
    ['Mist Wurm', 1],
    ['Ally of Justice Catastor', 1],
    ['Magical Android', 1],
    ['Goyo Guardian', 1],
    ['Exploder Dragonwing', 1],
    ['Iron Chain Dragon', 1],
  ],
  side: [
    // Mirror-match and Zombie graveyard hate that does not touch your own mill.
    ['D.D. Crow', 2],
    // Machine answers for Gadgets.
    ['Cyber Dragon', 2],
    // DARK floodgates and removal for Blackwings, Tele-DAD and Caius.
    ['Consecrated Light', 3],
    // Anti-trap for Gladiator Beasts (War Chariot) and trap-heavy control.
    ['Royal Decree', 2],
    ['Dust Tornado', 2],
    // Treeborn Frog and set monsters.
    ['Nobleman of Crossout', 2],
    // Stalls Blackwing and X-Saber beatdown.
    ['Legendary Jujitsu Master', 2],
  ],
};

export const DECKS: DeckDef[] = [quickdrawPlant, zombies, lightsworn];
