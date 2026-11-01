// Game plans for the 2010 archetypes: what each deck counts as progress beyond plain card advantage. The look-ahead
// (planner.ts) adds these to its board score, so it steers toward the lines the deck is built for: a Lightsworn player
// wants four Lightsworn names in the Graveyard for Judgment Dragon, a Plant player wants Plaguespreader Zombie there,
// a Monarch player wants tribute fodder when a Monarch is in hand, and so on.
//
// A deck's plans come from its own decklist (so custom decks get them too). Values are in the planner's card units
// (one card ≈ 1000).
import type { CardInstance } from '../engine/card';
import type { DeckList, Game } from '../engine/game';
import type { PlayerId } from '../engine/types';

export interface Plan {
  id: string;
  /** Extra worth of `p`'s position under this plan. */
  value(g: Game, p: PlayerId): number;
}

const grave = (g: Game, p: PlayerId) => g.players[p].grave;
const hand = (g: Game, p: PlayerId) => g.players[p].hand;
const mons = (g: Game, p: PlayerId) => g.players[p].mzone.filter((c): c is CardInstance => !!c);
const faceUp = (g: Game, p: PlayerId) => mons(g, p).filter((c) => c.faceUp);
const named = (list: CardInstance[], name: string) => list.filter((c) => c.name === name).length;
const capped = (n: number, cap: number, each: number) => Math.min(n, cap) * each;

interface PlanDef {
  id: string;
  /** Cards that mark a deck as this archetype. */
  marks: string[];
  /** Copies of the marks a deck needs to play this plan (default 3): one tech copy (a single Caius, a sided
   *  Necrovalley) doesn't make a Monarch or Gravekeeper's deck. */
  need?: number;
  value(g: Game, p: PlayerId): number;
}

