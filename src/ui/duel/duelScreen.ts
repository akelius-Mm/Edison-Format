// Duel screen: mounts the board, runs a Game to completion and resolves with the result.
import '../theme/theme.css';
import '../cards/cards.css';
import './duel.css';
import { createAI } from '../../ai/ai';
import type { CardData, CardInstance } from '../../engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, ResponseRequest, SelectRequest } from '../../engine/controller';
import { Ctx } from '../../engine/ctx';
import { Game, GameOver, phaseName } from '../../engine/game';
import type { BattlePos, PlayerId } from '../../engine/types';
import { ICONS } from '../cards/icons';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { applyPlaymat } from '../theme/playmats';
import { esc } from '../theme/util';
import type { DuelOptions, DuelResult } from './api';
import { BoardView, type RenderOpts } from './board';
import {
  Dialogs,
  type ModalHandle,
  type PromptCtx,
  confirmDialog,
  declareDialog,
  optionDialog,
  pileViewer,
  positionDialog,
  responseDialog,
  selectDialog,
  visibleTo,
} from './dialogs';
import { FxDirector, sleep } from './fx';
import { HumanController, type HumanUI, PacedController } from './human';
import { ChainStack, LogPanel, PhaseBar, PlayerPanel, PreviewPanel } from './panels';
import { Sfx } from './sound';

export async function startDuel(container: HTMLElement, opts: DuelOptions): Promise<DuelResult> {
  const screen = new DuelScreen(container, opts);
  return screen.run();
}

interface ActionState {
  p: PlayerId;
  actions: Action[];
  byCard: Map<number, Action[]>;
  resolve: (a: Action) => void;
}

interface AttackState {
  attacker: CardInstance;
  targets: CardInstance[];
  resolve: (v: CardInstance | null | 'cancel') => void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

class DuelScreen implements HumanUI {
  readonly game: Game;
  readonly root: HTMLElement;
  readonly overlay: HTMLElement;
  readonly board: BoardView;
  readonly panels: [PlayerPanel, PlayerPanel];
  readonly phaseBar: PhaseBar;
  readonly chain: ChainStack;
  readonly log: LogPanel;
  readonly preview: PreviewPanel;
  readonly dialogs: Dialogs;
  readonly sfx = new Sfx();
  readonly fx: FxDirector;
  readonly me: PlayerId;
  readonly viewer: PlayerId | null;
  readonly spectator: boolean;
  private specSpeed = 1;
  private paused = false;
  private pauseWaiters: (() => void)[] = [];
  private aborted: GameOver | null = null;
  private surrendered = false;
  private abortListeners = new Set<(e: GameOver) => void>();
  private raf = 0;
  private actionState: ActionState | null = null;
  private attackState: AttackState | null = null;
  private attackBar: ModalHandle | null = null;
  private unsubSettings: () => void;
  private yieldCounter = 0;
  private speedBtns: HTMLButtonElement[] = [];
  private soundBtn!: HTMLButtonElement;

