# Engine requests from `src/cards/sets/traps.ts`

Each item lists what is missing, why, the workaround currently used in `traps.ts`, and a proposed change.
None of these block the cards; they would make the scripts exact and remove hacks.

## 1. End the Battle Phase (Negate Attack)
*Why:* Negate Attack negates the attack **and ends the Battle Phase**. No API exists.
*Workaround:* `ctx.addPlayerMod(ctx.opp, 'cannotDeclareAttack')` for the rest of the turn.
*Proposal:* `Game.endBattlePhase()` sets `this.turnData.endBattle = true`; in `battlePhase()` loop:
```ts
for (;;) {
  if (this.over || this.turnData.endBattle) break;
```
plus `Ctx.endBattlePhase()` wrapper.

## 2. Redirect battle damage (Dimension Wall)
*Why:* "Battle damage you would take from this battle is inflicted to your opponent instead."
*Workaround:* `patchGame()` in traps.ts wraps the game instance's `damage()` once and checks a
`__reflect: PlayerId[]` property stored on the current `BattleState`.
*Proposal:* add `reflect?: PlayerId[]` to `BattleState`; in `damageStep()` before calling `damage()`:
```ts
if (b.reflect?.includes(dmg.player)) dmg = { player: this.opp(dmg.player), amount: dmg.amount };
```

## 3. LP gain becomes damage (Bad Reaction to Simochi)
*Why:* no hook in `recover()`.
*Workaround:* same `patchGame()` wrapper around `recover()` (looks for a face-up, active, non-negated
Bad Reaction to Simochi controlled by the other player).
*Proposal:* player QueryKey `'lpGainIsDamage'`; in `recover()`:
```ts
if (this.queryPlayer(p, 'lpGainIsDamage')) return void (await this.damage(p, amount, 'effect', source));
```

## 4. Token effects (Ojama Token: "when destroyed, its controller takes 300 damage")
*Why:* tokens move to location `'none'` when they leave the field and `collectTriggers()` skips
cards in `'none'`, so a token can't carry its own "when destroyed" trigger.
*Workaround:* the damage trigger lives on the Ojama Trio card (range grave/banished/hand/deck/szone)
and a WeakMap maps tokens → their Ojama Trio; it charges every destroyed, not-yet-charged token.
*Proposal:* in `collectTriggers()` allow `card.location === 'none'` when `card.isToken && ev.card === card`
(i.e. let a token react to its own leave-field events).

## 5. Skip Draw Phase (Reckless Greed, Time Seal)
*Workaround:* `addDelayed('draw', …)` on the right future turn pushes a `cannotDraw` player mod before
the draw and removes it at that turn's Standby Phase (draws during that Draw Phase by effects are also
blocked — negligible).
*Proposal:* `players[p].skipDraws: number`; in `playTurn()`:
```ts
if (this.players[tp].skipDraws > 0) { this.players[tp].skipDraws--; this.log(`${name} skips the Draw Phase.`); }
else if (!(this.turn === 1 && this.options.skipFirstDraw)) { … draw … }
```

## 6. Normal Summon from an effect / outside the Main Phase (Ultimate Offering)
*Why:* Ultimate Offering also works during the opponent's Battle Phase and summons immediately.
Calling `normalSummon()` from inside a resolving chain is unsafe (it opens a summon-negation window
and runs `resolveChain()` re-entrantly).
*Workaround:* the effect is an ignition effect (your Main Phase only) that grants +1 Normal Summon.
*Proposal:* `Game.afterChain(fn)` queue run by `resolveChain()` once the chain is empty, so an effect can
schedule `normalSummon(p, card, set)` right after resolution, in any phase.

## 7. Continuous 'negated' mods ignore the source's own negation
*Why:* `sourceActive()` skips `isNegated(src)` when `q === 'negated'` (recursion guard), so Royal Decree /
Trap Stun can't switch off Skill Drain, Imperial Order or another Royal Decree.
*Workaround:* those cards use `active: selfNotNegated` with a module-level recursion guard.
*Proposal:* track a per-source "currently evaluating" set inside `collectMods()` instead of skipping the check.

## 8. "Negate all Trap effects this turn" (Trap Stun)
*Why:* real Trap Stun lets traps be activated but negates their effects; we have no player/global
"traps resolve negated" query.
*Workaround:* `cannotActivateTraps` for both players this turn + `negated` temp mods on face-up traps.
*Proposal:* global/player QueryKey `'trapEffectsNegated'` checked in `resolveLink()` and `isNegated()`.

## 9. Macro Cosmos banishes itself
*Why:* `rawMove()` queries `banishInsteadOfGrave` before detaching the moving card, so a destroyed
Macro Cosmos (or anything granting that mod) still applies to itself and is banished.
*Proposal:* in `rawMove()`, compute `banishInsteadOfGrave` while ignoring `card` itself as a mod source
(e.g. temporarily set a flag the source check honours).
