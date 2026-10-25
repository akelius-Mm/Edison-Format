// Generated AI tournament personas.
import type { Difficulty } from '../ai/ai';

const FIRST = [
  'Akira', 'Rei', 'Kaito', 'Yuna', 'Haru', 'Mika', 'Sora', 'Daichi', 'Emi', 'Kenji',
  'Marcus', 'Lena', 'Diego', 'Priya', 'Omar', 'Nadia', 'Felix', 'Ingrid', 'Tobias', 'Chloe',
  'Mateo', 'Ava', 'Jonah', 'Zara', 'Luca', 'Isla', 'Theo', 'Freya', 'Ravi', 'Selene',
  'Bram', 'Aiko', 'Dmitri', 'Elena', 'Kwame', 'Amara', 'Hugo', 'Noor', 'Silas', 'Vera',
  'Jin', 'Mei', 'Tariq', 'Leila', 'Caleb', 'Ines', 'Rowan', 'Kira', 'Elias', 'Juno',
];
const LAST = [
  'Tachibana', 'Mori', 'Kurogane', 'Sakai', 'Hayashi', 'Okabe', 'Vell', 'Brandt', 'Alvarez', 'Raman',
  'Haddad', 'Novak', 'Lindqvist', 'Weber', 'Dubois', 'Rossi', 'Okafor', 'Castillo', 'Park', 'Nakamura',
  'Kowalski', 'Moreau', 'Silva', 'Fitzgerald', 'Ivanova', 'Mensah', 'Sato', 'Lund', 'Herrera', 'Quinn',
  'Ashford', 'Blackwood', 'Calloway', 'Draven', 'Everhart', 'Grimaldi', 'Holloway', 'Kessler', 'Marlowe', 'Thorne',
];
const HANDLES = [
  'Synchro Sensei', 'GraveyardGuru', 'Monarch_Main', 'TopDeckTitan', 'ChainLink7', 'SideDeckSage',
  'Plant Whisperer', 'Lumina Lover', 'BlackFeather', 'Saber Dancer', 'Tempest Tactician', 'DarkArmed',
  'Frog Prince', 'Bottomless Bob', 'Solemn Steve', 'Torrential Tara', 'NeoSpacian', 'Gorz Goes Brrr',
];

export interface PersonaTitle {
  title: string;
  skill: number;
}
const TITLES: PersonaTitle[] = [
  { title: 'Former Regional Champion', skill: 70 },
  { title: 'National Qualifier', skill: 60 },
  { title: 'Locals Legend', skill: 45 },
  { title: 'Seasoned Veteran', skill: 35 },
  { title: 'Tournament Regular', skill: 15 },
  { title: 'Rogue Specialist', skill: 20 },
  { title: 'Deck Tinkerer', skill: 0 },
  { title: 'Weekend Duelist', skill: -10 },
  { title: 'Rising Rookie', skill: -20 },
  { title: 'First Event Jitters', skill: -40 },
];

export interface PersonaRng {
  next(): number;
}

export function pick<T>(arr: readonly T[], rng: PersonaRng): T {
  return arr[Math.floor(rng.next() * arr.length) % arr.length];
}

export function personaName(rng: PersonaRng, used: Set<string>): string {
  for (let tries = 0; tries < 200; tries++) {
    const r = rng.next();
    const name = r < 0.12 ? pick(HANDLES, rng) : `${pick(FIRST, rng)} ${pick(LAST, rng)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const n = `Duelist #${used.size + 1}`;
  used.add(n);
  return n;
}

export function personaTitle(rng: PersonaRng): PersonaTitle {
  return pick(TITLES, rng);
}

export function difficultyFor(mix: Difficulty | 'mixed', rng: PersonaRng, skill: number): Difficulty {
  if (mix !== 'mixed') return mix;
  // Skilled personas tend to play harder AI.
  const r = rng.next() + skill / 200;
  return r > 0.8 ? 'hard' : r > 0.3 ? 'normal' : 'easy';
}

/** Quick persona for one-off duels. */
export function randomPersona(rng: PersonaRng = { next: Math.random }) {
  return { name: personaName(rng, new Set()), title: personaTitle(rng).title };
}

/** Simple seeded RNG for tournament generation. */
export class Mulberry {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