  constructor(
    private container: HTMLElement,
    private opts: DuelOptions,
  ) {
    const s = getSettings();
    const humanIdx = opts.sides.findIndex((x) => x.control === 'human');
    this.spectator = opts.sides[0].control !== 'human' && humanIdx < 0;
    this.me = (humanIdx >= 0 ? humanIdx : 0) as PlayerId;
    this.viewer = this.spectator ? null : this.me;
    this.sfx.enabled = s.sound;
    this.sfx.volume = s.volume;

    const controllers = opts.sides.map((side, i) => {
      if (side.control === 'human') return new HumanController(this);
      const ai = createAI(side.control, (opts.seed ?? Math.floor(Math.random() * 1e9)) + i * 7919);
      return new PacedController(ai, { pace: (ms) => this.aiPace(ms) });
    }) as [any, any];

    this.game = new Game([opts.sides[0].deck, opts.sides[1].deck], controllers, {
      seed: opts.seed,
      names: [opts.sides[0].name, opts.sides[1].name],
      firstPlayer: typeof opts.firstPlayer === 'number' ? opts.firstPlayer : undefined,
      skipFirstDraw: s.skipFirstDraw,
    });

    // ---- DOM
    this.root = h('div', `duel-root${this.spectator ? ' is-spectator' : ''}${s.showLog ? '' : ' hide-log'}`);
    this.root.tabIndex = -1;
    applyPlaymat(this.root, opts.playmat);
    this.root.style.background = '';
    this.overlay = h('div', 'duel-overlay');
    const sleeves: [string, string] = [opts.sides[0].sleeve, opts.sides[1].sleeve];
    this.board = new BoardView(this.game, { me: this.me, viewer: this.viewer, sleeves, speed: () => this.speed() });
    const opp = this.game.opp(this.me);
    const startLp = this.game.options.startLP;
    const p0 = new PlayerPanel(opts.sides[0], 0, this.me === 0, startLp, () => this.speed());
    const p1 = new PlayerPanel(opts.sides[1], 1, this.me === 1, startLp, () => this.speed());
    this.panels = [p0, p1];
    this.phaseBar = new PhaseBar(this.me);
    this.chain = new ChainStack(this.me);
    this.log = new LogPanel(this.me);
    this.preview = new PreviewPanel(this.game);
    this.dialogs = new Dialogs(this.root, this.sfx);

    const left = h('div', 'duel-left');
    left.append(this.panels[opp].el, this.preview.el, this.panels[this.me].el);
    const center = h('div', 'duel-center');
    const mat = h('div', 'duel-mat');
    applyPlaymat(mat, opts.playmat);
    center.appendChild(mat);
    const right = h('div', 'duel-right');
    right.append(this.buildTopBar(), this.phaseBar.el, this.chain.el, this.log.el);
    this.root.append(left, center, right, this.overlay);
    container.innerHTML = '';
    container.appendChild(this.root);
    this.board.mount(mat);

    this.fx = new FxDirector({
      game: this.game,
      board: this.board,
      root: this.root,
      overlay: this.overlay,
      chain: this.chain,
      panels: this.panels,
      sfx: this.sfx,
      me: this.me,
      spectator: this.spectator,
      names: [opts.sides[0].name, opts.sides[1].name],
      speed: () => this.speed(),
      flush: (o) => this.flush(o),
      spotlight: (c) => {
        if (this.canSee(c)) this.preview.show(c.data, c);
      },
    });

    // ---- wiring
    this.board.onCardClick = (c, el, ev) => this.onCardClick(c, el, ev);
    this.board.onCardHover = (c) => {
      if (c && this.canSee(c)) this.preview.show(c.data, c);
    };
    this.board.onPileClick = (p, loc, ev) => this.onPileClick(p, loc, ev);
    this.phaseBar.btnBattle.onclick = () => this.clickPhase('battle');
    this.phaseBar.btnMain2.onclick = () => this.clickPhase('main2');
    this.phaseBar.btnEnd.onclick = () => this.clickPhase('end');
    this.root.addEventListener('click', () => this.dialogs.closeMenu());

    this.game.hooks = {
      update: () => this.scheduleRender(),
      log: (e) => this.log.add(e),
      anim: async (a) => {
        if (this.aborted && a.type !== 'negate') throw this.aborted;
        try {
          await this.fx.handle(a);
        } catch (e) {
          console.error('anim error', e);
        }
        if (this.aborted && a.type !== 'negate') throw this.aborted;
      },
    };
    let officialImages = s.officialImages;
    this.unsubSettings = onSettingsChange((st) => {
      if (st.officialImages !== officialImages) {
        officialImages = st.officialImages;
        this.board.invalidateFaces();
        this.flush();
        this.preview.invalidate();
      }
      this.sfx.enabled = st.sound;
      this.sfx.volume = st.volume;
      this.updateSoundBtn();
      this.applySpeedVar();
    });
    this.applySpeedVar();
  }

