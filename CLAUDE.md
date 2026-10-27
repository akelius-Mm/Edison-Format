# Edison Format: card rules policy

Cards play as they did in the TCG on 2010-04-24 (SJC Edison), under the March 2010 Forbidden & Limited list.

- **Card text:** the English (US) TCG printing that was current in April 2010. Not the OCG/Japanese text, and not
  later errata or Problem-Solving Card Text rewordings (e.g. Treeborn Frog's face-up clause, Brain Control taking any
  face-up monster, Sangan/Witch with no once-per-turn).
- **Rulings:** TCG rulings in force in 2010 (Konami TCG FAQs / rulings of that era). Use OCG rulings only when no TCG
  ruling exists, and say so in a code comment.
- **Cite the source** (URL) in a comment next to any card behaviour that depends on a ruling. If no solid 2010 TCG
  source is found, leave the behaviour unchanged and flag it instead of guessing.
- Every rules fix gets a regression test (scripts/rules-test.ts or a scripts/*-test.ts wired into `npm test`).
