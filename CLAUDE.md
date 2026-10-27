# Edison Format: card rules policy

Cards play as they did in the TCG on 2010-04-24 (SJC Edison), under the March 2010 Forbidden & Limited list.

- **Banlist (overarching rule):** the official March 2010 TCG Forbidden & Limited list (Konami 10_03; Yugipedia
  "March 2010 Lists (TCG)"; https://www.edisonformat.com/banlist.html) in src/cards/banlist.ts, enforced exactly, with no
  exceptions for bundled decks. Every bundled deck must be legal under it: fix the deck, never the list. The real 2010
  tournament decklists (src/decks/tournament*.ts) are the reference for what was legal.
- **General game rules:** the Edison-era Official Rulebook v7.0 (https://www.edisonformat.com/rulebook.html) and
  https://www.edisonformat.com/edison-rule-differences.html; functional errata from
  https://www.edisonformat.com/functional-errata.html.

- **Card text:** the English (US) TCG printing that was current in April 2010. Not the OCG/Japanese text, and not
  later errata or Problem-Solving Card Text rewordings. Examples of 2010 behaviour that later errata changed: Treeborn
  Frog can't revive while you control a face-up Treeborn Frog; Brain Control can take any face-up monster; Sangan and
  Witch of the Black Forest have no once-per-turn.
- **Rulings:** TCG rulings in force in 2010. Primary source: https://edisonrul.ing (source files:
  https://github.com/vivaria/edisonrul.ing, `docs/source/cards/<letter>/<slug>.md`). Use each page's
  "Edisonformat.com (Historical, Pre-UTW Rulings)" section first — the 2010 Upper Deck FAQ and Konami set rulings — and
  the "Edisonformat.net (Revised)" section only where the historical one is silent (say so in a comment). The
  `misc/` pages cover card groups (Gemini, Spirit, Trap Monsters, battle tutors...). Use OCG rulings only when neither
  section covers it, and say so in a code comment.
- **Cite the source** (URL) in a comment next to any card behaviour that depends on a ruling. If no solid 2010 TCG
  source is found, leave the behaviour unchanged and flag it instead of guessing.
- Every rules fix gets a regression test (scripts/rules-test.ts or a scripts/*-test.ts wired into `npm test`).
