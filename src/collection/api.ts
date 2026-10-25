// Contract between game modes (duels, tournaments, Locals Night, draft) and the collection.
// Modes call grantPrize(); the collection module registers the handler that stores it.

export interface PrizeGrant {
  /** Number of booster packs awarded. */
  packs?: number;
  /** Set code for the packs (e.g. "TSHD"); omitted = the collection picks a current set. */
  set?: string;
  /** Duel Points (the in-app currency). */
  coins?: number;
  /** Shown to the player, e.g. "Locals Night · 1st place". */
  reason: string;
}

type Handler = (g: PrizeGrant) => void;
let handler: Handler | null = null;
const QUEUE_KEY = 'edison.pendingPrizes.v1';

/** Award packs and/or coins. Safe to call before the collection module has loaded. */
export function grantPrize(g: PrizeGrant) {
  if (handler) return handler(g);
  try {
    const q: PrizeGrant[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    q.push(g);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable: the prize is lost, play continues */
  }
}

/** Called once by the collection module; delivers any prizes queued before it loaded. */
export function registerPrizeHandler(h: Handler) {
  handler = h;
  try {
    const q: PrizeGrant[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    localStorage.removeItem(QUEUE_KEY);
    for (const g of q) h(g);
  } catch {
    /* ignore */
  }
}
