export interface DeckDef {
  id: string;
  name: string;
  /** Archetype / strategy label shown in menus. */
  archetype: string;
  description: string;
  /** 1 = top tier ... 3 = rogue. Used by tournament seeding & simulated results. */
  tier: 1 | 2 | 3;
  /** Accent colour for deck boxes / UI. */
  color: string;
  /** [card name, copies] */
  main: [string, number][];
  extra: [string, number][];
  /** Optional side deck. */
  side?: [string, number][];
}
