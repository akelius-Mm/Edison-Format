// Locals Night engine (no DOM): import from here.
export * from './types';
export * from './night';
export { META, classifyDeck, decksFor, metaInfo, metaLabel, matchupEdge, deckStrength } from './meta';
export { REGULARS, regularById, type Regular } from './regulars';
export { RIVAL_TAG_LABEL, agoText, rivalFirstName, rivalMemory, rivalPlayed, rivalRecordText, rivalTag, type RivalTag } from './rivals';
export { SHOPS, shopById, nightDate, swissRoundsFor, topCutFor } from './shops';
export { computeStandings, idCheck, seedTopCut, topCutSeeds, winnerOf, loserOf, finalPlacements } from './swiss';