  // ------------------------------------------------------------------ chrome
  private buildTopBar() {
    const top = h('div', 'duel-top');
    const cap = h('div', 'duel-caption');
    cap.innerHTML = `<b>${esc(this.opts.caption ?? 'Duel')}</b>${this.spectator ? '<span class="tag">Spectating</span>' : ''}`;
    const btns = h('div', 'duel-tools');
    const logBtn = h('button', 'icon-btn', ICONS.log) as HTMLButtonElement;
    logBtn.title = 'Toggle duel log';
    logBtn.onclick = () => {
      this.root.classList.toggle('hide-log');
      updateSettings({ showLog: !this.root.classList.contains('hide-log') });
    };
    this.soundBtn = h('button', 'icon-btn') as HTMLButtonElement;
    this.soundBtn.title = 'Toggle sound';
    this.soundBtn.onclick = () => updateSettings({ sound: !getSettings().sound });
    this.updateSoundBtn();
    btns.append(logBtn, this.soundBtn);
    const canSurrender = !this.spectator && (this.opts.allowSurrender ?? true);
    if (canSurrender || this.spectator) {
      const sur = h('button', 'icon-btn icon-btn--danger', ICONS.flag) as HTMLButtonElement;
      sur.title = this.spectator ? 'Stop watching' : 'Surrender';
      sur.onclick = () => void this.surrender();
      btns.appendChild(sur);
    }
    top.append(cap, btns);
    if (this.spectator) {
      const spd = h('div', 'spec-speed');
      const mk = (label: string, v: number, title: string) => {
        const b = h('button', 'chip-btn', label) as HTMLButtonElement;
        b.title = title;
        b.onclick = () => {
          if (v === 0) this.setPaused(!this.paused);
          else {
            this.specSpeed = v;
            this.setPaused(false);
          }
          this.refreshSpeedBtns();
          this.applySpeedVar();
        };
        b.dataset.v = String(v);
        this.speedBtns.push(b);
        return b;
      };
      spd.append(mk(ICONS.pause, 0, 'Pause / resume'), mk('1×', 1, 'Normal speed'), mk('2×', 2, 'Fast'), mk('4×', 4, 'Very fast'), mk('⏭', 1000, 'Skip animations'));
      top.appendChild(spd);
      this.refreshSpeedBtns();
    }
    return top;
  }

  private refreshSpeedBtns() {
    for (const b of this.speedBtns) {
      const v = Number(b.dataset.v);
      b.classList.toggle('is-on', v === 0 ? this.paused : !this.paused && v === this.specSpeed);
      if (v === 0) b.innerHTML = this.paused ? ICONS.play : ICONS.pause;
    }
  }

  private updateSoundBtn() {
    if (!this.soundBtn) return;
    const on = getSettings().sound;
    this.soundBtn.innerHTML = on ? ICONS.sound : ICONS.mute;
    this.soundBtn.classList.toggle('is-off', !on);
  }

  private applySpeedVar() {
    this.root.style.setProperty('--sp', String(this.speed()));
  }

  speed(): number {
    const base = getSettings().animationSpeed;
    if (!(base > 0)) return 0;
    if (this.spectator) return this.specSpeed >= 1000 ? 0 : base / this.specSpeed;
    return base;
  }

  private setPaused(v: boolean) {
    this.paused = v;
    this.root.classList.toggle('is-paused', v);
    if (!v) {
      const w = this.pauseWaiters;
      this.pauseWaiters = [];
      w.forEach((f) => f());
    }
  }

