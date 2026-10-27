// Necrovalley's GY lock, shared by "Necrovalley" and "Gravekeeper's Priestess" (while there is no face-up Field Spell,
// the field is treated as "Necrovalley"). 2010 text: "Cards in the GY cannot be banished. Negate any card effect that
// would move a card in the GY to a different place. Negate any card effect that changes Types or Attributes in the GY."
//
// The lock itself is engine-level, through the player queries the source turns on:
//  - 'cannotBanishFromGY': GY-banish costs are not offered (gy-costs.ts) and Game.banish leaves GY cards where they are;
//  - 'gyLock': Game.moveCards / Game.specialSummon do not move GY cards for a card effect, and Game.cardView does not
//    apply Type changes (Zombie World) in the GY.
// On top of that, `necrovalleyNegates` negates on activation an effect that targets a card in a GY, or that is
// activated in the GY to move the card itself (Plaguespreader Zombie, Wulf...). Treeborn Frog is not negated (2010 TCG
// ruling, CardData.ignoresGyLock).
import type { Ctx } from '../engine/ctx';
import type { ChainLink } from '../engine/game';
import type { GameEvent } from '../engine/types';

/** GY effects that Special Summon or add cards without moving a card that is in the GY. */
const NECROVALLEY_SAFE = ['Dandylion'];

/** Called from a 'chainActivated' trigger's eventFilter while the lock source applies: negates the new link if needed. */
export function necrovalleyNegates(ctx: Ctx, ev: GameEvent, sourceName = 'Necrovalley') {
  const link = ev.data?.link as ChainLink | undefined;
  if (!link || link.negated || link.card.data.ignoresGyLock) return;
  // Searches from the Deck (Sangan) and Dandylion's Tokens do not move a card in the GY, so they are not negated.
  const cats = link.effect.categories ?? [];
  const moves = cats.some((k) => ['specialSummon', 'toHand', 'toDeck', 'banish'].includes(k));
  const targetsGY = link.ctx.targets.some((c) => c.location === 'grave');
  const fromGY = link.fromLocation === 'grave' && link.card.location === 'grave' && moves && !NECROVALLEY_SAFE.includes(link.card.name);
  if (targetsGY || fromGY) {
    ctx.game.log(`${sourceName} negates ${link.card.name}.`, 'action', ctx.player);
    ctx.game.negateLink(link, false, ctx.self);
  }
}
