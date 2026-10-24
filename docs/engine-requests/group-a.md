# Engine requests: archetype group A (Plants, Zombies, Lightsworn)

None of these block the decks. Each item says what the workaround in the card files is now.

## 1. `synchroMaterialCheck` missing from `MonsterOpts` (src/cards/define.ts)
CARD_SCRIPTING.md documents `synchroMaterialCheck`, but `monster()` doesn't accept or forward it.
**Workaround:** `plants.ts` sets it on the returned `CardData`
(`quickdraw.synchroMaterialCheck = …`, `debris.synchroMaterialCheck = …`).
**Proposed diff:**
```diff
 interface MonsterOpts {
   ...
+  synchroMaterialCheck?: CardData['synchroMaterialCheck'];
 }
 ...
     aiValue: o.aiValue,
     setCode: o.setCode,
+    synchroMaterialCheck: o.synchroMaterialCheck,
   });
```

## 2. Per-card Tribute filter (Red-Eyes Zombie Dragon)
"Can only be Tribute Summoned by Tributing Zombie-Type monsters." `Game.tributeCandidates(p, forCard)`
ignores `forCard`. **Workaround:** the restriction isn't enforced.
**Proposed:** add `tributeFilter?: (c: CardInstance) => boolean` to `CardData` and in `tributeCandidates`:
```diff
-    return this.monsters(p).filter((c) => !this.queryCard(c, 'cannotBeTributed') && !c.flags.noTributeSummonFodder);
+    return this.monsters(p).filter((c) => !this.queryCard(c, 'cannotBeTributed') && !c.flags.noTributeSummonFodder && (!forCard?.data.tributeFilter || forCard.data.tributeFilter(c)));
```

## 3. Type-changing query (Zombie World)
"All monsters on the field and in the GYs become Zombie-Type", and "only Zombies can be Tribute Summoned".
There's no `race` QueryKey and the engine reads `c.data.race` directly.
**Workaround:** zombies.ts uses `isZombie(ctx, c)`, which treats field/GY monsters as Zombies while
Zombie World is face-up, for Zombie Master, Mezuki, Book of Life, Il Blud and Doomkaiser's
effect. Synchro material filters (Doomkaiser) and other files' cards don't see the change.
The Tribute Summon restriction isn't enforced.
**Proposed:** `Game.getRace(card)` with a `race` override mod (like `level`), used by `helpers.race()`,
plus a player-level `cannotTributeSummon` query with a filter on the monster being summoned.

## 4. Destruction-replacement hook (Nettles, Realm of Light)
"If … would be destroyed, you can … instead." There's no replacement step in `Game.destroy`.
**Workaround:** Nettles is a Quick Effect. In response to an opponent's destroy effect that
targets a Plant you control, or to an attack on one, it returns to the hand and makes that Plant
indestructible for the turn. Realm of Light's "remove 2 counters instead" is omitted.
**Proposed:** an optional `replaceDestroy?: (ctx, cards, reason) => Promise<CardInstance[]>` hook on
continuous effects. `Game.destroy` would call it before moving cards, and the hook returns the
cards it saved.

## 5. Gemini monsters (Gigaplant, Il Blud)
There's no Gemini Summon action. **Workaround:** `geminiSummonEffect()` in plants.ts is an
ignition effect that spends the Normal Summon and sets `flags.geminiSummoned`. Effects check the flag.
It starts a chain, so it can't be Solemn-negated as a summon. While un-Gemini'd, the monster is
still flagged as `effect` (not treated as a Normal Monster).
**Proposed:** a `gemini` action in `legalMainActions` for face-up `gemini` monsters when a Normal
Summon is left. It would go through `summonNegationWindow`, emit `normalSummoned`/`summoned` with
method `'gemini'`, and set a `geminiSummoned` flag the engine keeps until the card leaves the field.

## 6. `when: true` battle triggers always miss timing
In `damageStep()`, `battleDestroyed` is emitted in one batch, then `damageStepEnd` begins a new
batch before `processTriggers`. `buildTriggerChain` then drops every optional `when` trigger
from the first batch (`t.event.batch !== this.lastBatch`). This affects core.ts Goyo Guardian.
**Workaround:** group-A battle triggers (Pyramid Turtle, Red-Eyes Zombie Dragon) don't set `when`.
**Proposed:** emit `damageStepEnd` as `minor: true`, or don't count `damageStepEnd` when setting `lastBatch`.

## 7. Minor
- Plaguespreader Zombie's "banish when it leaves the field" is set with `card.banishOnLeave = true`
  after its own Special Summon, as the guide describes. It works.
- Celestia's Tribute-Summon trigger uses `tributeSummoned`. Lyla's "cannot change position until
  the end of your next turn" uses a flag plus a continuous `cannotChangePos` mod, because TempMod
  has no "end of your next turn" duration.