const PLANS: PlanDef[] = [
  {
    id: 'plants',
    marks: ['Quickdraw Synchron', 'Dandylion', 'Lonefire Blossom', 'Glow-Up Bulb', 'Spore'],
    value: (g, p) => {
      const gy = grave(g, p);
      // recursive Synchro material waiting in the Graveyard
      let v = named(gy, 'Plaguespreader Zombie') * 350 + named(gy, 'Glow-Up Bulb') * 300 + named(gy, 'Spore') * 250;
      // Fluff Tokens are free Synchro material
      v += capped(mons(g, p).filter((c) => c.isToken).length, 2, 120);
      // Quickdraw wants a monster to discard
      if (hand(g, p).some((c) => c.name === 'Quickdraw Synchron') && hand(g, p).some((c) => c.isMonster && c.name !== 'Quickdraw Synchron')) v += 150;
      return v;
    },
  },
  {
    id: 'zombies',
    marks: ['Mezuki', 'Zombie Master', 'Goblin Zombie', 'Book of Life'],
    value: (g, p) => {
      const gy = grave(g, p);
      const zombies = gy.filter((c) => c.isMonster && c.data.race === 'Zombie').length;
      return named(gy, 'Mezuki') * 300 + named(gy, 'Plaguespreader Zombie') * 300 + capped(zombies, 6, 60);
    },
  },
  {
    id: 'lightsworn',
    marks: ['Judgment Dragon', 'Ryko, Lightsworn Hunter', 'Lumina, Lightsworn Summoner', 'Wulf, Lightsworn Beast', 'Celestia, Lightsworn Angel'],
    value: (g, p) => {
      const gy = grave(g, p);
      // Judgment Dragon needs 4 differently named Lightsworn monsters in the Graveyard
      const names = new Set(gy.filter((c) => c.isMonster && c.inSet('lightsworn')).map((c) => c.name));
      let v = capped(names.size, 4, 150) + named(gy, 'Necro Gardna') * 250;
      if (names.size >= 4 && hand(g, p).some((c) => c.name === 'Judgment Dragon')) v += 400;
      return v;
    },
  },
  {
    id: 'dark-armed',
    marks: ['Dark Armed Dragon', 'Destiny Hero - Malicious', 'Armageddon Knight', 'Dark Grepher', 'Allure of Darkness'],
    value: (g, p) => {
      const gy = grave(g, p);
      const darks = gy.filter((c) => c.isMonster && c.data.attribute === 'DARK').length;
      // Dark Armed Dragon is summoned with exactly 3 DARK monsters in the Graveyard; more feed its effect
      let v = capped(darks, 3, 200) + Math.max(0, darks - 3) * 40;
      v += named(gy, 'Destiny Hero - Malicious') * 250 + named(gy, 'Destiny HERO - Malicious') * 250;
      if (darks === 3 && hand(g, p).some((c) => c.name === 'Dark Armed Dragon')) v += 400;
      return v;
    },
  },
  {
    id: 'blackwings',
    marks: ['Blackwing - Gale the Whirlwind', 'Blackwing - Bora the Spear', 'Blackwing - Kalut the Moon Shadow', 'Blackwing - Sirocco the Dawn'],
    value: (g, p) => capped(faceUp(g, p).filter((c) => c.inSet('blackwing')).length, 3, 150),
  },
  {
    id: 'gladiators',
    marks: ['Gladiator Beast Bestiari', 'Gladiator Beast Darius', 'Gladiator Beast Laquari', 'Test Tiger'],
    // a Gladiator Beast on the field that can tag out is worth more than its stats
    value: (g, p) => capped(faceUp(g, p).filter((c) => c.inSet('gladiator') && !c.isExtra).length, 2, 200),
  },
  {
    id: 'monarchs',
    marks: ['Caius the Shadow Monarch', 'Raiza the Storm Monarch', 'Mobius the Frost Monarch', 'Thestalos the Firestorm Monarch', 'Zaborg the Thunder Monarch', 'Granmarg the Rock Monarch'],
    value: (g, p) => {
      const gy = grave(g, p);
      let v = named(gy, 'Treeborn Frog') * 400 + named(gy, 'Swap Frog') * 80;
      // tribute fodder on the field while a Monarch waits in hand
      if (hand(g, p).some((c) => /Monarch$/.test(c.name))) v += capped(mons(g, p).length, 1, 250);
      return v;
    },
  },
  {
    id: 'six-samurai',
    marks: ['Grandmaster of the Six Samurai', 'The Six Samurai - Zanji', 'The Six Samurai - Irou', 'Great Shogun Shien'],
    value: (g, p) => capped(faceUp(g, p).filter((c) => c.inSet('six-samurai') || c.name.includes('Six Samurai')).length, 3, 140),
  },
  {
    id: 'x-sabers',
    marks: ['XX-Saber Faultroll', 'X-Saber Airbellum', 'XX-Saber Boggart Knight'],
    // XX-Saber Faultroll comes out with 2 X-Sabers on the field
    value: (g, p) => capped(faceUp(g, p).filter((c) => c.inSet('x-saber')).length, 2, 170),
  },
  {
    id: 'gravekeepers',
    marks: ['Necrovalley', "Gravekeeper's Spy", "Gravekeeper's Commandant"],
    need: 4,
    value: (g, p) => {
      const f = g.players[p].fzone;
      return f && f.faceUp && f.name === 'Necrovalley' ? 600 : 0;
    },
  },
];

/** The plans that fit a decklist. */
export function plansFor(deck: DeckList): Plan[] {
  const cards = [...deck.main, ...deck.extra].map((c) => c.name);
  return PLANS.filter((pl) => cards.filter((n) => pl.marks.includes(n)).length >= (pl.need ?? 3)).map(({ id, value }) => ({ id, value }));
}

/** Total extra worth of `p`'s position under `plans` (failures count as nothing). */
export function planValue(plans: Plan[], g: Game, p: PlayerId): number {
  let v = 0;
  for (const pl of plans) {
    try {
      v += pl.value(g, p);
    } catch {
      /* a plan that can't read this board adds nothing */
    }
  }
  return v;
}
