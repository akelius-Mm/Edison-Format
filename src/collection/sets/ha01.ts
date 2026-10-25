// Hidden Arsenal (HA01) — English TCG printing.
// Card list and per-card rarities: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON,
// generated from Yugipedia "Set Card Lists"), HA01-EN list. Every printed card is listed
// with every rarity it was printed in; src/collection/index.ts keeps only cards that exist in
// the simulator's pool (findCard), so newly scripted cards join the set automatically.
// Release date: TCG (Europe) release per YGOJSON; the North American date is within days.
// At generation time 5 of 30 printed cards were playable.
import type { EraSetData } from '../types';

export const HA01: EraSetData = {
  code: 'HA01',
  name: "Hidden Arsenal",
  format: 'hidden-arsenal',
  released: '2009-11-05',
  colors: ['#2a2d33', '#c8ccd4'],
  featured: "Brionac, Dragon of the Ice Barrier",
  cards: [
    ["Blizzed, Defender of the Ice Barrier", "ScR"],
    ["Blizzard Warrior", "SR"],
    ["Cryomancer of the Ice Barrier", "ScR"],
    ["Mist Valley Thunderbird", "ScR"],
    ["Mist Valley Shaman", "ScR"],
    ["Mist Valley Soldier", "ScR"],
    ["Flamvell Dragnov", "SR"],
    ["Flamvell Magician", "SR"],
    ["Flamvell Guard", "SR"],
    ["X-Saber Axel", "SR"],
    ["X-Saber Airbellum", "ScR"],
    ["X-Saber Uruz", "SR"],
    ["Commander Gottoms, Swordmaster", "ScR"],
    ["Ally of Justice Clausolas", "SR"],
    ["Ally of Justice Garadholg", "SR"],
    ["Ally of Justice Rudra", "SR"],
    ["Worm Apocalypse", "SR"],
    ["Worm Barses", "SR"],
    ["Worm Cartaros", "SR"],
    ["Worm Dimikles", "SR"],
    ["Worm Erokin", "ScR"],
    ["Brionac, Dragon of the Ice Barrier", "ScR"],
    ["Mist Wurm", "ScR"],
    ["Flamvell Uruquizas", "ScR"],
    ["X-Saber Urbellum", "ScR"],
    ["Ally of Justice Catastor", "ScR"],
    ["Wrath of Neos", "ScR"],
    ["Detonate", "SR"],
    ["Berserker Crush", "SR"],
    ["Evolution Burst", "ScR"],
  ],
};
