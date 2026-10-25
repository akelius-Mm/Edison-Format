// Premade decks: archetype group C (Frog Monarchs, Tele-DAD, Hero Beat).
import type { DeckDef } from './types';

const FROG_MONARCHS: DeckDef = {
  id: 'frog-monarchs',
  name: 'Frog Monarchs',
  archetype: 'Monarch',
  tier: 1,
  color: '#3f8f6b',
  description:
    'Swap Frog sends Treeborn Frog to the GY, where it keeps coming back as Tribute fodder, while Flip Flop Frog bounces the opponent\'s monsters and Dupe Frog fetches more Frogs. Each Tribute Summon of Caius, Raiza, Mobius, Thestalos or Zaborg takes a card from the opponent. Enemy Controller and Soul Exchange let you tribute away the opponent\'s monsters. The deck runs very few Spells/Traps to keep Treeborn Frog live, so plan around a mostly empty backrow.',
  main: [
    // Monarchs (8)
    ['Caius the Shadow Monarch', 3],
    ['Raiza the Storm Monarch', 2],
    ['Mobius the Frost Monarch', 1],
    ['Thestalos the Firestorm Monarch', 1],
    ['Zaborg the Thunder Monarch', 1],
    // Frogs (9)
    ['Swap Frog', 3],
    ['Treeborn Frog', 1],
    ['Flip Flop Frog', 2],
    ['Dupe Frog', 2],
    ['Substitoad', 1],
    // Tech monsters (5)
    ['Gorz the Emissary of Darkness', 1],
    ['Sangan', 1],
    ['Card Trooper', 1],
    ['Spirit Reaper', 1],
    ['Tragoedia', 1],
    // Spells (17)
    ['Enemy Controller', 3],
    ['Soul Exchange', 2],
    ['Cold Wave', 1],
    ['Brain Control', 1],
    ['Mind Control', 1],
    ['Book of Moon', 1],
    ['Mystical Space Typhoon', 1],
    ['Heavy Storm', 1],
    ['Dark Hole', 1],
    ['Monster Reborn', 1],
    ['Pot of Avarice', 1],
    ['Foolish Burial', 1],
    ['Smashing Ground', 1],
    ['Gold Sarcophagus', 1],
    // Traps (1)
    ['Solemn Judgment', 1],
  ],
  extra: [
    ['Stardust Dragon', 2],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Goyo Guardian', 1],
    ['Red Dragon Archfiend', 1],
    ['Black Rose Dragon', 1],
    ['Colossal Fighter', 1],
    ['Ancient Fairy Dragon', 1],
    ['Magical Android', 1],
    ['Thought Ruler Archfiend', 1],
    ['Mist Wurm', 1],
    ['Ally of Justice Catastor', 1],
    ['Armory Arm', 1],
    ['Chimeratech Fortress Dragon', 1],
    ['Gaia Knight, the Force of Earth', 1],
  ],
  // Monster-heavy so Treeborn Frog stays live (no Spell/Trap floodgates).
  side: [
    // Lightsworn and Zombie graveyard hate (Kycoo banishes only the opponent's cards, so Treeborn is safe).
    ['D.D. Crow', 2],
    ['Kycoo the Ghost Destroyer', 2],
    // Machine answers for Gadgets.
    ['Cyber Dragon', 2],
    // Extra Monarchs: Mobius for trap-heavy Gladiator / control, Zaborg and Thestalos for more removal.
    ['Mobius the Frost Monarch', 2],
    ['Zaborg the Thunder Monarch', 1],
    ['Thestalos the Firestorm Monarch', 1],
    // Set monsters, flip monsters and opposing Treeborn Frog.
    ['Nobleman of Crossout', 2],
    // Another Tribute steal for the mirror and big synchros.
    ['Soul Exchange', 1],
    // Flip removal that also works as Tribute fodder.
    ['Tsukuyomi', 1],
    // Stalls Blackwing and X-Saber beatdown.
    ['Legendary Jujitsu Master', 1],
  ],
};

