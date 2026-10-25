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
  /** Set on real decklists that placed at a tournament of the era. */
  event?: {
    /** e.g. "Shonen Jump Championship Edison" */
    name: string;
    /** ISO date, e.g. "2010-04-17" ("2010-05" when the source gives only the month) */
    date: string;
    /** e.g. "1st", "Top 4", "Top 8" */
    place: string;
    pilot?: string;
  };
}
