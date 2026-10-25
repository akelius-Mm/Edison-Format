// Turbo Pack: Booster Two (TU02) — English TCG printing.
// Card list and per-card rarities: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON,
// generated from Yugipedia "Set Card Lists"), TU02-EN list. Every printed card is listed
// with every rarity it was printed in; src/collection/index.ts keeps only cards that exist in
// the simulator's pool (findCard), so newly scripted cards join the set automatically.
// Release date: TCG (Europe) release per YGOJSON; the North American date is within days.
// At generation time 4 of 21 printed cards were playable.
import type { EraSetData } from '../types';

export const TU02: EraSetData = {
  code: 'TU02',
  name: "Turbo Pack: Booster Two",
  format: 'turbo',
  released: '2010-01-22',
  colors: ['#4a2a12', '#e8a050'],
  featured: "Gladiator Beast Heraklinos",
  cards: [
    ["Gladiator Beast Heraklinos", "UtR"],
    ["Chaos Sorcerer", "UR"],
    ["Gravekeeper's Assailant", "SR"],
    ["Magical Dimension", "SR"],
    ["Foolish Burial", "SR"],
    ["Beckoning Light", "SR"],
    ["Gravekeeper's Spear Soldier", "R"],
    ["My Body as a Shield", "R"],
    ["Magical Stone Excavation", "R"],
    ["Mist Archfiend", "R"],
    ["Light-Imprisoning Mirror", "R"],
    ["Shadow-Imprisoning Mirror", "R"],
    ["Anti-Spell Fragrance", "C"],
    ["Gravekeeper's Cannonholder", "C"],
    ["Necrovalley", "C"],
    ["Autonomous Action Unit", "C"],
    ["Anti-Spell", "C"],
    ["Reflect Bounder", "C"],
    ["Mausoleum of the Emperor", "C"],
    ["Gravekeeper's Commandant", "C"],
    ["Iron Core of Koa'ki Meiru", "C"],
  ],
};
