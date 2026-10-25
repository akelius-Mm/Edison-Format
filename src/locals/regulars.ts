// Recurring characters of the local scene: same names, same decks, every Friday.
import type { Difficulty } from '../ai/ai';
import type { MetaKey } from './types';

export interface Regular {
  id: string;
  name: string;
  title: string;
  meta: MetaKey;
  skill: number;
  difficulty: Difficulty;
  avatar: string;
  /** How often they show up (0..1). */
  attendance: number;
  blurb: string;
}

export const REGULARS: Regular[] = [
  {
    id: 'marcus',
    name: 'Marcus Vell',
    title: 'Store champion',
    meta: 'blackwings',
    skill: 60,
    difficulty: 'hard',
    avatar: 'avatar-3',
    attendance: 0.9,
    blurb: 'Plays Blackwings every week and knows every Icarus Attack line.',
  },
  {
    id: 'priya',
    name: 'Priya Raman',
    title: 'Regional top 8',
    meta: 'plants',
    skill: 55,
    difficulty: 'hard',
    avatar: 'avatar-7',
    attendance: 0.85,
    blurb: 'Matte black sleeves. Has never missed a Dandylion trigger.',
  },
  {
    id: 'dave',
    name: 'Big Dave Okafor',
    title: 'Binder guy',
    meta: 'monarchs',
    skill: 20,
    difficulty: 'normal',
    avatar: 'avatar-2',
    attendance: 0.8,
    blurb: 'Frog Monarchs and a trade binder the size of a phone book.',
  },
  {
    id: 'theo',
    name: 'Theo Lindqvist',
    title: 'Lightsworn loyalist',
    meta: 'lightsworn',
    skill: 30,
    difficulty: 'normal',
    avatar: 'avatar-5',
    attendance: 0.75,
    blurb: 'Mills three, hopes for Judgment Dragon, smiles either way.',
  },
  {
    id: 'nadia',
    name: 'Nadia Castillo',
    title: 'Tag-out specialist',
    meta: 'gladiators',
    skill: 45,
    difficulty: 'hard',
    avatar: 'avatar-9',
    attendance: 0.7,
    blurb: 'Tags out at the end of every Battle Phase. Every single one.',
  },
  {
    id: 'kenji',
    name: 'Kenji Mori',
    title: 'Zombie diehard',
    meta: 'zombies',
    skill: 15,
    difficulty: 'normal',
    avatar: 'avatar-4',
    attendance: 0.7,
    blurb: 'Has played Zombies since Goblin Zombie was at three.',
  },
  {
    id: 'jonah',
    name: 'Jonah Weber',
    title: 'Saber believer',
    meta: 'xsabers',
    skill: 25,
    difficulty: 'normal',
    avatar: 'avatar-11',
    attendance: 0.6,
    blurb: 'Swears X-Sabers are tier one. Some weeks he is right.',
  },
  {
    id: 'felix',
    name: 'Felix Brandt',
    title: 'Fifteen and fearless',
    meta: 'herobeat',
    skill: -5,
    difficulty: 'easy',
    avatar: 'avatar-6',
    attendance: 0.65,
    blurb: 'Hero Beat, a fresh box of sleeves, and he never scoops.',
  },
  {
    id: 'gus',
    name: 'Gus Holloway',
    title: 'Rogue of the week',
    meta: 'rogue',
    skill: 10,
    difficulty: 'normal',
    avatar: 'avatar-12',
    attendance: 0.6,
    blurb: 'Brings a different rogue deck every Friday. Usually goes 2-2.',
  },
];

export const regularById = (id: string | undefined) => (id ? REGULARS.find((r) => r.id === id) : undefined);
