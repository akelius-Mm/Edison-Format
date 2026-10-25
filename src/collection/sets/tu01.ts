// Turbo Pack: Booster One (TU01) — English TCG printing.
// Card list and per-card rarities: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON,
// generated from Yugipedia "Set Card Lists"), TU01-EN list. Every printed card is listed
// with every rarity it was printed in; src/collection/index.ts keeps only cards that exist in
// the simulator's pool (findCard), so newly scripted cards join the set automatically.
// Release date: TCG (Europe) release per YGOJSON; the North American date is within days.
// At generation time 15 of 21 printed cards were playable.
import type { EraSetData } from '../types';

export const TU01: EraSetData = {
  code: 'TU01',
  name: "Turbo Pack: Booster One",
  format: 'turbo',
  released: '2009-09-12',
  colors: ['#5a3a12', '#f0b860'],
  featured: "Judgment Dragon",
  cards: [
    ["Judgment Dragon", "UtR"],
    ["Doomcaliber Knight", "UR"],
    ["Garoth, Lightsworn Warrior", "SR"],
    ["Krebons", "SR"],
    ["Gladiator Beast Samnite", "SR"],
    ["Black Whirlwind", "SR"],
    ["Crush Card Virus", "R"],
    ["Satellite Cannon", "R"],
    ["Rescue Cat", "R"],
    ["Grandmaster of the Six Samurai", "R"],
    ["Trade-In", "R"],
    ["Armageddon Knight", "R"],
    ["Book of Moon", "C"],
    ["Terraforming", "C"],
    ["Hand Destruction", "C"],
    ["Gladiator Beast Murmillo", "C"],
    ["Gladiator Beast Bestiari", "C"],
    ["Gladiator Beast Laquari", "C"],
    ["Golden Flying Fish", "C"],
    ["Ryko, Lightsworn Hunter", "C"],
    ["D.D.R. - Different Dimension Reincarnation", "C"],
  ],
};
