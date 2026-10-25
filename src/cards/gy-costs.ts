// Effects whose cost (or Summon procedure) banishes cards from a Graveyard. While "cards in the GY cannot be
// banished" applies (Necrovalley: player query 'cannotBanishFromGY'), the engine does not offer them, since the cost
// cannot be paid. Kept as one table (card name -> effect indexes) so the card scripts stay as they are; a missing
// card or index is reported by scripts/rules-test.ts.
import { findCard } from './define';

export const GY_BANISH_COSTS: [string, number[]][] = [
  ['Dark Armed Dragon', [1]],
  ['Chaos Sorcerer', [0]],
  ['Black Luster Soldier - Envoy of the Beginning', [0]],
  ['Chaos Emperor Dragon - Envoy of the End', [0]],
  ['Sky Scourge Norleras', [0]],
  ['Phantom of Chaos', [0]],
  ['Necro Gardna', [0]],
  ['Mezuki', [0]],
  ['Destiny Hero - Malicious', [0]],
  ['Blackwing - Vayu the Emblem of Honor', [1]],
  ['Black Rose Dragon', [1]],
  ['Iron Chain Dragon', [0]],
  ['Red-Eyes Wyvern', [0]],
  ['Psychic Lifetrancer', [0]],
  ['Reinforced Human Psychic Borg', [0]],
  ["Enishi, Shien's Chancellor", [0]],
  ["Koa'ki Meiru Rooklord", [2]],
  ['Gigastone Omega', [0]],
  ['Dark Simorgh', [0]],
  ['Knight of the Red Lotus', [0]],
  ['Yamato-no-Kami', [0]],
  ['Ronintoadin', [1]],
  ['Destiny End Dragoon', [1]],
  ['Phoenixian Cluster Amaryllis', [2]],
  ['Rainbow Dark Dragon', [0, 1]],
  ['Dark Nephthys', [0]],
  ['Future Samurai', [1]],
  ['The Dark Creator', [1]],
  ['Shutendoji', [0]],
  ['Cloudian - Storm Dragon', [0]],
];

/** Problems with the table (unknown cards / indexes); empty when every entry resolves. */
export function applyGyBanishCosts(): string[] {
  const problems: string[] = [];
  for (const [name, idxs] of GY_BANISH_COSTS) {
    const c = findCard(name);
    if (!c) {
      problems.push(`unknown card ${name}`);
      continue;
    }
    for (const i of idxs) {
      const ef = c.effects?.[i];
      if (!ef) problems.push(`${name} has no effect ${i}`);
      else ef.gyBanishCost = true;
    }
  }
  return problems;
}

export const GY_BANISH_COST_PROBLEMS = applyGyBanishCosts();
