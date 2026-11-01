// "Judge!": call a floor judge during a duel. The judge looks at what's going on (the cards on the Chain, the cards
// in the last few things that happened, the card you're looking at) and reads out the 2010 rulings on record for each,
// with the source to check: the edisonrul.ing historical (pre-UTW) rulings and edisonformat.com, as cited next to each
// card's code (src/cards/rulings.generated.ts, built by scripts/extract-rulings.ts), plus the plain-language Rules
// updates (screens/rulesNotes.ts). You can also ask about any card by name. Read-only: nothing here changes the duel.
import type { CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import { allCards, findCard } from '../../cards';
import { RULINGS, type RulingNote } from '../../cards/rulings.generated';
import { RULES_NOTES } from '../screens/rulesNotes';
import { zoomCard } from '../cards/zoom';
import { esc } from '../theme/util';
import './judge.css';

/** Everything on record for a card: cited 2010 rulings, then the Rules updates that mention it. */
export function rulingsFor(name: string): { notes: RulingNote[]; updates: string[] } {
  const notes = RULINGS[name] ?? [];
  const updates: string[] = [];
  for (const g of RULES_NOTES) for (const it of g.items) if (it.includes(name) && !updates.includes(it)) updates.push(it);
  return { notes, updates };
}

/** The cards a judge would look at right now, most relevant first (at most `max`, by name). */
export function cardsInQuestion(game: Game, focus: CardInstance | null | undefined, max = 6): string[] {
  const out: string[] = [];
  const add = (c: CardInstance | null | undefined) => {
    if (!c || c.isToken || out.includes(c.name) || out.length >= max) return;
    out.push(c.name);
  };
  // the Chain, newest link first
  for (const l of [...game.chain].reverse()) add(l.card);
  add(focus);
  // the last things that happened (cards that moved, were summoned, activated, attacked…)
  const recent = game.eventLog.slice(-30).reverse();
  for (const ev of recent) {
    add(ev.card as CardInstance | undefined);
    add((ev as { other?: CardInstance }).other);
  }
  return out;
}

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

/** Open the judge sheet over the duel. */
export function openJudge(root: HTMLElement, game: Game, focus: CardInstance | null | undefined) {
  root.querySelector('.jd-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'jd-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'Judge');
  const sheet = document.createElement('div');
  sheet.className = 'jd-sheet';
  const names = cardsInQuestion(game, focus);
  const listId = `jd-cards-${Math.random().toString(36).slice(2, 8)}`;
  sheet.innerHTML = `
    <div class="jd-head">
      <span class="jd-badge" aria-hidden="true">J</span>
      <div><b>Floor judge</b><small>“Judge here. What’s the question?”</small></div>
      <button type="button" class="jd-close" aria-label="Close">✕</button>
    </div>
    <label class="jd-ask"><input type="search" list="${listId}" placeholder="Ask about any card…" autocomplete="off" spellcheck="false" aria-label="Ask about a card"><datalist id="${listId}"></datalist></label>
    <div class="jd-answer" hidden></div>
    <h3 class="jd-h">${names.length ? 'On the table right now' : 'Nothing has happened yet'}</h3>
    <div class="jd-list"></div>
    <p class="jd-foot">Rulings as of April 2010 (SJC Edison): edisonrul.ing’s historical, pre-UTW rulings and the Edison Format rulebook. The duel already plays by them; this explains why.</p>`;
  const list = sheet.querySelector<HTMLElement>('.jd-list')!;
  for (const n of names) list.appendChild(cardBlock(n));
  const answer = sheet.querySelector<HTMLElement>('.jd-answer')!;
  const input = sheet.querySelector<HTMLInputElement>('input')!;
  const dl = sheet.querySelector<HTMLDataListElement>('datalist')!;
  input.addEventListener(
    'focus',
    () => {
      if (dl.childElementCount) return;
      for (const n of [...new Set(allCards().map((c) => c.name))].sort()) {
        const o = document.createElement('option');
        o.value = n;
        dl.appendChild(o);
      }
    },
    { once: true },
  );
  const ask = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const all = [...new Set(allCards().map((c) => c.name))];
    const name = all.find((n) => n.toLowerCase() === q) ?? all.find((n) => n.toLowerCase().startsWith(q)) ?? all.find((n) => n.toLowerCase().includes(q));
    answer.hidden = false;
    answer.replaceChildren(name ? cardBlock(name) : Object.assign(document.createElement('p'), { className: 'jd-none', textContent: 'No Edison-era card by that name.' }));
  };
  input.addEventListener('change', ask);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ask();
  });
  const close = () => {
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
