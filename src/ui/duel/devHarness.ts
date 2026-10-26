// Temporary development harness for the duel screen (loaded by /duel-dev.html).
import '../../cards';
import { allCards, cardByName, findCard } from '../../cards';
import { normal } from '../../cards/define';
import type { CardData } from '../../engine/card';
import { renderCard } from '../cards/render';
import { renderAvatar } from '../theme/avatars';
import { PLAYMATS, applyPlaymat } from '../theme/playmats';
import { SLEEVES, applySleeve } from '../theme/sleeves';
import { startDuel } from './duelScreen';
import type { Difficulty } from '../../ai/ai';

const app = document.getElementById('app')!;
const q = new URLSearchParams(location.search);

function ensure(name: string, mk: () => CardData) {
  return findCard(name) ?? mk();
}
const brute = ensure('Dev Brute', () => normal('Dev Brute', 'EARTH', 'Warrior', 4, 1800, 1000, 'A sturdy warrior used for testing.'));
const wall = ensure('Dev Wall', () => normal('Dev Wall', 'EARTH', 'Rock', 4, 500, 2000, 'A stone wall used for testing.'));
const tuner = ensure('Dev Tuner', () => {
  const t = normal('Dev Tuner', 'EARTH', 'Machine', 2, 800, 800, 'A tuner used for testing.');
  t.mtypes!.push('tuner');
  return t;
});
const flyer = ensure('Dev Skyhawk', () => normal('Dev Skyhawk', 'WIND', 'Winged Beast', 4, 1700, 1200, 'A swift hawk.'));
const fish = ensure('Dev Deep Angler', () => normal('Dev Deep Angler', 'WATER', 'Fish', 3, 1300, 900, 'Lurks below.'));
const fiend = ensure('Dev Night Fiend', () => normal('Dev Night Fiend', 'DARK', 'Fiend', 4, 1600, 1300, 'Born of shadow.'));

function deck(): { main: CardData[]; extra: CardData[] } {
  const names = ['Mystical Space Typhoon', 'Heavy Storm', 'Dark Hole', 'Monster Reborn', 'Pot of Avarice', 'Book of Moon', 'Brain Control', 'Limiter Removal', 'Scapegoat', 'Mirror Force', 'Bottomless Trap Hole', 'Solemn Judgment', 'Call of the Haunted', 'Royal Oppression', 'Gravity Bind', 'Sangan', 'Card Trooper', 'Cyber Dragon', 'Dark Armed Dragon', 'Morphing Jar', 'Treeborn Frog', 'Honest'];
  const main = [...names.map((n) => cardByName(n)), ...Array(4).fill(brute), ...Array(3).fill(wall), ...Array(5).fill(tuner), ...Array(2).fill(flyer), ...Array(2).fill(fish), ...Array(2).fill(fiend)];
  const extra = [cardByName('Goyo Guardian'), cardByName('Brionac, Dragon of the Ice Barrier')];
  return { main, extra };
}

function gallery() {
  app.style.overflow = 'auto';
  app.style.padding = '16px';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start';
  const size = (q.get('size') as any) || 'lg';
  for (const c of allCards()) wrap.appendChild(renderCard(c, { size, showLimit: true }));
  app.appendChild(wrap);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;margin-top:20px';
  for (const s of SLEEVES) {
    const c = renderCard(brute, { size: 'md', faceDown: true, sleeve: s.id });
    c.title = s.name;
    row.appendChild(c);
  }
  app.appendChild(row);
  const av = document.createElement('div');
  av.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;margin-top:20px';
  for (let i = 1; i <= 12; i++) av.appendChild(renderAvatar(`avatar-${i}`, 72));
  for (const s of ['Kaiba', 'Yugi', 'Joey', 'x', 'y']) av.appendChild(renderAvatar(s, 72));
  app.appendChild(av);
  const mats = document.createElement('div');
  mats.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;margin-top:20px';
  for (const m of PLAYMATS) {
    const d = document.createElement('div');
    d.style.cssText = 'width:300px;height:190px;border-radius:10px;display:flex;align-items:flex-end;padding:8px;font-weight:700';
    applyPlaymat(d, m.id);
    d.textContent = m.name;
    mats.appendChild(d);
  }
  app.appendChild(mats);
  void applySleeve;
}

async function duel() {
  const mode = q.get('mode') ?? 'human';
  const diff = (q.get('ai') as Difficulty) ?? 'normal';
  const res = await startDuel(app, {
    sides: [
      { name: mode === 'spectate' ? 'Alpha Bot' : 'You', deck: deck(), avatar: 'avatar-1', sleeve: q.get('sleeve') ?? 'classic-red', control: mode === 'spectate' ? 'hard' : 'human', title: 'Dev Harness' },
      { name: 'Rival AI', deck: deck(), avatar: 'avatar-3', sleeve: 'arcane-circle', control: diff },
    ],
    playmat: q.get('mat') ?? 'edison-night',
    firstPlayer: q.has('first') ? (Number(q.get('first')) as 0 | 1) : 'coin',
    seed: q.has('seed') ? Number(q.get('seed')) : undefined,
    caption: 'Dev Duel',
    allowSurrender: true,
    // e2e scripts (scripts/whynot-e2e.cjs) set up board states through the live game
    onMount: (ctl) => {
      (window as any).__duelCtl = ctl;
      (window as any).__cardByName = cardByName;
    },
  });
  (window as any).__duelResult = res;
  console.log('DUEL RESULT', JSON.stringify(res));
  app.innerHTML = `<div style="padding:40px;font-size:22px">Result: ${JSON.stringify(res)} <a href="" style="color:#9cf">again</a></div>`;
}

if (q.has('gallery')) gallery();
else void duel();
