// Turbo Pack: Booster Three (TU03) — English TCG printing.
// Card list and per-card rarities: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON,
// generated from Yugipedia "Set Card Lists"), TU03-EN list. Every printed card is listed
// with every rarity it was printed in; src/collection/index.ts keeps only cards that exist in
// the simulator's pool (findCard), so newly scripted cards join the set automatically.
// Release date: TCG (Europe) release per YGOJSON; the North American date is within days.
// At generation time 11 of 21 printed cards were playable.
import type { EraSetData } from '../types';

export const TU03: EraSetData = {
  code: 'TU03',
  name: "Turbo Pack: Booster Three",
  format: 'turbo',
  released: '2010-07-22',
  colors: ['#5a2a1a', '#f09060'],
  featured: "Caius the Shadow Monarch",
  cards: [
    ["Caius the Shadow Monarch", "UtR"],
    ["Dark Grepher", "UR"],
    ["Rescue Cat", "SR"],
    ["Morphtronic Celfon", "SR"],
    ["Rekindling", "SR"],
    ["Treacherous Trap Hole", "SR"],
    ["Gladiator Beast Retiari", "R"],
    ["XX-Saber Faultroll", "R"],
    ["XX-Saber Ragigura", "R"],
    ["Magical Android", "R"],
    ["Dark Eruption", "R"],
    ["Saber Slash", "R"],
    ["Destiny HERO - Diamond Dude", "C"],
    ["D.D. Crow", "C"],
    ["Superancient Deepsea King Coelacanth", "C"],
    ["Koa'ki Meiru Drago", "C"],
    ["Kycoo the Ghost Destroyer", "C"],
    ["Nobleman of Crossout", "C"],
    ["Cloak and Dagger", "C"],
    ["Gladiator Beast War Chariot", "C"],
    ["Pollinosis", "C"],
  ],
};
