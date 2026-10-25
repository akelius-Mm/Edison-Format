// The local scene: fictional card shops and the Friday nights of the Edison format window.
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

// Edison format ran from March to the end of August 2010. Night 1 is the Friday after
// SJC Edison (April 17–18, 2010); later nights step a week at a time and wrap within the window.
const WINDOW_START = Date.UTC(2010, 2, 5); // Friday, March 5, 2010
const FRIDAYS = 26; // through Friday, August 27, 2010
const FIRST_NIGHT_INDEX = 7; // Friday, April 23, 2010

export function nightDate(number: number): { iso: string; label: string } {
  const idx = (FIRST_NIGHT_INDEX + Math.max(0, number - 1)) % FRIDAYS;
  const d = new Date(WINDOW_START + idx * 7 * 86400000);
  const iso = d.toISOString().slice(0, 10);
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { iso, label };
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
