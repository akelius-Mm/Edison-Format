# Rulings: sources, checks and open gaps

Cards play by the 2010 TCG rulings (CLAUDE.md). This page says where those rulings come from, how the code is kept in
line with them, and what is still known to differ.

## The database

The rulings database is **https://edisonrul.ing** (source: https://github.com/vivaria/edisonrul.ing,
`docs/source/cards/<letter>/<slug>.md`). Each card page has two sections:

- **Edisonformat.com (Historical, Pre-UTW Rulings)**: the 2010 card text and the 2010 rulings (the Upper Deck FAQ and
  Konami's set rulings). This is the source we follow.
- **Edisonformat.net (Revised)**: today's rulings for Edison events. Used only where the historical section is silent,
  and the code comment says so.

`scripts/import-rulings-db.ts <checkout>` indexes a checkout of the database:

- `src/cards/rulings-db.generated.ts`: which page is about each card of the pool (1339 of 1365 cards; the other 26 are
  Forbidden or have no page). The judge links every card to its page.
- `scripts/data/edisonrul.ing-pages.json`: every page of the database, and whether it has historical rulings.

Only the index is kept, not the rulings' text: the database publishes no license for it.

## How the code stays in line

- **A comment with the page URL** sits next to every card behaviour that depends on a ruling.
- **`scripts/rulings-db-test.ts`** (part of `npm test`) fails if any `https://edisonrul.ing/cards/...` link in `src/` is
  not a page of the database.
- **`scripts/extract-rulings.ts`** collects those comments into the judge's rulings book
  (`src/cards/rulings.generated.ts`). `npm test` fails if the book is out of date.
- **Every rules fix gets a regression test** in `scripts/rulings/`. All tests use the shared harness in
  `scripts/lib/harness.ts`, and `npm run test:rulings` runs only these.

## Audit (November 2026, database of 2026-05-03)

Every one of the 1339 pool cards with a database page was compared with its historical section: the ruling comments
in the code, the implementation, and the card text. The audit found about 210 discrepancies. 182 are fixed, each with
a regression test (`scripts/rulings/db-*.ts`, 206 tests). The judge's rulings book now covers 507 cards (632 notes).

### Not fixed: needs an engine feature

| Card(s) | 2010 ruling | Now |
| --- | --- | --- |
| Gladiator Beast tag-outs | Each Gladiator Beast's end-of-battle effect gets its own Chain, the turn player's first | They share one Chain |
| Prohibition | The declared card can't be activated, Set or Summoned from the hand / Extra Deck | It is negated or sent away after the fact (APPROX) |
| Makyura the Destructor | Traps can be activated from the hand | Not implemented |
| The Immortal Bushi | Its revival is an Ignition Effect during your Standby Phase | It is a trigger at the start of the Standby Phase |
| Level Eater | It can't be Tributed except for a Tribute Summon | Text only; no engine rule for this |
| Destiny Hero - Diamond Dude | The Normal Spell's costs and activation requirements are skipped | Still checked (APPROX) |
| Gladiator Beast Darius | The negated target can still activate its effects (they resolve without effect) | It can't activate them |
| Kuribon | Damage calculation still happens and Kuribon counts as destroyed by battle | The battle ends with no calculation (APPROX) |
| Trap of Darkness, Fake Feather | The copied Trap's costs are not paid | Fake Feather skips them but still needs a payable cost; Trap of Darkness pays them |
| Soul Exchange | The target can be Tributed for any cost or effect | Only through the Tribute helpers in spells.ts / plants.ts |
| Cold Wave | Trigger-like effects of Spells can't be activated | Only Ignition / Quick-like ones are blocked (APPROX) |
| Gadjiltron Dragon / Chimera, Hyper Psychic Blaster | Their effect activates even if they were flipped face-down | The engine never fires triggers of face-down monsters |
| Alien Grey / Alien Telepath (glas.ts) | The A-Counter battle rule applies to every Alien's battles | Only to the card's own battles |

The code marks other known approximations with `APPROX:` and a citation (143 today).

### To verify against an April 2010 printing

The database has no historical card text for these, so their wording could not be checked:

- **X-Saber Galahad**: effect ③ was added from the revised text, and its English wording was written from memory.
- **Spiritual Forest**: the text was reworded to "once per turn" to match the ruling; the 2010 printing was not
  confirmed.
- **Super-Nimble Mega Hamster**: the code says "Level 3 or lower monster"; the revised text says "Beast".
- **Cloudian - Turbulence**: the hand as a source; the ruling names only the Deck and either GY.
- **Seven Tools of the Bandit**: no 2010 text or rulings in the database.
- **Lightsworn Sabre**: "When" or "If" (whether it can miss timing).
- **Doomkaiser Dragon**: one historical bullet says "either Graveyard", the card text says "your opponent's"; the code
  follows the card text.
