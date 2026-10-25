// Animation director: turns engine AnimEvents into visual effects + sound, paced by the speed setting.
import type { CardInstance } from '../../engine/card';
import type { AnimEvent, Game } from '../../engine/game';
import { phaseName } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
import { renderCard } from '../cards/render';
import type { BoardView, RenderOpts } from './board';
import type { ChainStack, PlayerPanel } from './panels';
import type { Sfx } from './sound';

export interface FxHost {
  game: Game;
  board: BoardView;
  root: HTMLElement;
  overlay: HTMLElement;
  chain: ChainStack;
  panels: [PlayerPanel, PlayerPanel];
  sfx: Sfx;
  me: PlayerId;
  spectator: boolean;
  names: [string, string];
  /** The first player was chosen (games 2 and 3 of a match), not rolled for. */
  firstChosen?: boolean;
  speed(): number;
  /** Render everything now (board + panels). */
  flush(opts?: RenderOpts): void;
  /** Show a card in the preview panel (when visible to the viewer). */
  spotlight(c: CardInstance): void;
}

export const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function el(cls: string, html = '') {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}

function center(e: Element) {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

export class FxDirector {
  constructor(private h: FxHost) {}

  private async wait(ms: number) {
    const t = ms * this.h.speed();
    if (t > 0) await sleep(t);
  }

  private local(x: number, y: number) {
    const r = this.h.overlay.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  }

  async handle(a: AnimEvent): Promise<void> {
    const h = this.h;
    switch (a.type) {
      case 'coin':
        h.flush();
        return this.h.firstChosen ? this.firstCaption(a.player as PlayerId) : this.diceRoll(a.player as PlayerId);
      case 'turn': {
        h.flush();
        h.sfx.play('turn');
        const mine = a.player === h.me;
        const label = h.spectator ? `${h.names[a.player as PlayerId]}'s Turn` : mine ? 'Your Turn' : "Opponent's Turn";
        this.banner(`<small>Turn ${a.turn}</small><b>${label}</b>`, `banner--turn ${mine ? 'is-me' : 'is-opp'}`, 1300);
        return this.wait(1150);
      }
      case 'phase': {
        h.flush();
        const ph = a.phase as string;
        if (ph === 'draw' || ph === 'standby') return this.wait(120);
        h.sfx.play('phase');
        this.banner(`<b>${phaseName(a.phase)}</b>`, `banner--phase ${a.player === h.me ? 'is-me' : 'is-opp'}`, 900);
        return this.wait(ph === 'end' ? 380 : 520);
      }
      case 'draw': {
        const n = (a.cards as number[]).length;
        const stagger = a.opening ? 110 : 90;
        h.flush({ stagger: stagger * h.speed() });
        h.sfx.play('draw');
        for (let i = 1; i < Math.min(n, 6); i++) window.setTimeout(() => h.sfx.play('draw'), i * stagger * h.speed());
        return this.wait(430 + stagger * (n - 1));
      }
      case 'move': {
        h.flush();
        if (a.set) {
          h.sfx.play('set');
          for (const m of a.cards as { uid: number }[]) this.pulse(m.uid, 'fx-set', 500);
          return this.wait(420);
        }
        const toHand = (a.cards as { to: string }[]).some((m) => m.to === 'hand' || m.to === 'deck');
        if (toHand) h.sfx.play('draw');
        return this.wait(360);
      }
      case 'summon': {
        h.flush();
        const method = a.method as string;
        const uids = a.cards as number[];
        const first = h.game.card(uids[0]);
        if (first && first.faceUp) h.spotlight(first);
        if (method === 'set') {
          h.sfx.play('set');
          for (const u of uids) this.pulse(u, 'fx-set', 500);
          return this.wait(420);
        }
        if (method === 'synchro') {
          h.sfx.play('synchro');
          for (const u of uids) this.synchroBurst(u);
          return this.wait(1250);
        }
        h.sfx.play('summon');
        for (const u of uids) {
          this.pulse(u, method === 'tribute' ? 'fx-summon fx-tribute' : 'fx-summon', 900);
          this.ring(u, method === 'tribute' ? 'ring--tribute' : 'ring--summon');
        }
        return this.wait(method === 'tribute' ? 800 : 650);
      }
      case 'activate': {
        h.flush();
        h.sfx.play('activate');
        const c = h.game.card(a.card);
        if (c) {
          h.spotlight(c);
          this.pulse(c.uid, 'fx-activate', 900);
          this.showcase(c, a.chainIndex as number, a.player as PlayerId);
        }
        return this.wait(950);
      }
      case 'resolve': {
        h.flush();
        h.sfx.play('resolve');
        this.pulse(a.card, 'fx-resolve', 700);
        const row = h.chain.linkEl(a.chainIndex);
        if (row) {
          row.classList.remove('flash');
          void row.offsetWidth;
          row.classList.add('flash');
        }
        return this.wait(480);
      }
      case 'chainEnd':
        h.flush();
        return;
      case 'target': {
        h.flush();
        h.sfx.play('target');
        const src = h.board.elFor(a.source);
        for (const u of a.cards as number[]) {
          const t = h.board.elFor(u);
          if (!t) continue;
          this.reticle(t);
          if (src && src !== t) this.beam(src, t, 'beam--target', 700);
        }
        return this.wait(720);
      }
      case 'attack': {
        h.flush();
        h.sfx.play('attack');
        const at = h.board.elFor(a.attacker);
        const tgt = a.target != null ? h.board.elFor(a.target) : h.panels[h.game.opp(a.player as PlayerId)].avatarEl;
        if (at && tgt) {
          this.beam(at, tgt, 'beam--attack', 900);
          this.lunge(at, tgt);
          if (a.target != null) this.reticle(tgt as HTMLElement);
        }
        return this.wait(700);
      }
      case 'battle': {
        h.flush();
        h.sfx.play('battle');
        const at = h.board.elFor(a.attacker);
        const tgt = a.target != null ? h.board.elFor(a.target) : null;
        const spot = tgt ?? (at ? null : null);
        if (spot) this.spark(spot);
        else {
          const def = h.panels[h.game.opp(h.game.turnPlayer)].avatarEl;
          this.spark(def);
        }
        if (at) this.shakeEl(at);
        if (tgt) this.shakeEl(tgt);
        return this.wait(460);
      }
      case 'damage': {
        h.flush();
        const amt = a.amount as number;
        const big = amt >= 2000 && a.kind !== 'cost';
        h.sfx.play(big ? 'bigDamage' : 'damage');
        this.floatNumber(a.player as PlayerId, `-${amt}`, a.kind === 'cost' ? 'num--cost' : 'num--dmg', big);
        if (big) this.shakeScreen();
        if (a.kind !== 'cost') this.flashSide(a.player as PlayerId, 'flash--dmg');
        return this.wait(big ? 950 : 750);
      }
      case 'recover': {
        h.flush();
        h.sfx.play('recover');
        this.floatNumber(a.player as PlayerId, `+${a.amount}`, 'num--heal', false);
        this.flashSide(a.player as PlayerId, 'flash--heal');
        return this.wait(650);
      }
      case 'destroy': {
        // Shatter the cards where they currently stand, then render them into the GY.
        const drop = new Set<number>();
        let any = false;
        for (const m of a.cards as { uid: number; from: string }[]) {
          const e = h.board.elFor(m.uid);
          if (e && (m.from === 'mzone' || m.from === 'szone' || m.from === 'fzone')) {
            this.shatter(e);
            drop.add(m.uid);
            any = true;
          }
        }
        h.flush({ drop, instant: drop });
        if (any) h.sfx.play('destroy');
        return this.wait(any ? 560 : 300);
      }
      case 'flip': {
        h.flush();
        h.sfx.play('flip');
        return this.wait(420);
      }
      case 'negate': {
        h.sfx.play('negate');
        const e = h.board.elFor(a.card);
        if (e) this.cross(e);
        return;
      }
      case 'shuffle':
        return;
      case 'reveal': {
        h.flush();
        const cards = (a.cards as number[]).map((u) => h.game.card(u)).filter((c): c is CardInstance => !!c);
        // Only show the opponent's revealed cards (your own searches are already visible in your hand).
        const show = h.spectator ? cards : cards.filter((c) => c.owner !== h.me);
        if (!show.length) return;
        this.reveal(show);
        return this.wait(1200);
      }
      default:
        h.flush();
    }
  }

  // ------------------------------------------------------------------ primitives
  private pulse(uid: number, cls: string, ms: number) {
    const e = this.h.board.elFor(uid);
    if (!e || this.h.speed() <= 0) return;
    const classes = cls.split(' ');
    e.classList.remove(...classes);
    void e.offsetWidth;
    e.classList.add(...classes);
    window.setTimeout(() => e.classList.remove(...classes), ms * Math.max(0.3, this.h.speed()));
  }

  private place(node: HTMLElement, x: number, y: number) {
    const p = this.local(x, y);
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    this.h.overlay.appendChild(node);
  }

  private autoRemove(node: HTMLElement, ms: number) {
    window.setTimeout(() => node.remove(), Math.max(50, ms * this.h.speed()));
  }

  private ring(uid: number, cls: string) {
    const e = this.h.board.elFor(uid);
    if (!e || this.h.speed() <= 0) return;
    const c = center(e);
    const r = el(`fx-ring ${cls}`);
    r.style.setProperty('--sz', `${this.h.board.cw * 2.2}px`);
    this.place(r, c.x, c.y);
    this.autoRemove(r, 900);
  }

  private synchroBurst(uid: number) {
    const e = this.h.board.elFor(uid);
    if (!e || this.h.speed() <= 0) return;
    const c = center(e);
    const cw = this.h.board.cw;
    const wrap = el('fx-synchro');
    wrap.style.setProperty('--sz', `${cw * 3}px`);
    wrap.innerHTML = '<div class="sy-ring r1"></div><div class="sy-ring r2"></div><div class="sy-ring r3"></div><div class="sy-pillar"></div><div class="sy-flash"></div>';
    this.place(wrap, c.x, c.y);
    this.autoRemove(wrap, 1500);
    this.pulse(uid, 'fx-summon fx-synchro-card', 1400);
  }

  private showcase(c: CardInstance, chainIndex: number, player: PlayerId) {
    if (this.h.speed() <= 0) return;
    const src = this.h.board.elFor(c.uid);
    const ov = this.h.overlay.getBoundingClientRect();
    const w = Math.min(230, Math.max(150, ov.height * 0.3));
    const box = el(`fx-showcase ${player === this.h.me ? 'is-me' : 'is-opp'}`);
    const card = renderCard(c.data, { size: 'lg' });
    card.style.setProperty('--yc-w', `${w}px`);
    box.appendChild(card);
    if (chainIndex) box.appendChild(el('fx-showcase-badge', `<small>Chain</small>${chainIndex}`));
    box.appendChild(el('fx-showcase-glow'));
    const cx = ov.left + ov.width / 2 + (player === this.h.me ? -ov.width * 0.18 : ov.width * 0.18);
    const cy = ov.top + ov.height / 2;
    this.place(box, cx, cy);
    const sp = this.h.speed();
    let from = 'translate(-50%,-50%) scale(.35)';
    if (src) {
      const s = center(src);
      from = `translate(calc(-50% + ${s.x - cx}px), calc(-50% + ${s.y - cy}px)) scale(${(s.w / w).toFixed(3)})`;
    }
    box.animate(
      [
        { transform: from, opacity: 0.4 },
        { transform: 'translate(-50%,-50%) scale(1.04)', opacity: 1, offset: 0.28 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-50%,-50%) scale(.92)', opacity: 0 },
      ],
      { duration: 1050 * sp, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    this.autoRemove(box, 1100);
  }

  private reticle(t: HTMLElement) {
    if (this.h.speed() <= 0) return;
    const c = center(t);
    const r = el('fx-reticle', '<i></i><i></i><i></i><i></i>');
    r.style.setProperty('--sz', `${Math.max(c.w, c.h) * 1.15}px`);
    this.place(r, c.x, c.y);
    this.autoRemove(r, 900);
  }

  private beam(a: HTMLElement, b: HTMLElement, cls: string, ms: number) {
    if (this.h.speed() <= 0) return;
    const p = center(a);
    const q = center(b);
    const s = this.local(p.x, p.y);
    const e = this.local(q.x, q.y);
    const len = Math.hypot(e.x - s.x, e.y - s.y);
    const ang = (Math.atan2(e.y - s.y, e.x - s.x) * 180) / Math.PI;
    const beam = el(`fx-beam ${cls}`);
    beam.style.left = `${s.x}px`;
    beam.style.top = `${s.y}px`;
    beam.style.width = `${len}px`;
    beam.style.transform = `rotate(${ang}deg)`;
    this.h.overlay.appendChild(beam);
    this.autoRemove(beam, ms);
  }

  private lunge(a: HTMLElement, b: HTMLElement) {
    const sp = this.h.speed();
    if (sp <= 0) return;
    const p = center(a);
    const q = center(b);
    const dx = (q.x - p.x) * 0.42;
    const dy = (q.y - p.y) * 0.42;
    const fx = a.querySelector('.dc-fx') as HTMLElement | null;
    fx?.animate(
      [
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.08)`, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: 0.6 },
        { transform: 'translate(0,0) scale(1)' },
      ],
      { duration: 700 * sp, easing: 'cubic-bezier(.3,.7,.3,1)' },
    );
  }

  private spark(t: HTMLElement) {
    if (this.h.speed() <= 0) return;
    const c = center(t);
    const s = el('fx-spark', '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>');
    s.style.setProperty('--sz', `${this.h.board.cw * 1.6}px`);
    this.place(s, c.x, c.y);
    this.autoRemove(s, 700);
  }

  private shakeEl(e: HTMLElement) {
    const sp = this.h.speed();
    if (sp <= 0) return;
    const fx = (e.querySelector('.dc-fx') as HTMLElement) ?? e;
    fx.animate(
      [{ transform: 'translate(0,0)' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(4px,-2px)' }, { transform: 'translate(-3px,-1px)' }, { transform: 'translate(0,0)' }],
      { duration: 320 * sp },
    );
  }

  private shakeScreen() {
    const sp = this.h.speed();
    if (sp <= 0) return;
    this.h.board.stage.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: 'translate(-9px,5px)' },
        { transform: 'translate(8px,-6px)' },
        { transform: 'translate(-6px,-4px)' },
        { transform: 'translate(5px,4px)' },
        { transform: 'translate(0,0)' },
      ],
      { duration: 480 * sp },
    );
  }

  private floatNumber(p: PlayerId, text: string, cls: string, big: boolean) {
    if (this.h.speed() <= 0) return;
    const panel = this.h.panels[p];
    const lp = panel.el.querySelector('.pp-lp') ?? panel.el;
    const c = center(lp);
    const n = el(`fx-num ${cls}${big ? ' is-big' : ''}`, text);
    this.place(n, c.x, c.y);
    this.autoRemove(n, 1300);
    // second number over that player's field
    const side = this.h.board.sideOf(p).root;
    const s = center(side);
    const n2 = el(`fx-num fx-num--field ${cls}${big ? ' is-big' : ''}`, text);
    this.place(n2, s.x, s.y);
    this.autoRemove(n2, 1300);
  }

  private flashSide(p: PlayerId, cls: string) {
    if (this.h.speed() <= 0) return;
    const f = el(`fx-flash ${cls} ${p === this.h.me ? 'is-me' : 'is-opp'}`);
    this.h.overlay.appendChild(f);
    this.autoRemove(f, 800);
  }

  private shatter(e: HTMLElement) {
    if (this.h.speed() <= 0) return;
    const card = e.querySelector('.yc') as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const cols = 3;
    const rows = 4;
    const sp = this.h.speed();
    const rot = e.classList.contains('is-def');
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const piece = card.cloneNode(true) as HTMLElement;
        const x0 = (i / cols) * 100;
        const x1 = ((i + 1) / cols) * 100;
        const y0 = (j / rows) * 100;
        const y1 = ((j + 1) / rows) * 100;
        const jit = () => (Math.random() - 0.5) * 8;
        piece.style.clipPath = `polygon(${x0 + jit()}% ${y0 + jit()}%, ${x1 + jit()}% ${y0 + jit()}%, ${x1 + jit()}% ${y1 + jit()}%, ${x0 + jit()}% ${y1 + jit()}%)`;
        piece.classList.add('fx-shard');
        const w = card.offsetWidth;
        const hgt = card.offsetHeight;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const p = this.local(cx, cy);
        piece.style.setProperty('--yc-w', `${w}px`);
        piece.style.left = `${p.x - w / 2}px`;
        piece.style.top = `${p.y - hgt / 2}px`;
        this.h.overlay.appendChild(piece);
        const ang = Math.atan2((j + 0.5) / rows - 0.5, (i + 0.5) / cols - 0.5);
        const dist = 40 + Math.random() * 70;
        const base = rot ? 'rotate(-90deg) scale(.82)' : '';
        piece.animate(
          [
            { transform: `${base} translate(0,0) rotate(0)`, opacity: 1, filter: 'brightness(2)' },
            { transform: `${base} translate(${Math.cos(ang) * 6}px, ${Math.sin(ang) * 6}px)`, opacity: 1, filter: 'brightness(1.6)', offset: 0.15 },
            { transform: `${base} translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 30}px) rotate(${(Math.random() - 0.5) * 120}deg)`, opacity: 0, filter: 'brightness(1)' },
          ],
          { duration: 650 * sp, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' },
        );
        this.autoRemove(piece, 700);
      }
    }
    const fl = el('fx-ring ring--destroy');
    fl.style.setProperty('--sz', `${this.h.board.cw * 1.8}px`);
    this.place(fl, r.left + r.width / 2, r.top + r.height / 2);
    this.autoRemove(fl, 700);
  }

  private cross(e: HTMLElement) {
    if (this.h.speed() <= 0) return;
    const c = center(e);
    const x = el('fx-cross');
    x.style.setProperty('--sz', `${Math.max(c.w, c.h) * 0.9}px`);
    this.place(x, c.x, c.y);
    this.autoRemove(x, 1100);
  }

  private banner(html: string, cls: string, ms: number) {
    if (this.h.speed() <= 0) return;
    const b = el(`fx-banner ${cls}`, `<div class="fx-banner-in">${html}</div>`);
    const st = this.h.board.stage.getBoundingClientRect();
    this.place(b, st.left + st.width / 2, st.top + st.height / 2);
    this.autoRemove(b, ms);
  }

  private reveal(cards: CardInstance[]) {
    if (this.h.speed() <= 0) return;
    const wrap = el('fx-reveal');
    wrap.appendChild(el('fx-reveal-title', 'Revealed'));
    const row = el('fx-reveal-row');
    for (const c of cards) row.appendChild(renderCard(c.data, { size: 'md' }));
    wrap.appendChild(row);
    const st = this.h.board.stage.getBoundingClientRect();
    this.place(wrap, st.left + st.width / 2, st.top + st.height / 2);
    this.autoRemove(wrap, 1300);
  }

  /** Who goes first, as a sentence for the viewer. */
  private firstLabel(first: PlayerId) {
    const mine = first === this.h.me;
    return this.h.spectator ? `${this.h.names[first]} goes first` : mine ? 'You go first' : 'Opponent goes first';
  }

  /** Games 2 and 3: the loser chose, so there is nothing to roll. A short caption only. */
  private async firstCaption(first: PlayerId) {
    if (this.h.speed() <= 0) return;
    this.banner(`<b>${this.firstLabel(first)}</b>`, `banner--phase ${first === this.h.me ? 'is-me' : 'is-opp'}`, 1100);
    await this.wait(900);
  }

  /**
   * High roll for the first turn, like at locals: each player rolls one die, the higher roll
   * goes first and a tie is rolled again. The engine has already decided; the dice agree with it.
   */
  private async diceRoll(first: PlayerId) {
    const sp = this.h.speed();
    const reduce = sp <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const d6 = () => 1 + Math.floor(Math.random() * 6);
    // Rounds of [player 0, player 1]. Ties re-roll (at most two shown), the last round agrees with the engine.
    const rounds: [number, number][] = [];
    for (;;) {
      const r: [number, number] = [d6(), d6()];
      if (r[0] === r[1] && rounds.length < 2) {
        rounds.push(r);
        continue;
      }
      if (r[0] === r[1]) {
        if (r[first] < 6) r[first]++;
        else r[1 - first]--;
      }
      if (r[first] < r[1 - first]) r.reverse();
      rounds.push(r);
      break;
    }
    const top = (1 - this.h.me) as PlayerId;
    const who = (p: PlayerId) => (this.h.spectator ? this.h.names[p] : p === this.h.me ? 'You' : 'Opponent');
    const slot = (p: PlayerId) => {
      const s = el(`dice-slot ${p === this.h.me ? 'is-me' : 'is-opp'}`);
      const tray = el('dice-tray');
      const thrower = el('die-throw');
      const cube = el('die', DIE_FACES);
      thrower.append(el('die-shadow'), el('die-tilt'));
      thrower.lastElementChild!.appendChild(cube);
      tray.appendChild(thrower);
      s.append(tray, el('dice-who', who(p)));
      return { s, thrower, cube, shadow: thrower.firstElementChild as HTMLElement };
    };
    const slots = { [top]: slot(top), [this.h.me]: slot(this.h.me) } as Record<PlayerId, ReturnType<typeof slot>>;
    const caption = el('dice-caption');
    const wrap = el('fx-dice-wrap');
    wrap.append(slots[top].s, caption, slots[this.h.me].s);
    this.h.overlay.appendChild(wrap);
    const rollMs = 1250 * sp;
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      caption.innerHTML = i ? '<span>Tie · roll again</span>' : '';
      caption.classList.remove('is-shown');
      if (!reduce) this.h.sfx.play('coin');
      for (const p of [0, 1] as PlayerId[]) this.tumble(slots[p], r[p], reduce ? 0 : rollMs, p === top);
      if (!reduce) {
        await sleep(rollMs);
        this.h.sfx.play('coin');
      }
      const tie = r[0] === r[1];
      const line = this.h.spectator
        ? `${this.h.names[0]} rolled ${r[0]} · ${this.h.names[1]} rolled ${r[1]}`
        : `You rolled ${r[this.h.me]} · Opponent rolled ${r[top]}`;
      caption.innerHTML = `<span>${line}</span><b>${tie ? 'Tie · roll again' : this.firstLabel(first)}</b>`;
      caption.classList.add('is-shown');
      if (!tie) for (const p of [0, 1] as PlayerId[]) slots[p].s.classList.toggle('is-winner', p === first);
      await this.wait(tie ? 900 : 1500);
    }
    wrap.classList.add('out');
    window.setTimeout(() => wrap.remove(), 400);
  }

  /** Throw one die so it comes to rest showing `value`. */
  private tumble(s: { thrower: HTMLElement; cube: HTMLElement; shadow: HTMLElement }, value: number, ms: number, fromTop: boolean) {
    const rest = DIE_REST[value];
    const spinX = 360 * (2 + Math.floor(Math.random() * 2)) * (Math.random() < 0.5 ? 1 : -1);
    const spinY = 360 * (1 + Math.floor(Math.random() * 2)) * (Math.random() < 0.5 ? 1 : -1);
    const endZ = Math.round(Math.random() * 40 - 20);
    const final = `rotateZ(${endZ}deg) rotateX(0deg) rotateY(0deg) ${rest}`;
    s.cube.getAnimations().forEach((a) => a.cancel());
    s.thrower.getAnimations().forEach((a) => a.cancel());
    s.shadow.getAnimations().forEach((a) => a.cancel());
    s.cube.style.transform = final;
    if (ms <= 0) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const y0 = fromTop ? -1 : 1;
    s.cube.animate(
      [
        { transform: `rotateZ(${endZ + 200 * dir}deg) rotateX(${spinX}deg) rotateY(${spinY}deg) ${rest}` },
        { transform: `rotateZ(${endZ + 30 * dir}deg) rotateX(${spinX * 0.12}deg) rotateY(${spinY * 0.12}deg) ${rest}`, offset: 0.7 },
        { transform: final },
      ],
      { duration: ms, easing: 'cubic-bezier(.2,.65,.3,1)' },
    );
    // travel across the table with two small bounces before settling
    s.thrower.animate(
      [
        { transform: `translate(${-150 * dir}%, ${60 * y0}%) translateZ(0) scale(1.15)`, opacity: 0 },
        { transform: `translate(${-60 * dir}%, ${-30 * y0}%) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${-18 * dir}%, 0) scale(1)`, offset: 0.5 },
        { transform: `translate(${-6 * dir}%, -8%) scale(1.03)`, offset: 0.68 },
        { transform: 'translate(0, 0) scale(1)', offset: 0.85 },
        { transform: 'translate(0, -2%) scale(1.005)', offset: 0.92 },
        { transform: 'translate(0, 0) scale(1)' },
      ],
      { duration: ms, easing: 'ease-out' },
    );
    s.shadow.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0.5, transform: 'scale(.8)', offset: 0.5 }, { opacity: 1, transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
  }
}

/** Pip positions on a 3 × 3 grid, numbered 1-9 left to right, top to bottom. */
const PIPS: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
/** Faces as on a real die (opposite faces add up to 7). */
const DIE_FACES =
  '<i class="die-core die-core--x"></i><i class="die-core die-core--y"></i><i class="die-core die-core--z"></i>' +
  [1, 2, 3, 4, 5, 6].map((n) => `<div class="die-face die-f${n}">${PIPS[n].map((p) => `<i style="grid-area:p${p}"></i>`).join('')}</div>`).join('');
/** Rotation that brings each face to the front. */
const DIE_REST: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(-90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
};
