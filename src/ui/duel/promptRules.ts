// "Smart" response prompts: which quiet moments are worth stopping the duel for.
//
// Chains, attacks, the Damage Step and summon negation always ask. The quiet phase windows
// (Draw, Standby, End) used to ask only for a Set card the AI itself would play, so a human could never use a Quick-Play
// from the hand in their own Standby Phase (Enemy Controller, Book of Moon...) or a Set Book of Moon, Phoenix Wing Wind
// Blast or Emergency Teleport in the opponent's Standby / End Phase. A real trick is offered now, at the moments
// players actually use them, without asking every Draw Phase for a card held all game:
//  - your own turn: the Standby Phase (Quick-Plays in hand, Set cards, quick effects);
//  - the opponent's turn: their Standby Phase and End Phase (Set cards and quick effects; hand Quick-Plays cannot be
//    used on their turn anyway);
//  - right after the opponent summons: Set cards that flip, take or bounce a monster (Book of Moon, Enemy Controller,
//    Phoenix Wing Wind Blast...), so a just-summoned monster can be answered before it acts.
// DOM-free: scripts/prompt-test.ts checks it.
import type { Activation, ResponseRequest, WindowKind } from '../../engine/controller';
import type { Game } from '../../engine/game';
import type { PlayerId } from '../../engine/types';

/** Effect categories that answer a monster on the field ('destroy' is left out: Spell/Trap removal like MST uses it too). */
const MONSTER_ANSWERS = new Set(['position', 'control', 'toDeck', 'toHand', 'banish']);

/** A playable trick in this window that a player would want to be asked about (see the file comment). */
export function smartTrick(game: Game, p: PlayerId, kind: WindowKind, o: Activation): boolean {
  const c = o.card;
  const myTurn = game.turnPlayer === p;
  const handQuickPlay = c.location === 'hand' && c.isSpell && c.data.stype === 'quickplay';
  const setCard = c.onField && !c.faceUp && (c.isTrap || c.data.stype === 'quickplay');
  const quickEffect = o.effect.kind === 'quick';
  if (kind === 'phase') {
    const moment = myTurn ? game.phase === 'standby' : game.phase === 'standby' || game.phase === 'end';
    if (!moment) return false;
    return handQuickPlay || setCard || quickEffect;
  }
  // after a summon the engine opens a 'priority' window (turn player first) or a plain 'response' one
  if ((kind === 'response' || kind === 'priority') && !myTurn) {
    const last = game.recentEvents[game.recentEvents.length - 1];
    const summon = last?.type === 'summoned' || last?.type === 'specialSummoned' || last?.type === 'normalSummoned' || last?.type === 'flipSummoned';
    return summon && setCard && (o.effect.categories ?? []).some((k) => MONSTER_ANSWERS.has(k));
  }
  return false;
}

/** Whether "Smart" prompts stop the duel to ask `p` about this response window (`aiScore`: the AI's score for an option). */
export function smartPrompt(game: Game, p: PlayerId, req: ResponseRequest, aiScore: (o: Activation) => number): boolean {
  if (!req.options.length) return false;
  if (req.kind === 'chain' || req.kind === 'attack' || req.kind === 'damage' || req.kind === 'summonNegation') return true;
  // priority after your own summon: always ask when the monster you just summoned has an effect to use
  if (req.kind === 'priority' && req.options.some((o) => o.effect.kind === 'ignition' && o.card.controller === p && o.card.location === 'mzone')) return true;
  return req.options.some((o) => {
    if (o.event) return true;
    const c = o.card;
    const setCard = c.onField && !c.faceUp && (c.isTrap || c.data.stype === 'quickplay');
    if (setCard && aiScore(o) > 0) return true;
    return smartTrick(game, p, req.kind, o);
  });
}
