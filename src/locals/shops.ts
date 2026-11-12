// The local scene: fictional card shops and their Friday nights.
import { eventDateOf, nextWeekday, type EventDate } from '../calendar';
import type { FieldSize, Shop } from './types';
import { hash } from './rng';

/** Invented shops (no real store names). */
export const SHOPS: Shop[] = [
  {
    id: 'kettle-hill',
    name: 'Kettle Hill Cards & Games',
    where: 'Back room · 8 folding tables',
    blurb: 'Pairings go up on the corkboard by the soda fridge. Doors at 6:30, round one at 7.',
  },
  {
    id: 'third-turn',
    name: 'The Third Turn',
    where: 'Upstairs from the comic shop',
    blurb: 'Long tables under fluorescent lights and a judge who reads every ruling out loud.',
  },
  {
    id: 'lantern-street',
    name: 'Lantern Street Collectibles',
    where: 'Corner unit · glass case of singles',
    blurb: 'The binder crowd trades between rounds. Prize packs come straight off the shelf.',
  },
];

export const shopById = (id: string) => SHOPS.find((s) => s.id === id) ?? SHOPS[0];

/** Locals is this Friday: tonight on a Friday, otherwise the coming one. A night keeps the date it was played on. */
export function nightDate(at = Date.now()): EventDate {
  return eventDateOf(nextWeekday(5, at));
}

/** The shop hosting a given night (the scene rotates between the three shops). */
export function nightShop(number: number): Shop {
  return SHOPS[(Math.max(1, number) - 1) % SHOPS.length];
}

/** Turnout varies week to week; the player can override it at check-in. */
export function expectedTurnout(number: number): FieldSize {
  const r = hash(`turnout-${number}`) % 100;
  return r < 40 ? 16 : r < 78 ? 24 : 32;
}

export function swissRoundsFor(size: number) {
  // Konami's 2010 recommendation: 9–16 players → 4 rounds, 17–32 → 5 rounds.
  return Math.max(3, Math.ceil(Math.log2(size)));
}

export function topCutFor(size: number): 4 | 8 {
  return size <= 16 ? 4 : 8;
}
