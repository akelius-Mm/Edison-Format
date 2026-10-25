// Edison Format Forbidden & Limited list (TCG list in effect for SJC Edison, April 2010),
// reconstructed for this simulator. Cards not listed are unlimited (3).
import { CARDS } from './define';

export const FORBIDDEN = [
  'Black Luster Soldier - Envoy of the Beginning',
  'Butterfly Dagger - Elma',
  'Card of Safe Return',
  'Change of Heart',
  'Chaos Emperor Dragon - Envoy of the End',
  'Crush Card Virus',
  'Cyber Jar',
  'Cyber-Stein',
  'Dark Magician of Chaos',
  'Dark Strike Fighter',
  'Delinquent Duo',
  'Destiny Draw',
  'Dimension Fusion',
  'Exchange of the Spirit',
  'Fiber Jar',
  'Giant Trunade',
  'Graceful Charity',
  "Harpie's Feather Duster",
  'Imperial Order',
  'Last Turn',
  'Magical Scientist',
  'Makyura the Destructor',
  'Metamorphosis',
  'Mirage of Nightmare',
  'Painful Choice',
  'Pot of Greed',
  'Raigeki',
  'Ring of Destruction',
  'Sacred Phoenix of Nephthys',
  'Sinister Serpent',
  'Snatch Steal',
  'The Forceful Sentry',
  'Thousand-Eyes Restrict',
  'Time Seal',
  'Victory Dragon',
  'Witch of the Black Forest',
  'Yata-Garasu',
];

export const LIMITED = [
  // Monsters
  'Brionac, Dragon of the Ice Barrier',
  'Breaker the Magical Warrior',
  'Card Trooper',
  'Dark Armed Dragon',
  'Destiny Hero - Disk Commander',
  'Elemental Hero Stratos',
  'Gladiator Beast Bestiari',
  'Gorz the Emissary of Darkness',
  'Goyo Guardian',
  'Magician of Faith',
  'Marshmallon',
  'Morphing Jar',
  'Neo-Spacian Grand Mole',
  'Plaguespreader Zombie',
  'Rescue Cat',
  'Sangan',
  'Spirit Reaper',
  'Treeborn Frog',
  'Tribe-Infecting Virus',
  'Tsukuyomi',
  'Night Assailant',
  // Spells
  'Allure of Darkness',
  'Brain Control',
  'Card Destruction',
  'Charge of the Light Brigade',
  'Cold Wave',
  'Dark Hole',
  'E - Emergency Call',
  'Emergency Teleport',
  'Foolish Burial',
  'Future Fusion',
  'Gold Sarcophagus',
  'Heavy Storm',
  'Lightning Vortex',
  'Limiter Removal',
  'Mass Driver',
  'Megamorph',
  'Messenger of Peace',
  'Mind Control',
  'Monster Reborn',
  'Mystical Space Typhoon',
  'Overload Fusion',
  'Premature Burial',
  'Reinforcement of the Army',
  'Scapegoat',
  // Traps
  'Call of the Haunted',
  'Ceasefire',
  'Magic Cylinder',
  'Magical Explosion',
  'Mirror Force',
  'Return from the Different Dimension',
  'Royal Decree',
  'Solemn Judgment',
  'Torrential Tribute',
  'Trap Dustshoot',
  'Ultimate Offering',
  'Wall of Revealing Light',
];

// Corrections from the real SJC Edison decklists (src/decks/tournament.ts) and the March 2010 TCG list:
// Book of Moon, Pot of Avarice and Nobleman of Crossout were Unlimited (Jeff Jones won with 3 Pot of Avarice,
// Jake Mattern sided 3 Nobleman), and Royal Oppression was Semi-Limited (Renaldo Lainez played 2).
export const SEMI_LIMITED = [
  'Royal Oppression',
  'Burial from a Different Dimension',
  'Chaos Sorcerer',
  'Cyber Dragon',
  'Reasoning',
  'Swords of Revealing Light',
  'Destiny Hero - Malicious',
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