  // ------------------------------------------------------------------ rendering
  private scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderAll();
    });
  }

  flush(o?: RenderOpts) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderAll(o);
  }

  private renderAll(o?: RenderOpts) {
    this.board.render(o);
    this.panels[0].update(this.game);
    this.panels[1].update(this.game);
    this.phaseBar.update(this.game);
    this.chain.update(this.game);
    this.preview.refresh();
    if (this.actionState) this.markActions();
  }

  private canSee(c: CardInstance) {
    if (this.viewer === null) return c.faceUp || this.game.isPublic(c, 0) && this.game.isPublic(c, 1);
    return visibleTo(this.game, c, this.viewer);
  }

  // ------------------------------------------------------------------ run
  async run(): Promise<DuelResult> {
    this.flush();
    let res: { winner: PlayerId | null; reason: string; turns: number };
    try {
      res = await this.game.start();
    } catch (e) {
      if (e instanceof GameOver) res = { winner: e.winner, reason: e.reason, turns: this.game.turn };
      else {
        console.error('Duel crashed', e);
        res = { winner: null, reason: `Engine error: ${(e as Error)?.message ?? e}`, turns: this.game.turn };
      }
    }
    if (this.surrendered) res = { winner: this.game.opp(this.me), reason: 'Surrender', turns: this.game.turn };
    this.clearInteraction();
    this.dialogs.closeAll();
    this.flush();
    await this.showResult(res);
    this.teardown();
    const out: DuelResult = { winner: res.winner, reason: res.reason, turns: res.turns };
    if (this.surrendered) out.surrendered = true;
    return out;
  }

  private teardown() {
    this.unsubSettings();
    this.dialogs.dispose();
    this.board.destroy();
    if (this.raf) cancelAnimationFrame(this.raf);
    window.setTimeout(() => this.sfx.dispose(), 1500);
    this.root.remove();
    document.querySelectorAll('body > .dc-ghost').forEach((e) => e.remove());
  }

  private showResult(res: { winner: PlayerId | null; reason: string; turns: number }): Promise<void> {
    return new Promise((resolve) => {
      const win = res.winner;
      let title: string;
      let cls: string;
      if (win === null) {
        title = 'Draw';
        cls = 'is-draw';
      } else if (this.spectator) {
        title = `${this.opts.sides[win].name} Wins`;
        cls = 'is-win';
      } else if (win === this.me) {
        title = 'Victory';
        cls = 'is-win';
      } else {
        title = 'Defeat';
        cls = 'is-lose';
      }
      this.sfx.play(cls === 'is-lose' ? 'lose' : 'win');
      const lp = this.game.players.map((p) => p.lp);
      const o = h('div', `result ${cls}`);
      o.innerHTML = `<div class="result-rays"></div><div class="result-box">
        <div class="result-title">${esc(title)}</div>
        <div class="result-reason">${esc(res.reason)}</div>
        <div class="result-stats">
          <div><small>${esc(this.opts.sides[this.me].name)}</small><b>${lp[this.me]} LP</b></div>
          <div><small>Turns</small><b>${res.turns}</b></div>
          <div><small>${esc(this.opts.sides[this.game.opp(this.me)].name)}</small><b>${lp[this.game.opp(this.me)]} LP</b></div>
        </div>
        <button class="btn btn--primary btn--lg result-continue"><span>Continue</span></button>
      </div>`;
      this.root.appendChild(o);
      requestAnimationFrame(() => o.classList.add('is-open'));
      const btn = o.querySelector('.result-continue') as HTMLButtonElement;
      btn.onclick = () => {
        this.sfx.play('click');
        resolve();
      };
      window.setTimeout(() => btn.focus(), 300);
    });
  }

  private async surrender() {
    if (this.aborted) return;
    const yes = await confirmDialog(
      this.dialogs,
      { prompt: this.spectator ? 'Stop watching this duel?' : 'Surrender this duel?' },
      this.spectator ? 'Stop' : 'Surrender',
      'Keep playing',
    );
    if (!yes || this.aborted) return;
    if (this.spectator) {
      this.abort(new GameOver(null, 'Spectating stopped'));
      return;
    }
    this.surrendered = true;
    this.abort(new GameOver(this.game.opp(this.me), 'Surrender'));
  }

  private abort(e: GameOver) {
    this.aborted = e;
    this.dialogs.closeAll();
    this.clearInteraction();
    for (const l of [...this.abortListeners]) l(e);
    this.abortListeners.clear();
    this.setPaused(false);
  }

  /** Race a UI promise against abort (surrender). */
  private guard<T>(p: Promise<T>): Promise<T> {
    if (this.aborted) return Promise.reject(this.aborted);
    return new Promise<T>((resolve, reject) => {
      const onAbort = (e: GameOver) => reject(e);
      this.abortListeners.add(onAbort);
      p.then(
        (v) => {
          this.abortListeners.delete(onAbort);
          if (this.aborted) reject(this.aborted);
          else resolve(v);
        },
        (err) => {
          this.abortListeners.delete(onAbort);
          reject(err);
        },
      );
    });
  }

  private async aiPace(ms: number) {
    if (this.aborted) throw this.aborted;
    if (this.paused) await new Promise<void>((r) => this.pauseWaiters.push(r));
    const t = ms * this.speed();
    if (t > 0) await sleep(t);
    else if (++this.yieldCounter % 4 === 0) await sleep(0);
    if (this.aborted) throw this.aborted;
  }

  private promptCtx(): PromptCtx {
    return {
      game: this.game,
      viewer: this.viewer ?? this.me,
      sleeves: [this.opts.sides[0].sleeve, this.opts.sides[1].sleeve],
      sfx: this.sfx,
      preview: (c) => {
        if ('uid' in (c as any)) this.preview.show((c as CardInstance).data, c as CardInstance);
        else this.preview.show(c as CardData);
      },
      highlight: (uids, cls) => uids.forEach((u) => this.board.mark(u, cls)),
      clearHighlight: (cls) => this.board.clearMarks(cls),
    };
  }

  // ------------------------------------------------------------------ HumanUI: main actions
  requestAction(p: PlayerId, actions: Action[]): Promise<Action> {
    this.flush();
    const byCard = new Map<number, Action[]>();
    for (const a of actions) {
      if (a.type === 'phase' || a.type === 'surrender') continue;
      const list = byCard.get(a.card.uid) ?? [];
      list.push(a);
      byCard.set(a.card.uid, list);
    }
    const promise = new Promise<Action>((resolve) => {
      this.actionState = { p, actions, byCard, resolve };
    });
    this.markActions();
    const has = (to: string) => actions.some((a) => a.type === 'phase' && a.to === to);
    this.phaseBar.btnBattle.disabled = !has('battle');
    this.phaseBar.btnMain2.disabled = !has('main2');
    this.phaseBar.btnEnd.disabled = !has('end');
    this.phaseBar.el.classList.add('is-active');
    this.root.classList.add('awaiting-action');
    return this.guard(promise);
  }

  private markActions() {
    const st = this.actionState;
    this.board.clearMarks('can-act');
    if (!st) return;
    for (const uid of st.byCard.keys()) this.board.mark(uid, 'can-act');
    const g = this.game;
    for (const [uid] of st.byCard) {
      const c = g.card(uid);
      if (!c) continue;
      if (c.location === 'extra') this.board.markPile(c.owner, 'extra', 'can-act');
      if (c.location === 'grave') this.board.markPile(c.owner, 'grave', 'can-act');
      if (c.location === 'banished') this.board.markPile(c.owner, 'banished', 'can-act');
    }
  }

  private resolveAction(a: Action) {
    const st = this.actionState;
    if (!st) return;
    this.actionState = null;
    this.board.clearMarks('can-act');
    this.dialogs.closeMenu();
    this.phaseBar.btnBattle.disabled = true;
    this.phaseBar.btnMain2.disabled = true;
    this.phaseBar.btnEnd.disabled = true;
    this.phaseBar.el.classList.remove('is-active');
    this.root.classList.remove('awaiting-action');
    this.sfx.play('click');
    st.resolve(a);
  }

  private clearInteraction() {
    this.actionState = null;
    this.attackState = null;
    this.attackBar?.close();
    this.attackBar = null;
    this.board.clearMarks('can-act', 'is-target', 'is-attacker', 'is-candidate', 'is-response');
    this.phaseBar.btnBattle.disabled = true;
    this.phaseBar.btnMain2.disabled = true;
    this.phaseBar.btnEnd.disabled = true;
    this.root.classList.remove('awaiting-action');
  }

  private async clickPhase(to: 'battle' | 'main2' | 'end') {
    const st = this.actionState;
    if (!st) return;
    const a = st.actions.find((x) => x.type === 'phase' && x.to === to);
    if (!a) return;
    if (to === 'end' && getSettings().confirmEndTurn) {
      const other = st.actions.some((x) => x.type !== 'phase');
      if (other) {
        const ok = await confirmDialog(this.dialogs, { prompt: 'End your turn? You still have possible actions.' }, 'End Turn', 'Cancel');
        if (!ok || this.actionState !== st) return;
      }
    }
    this.resolveAction(a);
  }

  actionLabel(a: Action): { label: string; sub?: string } {
    const g = this.game;
    switch (a.type) {
      case 'summon': {
        const n = g.tributesNeeded(a.card);
        return n ? { label: 'Tribute Summon', sub: `Tribute ${n}` } : { label: 'Normal Summon' };
      }
      case 'set': {
        const n = g.tributesNeeded(a.card);
        return n ? { label: 'Set', sub: `Tribute ${n}` } : { label: 'Set' };
      }
      case 'setST':
        return { label: 'Set' };
      case 'flip':
        return { label: 'Flip Summon' };
      case 'position':
        return { label: a.card.pos === 'atk' ? 'Change to Defense' : 'Change to Attack' };
      case 'activate': {
        const isCard = a.act.effect.kind === 'activate' && !a.card.isMonster;
        if (isCard) return { label: 'Activate', sub: a.act.effect.label && a.act.effect.label !== 'Activate' ? a.act.effect.label : undefined };
        return { label: 'Activate Effect', sub: a.act.label };
      }
      case 'proc':
        return { label: 'Special Summon', sub: a.act.label !== 'Special Summon' ? a.act.label : undefined };
      case 'synchro':
        return { label: 'Synchro Summon' };
      case 'attack':
        return { label: 'Attack' };
      default:
        return { label: a.type };
    }
  }

  private onCardClick(c: CardInstance, el: HTMLElement, ev: MouseEvent) {
    if (this.canSee(c)) this.preview.show(c.data, c);
    // attack targeting
    if (this.attackState) {
      if (this.attackState.targets.includes(c)) {
        const st = this.attackState;
        this.endAttackTargeting();
        st.resolve(c);
      }
      return;
    }
    if (c.location === 'grave' || c.location === 'banished') {
      this.openPile(c.owner, c.location);
      return;
    }
    const st = this.actionState;
    if (!st) return;
    const acts = st.byCard.get(c.uid);
    if (!acts?.length) {
      this.dialogs.closeMenu();
      return;
    }
    if (acts.length === 1 && acts[0].type === 'attack') {
      this.resolveAction(acts[0]);
      return;
    }
    const r = el.getBoundingClientRect();
    this.dialogs.menuAt(
      r.left + r.width / 2,
      r.top,
      c.name,
      acts.map((a) => {
        const l = this.actionLabel(a);
        return { label: l.label, sub: l.sub, onClick: () => this.resolveAction(a), kind: a.type === 'attack' ? 'is-attack' : '' };
      }),
    );
    void ev;
  }

  private onPileClick(p: PlayerId, loc: 'grave' | 'banished' | 'extra' | 'deck', ev: MouseEvent) {
    void ev;
    if (loc === 'deck') {
      this.toast(`${this.opts.sides[p].name}'s Deck: ${this.game.players[p].deck.length} cards`);
      return;
    }
    this.openPile(p, loc);
  }

  private openPile(p: PlayerId, loc: 'grave' | 'banished' | 'extra') {
    const g = this.game;
    const cards = loc === 'grave' ? g.players[p].grave : loc === 'banished' ? g.players[p].banished : g.players[p].extra;
    const names = { grave: 'Graveyard', banished: 'Banished', extra: 'Extra Deck' };
    const whose = this.spectator ? `${this.opts.sides[p].name}'s` : p === this.me ? 'Your' : "Opponent's";
    const st = this.actionState;
    pileViewer(this.dialogs, this.promptCtx(), `${whose} ${names[loc]}`, cards, {
      faceDown: (c) => !this.canSee(c),
      actions: (c) => {
        const acts = st && this.actionState === st ? st.byCard.get(c.uid) ?? [] : [];
        return acts.map((a) => ({ label: this.actionLabel(a).label, onClick: () => this.resolveAction(a) }));
      },
    });
  }

  private toast(text: string) {
    const t = h('div', 'toast', esc(text));
    this.root.appendChild(t);
    window.setTimeout(() => t.classList.add('out'), 1600);
    window.setTimeout(() => t.remove(), 2000);
  }

  // ------------------------------------------------------------------ HumanUI: attack targeting
  requestAttackTarget(p: PlayerId, attacker: CardInstance, targets: CardInstance[], canDirect: boolean): Promise<CardInstance | null | 'cancel'> {
    this.flush();
    if (!targets.length && canDirect && !this.game.battle) return Promise.resolve(null);
    if (!targets.length && !canDirect) return Promise.resolve('cancel');
    const replay = !!this.game.battle;
    const promise = new Promise<CardInstance | null | 'cancel'>((resolve) => {
      this.attackState = { attacker, targets, resolve };
    });
    for (const t of targets) this.board.mark(t.uid, 'is-target');
    this.board.mark(attacker.uid, 'is-attacker');
    const actions = [] as { label: string; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; onClick: () => void; hotkey?: string }[];
    if (canDirect)
      actions.push({
        label: 'Direct Attack',
        kind: 'danger',
        onClick: () => {
          const st = this.attackState;
          this.endAttackTargeting();
          st?.resolve(null);
        },
      });
    actions.push({
      label: replay ? 'Stop attack' : 'Cancel',
      kind: 'ghost',
      hotkey: 'Escape',
      onClick: () => {
        const st = this.attackState;
        this.endAttackTargeting();
        st?.resolve('cancel');
      },
    });
    this.attackBar = this.dialogs.modal({
      title: replay ? `Replay: ${attacker.name}` : `Attack with ${attacker.name}`,
      subtitle: targets.length ? 'Click an opponent monster to attack it.' : 'Attack directly?',
      source: attacker.data,
      actions,
      docked: true,
      className: 'dlg--attack',
    });
    return this.guard(promise);
  }

  private endAttackTargeting() {
    this.attackState = null;
    this.attackBar?.close();
    this.attackBar = null;
    this.board.clearMarks('is-target', 'is-attacker');
  }

  // ------------------------------------------------------------------ HumanUI: prompts
  private shouldPrompt(p: PlayerId, req: ResponseRequest): boolean {
    if (!req.options.length) return false;
    if (getSettings().responsePrompts === 'always') return true;
    if (req.kind === 'chain' || req.kind === 'attack' || req.kind === 'damage' || req.kind === 'summonNegation') return true;
    return req.options.some((o) => {
      if (o.event) return true;
      const c = o.card;
      const setCard = c.onField && !c.faceUp && (c.isTrap || c.data.stype === 'quickplay');
      if (!setCard) return false;
      return this.aiScore(p, o) > 0;
    });
  }

  private aiScore(p: PlayerId, o: Activation): number {
    const fn = o.effect.ai?.score;
    if (!fn) return 0;
    try {
      const ctx = new Ctx(this.game, o.card, o.effect, p);
      ctx.effectIndex = o.effectIndex;
      ctx.event = o.event;
      return fn(ctx);
    } catch {
      return 0;
    }
  }

  async requestResponse(p: PlayerId, req: ResponseRequest): Promise<Activation | null> {
    if (!this.shouldPrompt(p, req)) return null;
    this.flush();
    const g = this.game;
    let title = 'Respond?';
    switch (req.kind) {
      case 'chain': {
        const top = g.chain[g.chain.length - 1];
        title = top ? (top.player === p ? `Chain to your ${top.card.name}?` : `Opponent activated ${top.card.name} — chain?`) : 'Chain?';
        break;
      }
      case 'attack':
        title = g.battle && g.battle.attacker.controller !== p ? `${g.battle.attacker.name} attacks!` : 'Attack declared';
        break;
      case 'damage':
        title = 'Damage Step';
        break;
      case 'summonNegation':
        title = 'Negate this summon?';
        break;
      case 'phase':
        title = `${phaseName(g.phase)} — activate a card?`;
        break;
      default:
        title = 'Respond?';
    }
    this.sfx.play('target');
    let sub = req.prompt;
    if (title === 'Respond?' && req.prompt && req.prompt !== 'Respond?') {
      title = req.prompt;
      sub = '';
    }
    if (sub === title || sub === 'Respond?') sub = '';
    return this.guard(responseDialog(this.dialogs, this.promptCtx(), { ...req, prompt: sub }, title));
  }

  requestSelect(_p: PlayerId, req: SelectRequest): Promise<CardInstance[]> {
    this.flush();
    const d = selectDialog(this.dialogs, this.promptCtx(), req);
    return this.guard(d.promise);
  }

  requestOption(_p: PlayerId, req: OptionRequest): Promise<number> {
    this.flush();
    return this.guard(optionDialog(this.dialogs, req));
  }

  requestConfirm(_p: PlayerId, req: ConfirmRequest): Promise<boolean> {
    this.flush();
    return this.guard(confirmDialog(this.dialogs, req));
  }

  requestPosition(_p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]): Promise<BattlePos | 'set'> {
    this.flush();
    return this.guard(positionDialog(this.dialogs, this.promptCtx(), card, allowed));
  }

  requestTrigger(_p: PlayerId, act: Activation): Promise<boolean> {
    this.flush();
    return this.guard(
      confirmDialog(this.dialogs, { prompt: `Activate ${act.card.name}${act.label && act.label !== 'Trigger' ? ` (${act.label})` : ''}?`, source: act.card }, 'Activate', 'Skip'),
    );
  }

  requestDeclare(_p: PlayerId, prompt: string, names: string[]): Promise<string> {
    this.flush();
    return this.guard(declareDialog(this.dialogs, prompt, names));
  }
}
