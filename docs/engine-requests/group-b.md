# Engine requests: archetype group B (Blackwings, X-Sabers, Gladiator Beasts)

None of these block the decks. Each section gives the workaround that is in place now.

## 1. Optional "When ..." battle-destroy triggers always miss timing (bug)

`Game.damageStep()` destroys the losing monsters (batch N), then calls `beginBatch()` and emits
`damageStepEnd` (batch N+1) **before** `processTriggers`. `buildTriggerChain` drops every
`when: true` trigger whose `event.batch !== lastBatch`. So "When this card destroys a monster by
battle" triggers never activate. This affects core `Goyo Guardian` (`when: true`).

Proposed diff (game.ts, end of `damageStep`):

```ts
      await this.ruleCleanup();
+     // Battle-destroy triggers must be collected before the step ends, or "When..." ones miss timing.
+     await this.processTriggers(false);
    }
    this.beginBatch();
    this.emit({ type: 'damageStepEnd', card: attacker, other: target ?? undefined, player: p });
```

(An alternative is to emit `damageStepEnd` with `minor: true`, but then it would not open a response window.)

Workaround: Shura and Uruz leave out `when: true`, so they cannot miss timing.

## 2. "You can Normal Summon this card without Tributing" (Blackwing - Elphin the Raven)

`tributesNeeded()` only reads `card.flags.noTribute`, and nothing refreshes that flag while the card is
in the hand. Proposed: a card QueryKey `'noTributeSummon'`, which a continuous effect with `range: ['hand']` can set:

```ts
  tributesNeeded(card: CardInstance): number {
    const lv = card.data.level ?? 0;
-   if (card.flags.noTribute) return 0;
+   if (card.flags.noTribute || this.queryCard(card, 'noTributeSummon')) return 0;
```

(`collectMods` must then also consider sources in the hand, which it already does when `range` includes `'hand'`.)

Workaround: Elphin has a hand-range continuous effect on the player query `cannotNormalSummon`. Its filter
refreshes `flags.noTribute` and always returns false. `canNormalSummon` queries that key before
`tributesNeeded`, so the flag is current whenever the engine needs it.

## 3. One-shot "the next battle damage you take this turn becomes 0" (Blackwing - Mistral the Silver Shield)

Proposed: a player mod `'nextBattleDamageZero'` that `damageStep` consumes, meaning it removes the mod
the first time it blocks damage:

```ts
const zeroIdx = this.playerMods.findIndex((m) => m.player === dmg.player && m.q === 'nextBattleDamageZero');
if (zeroIdx >= 0) { this.playerMods.splice(zeroIdx, 1); blocked = true; }
```

Workaround: Mistral gives `noBattleDamage` for the rest of the turn, which is slightly stronger than the real card.

## 4. Passive event hooks (no chain link)

Some cards must remember a past event without starting a chain:
- "Special Summoned by the effect of a Gladiator Beast" (Laquari, Hoplomus, Andal)
- "sent from the field to the GY this turn" (XX-Saber Darksoul)

Proposed: `EffectDef.kind = 'listener'`, with `event` and `onEvent(ctx, ev)` called synchronously from
`collectTriggers`.

Workaround: a `trigger` effect whose `eventFilter` writes `card.flags` and always returns `false`.
It never creates a pending trigger.

## 5. `Ctx.specialSummon` cannot set `reasonCard`

Test Tiger must Special Summon "by the effect of" the Gladiator Beast it returned, so the new monster's
"if Special Summoned by a Gladiator Beast" effect applies. `Ctx.specialSummon` always passes
`reasonCard: this.self`. Proposed: add `reasonCard?: CardInstance` to its `opts` type, since the spread
already lets it override the default.

Workaround: Test Tiger calls `ctx.game.specialSummon(cards, ctx.player, { reasonCard })` directly.

## 6. "Only this monster can attack this turn" (Blackwing - Sirocco the Dawn)

Workaround: every other monster you control gets `flags.cannotAttackTurn = turn`. Monsters summoned
after the effect resolves are not restricted. Proposed: a player mod `'onlyAttacker'` whose value is
the uid of the monster allowed to attack, checked in `canAttack`.
