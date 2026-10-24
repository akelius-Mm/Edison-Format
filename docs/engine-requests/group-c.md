# Engine requests — Archetype group C (Monarchs / Tele-DAD / HEROes)

None of these block the decks. Each one lists the workaround that is in place now.

## 1. Restricted extra Normal Summon (Swap Frog)

**What:** Swap Frog's bounce effect grants "1 additional Normal Summon of a 'Frog' monster
(except Swap Frog)". `ctx.gainNormalSummon()` only adds a generic summon, so the extra summon
can currently be used on any monster, including a Monarch Tribute Summon.

**Proposal:** add typed extra summons to `PlayerState`, and have `canNormalSummon` and `normalSummon`
use them once the regular summon is gone.

```ts
// game.ts PlayerState
extraSummons: { filter: (c: CardInstance) => boolean; turn: number }[];

// canNormalSummon(p, card, set)
const ps = this.players[p];
const regular = ps.normalSummonsLeft > 0;
const extra = ps.extraSummons.some((e) => e.turn === this.turn && e.filter(card));
if (!regular && !extra) return false;

// normalSummon: consume the regular summon first, else the first matching extra entry
if (ps.normalSummonsLeft > 0) ps.normalSummonsLeft--;
else ps.extraSummons.splice(ps.extraSummons.findIndex((e) => e.turn === this.turn && e.filter(card)), 1);

// ctx.ts
gainNormalSummon(n = 1, filter?: (c: CardInstance) => boolean) {
  if (!filter) { this.game.players[this.player].normalSummonsLeft += n; return; }
  for (let i = 0; i < n; i++) this.game.players[this.player].extraSummons.push({ filter, turn: this.game.turn });
}
```

**Workaround:** a generic `ctx.gainNormalSummon()`. The AI only uses the bounce in the Frog loop
(bounce Swap Frog, then Special Summon it again).

## 2. Card-level "cannot be Special Summoned"

**What:** there is no per-card query for "this card cannot be Special Summoned". It is needed for
Frog the Jam, and for Destiny Hero - Disk Commander ("cannot be Special Summoned from the GY during
the turn it was sent there").

**Proposal:** add a `cannotBeSpecialSummoned` QueryKey, and check it per card in
`Game.specialSummon` and `Ctx.canSummonCard`:

```ts
if (!opts.ignoreConditions && this.queryCard(c, 'cannotBeSpecialSummoned')) continue;
```

`queryCard` would need to evaluate `range: ['hand','grave','deck']` self-mods off the field. That
already works through `sourceActive`'s range check.

**Workaround:** both restrictions are not enforced. They are stated in the card text only.

## 3. Gemini monsters (Elemental Hero Neos Alius)

**What:** no engine support for Gemini monsters: a Gemini Summon, being treated as a Normal Monster
until then, or losing Gemini status when flipped face-down.

**Proposal:** add a `gemini` main-phase action for a face-up Gemini monster whose controller still
has a Normal Summon. It would use the Normal Summon, set `card.flags.geminiSummoned = true`, and
emit `normalSummoned`/`summoned` with method `'normal'` so that summon negation and responses apply.
`changePosition(..., faceUp=false)` should clear the flag. `isNormalMonster` should treat an
un-summoned Gemini as Normal.

**Workaround:** Neos Alius has an ignition effect, "Gemini Summon", that uses the Normal Summon
(in `activate`) and sets `flags.geminiSummoned`. The effect goes on the chain instead of being a
summon.

## 4. Name-change effects (Dupe Frog, Ronintoadin, Neos Alius)

**What:** "This card's name is treated as X" (Dupe Frog → "Des Frog", Neos Alius → "Elemental
Hero Neos") has no hook. `CardInstance.name` is static.

**Proposal:** add a `nameAs` query (string-valued mod) and a `game.cardName(c)` accessor that
name checks use.

**Workaround:** not implemented. No card in the current pool depends on it.

## 5. Applying a card's effect outside a chain (Destiny Hero - Diamond Dude)

**What:** Diamond Dude lets you activate a Normal Spell's effect from the GY during your next Main
Phase. Doing this properly needs the engine to offer that effect as an activation (a chain link)
in that Main Phase.

**Workaround:** a `game.addDelayed('main1', ..., 2)` callback. At the start of the owner's next
Main Phase 1, it asks to confirm (for the AI, the spell's own `ai.score`), then runs the spell's
`canActivate`, `activate` and `resolve` directly, without a chain.
