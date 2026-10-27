// Necrovalley, shared by "Necrovalley" and "Gravekeeper's Priestess" (while there is no face-up Field Spell, the field
// is treated as "Necrovalley"). 2010 US text (https://edisonrul.ing/cards/n/necrovalley.html, historical section):
// "Negate the effects of Spells, Traps, and Effect Monsters that target a card(s) in either player's Graveyard. Cards in
// either player's Graveyard cannot be removed from play. All "Gravekeeper's" monsters gain 500 ATK and DEF."
//
//  - 'cannotBanishFromGY': GY-banish costs are not offered (gy-costs.ts) and Game.banish leaves GY cards where they are
//    ("Cards / Effects that remove from play cards in the Graveyard for cost / effect cannot activate").
//  - 'gyLock' + `necrovalleyNegates`: only an effect that TARGETS a card in a GY is negated. Effects that move cards out
//    of the GY without targeting (Rekindling, Drill Warrior, Red-Eyes Darkness Metal Dragon), and cards that move
//    themselves from the GY (Treeborn Frog, Plaguespreader Zombie, Il Blud, Vampire Lord...), are not negated; Type /
//    Attribute changes that do not target (Zombie World) still apply in the GY.
import type { Ctx } from '../engine/ctx';
import type { ChainLink } from '../engine/game';
import type { GameEvent } from '../engine/types';

/** Called from a 'chainActivated' trigger's eventFilter while the source applies: negates the new link if it targets a GY card. */
export function necrovalleyNegates(ctx: Ctx, ev: GameEvent, sourceName = 'Necrovalley') {
  const link = ev.data?.link as ChainLink | undefined;
  if (!link || link.negated || link.card.data.ignoresGyLock) return;
  if (link.ctx.targets.some((c) => c.location === 'grave')) {
    ctx.game.log(`${sourceName} negates ${link.card.name}.`, 'action', ctx.player);
    ctx.game.negateLink(link, false, ctx.self);
  }
}