const TELE_DAD: DeckDef = {
  id: 'tele-dad',
  name: 'Tele-DAD',
  archetype: 'Dark Armed Dragon',
  tier: 1,
  color: '#5b3a8c',
  description:
    'The deck that defined Edison. Emergency Teleport pulls Krebons or Psychic Commander from the Deck for Synchro Summons. Armageddon Knight, Dark Grepher and Destiny Hero - Malicious fill the GY with DARK monsters until Dark Armed Dragon can be summoned and start clearing the board. Caius, Gorz and a solid trap lineup cover the rest.',
  main: [
    // Monsters (19)
    ['Dark Armed Dragon', 1],
    ['Caius the Shadow Monarch', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Tragoedia', 1],
    ['Krebons', 3],
    ['Psychic Commander', 2],
    ['Destiny Hero - Malicious', 2],
    ['Dark Grepher', 2],
    ['Armageddon Knight', 2],
    ['Sangan', 1],
    ['Spirit Reaper', 1],
    ['Card Trooper', 1],
    ['Plaguespreader Zombie', 1],
    // Spells (12)
    ['Emergency Teleport', 1],
    ['Allure of Darkness', 1],
    ['Gold Sarcophagus', 1],
    ['Mystical Space Typhoon', 1],
    ['Heavy Storm', 1],
    ['Dark Hole', 1],
    ['Monster Reborn', 1],
    ['Brain Control', 1],
    ['Book of Moon', 1],
    ['Pot of Avarice', 1],
    ['Foolish Burial', 1],
    ['Smashing Ground', 1],
    // Traps (9)
    ['Solemn Judgment', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 2],
    ['Call of the Haunted', 1],
    ['Trap Dustshoot', 1],
  ],
  extra: [
    ['Stardust Dragon', 2],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Goyo Guardian', 1],
    ['Thought Ruler Archfiend', 1],
    ['Magical Android', 1],
    ['Red Dragon Archfiend', 1],
    ['Black Rose Dragon', 1],
    ['Colossal Fighter', 1],
    ['Ancient Fairy Dragon', 1],
    ['Arcanite Magician', 1],
    ['Mist Wurm', 1],
    ['Ally of Justice Catastor', 1],
    ['Armory Arm', 1],
    ['Iron Chain Dragon', 1],
  ],
  side: [
    // Lightsworn, Zombie and mirror-DAD graveyard hate.
    ['D.D. Crow', 2],
    // Machine answers for Gadgets.
    ['Cyber Dragon', 2],
    // More Caius for the slower control and Monarch matchups.
    ['Caius the Shadow Monarch', 2],
    // Blocks Plant / Blackwing / Lightsworn searches (Emergency Teleport summons, so it still works).
    ['Thunder King Rai-Oh', 2],
    // Backrow answers for Gladiator Beasts and control.
    ['Dust Tornado', 2],
    // LIGHT floodgate for Lightsworn (Tele-DAD is DARK, so it never hits you).
    ['Light-Imprisoning Mirror', 2],
    // Treeborn Frog and set monsters.
    ['Nobleman of Crossout', 2],
    // Name the opposing engine card (Black Whirlwind, Solar Recharge, Swap Frog).
    ['Prohibition', 1],
  ],
};

const HERO_BEAT: DeckDef = {
  id: 'hero-beat',
  name: 'Hero Beat',
  archetype: 'Elemental HERO',
  tier: 2,
  color: '#d4a017',
  description:
    'Elemental HEROes beat down with efficient Level 4s. Stratos searches or clears backrow, and E - Emergency Call, Hero Signal and Elemental Hero Ocean keep the HERO count up. Miracle Fusion banishes materials from the field or GY to bring out Absolute Zero or Gaia from the Extra Deck. Cyber Dragon and Thunder King Rai-Oh back up the beats, and Cyber Dragon plus Card Trooper can become Chimeratech Fortress Dragon.',
  main: [
    // Monsters (17)
    ['Elemental Hero Stratos', 1],
    ['Elemental Hero Neos Alius', 3],
    ['Elemental Hero Ocean', 2],
    ['Elemental Hero Wildheart', 1],
    ['Elemental Hero Bubbleman', 1],
    ['Cyber Dragon', 2],
    ['Thunder King Rai-Oh', 1],
    ['Gorz the Emissary of Darkness', 1],
    ['Card Trooper', 1],
    ['Sangan', 1],
    ['Tragoedia', 1],
    ['D.D. Warrior Lady', 1],
    ['Spirit Reaper', 1],
    // Spells (14)
    ['E - Emergency Call', 1],
    ['Miracle Fusion', 2],
    ['Reinforcement of the Army', 1],
    ['Gold Sarcophagus', 1],
    ['Mystical Space Typhoon', 1],
    ['Heavy Storm', 1],
    ['Dark Hole', 1],
    ['Monster Reborn', 1],
    ['Brain Control', 1],
    ['Book of Moon', 1],
    ['Pot of Avarice', 1],
    ['Smashing Ground', 1],
    ['Lightning Vortex', 1],
    // Traps (9)
    ['Hero Signal', 2],
    ['Solemn Judgment', 1],
    ['Mirror Force', 1],
    ['Torrential Tribute', 1],
    ['Bottomless Trap Hole', 2],
    ['Dimensional Prison', 1],
    ['Call of the Haunted', 1],
  ],
  extra: [
    ['Elemental Hero Absolute Zero', 3],
    ['Elemental Hero Gaia', 3],
    ['Chimeratech Fortress Dragon', 2],
    ['Stardust Dragon', 1],
    ['Brionac, Dragon of the Ice Barrier', 1],
    ['Goyo Guardian', 1],
    ['Red Dragon Archfiend', 1],
    ['Colossal Fighter', 1],
    ['Black Rose Dragon', 1],
    ['Magical Android', 1],
  ],
  side: [
    // Lightsworn and Zombie graveyard hate; Kycoo is a Level 4 beater that only banishes the opponent's cards.
    ['D.D. Crow', 2],
    ['Kycoo the Ghost Destroyer', 2],
    // More D.D. Warrior Lady to trade with Judgment Dragon, Caius-backed Monarchs and synchros.
    ['D.D. Warrior Lady', 2],
    // Anti-trap that keeps Hero Signal usable (unlike Royal Decree).
    ['Trap Stun', 2],
    // LIGHT floodgate for Lightsworn and Judgment Dragon.
    ['Light-Imprisoning Mirror', 2],
    // Name the opposing engine card (Black Whirlwind, Solar Recharge, Swap Frog).
    ['Prohibition', 1],
    // Treeborn Frog and set monsters.
    ['Nobleman of Crossout', 2],
    ['Dust Tornado', 2],
  ],
};

export const DECKS: DeckDef[] = [FROG_MONARCHS, TELE_DAD, HERO_BEAT];
