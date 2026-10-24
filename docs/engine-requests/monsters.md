# Engine requests from `src/cards/sets/monsters.ts`

Each item lists what is missing, why, a proposed change, and the workaround currently in the script.

## 1. `when: true` triggers on battle destruction always miss timing
`damageStep()` emits `damageStepEnd` (non-minor, new batch) **before** `processTriggers`, so any
optional "When ... you can" trigger on `battleDestroyed`/`sentToGrave` from battle has
`event.batch !== lastBatch` and is skipped (this also affects core's Goyo Guardian).
**Proposed:** emit `damageStepEnd` with `minor: true`, or run `processTriggers` once before emitting it.
```diff
-    this.beginBatch();
-    this.emit({ type: 'damageStepEnd', card: attacker, other: target ?? undefined, player: p });
+    this.beginBatch();
+    this.emit({ type: 'damageStepEnd', card: attacker, other: target ?? undefined, player: p, minor: true });
```
(`minor` events still collect triggers, so DD Warrior Lady / Big Shield Gardna keep working.)
**Workaround:** battle-destruction triggers in monsters.ts (recruiters, Behemoth…) omit `when`.

## 2. Per-card "cannot be Special Summoned" (Spirits, Victory Dragon)
No card-level query. **Proposed:** `CardData.cannotSpecialSummon?: boolean`, checked in
`Game.specialSummon`/`inherentSpecialSummon` and `Ctx.canSummonCard`.
**Workaround:** `nomi: true` (blocks revival and summons from hand/Deck via `canSummonCard`).

## 3. Tribute requirements (Totem Dragon, Victory Dragon)
`CardData.doubleTribute` is declared but never read; there is no way to require specific tributes.
**Proposed:** in `normalSummon`/`canNormalSummon`, count a monster with `doubleTribute` as 2 when the
summoned monster passes an optional `CardData.doubleTributeFor?(c)` filter; add
`CardData.tributeReq?: { count: number; filter?: (c) => boolean }` overriding the level rule.
**Workaround:** Totem Dragon's double-tribute is not applied; Victory Dragon uses the normal 2-tribute rule.

## 4. Face-down monster effects (Big Shield Gardna)
`collectTriggers` skips face-down monsters except for `flipped`, so "while face-down, when targeted
by a Spell: flip it face-up and negate" cannot be scripted.
**Proposed:** `EffectDef.faceDownOk?: boolean` honoured by `collectTriggers`/`buildTriggerChain`.
**Workaround:** only the "change to Attack Position after being attacked" effect is implemented.

## 5. `targeted` / `chainResolved` events are declared but never emitted
Needed for Spirit Reaper ("destroy it after the effect that targeted it resolves") and Cyber Phoenix.
**Proposed:** emit `targeted` (card = target, other = source) from `Ctx.addTargets`, and
`chainResolved` (data.link) after each `resolveLink`.
**Workaround:** both cards hook `chainActivated` (eventFilter side effect). Spirit Reaper wraps the
targeting link's `effect.resolve` to destroy itself afterwards; Cyber Phoenix calls `negateLink`.

## 6. Trap activation from the hand (Makyura the Destructor)
**Proposed:** in `canActivateEffect`, allow a trap in `hand` when
`this.turnData['trapsFromHand:' + player]` is true (needs a free S/T zone, placed like a spell).
**Workaround:** Makyura's trigger already sets `turnData['trapsFromHand:<player>'] = true`; no effect until the engine reads it.

## 7. "Cannot banish cards from the GY" (Kycoo the Ghost Destroyer)
**Proposed:** player query key `cannotBanishFromGrave`, checked in `Game.banish` for cards in `grave`
(costs included) and in proc conditions using GY banish (Chaos Sorcerer, DAD…).
**Workaround:** only Kycoo's battle-damage banish effect is implemented.

## 8. "Cannot attack directly" (Magical Scientist)
**Proposed:** card query key `cannotDirectAttack`, checked in `attackTargets` (`direct = false`).
**Workaround:** not enforced.

## 9. Start of the Damage Step / ending the Battle Phase
* No event at the start of the Damage Step (Neo-Spacian Grand Mole, Mystic Swordsman LV2).
  **Workaround:** Grand Mole is a Damage-Step quick effect before damage calculation; Mystic
  Swordsman destroys the face-down target on attack declaration and negates the attack.
* No "end the Battle Phase" helper (Battle Fader, Cyber Valley).
  **Proposed:** `Game.endBattlePhase()` setting a flag the `battlePhase()` loop checks.
  **Workaround:** negate the attack + `cannotDeclareAttack` on the turn player for the turn.

## 10. Banisher of the Radiance sends itself to the banished zone
`banishInsteadOfGrave` is evaluated in `rawMove` before the card is detached, so Banisher is
banished when it leaves the field. Officially it goes to the GY. **Proposed:** in `rawMove`,
evaluate the query after `detach` (or exclude the moving card as a source). Low priority.

## 11. Replacement "destroyed by battle → banished" (Dark Magician of Chaos)
**Workaround:** the monster goes to the GY (triggers fire) and is then banished by a mandatory trigger.
**Proposed:** card query `banishBattleVictims` checked in `damageStep()` when moving losers.
