# Card scripting guide

Every card is defined in TypeScript under `src/cards/sets/*.ts` using the helpers in
`src/cards/define.ts` (`monster`, `normal`, `spell`, `trap`, `token`). Files are loaded
for side effects by `src/cards/index.ts`. **Read `src/cards/sets/core.ts` first** — it
implements one example of every pattern below and is the style reference.

Key engine files (read-only for card authors):

| File | What it gives you |
| --- | --- |
| `src/engine/card.ts` | `CardData`, `EffectDef`, `Mod`, `QueryKey`, `CardInstance` |
| `src/engine/ctx.ts` | `Ctx` – the API a script uses (select, destroy, summon, search…) |
| `src/engine/game.ts` | `Game` – state, chain, battle, events. Use through `ctx.game` when Ctx lacks something |
| `src/engine/types.ts` | Event names, locations, attributes, races |
| `src/cards/helpers.ts` | Filters (`attr`, `race`, `inSet`…), event filters, `flip()`, `cardValue()` |

## Card data rules

* Stats (attribute, type, level, ATK/DEF) must match the real card.
* `text` is a **concise paraphrase** of the card's effect in your own words (do not
  copy official card text verbatim). Keep it accurate to how the card works.
* `sets: [...]` holds archetype tags in kebab-case: `blackwing`, `lightsworn`,
  `gladiator`, `x-saber` (XX-Sabers get both `x-saber` and `xx-saber`), `frog`,
  `monarch`, `destiny-hero`, `elemental-hero`, `hero` (all HEROes), `synchron`,
  `ice-barrier`, `ally-of-justice`, `six-samurai`, `infernity`, `gravekeeper`…
* `aiValue` (optional, ~0–2000) tells the AI how valuable the card is beyond its ATK.
* Extra Deck: `types: ['synchro']` + `synchro: { tuner?, nonTuner?, minNonTuners?, maxNonTuners?, desc }`
  or `types: ['fusion']` + `fusion: { materials: [filter, filter...], noPoly?, desc }`.
  Put the material line as the first line of `text`.
* Tuners: `types: ['tuner']`. Flip monsters: `types: ['flip']`. Gemini: `types: ['gemini']`.
* `cannotNormalSummon: true` for Nomi/Semi-Nomi; `nomi: true` if it can't be revived unless
  properly summoned first (Dark Armed Dragon, Judgment Dragon…).
* `synchroMaterialCheck(synchro, materials, self)` for material restrictions (Debris Dragon…).

## Effect kinds (`EffectDef.kind`)

| kind | meaning | default range |
| --- | --- | --- |
| `activate` | activating a Spell/Trap card itself | spell: hand/szone/fzone, trap: szone |
| `ignition` | spell speed 1, your Main Phase | monster: mzone, S/T: szone/fzone |
| `quick` | spell speed 2 on either turn (monster or face-up continuous S/T) | same |
| `trigger` | fires on an `event` (see below) | **no restriction** – filter with `eventFilter`/`range` |
| `continuous` | passive `mods` while in range & face-up | same |
| `proc` | inherent Special Summon from hand/GY/Extra (no chain; Solemn can negate) | hand |

Important fields: `opt` (true = once per turn per copy; string = hard once per turn shared
by name), `mandatory`, `when` (optional "When… you can" trigger that can miss timing),
`damageStep`, `negateSummon` (counter traps / Royal Oppression), `condition`,
`canActivate` (are costs/targets available?), `activate` (pay costs + choose targets;
return `false` to cancel ONLY if nothing was paid yet), `resolve`, `categories`, `ai`.

**Always set `categories`** – other cards and the AI read them (Stardust Dragon checks for
`destroy`, Starlight Road for `destroyMulti`, AI checks `draw`/`search`/`specialSummon`…).

### Costs vs. targets vs. resolution
* Costs (discard, tribute, pay LP, banish from GY) happen in `activate` and use reason `'cost'`.
* Targets are chosen in `activate` with `ctx.selectTargets(...)`. In `resolve` use
  `ctx.validTargets(filter)` – it drops targets that moved since they were targeted.
* Non-targeting choices ("destroy 1 monster your opponent controls") happen in `resolve`
  with `ctx.select(...)`.

### Events (`src/engine/types.ts`)
`normalSummoned`, `tributeSummoned`, `specialSummoned`, `flipSummoned`, `synchroSummoned`,
`fusionSummoned`, `summoned` (any successful summon), `monsterSet`, `flipped`, `destroyed`,
`battleDestroyed` (card = destroyed, other = destroyer), `sentToGrave`, `milled` (deck→GY),
`banished`, `addedToHand`, `returnedToHand`, `returnedToDeck`, `discarded`, `drawn`,
`leftField`, `tributed`, `usedAsMaterial`, `attackDeclared` (card = attacker, other = target),
`attackNegated`, `battleDamage`, `damage`, `lpGain`, `phaseStart` (ev.phase), `battleEnd`,
`damageStepEnd`, `positionChanged`, `controlChanged`.

Event fields: `card`, `other`, `player`, `from`, `to`, `reason`, `reasons` (e.g.
`['battle','destroy']`, `['discard','cost']`), `reasonCard`, `reasonPlayer`, `method`
(`normal|tribute|flip|special|synchro|fusion`), `amount`, `phase`.

* Trigger effects: `kind: 'trigger', event: 'sentToGrave', eventFilter: selfFieldToGrave`.
  Default eventFilter is `ev.card === ctx.self`. The trigger is checked where the card is
  *after* the event, so "if this card is sent to the GY" works without `range`.
  Triggers of face-down monsters never fire (except `flipped`).
* "During your Standby Phase" etc.: `event: 'phaseStart', eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn`
  plus `range: ['grave']` / `['mzone']` as appropriate.
