// "Judge!": call a floor judge during a duel. The judge looks at what's going on (the cards on the Chain, the cards
// in the last few things that happened, the card you're looking at) and reads out the 2010 rulings on record for each,
// with the source to check: the edisonrul.ing historical (pre-UTW) rulings and edisonformat.com, as cited next to each
// card's code (src/cards/rulings.generated.ts, built by scripts/extract-rulings.ts), plus the plain-language Rules
// updates (screens/rulesNotes.ts). You can also ask about any card by name. Read-only: nothing here changes the duel.
import type { CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
import { findCard } from '../../cards';
import { cardsInQuestion, rulingsFor, searchCards } from './judgeBook';
import { zoomCard } from '../cards/zoom';
import { esc } from '../theme/util';
import './judge.css';

const host = (url: string) => (url.includes('edisonrul.ing') ? 'edisonrul.ing (2010 rulings)' : 'edisonformat.com');

function cardBlock(name: string): HTMLElement {
  const { notes, updates } = rulingsFor(name);
  const el = document.createElement('section');
  el.className = 'jd-card';
  const items = [
    ...notes.map((n) => `<li>${esc(n.text.charAt(0).toUpperCase() + n.text.slice(1))}<a class="jd-src" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(host(n.url))}</a></li>`),
    ...updates.map((u) => `<li>${esc(u)}<span class="jd-src">Rules update</span></li>`),
  ];
  el.innerHTML = `<header><b>${esc(name)}</b><button type="button" class="jd-text">Card text</button></header>${
    items.length ? `<ul>${items.join('')}</ul>` : '<p class="jd-none">No special 2010 rulings on record: it works as its text says.</p>'
  }`;
  el.querySelector<HTMLButtonElement>('.jd-text')!.onclick = () => {
    const d = findCard(name);
    if (d) zoomCard(d);
  };
  return el;
}

/** Open the judge sheet over the duel. `viewer` is the seat looking (null for a spectator). */
export function openJudge(root: HTMLElement, game: Game, focus: CardInstance | null | undefined, viewer: PlayerId | null) {
  root.querySelector('.jd-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'jd-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'Judge');
  const sheet = document.createElement('div');
  sheet.className = 'jd-sheet';
  const names = cardsInQuestion(game, focus, viewer);
  sheet.innerHTML = `
    <div class="jd-head">
      <span class="jd-badge" aria-hidden="true">J</span>
      <div><b>Floor judge</b><small>“Judge here. What’s the question?”</small></div>
      <button type="button" class="jd-close" aria-label="Close">✕</button>
    </div>
    <form class="jd-ask" action="#"><input type="search" enterkeyhint="search" placeholder="Ask about any card…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Ask about a card"><div class="jd-sugg" role="listbox"></div></form>
    <div class="jd-answer" hidden></div>
    <h3 class="jd-h">${names.length ? 'On the table right now' : 'Nothing has happened yet'}</h3>
    <div class="jd-list"></div>
    <p class="jd-foot">Rulings as of April 2010 (SJC Edison): edisonrul.ing’s historical, pre-UTW rulings and the Edison Format rulebook. The duel already plays by them; this explains why.</p>`;
  const list = sheet.querySelector<HTMLElement>('.jd-list')!;
  for (const n of names) list.appendChild(cardBlock(n));
  const answer = sheet.querySelector<HTMLElement>('.jd-answer')!;
  const input = sheet.querySelector<HTMLInputElement>('input')!;
  const sugg = sheet.querySelector<HTMLElement>('.jd-sugg')!;
  const form = sheet.querySelector<HTMLFormElement>('form')!;
  const show = (name: string | undefined) => {
    sugg.replaceChildren();
    answer.hidden = false;
    answer.replaceChildren(name ? cardBlock(name) : Object.assign(document.createElement('p'), { className: 'jd-none', textContent: 'No Edison-era card by that name.' }));
    // put the keyboard away: on iPhone a focused field keeps the page pushed up
    input.blur();
  };
  input.addEventListener('input', () => {
    sugg.replaceChildren(
      ...searchCards(input.value).map((n) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'jd-sugg-item';
        b.textContent = n;
        b.onclick = () => {
          input.value = n;
          show(n);
        };
        return b;
      }),
    );
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) show(searchCards(input.value, 1)[0]);
  });
  const close = () => {
    input.blur();
    // iPhone scrolls the page to make room for the keyboard; put it back so the duel isn't left off-screen
    window.scrollTo(0, 0);
    layer.classList.add('is-closing');
    window.removeEventListener('keydown', onKey);
    window.setTimeout(() => layer.remove(), 160);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  sheet.querySelector<HTMLButtonElement>('.jd-close')!.onclick = close;
  layer.addEventListener('click', (e) => {
    if (e.target === layer) close();
  });
  // taps inside the sheet must not reach the board (tap-to-hurry, card menus)
  sheet.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);
  layer.appendChild(sheet);
  root.appendChild(layer);
}
