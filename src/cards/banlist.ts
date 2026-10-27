// Edison Format Forbidden & Limited list: the TCG list effective 2010-03-01 (in force for SJC Edison, April 2010).
// Cards not listed are unlimited (3).
// Sources (they agree card for card: 43 Forbidden, 70 Limited, 19 Semi-Limited):
//   - https://www.edisonformat.com/banlist.html ("Edison Format Follows the March 2010 (TCG) Forbidden and Limited List")
//   - https://yugipedia.com/wiki/March_2010_Lists_(TCG), citing Konami's list
//     http://www.yugioh-card.com/en/limited/10_03_list.html (archived 2010-08-25)
// Names on that list that have no card definition here are kept so the list stays complete.
// This is the official list, applied in full: every bundled deck (archetype and tournament) must be legal under it
// (scripts/side-deck-test.ts counts Main + Extra + Side together).
import { CARDS } from './define';

export const FORBIDDEN = [
  // Monsters
  'Black Luster Soldier - Envoy of the Beginning',
  'Chaos Emperor Dragon - Envoy of the End',
  'Cyber Jar',
  'Cyber-Stein',
  'Dark Magician of Chaos',
  'Dark Strike Fighter',
  'Destiny Hero - Disk Commander',
  'Fiber Jar',
  'Magical Scientist',
  'Magician of Faith',
  'Makyura the Destructor',
  'Sinister Serpent',
  'Thousand-Eyes Restrict',
  'Tribe-Infecting Virus',
  'Tsukuyomi',
  'Victory Dragon',
  'Witch of the Black Forest',
  'Yata-Garasu',
  // Spells
  'Butterfly Dagger - Elma',
  'Card of Safe Return',
  'Change of Heart',
  'Confiscation',
  'Dark Hole',
  'Delinquent Duo',
  'Dimension Fusion',
  'Graceful Charity',
  "Harpie's Feather Duster",
  'Last Will',
  'Metamorphosis',
  'Mirage of Nightmare',
  'Monster Reborn',
  'Painful Choice',
  'Pot of Greed',
  'Premature Burial',
  'Raigeki',
  'Snatch Steal',
  'The Forceful Sentry',
  // Traps
  'Crush Card Virus',
  'Exchange of the Spirit',
  'Imperial Order',
  'Last Turn',
  'Ring of Destruction',
  'Time Seal',
];

export const LIMITED = [
  // Monsters
  'Black Rose Dragon',
  'Blackwing - Gale the Whirlwind',
  'Brionac, Dragon of the Ice Barrier',
  'Card Trooper',
  'Chaos Sorcerer',
  'Dark Armed Dragon',
  'Elemental Hero Stratos',
  'Exodia the Forbidden One',
  'Gladiator Beast Bestiari',
  'Gorz the Emissary of Darkness',
  'Goyo Guardian',
  'Left Arm of the Forbidden One',
  'Left Leg of the Forbidden One',
  'Lumina, Lightsworn Summoner',
  'Marshmallon',
  'Mezuki',
  'Mind Master',
  'Morphing Jar',
  'Necro Gardna',
  'Necroface',
  'Neo-Spacian Grand Mole',
  'Night Assailant',
  'Plaguespreader Zombie',
  'Rescue Cat',
  'Right Arm of the Forbidden One',
  'Right Leg of the Forbidden One',
  'Sangan',
  'Snipe Hunter',
  'Spirit Reaper',
  'Summoner Monk',
  'Tragoedia',
  // Spells
  'Advanced Ritual Art',
  'Allure of Darkness',
  'Brain Control',
  'Burial from a Different Dimension',
  'Card Destruction',
  'Charge of the Light Brigade',
  'Cold Wave',
  'Destiny Draw',
  'Emergency Teleport',
  'Foolish Burial',
  'Future Fusion',
  // Giant Trunade was Limited (not Forbidden) on the March 2010 TCG list: Ira D. Jones and Daniel LaMartina
  // both main-decked 1 in the SJC Edison 2010 Top 16 (src/decks/tournament2.ts).
  'Giant Trunade',
  'Heavy Storm',
  'Level Limit - Area B',
  'Limiter Removal',
  'Megamorph',
  'Mind Control',
  'Monster Gate',
  'Mystical Space Typhoon',
  'One for One',
  'Overload Fusion',
  'Reasoning',
  'Reinforcement of the Army',
  'Scapegoat',
  'Swords of Revealing Light',
  // Traps
  'Call of the Haunted',
  'Ceasefire',
  'Gravity Bind',
  'Magic Cylinder',
  'Magical Explosion',
  'Mind Crush',
  'Mirror Force',
  'Ojama Trio',
  'Return from the Different Dimension',
  'Solemn Judgment',
  'The Transmigration Prophecy',
  'Torrential Tribute',
  'Trap Dustshoot',
  'Wall of Revealing Light',
];

