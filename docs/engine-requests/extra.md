# Engine requests from `extra.ts`

Each request below already has a workaround in `src/cards/sets/extra.ts`. None of them blocks a card.

## 1. "Start of the Damage Step" event (Ally of Justice Catastor, Exploder Dragonwing)

**Why:** Both cards act at the start of the Damage Step, before damage calculation. No event is emitted there.

**Workaround:** each card has a `quick` effect with `damageStep: true`. The condition is `battle.inDamageStep` and "this card is battling". It is used in the existing Damage Step response window. The AI always uses it (score 100 or 90). The opponent can respond as if it were a Quick Effect.

**Proposed diff (`damageStep()`, after the face-down target is flipped):**
```ts
this.beginBatch();
this.emit({ type: 'damageStepStart', card: attacker, other: target ?? undefined, player: p });
await this.processTriggers(false);
if (b.negated || attacker.location !== 'mzone' || (target && target.location !== 'mzone')) { /* abort like below */ }
```
Add `'damageStepStart'` to `EventType`. The two cards would then become mandatory or optional triggers on that event.

## 2. Destruction replacement (Power Tool Dragon, Thousand-Eyes Restrict)

**Why:** "If this card would be destroyed, destroy/send X instead" needs a hook inside `destroy()` and inside battle destruction.

**Workaround:**
- Thousand-Eyes Restrict is `indestructibleBattle` while it has an absorbed monster. A mandatory `damageStepEnd` trigger works out whether it would have lost the battle and then destroys the equipped monster.
- Power Tool Dragon's substitute effect is **not implemented**. Its search effect works.

**Proposed:** add an optional `EffectDef.replaceDestroy?: (ctx, card, reason) => Promise<boolean>` on continuous effects. `Game.destroy` and the battle-destruction code would call it for each card first, and skip any card whose handler returns `true`.

## 3. `properlySummoned` is lost when an Extra Deck monster is revived (Stardust Dragon, Ancient Sacred Wyvern)

**Why:** `rawMove` sets `properlySummoned = keepProper && (dest === 'grave' || dest === 'banished')`. So a Synchro revived by Monster Reborn loses the flag on the field. Once it goes back to the GY, `ctx.canSummonCard` refuses it.

**Workaround:** Stardust's End Phase revival and ASW's self-revival use `ignoreConditions: true`.

**Proposed diff (`rawMove`):** a monster that was properly summoned once keeps the flag:
```ts
card.properlySummoned = keepProper; // instead of keepProper && (dest === 'grave' || dest === 'banished')
```
If the engine still needs to clear it, clear it only when the card returns to the deck, hand or Extra Deck.

## 4. Fusion Summon helper that records materials (Chimeratech Overdragon)

**Why:** `synchroSummon` stores `flags.materials`. Fusion Summons happen through `ctx.specialSummon(..., { method: 'fusion' })`, which takes no extra flags. Overdragon's ATK/DEF and number of attacks depend on how many materials were used.

**Workaround:** `fusionMaterialCount()` reads `flags.materials` if it is set. Otherwise it counts the `usedAsMaterial` events just before the summon in `game.eventLog`. The result is stored once in `flags.overdragonN`, with a minimum of 2.

**Proposed:**
- `specialSummon` opts gets `extraFlags?: Record<string, any>`, applied with `Object.assign(c.flags, extraFlags)` after `rawMove`.
- `Game.fusionSummon(p, fusion, mats)` moves the materials with reason `'fusion'` and sets `flags.materials` like Synchro does.
- `FusionReq` gets `extra?: (c) => boolean` with `maxExtra?`, for "+ 1 or more Machine-Type monsters". Today Overdragon's requirement is `[Cyber Dragon, Machine]`, so it lists the minimum only.

## 5. Non-activated "listener" effects (Nitro Warrior)

**Why:** "If you activate a Spell Card, this card gains 1000 ATK during its next damage calculation" is not an activated effect. It should not start a chain.

**Workaround:** a `trigger` on `cardActivated` whose `eventFilter` records the boost in `flags.nitroCharge` and always returns `false`. A second `eventFilter` on `damageStepEnd` clears the flag. A continuous `atk` mod applies +1000 while the flag is set and the card is in the Damage Step.

**Proposed:** an `EffectDef.kind = 'listener'` with `event` and `onEvent(ctx, ev)`. `collectTriggers` would call it right away instead of adding the effect to `pending`.

## 6. Source-aware targeting protection (Turbo Warrior)

**Why:** "Cannot be targeted by the effects of Level 6 or lower monsters". The `untargetable` query does not know which card is targeting.

**Workaround:** the mod checks the top chain link. While targets are chosen in `activate()`, the activating link is already on the chain. The mod applies when the top link is an opponent's monster of Level 6 or lower.

**Proposed:** `canTarget(c)` passes the source card. For example, `queryCard(c, 'untargetable', { by: this.self })` and `Mod.filter(ctx, subject, extra)`.

## 7. Negating effects of monsters in the GY (Dark Balter the Terrible)

**Why:** "Negate the effects of Effect Monsters destroyed by battle with this card". Their `sentToGrave` triggers are already pending when the card leaves the field. `isNegated()` only applies to cards on the field.

**Workaround:** an `eventFilter` on `battleDestroyed` flags the destroyed card. The `damageStepEnd` filter then removes that card's entries from `game.pending` before the trigger chain is built.

**Proposed:** a `flags.negatedUntilMoveId` honoured by `isNegated` for every location, and checked in `buildTriggerChain`.

## 8. Restrict a second attack to one target (Nitro Warrior)

**Why:** Nitro's second attack must target the monster it changed to Attack Position.

**Workaround:** Nitro gets `extraAttacks +1` for the turn and can attack any target with it.

**Proposed:** support `card.flags.forcedAttackTarget = { uid, moveId, turn }` in `attackTargets()`.
