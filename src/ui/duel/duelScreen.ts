// Duel screen: mounts the board, runs a Game to completion and resolves with the result.
import '../theme/theme.css';
import '../cards/cards.css';
import './duel.css';
import { createAI } from '../../ai/ai';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../../engine/controller';
import { Ctx } from '../../engine/ctx';
import { Game, GameOver, phaseName, type LogEntry } from '../../engine/game';
import { RecordingController } from '../../engine/replay';
import type { BattlePos, PlayerId } from '../../engine/types';
import { ICONS } from '../cards/icons';
import { preloadOfficialImages } from '../cards/officialArt';
import { zoomCard } from '../cards/zoom';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { applyMatVars, applyPlaymat, opponentMat } from '../theme/playmats';
import { esc } from '../theme/util';
import type { DuelOptions, DuelResult } from './api';
import { BoardView, type RenderOpts } from './board';
import {
  Dialogs,
  type ModalHandle,
  type PromptCtx,
  confirmDialog,
  isTouchUI,
  declareDialog,
  optionDialog,
  pileViewer,
  positionDialog,
  responseDialog,
  selectDialog,
  visibleTo,
} from './dialogs';
import { HandFidget } from './fidget';
import { FxDirector, sleep } from './fx';
import { FAST_FORWARD, setupHurry } from './hurry';
import { HumanController, type HumanUI, PacedController } from './human';
import { ChainStack, LogPanel, PhaseBar, PlayerPanel, PreviewPanel } from './panels';
import { Sfx } from './sound';
import { music } from '../audio/music';
import { haptic } from '../haptics';
import { duelLogLine, reportError, setDuelDiag } from '../diag';
import { openReportSheet } from '../screens/report';

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
  /** Idle hand-shuffle while the opponent plays (fidget.ts). */
  readonly fidget: HandFidget;
  readonly me: PlayerId;
  readonly viewer: PlayerId | null;
  readonly spectator: boolean;
  private specSpeed = 1;
  /** Fast-forward through the opponent's turn (the button); ends at the player's next decision. */
  private ff = false;
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
  /** Records the human's decisions (and replays saved ones when resuming). */
  private recorder: RecordingController | null = null;
  /** Feeding saved decisions back: no rendering, animation or sound until the log runs out. */
  private replaying = false;
  private replayLog: LogEntry[] = [];
  private restoringEl: HTMLElement | null = null;
  private left = false;
  /** Play a friend: told about every abort (surrender included). */
  private externalAbort: ((winner: PlayerId | null, reason: string) => void)[] = [];

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

    // One seed drives the shuffle, coin toss, card effects and the AI, so a duel is reproducible
    // from its seed, decks and the human's decisions (see engine/replay.ts).
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.replaying = !!opts.replay?.length || !!opts.spectate?.catchUp;
    const controllers = opts.sides.map((side, i) => {
      // Friends Locals spectating: both seats come from the players' decision logs.
      if (opts.spectate) return this.spectateSeat(opts.spectate.controllers[i]);
      // Play a friend: the friend's seat is driven from the network.
      if (opts.remote && side.control !== 'human') return this.remoteSeat(opts.remote);
      if (side.control === 'human') {
        const rec = new RecordingController(opts.localDriver ?? new HumanController(this), {
          replay: opts.replay,
          onDecision: (log, game) => opts.onDecision?.(log, game),
          onReplayEnd: () => this.endReplay(),
        });
        this.recorder ??= rec;
        return rec;
      }
      const ai = createAI(side.control, seed + i * 7919);
      return new PacedController(ai, { pace: (ms) => this.aiPace(ms) });
    }) as [any, any];

    this.game = new Game([opts.sides[0].deck, opts.sides[1].deck], controllers, {
      seed,
      names: [opts.sides[0].name, opts.sides[1].name],
      firstPlayer: typeof opts.firstPlayer === 'number' ? opts.firstPlayer : undefined,
      skipFirstDraw: opts.skipFirstDraw ?? s.skipFirstDraw,
    });

    // "Report a problem" carries this duel: seed, decks and decisions replay it exactly
    setDuelDiag({ opts, seed, me: this.me, log: () => this.recorder?.log ?? [], turn: () => this.game.turn });

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
    for (const p of this.panels) p.onLpRoll = (ms, up, amount) => this.sfx.lpTicker(ms, up, amount);
    this.phaseBar = new PhaseBar(this.me);
    if (this.spectator) this.phaseBar.setSpectatorLabels([opts.sides[0].name, opts.sides[1].name]);
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
    this.setupPhoneGestures(center);
    setupHurry(this, center);
    container.innerHTML = '';
    container.appendChild(this.root);
    this.board.mount(mat);
    // Each player has their own mat on their half of the table, like at a real event.
    mat.classList.add('mats-split');
    mat.style.background = '';
    const sideMe = mat.querySelector<HTMLElement>('.side-me');
    const sideOpp = mat.querySelector<HTMLElement>('.side-opp');
    if (sideMe) applyMatVars(sideMe, opts.playmat);
    if (sideOpp) applyMatVars(sideOpp, opts.oppPlaymat ?? opponentMat(opts.sides[1].name, opts.playmat));

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
      firstChosen: typeof opts.firstPlayer === 'number',
      speed: () => this.speed(),
      flush: (o) => this.flush(o),
      spotlight: (c) => {
        if (this.canSee(c)) this.preview.show(c.data, c);
      },
    });

    this.fidget = new HandFidget({
      board: this.board,
      sfx: this.sfx,
      me: this.me,
      spectator: this.spectator,
      speed: () => this.speed(),
      deciding: () => this.deciding(),
    });
    // a card entering or leaving the hand stops a shuffle at once
    this.board.onHandChange = () => this.fidget.cancel();

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
      update: () => {
        if (!this.replaying) this.scheduleRender();
      },
      log: (e) => {
        duelLogLine(e.turn, e.text);
        if (this.replaying) this.replayLog.push(e);
        else this.log.add(e);
      },
      anim: async (a) => {
        if (this.aborted && a.type !== 'negate') throw this.aborted;
        if (this.replaying) return;
        if (a.type === 'turn') this.fidget.turnStarted(a.player as PlayerId);
        try {
          await this.fx.handle(a);
        } catch (e) {
          console.error('anim error', e);
        }
        if (this.aborted && a.type !== 'negate') throw this.aborted;
      },
    };
    let officialImages = s.officialImages;
    // Fetch both decks' card scans now, so a card played later shows its real image straight away.
    const preload = () => preloadOfficialImages(opts.sides.flatMap((d) => [...d.deck.main, ...d.deck.extra].map((c) => c.name)));
    if (officialImages) preload();
    this.unsubSettings = onSettingsChange((st) => {
      if (st.officialImages !== officialImages) {
        officialImages = st.officialImages;
        if (officialImages) preload();
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
    // Play a friend: hand the caller a way to end the game and decorate the board.
    if (opts.onMount) {
      const self = this;
      opts.onMount({
        game: this.game,
        root: this.root,
        me: this.me,
        abort: (winner, reason) => this.abort(new GameOver(winner, reason)),
        leave: () => this.leaveSaved(),
        onAbort: (fn) => this.externalAbort.push(fn),
        get restoring() {
          return self.replaying;
        },
        endCatchUp: () => this.endCatchUp(),
      });
    }
  }

  // ------------------------------------------------------------------ phone
  /** Long-press any card to read it; tap the sheet to close. Portrait phones only. */
  private setupPhoneGestures(center: HTMLElement) {
    // Show the tip only the first time.
    let seen = false;
    try {
      seen = localStorage.getItem('edison.hint.hold') === '1';
      localStorage.setItem('edison.hint.hold', '1');
    } catch {
      /* ignore */
    }
    if (!seen) {
      const hint = h('div', 'phone-hint', 'Hold a card to read it');
      center.appendChild(hint);
      window.setTimeout(() => hint.classList.add('is-gone'), 5000);
    }
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let swallowClick = false;
    this.root.addEventListener('pointerdown', (ev) => {
      if (!isPhonePortrait() || ev.pointerType === 'mouse') return;
      const target = (ev.target as HTMLElement).closest('.dc, .yc');
      if (!target || target.closest('.preview')) return;
      startX = ev.clientX;
      startY = ev.clientY;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        swallowClick = true;
        this.root.classList.remove('show-log-sheet');
        this.root.classList.add('show-preview-sheet');
        navigator.vibrate?.(12);
      }, 420);
    });
    const cancel = (ev: PointerEvent) => {
      if (ev.type === 'pointermove' && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 10) return;
      window.clearTimeout(timer);
    };
    this.root.addEventListener('pointermove', cancel);
    this.root.addEventListener('pointerup', cancel);
    this.root.addEventListener('pointercancel', cancel);
    // The click that ends a long-press only opens the sheet.
    this.root.addEventListener(
      'click',
      (ev) => {
        if (swallowClick) {
          swallowClick = false;
          ev.stopPropagation();
          ev.preventDefault();
          return;
        }
        const t = ev.target as HTMLElement;
        if (t.closest('.preview') || (!t.closest('.log') && !t.closest('.icon-btn'))) {
          if (this.root.classList.contains('show-preview-sheet') && t.closest('.preview')) {
            this.root.classList.remove('show-preview-sheet');
            ev.stopPropagation();
            if (t.closest('.preview-card')) this.preview.zoom();
          } else if (!t.closest('.dc, .yc')) {
            this.root.classList.remove('show-preview-sheet', 'show-log-sheet');
          }
        }
      },
      true,
    );
    this.root.addEventListener('contextmenu', (ev) => {
      if (isPhonePortrait()) ev.preventDefault();
    });
  }

  // ------------------------------------------------------------------ chrome
  private buildTopBar() {
    const top = h('div', 'duel-top');
    const cap = h('div', 'duel-caption');
    cap.innerHTML = `<b>${esc(this.opts.caption ?? 'Duel')}</b>${this.spectator ? '<span class="tag">Spectating</span>' : ''}`;
    const btns = h('div', 'duel-tools');
    const logBtn = h('button', 'icon-btn', ICONS.log) as HTMLButtonElement;
    logBtn.title = 'Toggle duel log';
    logBtn.onclick = (ev) => {
      if (isPhonePortrait()) {
        ev.stopPropagation();
        this.root.classList.remove('show-preview-sheet');
        this.root.classList.toggle('show-log-sheet');
        return;
      }
      this.root.classList.toggle('hide-log');
      updateSettings({ showLog: !this.root.classList.contains('hide-log') });
    };
    const infoBtn = h('button', 'icon-btn icon-btn--phone', ICONS.info) as HTMLButtonElement;
    infoBtn.title = 'Card text';
    infoBtn.onclick = (ev) => {
      ev.stopPropagation();
      this.root.classList.remove('show-log-sheet');
      this.root.classList.toggle('show-preview-sheet');
    };
    this.soundBtn = h('button', 'icon-btn') as HTMLButtonElement;
    this.soundBtn.title = 'Toggle sound';
    this.soundBtn.onclick = () => updateSettings({ sound: !getSettings().sound });
    this.updateSoundBtn();
    btns.append(infoBtn, logBtn, this.soundBtn);
    const canSurrender = !this.spectator && (this.opts.allowSurrender ?? true);
    if (canSurrender || this.spectator) {
      const sur = h('button', 'icon-btn icon-btn--danger', ICONS.flag) as HTMLButtonElement;
      sur.title = this.spectator ? 'Stop watching' : this.opts.resumable ? 'Leave or concede' : 'Surrender';
      sur.setAttribute('aria-label', sur.title);
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
    if (this.replaying) return 0;
    const base = getSettings().animationSpeed;
    if (!(base > 0)) return 0;
    const ff = this.ff ? FAST_FORWARD : 1;
    if (this.spectator) return this.specSpeed >= 1000 ? 0 : (base / this.specSpeed) * ff;
    return base * ff;
  }

  /** Fast-forward on / off (see hurry.ts). */
  setFastForward(on: boolean) {
    if (this.ff === on) return;
    this.ff = on;
    this.root.classList.toggle('is-ff', on);
    this.applySpeedVar();
    if (on) this.fx.hurry();
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
    music.setPinch(Math.min(this.game.players[0].lp, this.game.players[1].lp) <= 2000);
    this.root.classList.toggle('is-opp-turn', this.game.turn > 0 && this.game.turnPlayer !== this.me);
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
    music.setScene('duel');
    if (this.replaying) this.beginReplay();
    else {
      this.sfx.play('shuffle');
      this.flush();
    }
    let res: { winner: PlayerId | null; reason: string; turns: number };
    try {
      res = await this.game.start();
    } catch (e) {
      if (e instanceof GameOver) res = { winner: e.winner, reason: e.reason, turns: this.game.turn };
      else {
        console.error('Duel crashed', e);
        reportError(e, 'duel crashed');
        res = { winner: null, reason: `Engine error: ${(e as Error)?.message ?? e}`, turns: this.game.turn };
      }
    }
    const mismatch = this.recorder?.mismatch;
    if (mismatch || this.left) {
      if (mismatch) console.warn('Duel could not be restored:', mismatch);
      this.replaying = false;
      this.clearInteraction();
      this.dialogs.closeAll();
      this.teardown();
      return mismatch ? { winner: null, reason: 'Restore failed', turns: this.game.turn, restoreFailed: true } : { winner: null, reason: 'Left', turns: this.game.turn, left: true };
    }
    // a log that ends with the game over never hands over: show the final board now
    if (this.replaying) this.endReplay();
    if (this.surrendered) res = { winner: this.game.opp(this.me), reason: 'Surrender', turns: this.game.turn };
    this.clearInteraction();
    this.dialogs.closeAll();
    this.flush();
    const out: DuelResult = { winner: res.winner, reason: res.reason, turns: res.turns, seen: this.shownCards() };
    if (this.surrendered) out.surrendered = true;
    try {
      this.opts.onGameOver?.(out);
    } catch (e) {
      console.error(e);
    }
    this.setFastForward(false);
    await this.showResult(res);
    this.teardown();
    return out;
  }

  /** A watched seat: paced like the AI (so pause and speed work), still reporting human. */
  private spectateSeat(c: PlayerController): PlayerController {
    return new Proxy(c, {
      get: (t, k) => {
        const v = (t as any)[k];
        if (typeof v !== 'function') return v;
        return async (...a: unknown[]) => {
          await this.aiPace(k === 'chooseAction' ? 90 : 40);
          return v.apply(t, a);
        };
      },
    });
  }

  /**
   * The friend's seat (Play a friend). While a saved duel is being restored, the friend's
   * decisions that are already on this phone are fed instantly; once the friend's seat has to
   * wait for the network (the friend is offline, or simply still thinking), the restore is over:
   * show the board as it stands instead of keeping "Restoring your duel…" up until the friend
   * returns (a real report: a guest who reloaded while the host was away saw the cover forever).
   */
  private remoteSeat(c: PlayerController): PlayerController {
    return new Proxy(c, {
      get: (t, k) => {
        const v = (t as any)[k];
        if (typeof v !== 'function' || !CONTROLLER_METHODS.has(k as string)) return v;
        return (...a: unknown[]) => {
          const p = v.apply(t, a) as Promise<unknown>;
          if (this.replaying && !this.opts.spectate) {
            let settled = false;
            p.then(
              () => (settled = true),
              () => (settled = true),
            );
            // an entry that is already here resolves within microtasks; anything slower is the network
            window.setTimeout(() => {
              if (!settled && this.replaying && !this.aborted) this.endReplay();
            }, 0);
          }
          return p;
        };
      },
    });
  }

  /** Spectating: the decisions made before we joined are in; show the board live. */
  endCatchUp() {
    if (this.opts.spectate) this.endReplay();
  }

  /** Resuming: hide the board while the saved decisions are fed back. */
  private beginReplay() {
    this.sfx.enabled = false;
    this.root.classList.add('is-restoring');
    this.restoringEl = h('div', 'duel-restoring', `<div class="duel-restoring-box"><span class="spinner"></span><b>${this.opts.spectate ? 'Catching up…' : 'Restoring your duel…'}</b></div>`);
    this.root.appendChild(this.restoringEl);
    this.armRestoreStall();
  }

  /** Nothing should sit on a full-screen spinner forever: after a while, offer a way out. */
  private armRestoreStall() {
    const cover = this.restoringEl;
    if (!cover) return;
    window.setTimeout(() => {
      if (this.restoringEl !== cover || this.aborted) return;
      const box = cover.querySelector('.duel-restoring-box')!;
      cover.classList.add('is-stalled');
      const more = h('div', 'duel-restoring-more');
      const hint = this.opts.remote || this.opts.spectate ? 'Your friend needs to reopen the app where they started this duel.' : 'This is taking longer than usual.';
      more.append(h('p', 'duel-restoring-hint', esc(hint)));
      const acts = h('div', 'duel-restoring-actions');
      const wait = h('button', 'btn btn--ghost', 'Keep waiting') as HTMLButtonElement;
      wait.type = 'button';
      wait.onclick = () => {
        more.remove();
        cover.classList.remove('is-stalled');
        this.armRestoreStall();
      };
      const leave = h('button', 'btn btn--primary', this.spectator ? 'Stop watching' : 'Leave (duel stays saved)') as HTMLButtonElement;
      leave.type = 'button';
      leave.dataset.test = 'restore-leave';
      leave.onclick = () => (this.spectator ? !this.aborted && this.abort(new GameOver(null, 'Spectating stopped')) : this.leaveSaved());
      acts.append(wait, leave);
      more.append(acts);
      box.after(more);
    }, STALL_MS);
  }

  /** The saved decisions ran out: render the board as it stands and hand over to the player. */
  private endReplay() {
    if (!this.replaying) return;
    // render once at speed 0 so nothing animates from the starting position
    this.flush();
    this.log.addMany(this.replayLog);
    this.replayLog = [];
    this.replaying = false;
    this.sfx.enabled = getSettings().sound;
    this.root.classList.remove('is-restoring');
    const r = this.restoringEl;
    this.restoringEl = null;
    if (r) {
      r.classList.add('is-gone');
      window.setTimeout(() => r.remove(), 250);
    }
  }

  /** Cards each player showed this game (by owner): face-up on the field, in the Graveyard or banished. */
  private shownCards(): [string[], string[]] {
    const out: [string[], string[]] = [[], []];
    try {
      for (const c of this.game.allCards) {
        if (c.isToken) continue;
        const shown = c.location === 'grave' || c.location === 'banished' || ((c.location === 'mzone' || c.location === 'szone' || c.location === 'fzone') && c.faceUp);
        if (shown) out[c.owner].push(c.data.id);
      }
    } catch {
      /* best effort */
    }
    return out;
  }

  private teardown() {
    setDuelDiag(null);
    this.unsubSettings();
    this.dialogs.dispose();
    this.fidget.dispose();
    this.board.destroy();
    if (this.raf) cancelAnimationFrame(this.raf);
    window.setTimeout(() => this.sfx.dispose(), 1500);
    music.setScene('menu', { delay: 0.4 });
    this.root.remove();
    document.querySelectorAll('body > .dc-ghost').forEach((e) => e.remove());
  }

  private showResult(res: { winner: PlayerId | null; reason: string; turns: number }): Promise<void> {
    return new Promise((resolve) => {
      const win = res.winner;
      let title: string;
      let cls: string;
      const custom = this.opts.resultTitle?.(res);
      if (custom) {
        title = custom;
        cls = win === null ? 'is-draw' : win === this.me ? 'is-win' : 'is-lose';
      } else if (win === null) {
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
      music.duelEnd();
      this.sfx.play(cls === 'is-lose' ? 'lose' : 'win');
      haptic(cls === 'is-lose' ? 'error' : cls === 'is-draw' ? 'warning' : 'success');
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
        haptic('selection');
        resolve();
      };
      window.setTimeout(() => btn.focus(), 300);
    });
  }

  private async surrender() {
    if (this.aborted) return;
    if (this.opts.resumable && !this.spectator) {
      const choice = await new Promise<'leave' | 'concede' | null>((resolve) => {
        const m = this.dialogs.modal({
          title: 'Leave this duel?',
          subtitle: 'Leave and save keeps the duel exactly as it is. Resume it later from Home.',
          className: 'dlg--leave',
          dismissible: true,
          onDismiss: () => resolve(null),
          actions: [
            { label: 'Leave and save', kind: 'primary', onClick: () => (m.close(), resolve('leave')) },
            { label: 'Concede', kind: 'danger', onClick: () => (m.close(), resolve('concede')) },
            { label: 'Keep playing', kind: 'ghost', hotkey: 'Escape', onClick: () => (m.close(), resolve(null)) },
            { label: 'Report a problem', kind: 'ghost', onClick: () => (m.close(), resolve(null), openReportSheet()) },
          ],
        });
      });
      if (!choice || this.aborted) return;
      if (choice === 'leave') return this.leaveSaved();
      this.surrendered = true;
      this.abort(new GameOver(this.game.opp(this.me), 'Surrender'));
      return;
    }
    const yes = await new Promise<boolean>((resolve) => {
      const m = this.dialogs.modal({
        title: this.spectator ? 'Stop watching this duel?' : 'Surrender this duel?',
        className: 'dlg--leave',
        dismissible: true,
        onDismiss: () => resolve(false),
        actions: [
          { label: this.spectator ? 'Stop' : 'Surrender', kind: this.spectator ? 'primary' : 'danger', hotkey: 'Enter', onClick: () => (m.close(), resolve(true)) },
          { label: 'Keep playing', kind: 'ghost', hotkey: 'Escape', onClick: () => (m.close(), resolve(false)) },
          { label: 'Report a problem', kind: 'ghost', onClick: () => (m.close(), resolve(false), openReportSheet()) },
        ],
      });
    });
    if (!yes || this.aborted) return;
    if (this.spectator) {
      this.abort(new GameOver(null, 'Spectating stopped'));
      return;
    }
    this.surrendered = true;
    this.abort(new GameOver(this.game.opp(this.me), 'Surrender'));
  }

  /** Leave without deciding the game; the caller keeps the duel saved. */
  private leaveSaved() {
    if (this.aborted) return;
    this.left = true;
    this.abort(new GameOver(null, 'Left'));
  }

  private abort(e: GameOver) {
    this.aborted = e;
    this.dialogs.closeAll();
    this.clearInteraction();
    for (const l of [...this.abortListeners]) l(e);
    this.abortListeners.clear();
    for (const f of this.externalAbort) f(e.winner, e.reason);
    this.setPaused(false);
  }

  /** Race a UI promise against abort (surrender). */
  private guard<T>(p: Promise<T>): Promise<T> {
    if (this.aborted) return Promise.reject(this.aborted);
    // the player is asked something: fast-forward never runs past a decision
    this.setFastForward(false);
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
    if (this.replaying) {
      // let the "Restoring" overlay paint now and then, otherwise run flat out
      if (++this.yieldCounter % 64 === 0) await sleep(0);
      if (this.aborted) throw this.aborted;
      return;
    }
    if (this.paused) await new Promise<void>((r) => this.pauseWaiters.push(r));
    const t = ms * this.speed();
    if (t > 0) await this.fx.idle(t);
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
  /** The player is being asked something right now (a shuffle never runs then). */
  private deciding(): boolean {
    return !!this.actionState || !!this.attackState || !!this.root.querySelector('.dlg-layer:not(.is-closing), .ctx-menu');
  }

  requestAction(p: PlayerId, actions: Action[]): Promise<Action> {
    this.fidget.cancel();
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
    // ending the turn gets a light tap; other choices a selection tick (the play itself follows)
    haptic(a.type === 'phase' && a.to === 'end' ? 'light' : 'selection');
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
    haptic('selection');
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
    const acts = st?.byCard.get(c.uid);
    const pile = c.location === 'extra' || c.location === 'deck' ? c.location : null;
    if (pile && !acts?.length) {
      // a card drawn on top of a pile: the tap is for the pile
      this.onPileClick(c.owner, pile, ev);
      return;
    }
    // Things the card could do but can't right now get a disabled row saying why (an LP cost, a used
    // Normal Summon, missing Tributes, a Trap Set this turn...).
    const blocked = st ? this.effectBlockedNote(c, acts) : null;
    const notes = [...(st ? this.playBlockedNotes(c, acts) : []), ...(blocked ? [{ label: `Effect: ${blocked.label}`, sub: blocked.sub }] : [])];
    const noteRows = notes.map((n) => ({ label: n.label, sub: n.sub, onClick: () => {}, kind: 'is-disabled', disabled: true }));
    if (!acts?.length && notes.length) {
      const r = el.getBoundingClientRect();
      this.dialogs.menuAt(r.left + r.width / 2, r.top, c.name, [
        ...noteRows,
        { label: 'View card', sub: 'Enlarge and read', onClick: () => zoomCard(c.data, { instance: c, game: this.game }), kind: 'is-view' },
      ]);
      return;
    }
    if (!acts?.length) {
      this.dialogs.closeMenu();
      // Nothing to do with this card: tap to enlarge it.
      if (this.canSee(c)) zoomCard(c.data, { instance: c, game: this.game });
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
      [
        ...acts.map((a) => {
          const l = this.actionLabel(a);
          return { label: l.label, sub: l.sub, onClick: () => this.resolveAction(a), kind: a.type === 'attack' ? 'is-attack' : '' };
        }),
        ...noteRows,
        pile === 'extra'
          ? { label: 'View Extra Deck', sub: `${this.game.players[c.owner].extra.length} cards`, onClick: () => this.openPile(c.owner, 'extra'), kind: 'is-view' }
          : { label: 'View card', sub: 'Enlarge and read', onClick: () => zoomCard(c.data, { instance: c, game: this.game }), kind: 'is-view' },
      ],
    );
    void ev;
  }

  /**
   * Why your card in hand (or Set on the field) can't be summoned, Set or activated right now, for
   * the action menu. Empty when nothing is blocked or the card has no such use.
   */
  private playBlockedNotes(c: CardInstance, acts: Action[] | undefined): { label: string; sub?: string }[] {
    if (this.spectator || c.controller !== this.me) return [];
    const g = this.game;
    const me = this.me;
    const has = (t: string) => !!acts?.some((a) => a.type === t);
    const mainPhase = g.turnPlayer === me && (g.phase === 'main1' || g.phase === 'main2') && !g.chain.length;
    const out: { label: string; sub?: string }[] = [];
    // on the opponent's turn a tap on a hand card just reads it (nothing to explain)
    if (c.location === 'hand' && g.turnPlayer !== me) return out;
    if (c.location === 'hand' && c.isMonster && !c.isExtra) {
      if (!has('summon') && !has('set') && !has('proc')) {
        const procs = (c.data.effects ?? []).some((ef) => ef.kind === 'proc');
        if (c.data.cannotNormalSummon) {
          out.push(procs ? { label: "Summon: its condition isn't met", sub: 'It can only be Special Summoned by its own condition' } : { label: "Summon: can't be Normal Summoned", sub: 'Special Summon it with a card effect' });
        } else if (!mainPhase) {
          out.push({ label: 'Summon: only in your Main Phase', sub: g.chain.length ? 'Not while a chain is resolving' : 'Move to Main Phase 1 or 2' });
        } else if (g.players[me].normalSummonsLeft <= 0) {
          out.push({ label: 'Summon: already Normal Summoned this turn', sub: 'One Normal Summon or Set per turn' });
        } else if (g.queryPlayer(me, 'cannotNormalSummon') && g.queryPlayer(me, 'cannotSet')) {
          out.push({ label: 'Summon: blocked by a card effect', sub: 'You cannot Normal Summon or Set right now' });
        } else {
          const need = g.tributesNeeded(c);
          const have = g.tributeCandidates(me, c).length;
          if (need > 0 && have < need && !g.altTributeCandidates(me, c).length)
            out.push({ label: `Summon: needs ${need} Tribute${need > 1 ? 's' : ''}`, sub: have ? `You control ${have} monster${have > 1 ? 's' : ''} you can Tribute` : 'You control no monsters to Tribute' });
          else if (need === 0 && g.freeMZones(me) <= 0) out.push({ label: 'Summon: your Monster Zones are full' });
        }
      }
      // an effect that only works once the monster is on the field (Test Tiger, Card Trooper...)
      const fieldOnly = (c.data.effects ?? []).some((ef) => (ef.kind === 'ignition' || ef.kind === 'quick') && !g.defaultRange(c, ef).includes('hand') && g.defaultRange(c, ef).includes('mzone'));
      if (fieldOnly && !has('activate')) out.push({ label: 'Effect: works once it is face-up on the field', sub: 'Summon it first' });
    } else if (c.location === 'hand' && (c.isSpell || c.isTrap)) {
      if (c.isTrap) {
        if (!has('setST')) out.push(g.freeSZones(me) <= 0 ? { label: 'Set: your Spell & Trap Zones are full' } : { label: 'Set: only in your Main Phase' });
        out.push({ label: 'Activate: Set it first', sub: 'Traps can be activated from your next turn' });
      } else if (!has('activate')) {
        const quick = c.data.stype === 'quickplay';
        if (g.queryPlayer(me, 'cannotActivateSpells')) out.push({ label: 'Activate: Spells are blocked by a card effect' });
        else if (!quick && !mainPhase) out.push({ label: 'Activate: only in your Main Phase', sub: g.chain.length ? 'Normal Spells cannot be chained' : undefined });
        else if (c.data.stype !== 'field' && g.freeSZones(me) <= 0) out.push({ label: 'Activate: your Spell & Trap Zones are full' });
        else out.push({ label: "Activate: its condition isn't met", sub: 'Check the card text: it needs a target or a cost you cannot pay' });
      }
    } else if (c.location === 'szone' && !c.faceUp && !has('activate')) {
      const waits = c.isTrap || c.data.stype === 'quickplay';
      if (waits && c.setTurn === g.turn) out.push({ label: 'Activate: Set this turn', sub: `${c.isTrap ? 'Traps' : 'Quick-Play Spells'} Set this turn can be activated from the next turn` });
      else if (c.isTrap && g.queryPlayer(me, 'cannotActivateTraps')) out.push({ label: 'Activate: Traps are blocked by a card effect' });
      else if (c.isSpell && !waits && !mainPhase) out.push({ label: 'Activate: only in your Main Phase' });
      else out.push({ label: "Activate: its condition isn't met", sub: 'It needs a trigger, a target or a cost that is not there right now' });
    }
    return out;
  }

  /**
   * When your card has Ignition or Quick effects but none can be activated right now, say why
   * (for the action menu). Null when one of them can be used, or the card has none.
   */
  private effectBlockedNote(c: CardInstance, acts: Action[] | undefined): { label: string; sub?: string } | null {
    if (this.spectator || c.controller !== this.me) return null;
    if (!(c.location === 'hand' || (c.onField && c.faceUp))) return null;
    if (acts?.some((a) => a.type === 'activate')) return null;
    const g = this.game;
    const effs = (c.data.effects ?? [])
      .map((ef, idx) => ({ ef, idx }))
      .filter(({ ef }) => (ef.kind === 'ignition' || ef.kind === 'quick') && g.defaultRange(c, ef).includes(c.location));
    if (!effs.length) return null;
    const lp = g.players[this.me].lp;
    const fmt = (n: number) => n.toLocaleString('en-US');
    for (const { ef } of effs) {
      const cost = lpCost(ef, effs.length === 1 ? c.data.text : '');
      if (cost && lp <= cost)
        return lp < cost
          ? { label: `needs ${fmt(cost)} LP (you have ${fmt(lp)})`, sub: 'Not enough Life Points to pay the cost' }
          : { label: `needs more than ${fmt(cost)} LP (you have ${fmt(lp)})`, sub: 'Paying the cost would leave you at 0' };
    }
    if (effs.every(({ ef, idx }) => ef.opt && g.isOptUsed(g.optKey(c, ef, idx, this.me)))) return { label: 'already used this turn', sub: 'Once per turn' };
    if (c.onField && g.isNegated(c)) return { label: "can't be used right now", sub: 'Its effects are negated' };
    const mainPhase = g.turnPlayer === this.me && (g.phase === 'main1' || g.phase === 'main2') && !g.chain.length;
    if (!mainPhase && effs.every(({ ef }) => ef.kind === 'ignition')) return { label: "can't be used right now", sub: 'Only in your Main Phase' };
    return { label: "can't be used right now", sub: 'Condition or timing not met' };
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
    // The Graveyard and Banished viewers link to each other (the banished pile is hidden on small boards).
    const other = loc === 'grave' ? 'banished' : loc === 'banished' ? 'grave' : null;
    const otherCards = other === 'grave' ? g.players[p].grave : other === 'banished' ? g.players[p].banished : [];
    const links = other ? [{ label: `${names[other]} (${otherCards.length})`, onClick: () => this.openPile(p, other) }] : [];
    pileViewer(this.dialogs, this.promptCtx(), `${whose} ${names[loc]}`, cards, {
      links,
      faceDown: (c) => !this.canSee(c),
      actions: (c) => {
        const acts = st && this.actionState === st ? st.byCard.get(c.uid) ?? [] : [];
        return acts.map((a) => ({ label: this.actionLabel(a).label, onClick: () => this.resolveAction(a) }));
      },
      notes: (c) => this.pileEffectNote(c),
    });
  }

  /**
   * For your own card in the Graveyard / banished with an effect that works from there but can't be
   * used right now: when it can be (from the card's own condition, e.g. "During your Standby Phase").
   */
  private pileEffectNote(c: CardInstance): string | null {
    if (this.spectator || c.owner !== this.me || (c.location !== 'grave' && c.location !== 'banished')) return null;
    const g = this.game;
    // rules listeners that watch every zone (their range includes 'deck') are not Graveyard effects
    const effs = (c.data.effects ?? []).filter((ef) => ef.kind !== 'continuous' && ef.kind !== 'activate' && (ef.range ?? []).includes(c.location) && !(ef.range ?? []).includes('deck'));
    if (!effs.length) return null;
    const ef = effs[0];
    if (effs.every((e) => e.opt && g.isOptUsed(g.optKey(c, e, (c.data.effects ?? []).indexOf(e), this.me)))) return 'Already used this turn.';
    const when = ef.kind === 'proc' ? null : pileWhen(c.data.text, c.location);
    if (ef.kind === 'trigger') return `${when ?? 'It activates at a set time'}. You'll be asked then.`;
    if (ef.kind === 'ignition') return when ? `${when}, in your Main Phase.` : 'Only in your Main Phase.';
    if (ef.kind === 'proc') return 'Summon it in your Main Phase once its condition is met.';
    return when ? `${when}.` : 'Usable once its condition is met.';
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
    const actions = [] as { label: string; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; onClick: () => void; hotkey?: string; icon?: 'close' }[];
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
      icon: 'close',
      onClick: () => {
        const st = this.attackState;
        this.endAttackTargeting();
        st?.resolve('cancel');
      },
    });
    this.attackBar = this.dialogs.modal({
      title: replay ? `Replay: ${attacker.name}` : `Attack with ${attacker.name}`,
      subtitle: targets.length ? `${isTouchUI() ? 'Tap' : 'Click'} an opponent monster to attack it.` : 'Attack directly?',
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
    // priority after your own summon: always ask when the monster you just summoned has an effect to use
    if (req.kind === 'priority' && req.options.some((o) => o.effect.kind === 'ignition' && o.card.controller === p && o.card.location === 'mzone')) return true;
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
      case 'priority':
        // the turn player acts first after their own summon; the opponent then responds as usual
        title = g.turnPlayer === p ? 'You have priority: use its effect first?' : 'Respond?';
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

/** PlayerController's request methods (the friend's seat is wrapped per request). */
const CONTROLLER_METHODS = new Set(['chooseAction', 'chooseResponse', 'selectCards', 'chooseOption', 'confirm', 'choosePosition', 'chooseAttackTarget', 'confirmTrigger', 'declareCard']);

/** A full-screen cover with no progress for this long offers a way out. */
const STALL_MS = 10000;

function isPhonePortrait() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 600px) and (orientation: portrait)').matches;
}

/** The Life Point cost of an effect: from its cost code (payLp(N)) or, failing that, the card text. */
/**
 * The card's own timing for an effect that works from the Graveyard / banished pile, e.g. "During your
 * Standby Phase, if this card is in your GY": the clause before ':' of the sentence naming the pile.
 */
function pileWhen(text: string, loc: 'grave' | 'banished'): string | null {
  const pile = loc === 'grave' ? /\b(GY|Graveyard)\b/ : /\bbanished\b/i;
  for (const s of text.split(/\n|(?<=\.)\s+/)) {
    if (!pile.test(s) || !/this card/i.test(s) || !s.includes(':')) continue;
    const c = s.split(':')[0].trim();
    if (/^(once per turn, )?(during|if this card is|while this card is|when you take)/i.test(c) && c.length < 110) return c.replace(/\.$/, '');
  }
  return null;
}

function lpCost(ef: EffectDef, text: string): number | null {
  const code = ef.activate ? String(ef.activate) : '';
  const m = code.match(/payLp\(\s*([\d.e]+)\s*\)/);
  if (m && Number.isFinite(Number(m[1]))) return Number(m[1]);
  const t = text.match(/pay (\d[\d,]*) (?:Life Points|LP)/i);
  return t ? Number(t[1].replace(/,/g, '')) : null;
}