// Book of Moon, Pot of Avarice and Nobleman of Crossout were Unlimited (Jeff Jones won SJC Edison with 3 Pot of Avarice,
// Jake Mattern sided 3 Nobleman). Breaker the Magical Warrior had left the list in September 2009, and Lightning Vortex,
// Sacred Phoenix of Nephthys, E - Emergency Call, Mass Driver and Messenger of Peace are not on the March 2010 list.
export const SEMI_LIMITED = [
  // Monsters
  'Cyber Dragon',
  'Dandylion',
  'Demise, King of Armageddon',
  'Destiny Hero - Malicious',
  'Goblin Zombie',
  'Honest',
  'Judgment Dragon',
  'Lonefire Blossom',
  // The user's decision: Treeborn Frog stays Semi-Limited (it is Semi-Limited on the March 2010 list too).
  'Treeborn Frog',
  // Spells
  'Black Whirlwind',
  'Chain Strike',
  'Gold Sarcophagus',
  'Magical Stone Excavation',
  'United We Stand',
  // Traps
  'Bottomless Trap Hole',
  'Royal Decree',
  'Royal Oppression',
  'Skill Drain',
  'Ultimate Offering',
];

// Cards scripted for the simulator (TSHD packs, Draft, Sealed, the collection) that had no English TCG
// release on or before SJC Edison (2010-04-24). They stay defined, but validateDeck rejects them in
// constructed decks. Each entry names its first English TCG printing.
export const POST_EDISON = [
  'Solemn Warning', // Duelist Revolution (DREV-EN077), 2010-08-17
  'Junk Destroyer', // Starter Deck: Duelist Toolbox (5DS3-EN039), late May / June 2010
  'XX-Saber Boggart Knight', // The Shining Darkness (TSHD-EN000; Sneak Peek TSHD-ENSP1, 2010-05-01)
  'XX-Saber Darksoul', // The Shining Darkness (TSHD-EN081), May 2010
  'X-Saber Palomuro', // The Shining Darkness (TSHD-EN093), May 2010
  'X-Saber Pashuul', // The Shining Darkness (TSHD-EN094), May 2010 (DT01 Duel Terminal copy not tournament-legal)
  'Genex Controller', // The Shining Darkness (TSHD-EN090), May 2010 (DT01 Duel Terminal copy not tournament-legal)
  'Ronintoadin', // The Shining Darkness (TSHD-EN033), May 2010
  'Dewloren, Tiger King of the Ice Barrier', // Hidden Arsenal 2 (HA02-EN027), 2010-07-20
  'Elemental Hero Great Tornado', // Legendary Collection 2 (LC02-EN010), 2011-10-04
  'Elemental Hero The Shining', // Yu-Gi-Oh! GX Volume 6 promo (YG06-EN001), 2011-03-01
  'Alexandrite Dragon', // Photon Shockwave (PHSW-EN000; Sneak Peek PHSW-ENSP1, 2011-11-05)
];

export function isPostEdison(name: string): boolean {
  return POST_EDISON.includes(name);
}

export function applyBanlist() {
  const byName = new Map(Object.values(CARDS).map((c) => [c.name, c]));
  for (const c of Object.values(CARDS)) c.limit = 3;
  const set = (names: string[], lim: 0 | 1 | 2) => {
    for (const n of names) {
      const c = byName.get(n);
      if (c) c.limit = lim;
    }
  };
  set(SEMI_LIMITED, 2);
  set(LIMITED, 1);
  set(FORBIDDEN, 0);
}

export function limitOf(name: string): number {
  if (FORBIDDEN.includes(name)) return 0;
  if (LIMITED.includes(name)) return 1;
  if (SEMI_LIMITED.includes(name)) return 2;
  return 3;
}
