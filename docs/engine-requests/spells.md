# Engine requests from `spells.ts`

Each request below already has a workaround in `src/cards/sets/spells.ts`. None of them blocks a card.

## 1. Opponent's monsters as Tribute Summon fodder (Soul Exchange)

**Why:** `Game.tributeCandidates(p)` only returns monsters that `p` controls. Soul Exchange lets you Tribute 1 opponent's monster for a Tribute Summon this turn.

**Workaround:** on resolution, the script marks the target (`flags.soulExchangeFor/soulExchangeTurn`). It also replaces `tributeCandidates` on that one `Game` instance (`ensureSoulExchangePatch`) so marked monsters are included. Nothing on the prototype changes.

**Proposed diff (game.ts):**
```ts
tributeCandidates(p: PlayerId, forCard?: CardInstance) {
  const own = this.monsters(p).filter((c) => !this.queryCard(c, 'cannotBeTributed') && !c.flags.noTributeSummonFodder);
  const lent = this.monsters(this.opp(p)).filter(
    (c) => c.flags.tributableBy === p && c.flags.tributableTurn === this.turn && !this.queryCard(c, 'cannotBeTributed'),
  );
  return [...own, ...lent];
}
```
After this change, Soul Exchange would set `tributableBy`/`tributableTurn` and drop the patch. The AI's `scoreSummon` should also treat the opponent's monsters as a gain, not a loss, when it ranks Tributes.

## 2. "Cannot Set Spell/Trap cards" (Cold Wave)

**Why:** `cannotSet` also blocks Setting monsters. Cold Wave only stops Spells and Traps from being activated or Set.

**Workaround:** Cold Wave only applies `cannotActivateSpells` and `cannotActivateTraps` to both players until the end of the next turn. Players can still Set Spells and Traps, but cannot activate them.

**Proposed:** add a player `QueryKey` `'cannotSetST'`. Check it in `legalMainActions` (the `setST` action) next to `cannotSet`.

## 3. Summon negation for Fusion Summons made by card effects

**Why:** `ctx.specialSummon(..., { method: 'fusion' })` has no summon-negation window. Solemn Judgment and Horn of Heaven therefore cannot negate a Polymerization, Miracle Fusion or Overload Fusion summon, even though they can under the real rules. Calling `inherentSpecialSummon` during chain resolution is not safe, because `summonNegationWindow` resolves a nested chain on top of the chain that is still resolving.

**Proposed:** let `specialSummon` accept `negatable: true`. It would queue the summon in a negation window that opens after the current chain link finishes resolving. That window could use a separate `chain` stack, or run straight after `resolveLink`.

## 4. Non-chain "rule" effects for lingering cards

**Why:** these effects are not activated effects, but the scripts model them as mandatory `trigger` effects:
- the Swords of Revealing Light turn counter and its self-destruction;
- Level Limit - Area B re-applying Defense Position after summons and position changes;
- Messenger of Peace maintenance;
- Snatch Steal returning control when it leaves the field.

Each of these starts a chain link that players can respond to, and it adds log lines.

**Proposed:** an `EffectDef` kind such as `'rule'`, with `event` + `eventFilter` + `resolve`. `collectTriggers` would run it straight after the event batch (in `processTriggers`, before `buildTriggerChain`), without making a chain link. A state-based `onUpdate(ctx)` hook would also suit Level Limit.

## 5. Minor

- `Premature Burial` / `Future Fusion` use `game.link(monster, spell, false)`, so the monster is destroyed when the Spell leaves the field for any reason. The real cards only do this when the Spell is *destroyed*. Bouncing the Spell is rare, so this approximation is acceptable. A `linkOnlyOnDestroy` flag in `ruleCleanup` would make it exact.
- Normal Spells that stay on the field (Swords of Revealing Light) set `flags.staysOnField` **and** `activeOnField = true` at resolution, so their `continuous` mods apply. It may be worth documenting this in CARD_SCRIPTING.md.