* Traps that respond to something (Bottomless, Mirror Force, Torrential…): `kind: 'activate'`
  with `event` + `eventFilter`. They become activatable right after that event happens.
  The matching event is `ctx.event`. Capture what you need in `activate` (store on `ctx.data`).
* FLIP effects: use `flip({...})` from helpers.

### Chain / negation helpers
`ctx.prevLink()` – the link you are responding to. `ctx.negate(link)`, `ctx.negateAndDestroy(link)`.
Link fields: `card`, `effect` (check `effect.categories`), `player`, `isCardActivation`,
`ctx.targets`. Summon negation: `negateSummon: true` + `condition` on `ctx.game.pendingSummon`
(`{cards, player, method}`) + `ctx.game.negatePendingSummon()` in resolve.
Attack negation: `ctx.negateAttack()`; current battle is `ctx.battle`
(`attacker`, `target`, `inDamageStep`).

### Continuous effects (`mods`)
```ts
{ kind: 'continuous', mods: [
  { q: 'atk', value: 500 },                                    // this card +500
  { q: 'atk', to: 'cards', filter: (ctx, c) => c.faceUpMonster && c.controller === ctx.player && c.inSet('blackwing'), value: 300 },
  { q: 'cannotSpecialSummon', to: 'players', filter: (ctx, p) => p === ctx.opp },
]}
```
Numeric keys (`atk`, `def`, `level`, `extraAttacks`) are summed; others are booleans.
Equip spells: in `resolve`, `ctx.equip(target)`; mods use `filter: (ctx, c) => c === ctx.equipTarget`.
Temporary changes: `ctx.addTempMod(card, 'atk', 500, 'turn' | 'field' | 'battle' | 'opponentEnd')`.
Player-level temporary: `ctx.addPlayerMod(ctx.opp, 'cannotDeclareAttack')`.
Negate a monster's effects: `ctx.negateEffects(card, 'field' | 'turn')`.
Delayed actions ("destroy it during the End Phase"): `ctx.later('end', async () => {...})`
(check `card.moveId` you captured to make sure it is the same card instance).
Linked cards (Call of the Haunted / Premature Burial): `ctx.game.link(a, b)`.
Extra Normal Summon: `ctx.gainNormalSummon()`.
Per-card scratch state that must survive while on the field: `card.flags` (reset when it moves).
Per-turn global data: `ctx.game.turnData`.

### Rules the engine has no hook for (`CardData.rules`)
Some cards change how the game itself works: replacement effects (Rainbow Life, Dimension Wall), summoning
restrictions (Earthbound Immortals, Koa'ki Meiru Drago), "cannot" locks that apply wherever the card is. Write them as a
**rule module**: a function that wraps `Game` methods, and list it in the card's `rules`.
```ts
function simochiRules(g: Game) {
  const orig = g.recover.bind(g);
  g.recover = async (p, amount, source) => {
    if (/* a face-up, active Bad Reaction to Simochi applies to p */) return void (await g.damage(p, amount, 'effect'));
    return orig(p, amount, source);
  };
}
trap('Bad Reaction to Simochi', 'continuous', { text, rules: [simochiRules], effects: [...] });
```
`Game.registerCard` installs each module once per game, as soon as a card that lists it is in the game (so from the start
for deck cards). The module must check that its card actually applies (face-up, active, not negated) every time: it is
installed for the whole game. Assign `g.method = ...` with the method's own signature (no `as any`). Prefer an engine
mechanism when one exists: `Game.preventBattleDamage(p, card)` ("you take no battle damage from this battle"),
`replaceDestroy` / `replaceDestroyOne` (destruction replacement), `mods` (continuous effects). Scratch data about the
current battle or chain link goes in `game.battle.flags` / `link.flags`.

### Selection purposes (AI hint)
`destroy`, `banish`, `bounce` (opponent's card to hand), `control`, `toDeck`, `position`,
`negate` → AI picks the **opponent's best** cards. `discard`, `tribute`, `cost`, `material`,
`toGrave` → AI picks **its own worst** cards. `toHand`, `specialSummon`, `buff`, `equip` →
AI picks its **own best**. Pass `aiScore` when the generic rule would be wrong
(e.g. Quickdraw Synchron should discard Dandylion first).

## AI hints (`ai.score(ctx)`)
Return a number; `<= 0` means "don't". Main-phase scale for comparison: special-summon procs
~70, synchros ~55–75, normal summon ~35–60, setting traps ~12–22, going to battle 8.
In response windows the AI activates the best option scoring >= 30.
Optional triggers fire when `ai.score` > 0 (or when no `ai` is given).
Write `ai.score` for anything situational: traps (when is it worth it?), quick-plays,
removal (is there a worthwhile target?), cards with LP costs, discard costs, etc.
Useful context: `ctx.battle`, `ctx.chainTop()`, `ctx.prevLink()`, `ctx.isMyTurn`, `ctx.phase`,
`ctx.monsters('opp')`, `cardValue(ctx.game, c)`.

## Rulings
Card behaviour follows the 2010 TCG rulings in the rulings database, https://edisonrul.ing (see CLAUDE.md). Put the
card's page URL in a comment next to the behaviour; `npm test` checks that every cited page exists
(`scripts/rulings-db-test.ts`) and the judge shows the comments to players (`scripts/extract-rulings.ts`). Each rules fix
gets a regression test in `scripts/rulings/` (shared harness: `scripts/lib/harness.ts`).

## Testing
* `npx tsc --noEmit` – must be clean for your files.
* `npx tsx scripts/sim.ts --deck <deck-id> --games 30` – AI vs AI duels using the premade
  decks. Prints crashes, script errors and win rates. `--verbose` / `--log` for detail,
  `--vs <deck-id>` to pick the opponent.
