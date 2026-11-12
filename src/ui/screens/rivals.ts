// Rivals (route `rivals`): the regulars of your scene as people instead of difficulty levels. Each has a deck, a
// rating, your record against them and a memory of the last time you played. Challenge one to a rated
// best-of-three; matches at Locals and events against the same regulars land on the same record.
import { nextWeekday } from '../../calendar';
import { aiRating } from '../../events';
import { REGULARS, RIVAL_TAG_LABEL, loadRivals, metaLabel, regularDeck, rivalMemory, rivalPlayed, rivalRecordText, rivalTag, type Regular } from '../../locals';
import { loadJSON, saveJSON } from '../settings';
import { confirmDeckProblems, playVsAI } from './duelSetup';
import { deckCarousel, lobbySection, linkButton } from './components';
import { h, icon, toast } from './dom';
import { avatar } from './locals';
import { frame, go, type Screen } from './nav';
import { allDeckInfos, premadeInfo } from './store';
import './locals.css';
import './rivals.css';

const SETUP_KEY = 'edison.duelSetup.v1';

/** The deck a regular brings this week (the rogue player changes it every Friday). */
function deckThisWeek(r: Regular) {
  return regularDeck(r.id, Math.floor(nextWeekday(5) / (7 * 86400000)));
}

export const rivalRating = (r: Regular) => aiRating(r.difficulty, r.skill);

export function rivalsScreen(): Screen {
  const decks = allDeckInfos();
  const saved = loadJSON<{ myDeck?: string | null }>(SETUP_KEY, {});
  let myDeck = saved.myDeck && decks.some((d) => d.key === saved.myDeck) ? saved.myDeck : null;
  const records = loadRivals();

  const total = REGULARS.reduce((t, r) => ({ w: t.w + (records[r.id]?.w ?? 0), l: t.l + (records[r.id]?.l ?? 0) }), { w: 0, l: 0 });
  const beaten = REGULARS.filter((r) => (records[r.id]?.w ?? 0) > 0).length;
  const summary = total.w + total.l ? `${total.w}–${total.l} against the room · ${beaten} of ${REGULARS.length} beaten` : `${REGULARS.length} regulars. Beat them all.`;

  const deckRow = deckCarousel(
    decks,
    myDeck,
    (d) => {
      myDeck = d?.key ?? null;
      saveJSON(SETUP_KEY, { ...loadJSON<Record<string, unknown>>(SETUP_KEY, {}), myDeck });
    },
    { label: 'Your deck' },
  );
  const deckSection = lobbySection('Your deck', linkButton('Deck Builder', () => go('deck-builder')), deckRow);

  async function challenge(r: Regular) {
    const mine = decks.find((d) => d.key === myDeck);
    if (!mine) {
      toast('Choose your deck first.', 'error');
      deckSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const theirs = deckThisWeek(r);
    if (!theirs) return toast(`${r.name} has no deck this week.`, 'error');
    if (!(await confirmDeckProblems(mine))) return;
    await playVsAI(mine, premadeInfo(theirs), { name: r.name, avatar: r.avatar, difficulty: r.difficulty }, 3, true, r.id);
  }

  const card = (r: Regular, rank: number) => {
    const rec = records[r.id];
    const tag = rivalTag(rec);
    const deck = deckThisWeek(r);
    const recText = rivalRecordText(rec);
    return h(
      'article',
      { class: ['rv-card', `is-${tag}`], dataset: { rival: r.id } },
      h(
        'div',
        { class: 'rv-top' },
        h('span', { class: 'rv-rank', 'aria-label': `Number ${rank}` }, String(rank)),
        h('span', { class: 'rv-portrait' }, avatar(r, 52)),
        h('div', { class: 'rv-who' }, h('b', null, r.name), h('span', null, `${r.title} · ${deck ? metaLabel(r.meta, deck) : 'Rogue'}`)),
        h('div', { class: 'rv-rating' }, h('b', null, String(rivalRating(r))), h('span', null, 'Rating')),
      ),
      h('p', { class: 'rv-memory' }, rivalMemory(r, rec)),
      h(
        'div',
        { class: 'rv-foot' },
        h('span', { class: ['rv-tag', `is-${tag}`] }, RIVAL_TAG_LABEL[tag]),
        recText ? h('span', { class: ['rv-rec', rec!.w > rec!.l && 'is-up', rec!.w < rec!.l && 'is-down'] }, `You ${recText}`) : null,
        h('button', { type: 'button', class: 'rv-go', 'data-test': `challenge-${r.id}`, onclick: () => void challenge(r) }, icon('swords'), rivalPlayed(rec) ? 'Rematch' : 'Challenge'),
      ),
    );
  };

  // the ladder: strongest first
  const ladder = [...REGULARS].sort((a, b) => rivalRating(b) - rivalRating(a));
  const el = frame(
    'Rivals',
    { eyebrow: 'Your scene', cls: 'lobby-screen rv-screen', backTo: () => go('title'), backLabel: 'Play' },
    h('p', { class: 'rv-summary' }, summary),
    deckSection,
    h('div', { class: 'rv-head' }, h('h2', null, 'The ladder'), h('span', null, 'Best of 3 · Rated')),
    h('div', { class: 'rv-list' }, ...ladder.map((r, i) => card(r, i + 1))),
  );
  return { el };
}
