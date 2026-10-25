// Play a friend (route `friend`): duel someone on their own phone with a room code.
//
//   Landing  → Create room (host) or Join with a code / a shared link (guest)
//   Lobby    → both names, deck choice, Single / Bo3 (host decides), Ready; both ready starts
//   Match    → the normal duel screen; the friend's seat is a RemoteController fed over the
//              network (src/net). Between Bo3 games the loser chooses who goes first.
//   After    → Rematch (back to the lobby) or Leave
//
// The match is saved like any other duel (resume.ts, kind 'friend'): reopening the app resumes
// it, rejoins the room and re-syncs the decision logs.
//
// Test hooks (URL query, before the #): `peer=host:port/path` points at another PeerJS server,
// `netbot=easy|normal|hard` lets the AI play this phone's seat and answers the between-game
// screens by itself (`netside=1` still shows the siding screen for the test to use), and exposes window.__edisonNet for end-to-end tests.
import './friend.css';
import { createAI, type Difficulty } from '../../ai/ai';
import { CARDS } from '../../cards';
import { buildDeckList } from '../../decks';
import type { DeckIds } from '../../decks/siding';
import { sidingScreen } from './siding';
import type { CardData, CardInstance } from '../../engine/card';
import type { PlayerController } from '../../engine/controller';
import { GameOver, type Game } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
import { newRoomCode, normalizeRoomCode, type GameEnd, type NetPlayer, type WireDeck } from '../../net/protocol';
import { PeerTransport } from '../../net/peerTransport';
import { AsHuman } from '../../net/remote';
import { Room, type GameState, type RoomSnapshot } from '../../net/room';
import { SpectateServer } from '../../net/spectate';
import { TransportError, describeServer, parseServer, type PeerServerConfig, type Transport } from '../../net/transport';
import type { DuelControl, DuelSide } from '../duel/api';
import { startDuel } from '../duel/duelScreen';
import { clearActiveDuel, loadActiveDuel, saveActiveDuel, type ResumeTag, type SavedDuel, type SavedSide } from '../duel/resume';
import { haptic } from '../haptics';
import { getSettings, loadJSON, saveJSON, updateSettings } from '../settings';
import { opponentMat } from '../theme/playmats';
import { ctaButton, deckShelf, iosGroup, iosRow, lobbySection, stickyBar } from './components';
import { button, h, icon, segmented, toast, type Child } from './dom';
import { applyPlaymat } from './ext';
import { avatar } from './locals';
import { frame, go, lockNav, scrollToTop, type Screen } from './nav';
import { allDeckInfos, toDeckList, type DeckInfo } from './store';
import { artInto } from './title';

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const PREFS_KEY = 'edison.friend.v1';
const H2H_KEY = 'edison.friends.h2h.v1';
const CLIENT_KEY = 'edison.clientId';
const CLAIM_AFTER_MS = 2 * 60 * 1000;
/** Waiting for the friend this long shows what helps and a way out. */
const OFFLINE_ACTIONS_MS = 10 * 1000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ART = 'Elemental HERO Stratos';

// ------------------------------------------------------------------ config and test hooks

export function query(): URLSearchParams {
  const q = new URLSearchParams(location.search);
  const hq = location.hash.split('?')[1];
  if (hq) new URLSearchParams(hq).forEach((v, k) => q.has(k) || q.set(k, v));
  return q;
}

/** URL param `peer` (tests), else the advanced setting, else the PeerJS cloud. */
export function serverConfig(): PeerServerConfig {
  return parseServer(query().get('peer')) ?? parseServer(getSettings().netServer) ?? parseServer('')!;
}

export const botLevel = (): Difficulty | null => {
  const b = query().get('netbot');
  return b === 'easy' || b === 'normal' || b === 'hard' ? b : null;
};

/** Test hook: the bot waits `ms` before each decision (`netpace`; `window.__edisonPace` overrides it live), so tests can act mid-game. */
export function paced(c: PlayerController, ms: number): PlayerController {
  if (!ms) return c;
  return new Proxy(c, {
    get(t, k) {
      const v = (t as any)[k];
      if (typeof v !== 'function') return v;
      return async (...a: unknown[]) => {
        // tests can slow one table down while it is being watched (window.__edisonPace)
        const pace = Number((globalThis as { __edisonPace?: number }).__edisonPace ?? ms);
        await new Promise((r) => setTimeout(r, pace));
        return v.apply(t, a);
      };
    },
  });
}

export function clientId(): string {
  let id = loadJSON<string>(CLIENT_KEY, '');
  if (!id) {
    id = Math.random().toString(36).slice(2, 12);
    saveJSON(CLIENT_KEY, id);
  }
  return id;
}

export function mePlayer(): NetPlayer {
  const s = getSettings();
  return { name: (s.playerName || 'Duelist').slice(0, 20), avatar: s.avatar, sleeve: s.sleeve, clientId: clientId() };
}

export const wireDeck = (d: DeckInfo): WireDeck => {
  const l = toDeckList(d);
  const side = buildDeckList({ main: d.side, extra: [] }).main.map((c) => c.id);
  return { name: d.name, main: l.main.map((c) => c.id), extra: l.extra.map((c) => c.id), side };
};
const deckIds = (w: WireDeck): DeckIds => ({ main: [...w.main], extra: [...w.extra], side: [...(w.side ?? [])] });

function deckFromWire(w: WireDeck): { main: CardData[]; extra: CardData[] } | null {
  const main = w.main.map((id) => CARDS[id]);
  const extra = w.extra.map((id) => CARDS[id]);
  return main.every(Boolean) && extra.every(Boolean) ? { main, extra } : null;
}

// ------------------------------------------------------------------ head-to-head records

interface H2H {
  name: string;
  w: number;
  l: number;
  d: number;
  last: number;
  matches: string[];
}

export function loadH2H(): Record<string, H2H> {
  const r = loadJSON<Record<string, H2H>>(H2H_KEY, {});
  return r && typeof r === 'object' ? r : {};
}

function recordH2H(friend: string, matchId: string, result: 'W' | 'L' | 'D') {
  const all = loadH2H();
  const k = friend.trim().toLowerCase() || 'friend';
  const r = all[k] ?? { name: friend, w: 0, l: 0, d: 0, last: 0, matches: [] };
  if (r.matches.includes(matchId)) return;
  r.name = friend;
  r.matches = [...r.matches, matchId].slice(-30);
  if (result === 'W') r.w++;
  else if (result === 'L') r.l++;
  else r.d++;
  r.last = Date.now();
  all[k] = r;
  saveJSON(H2H_KEY, all);
}

// ------------------------------------------------------------------ module state

/** The room this phone is in (survives re-renders of the route). */
let active: FriendSession | null = null;

export function friendScreen(params: Record<string, string>): Screen {
  const el = frame('Play a friend', { cls: 'friend-screen lobby-screen', compact: true, backTo: () => go('play'), backLabel: 'Duel' });
  const body = el.querySelector('.frame-body') as HTMLElement;
  const screen: Screen = {
    el,
    dispose: () => {
      // leaving the route from the lobby closes the room (a running match locks navigation)
      setTimeout(() => {
        if (active && active.view === body && !location.hash.startsWith('#/friend')) active.close();
      }, 0);
    },
  };

  // an invite link for the room whose match is saved here resumes it instead of joining afresh
  const savedFriend = loadActiveDuel();
  const savedSnap = savedFriend?.tag.kind === 'friend' ? (savedFriend.tag.meta?.room as RoomSnapshot | undefined) : undefined;
  if (params.join && savedSnap?.match && normalizeRoomCode(params.join) === savedSnap.code && !(active && !active.closed)) params = { ...params, resume: '1' };
  if (params.resume === '1') {
    history.replaceState(null, '', '#/friend');
    const saved = loadActiveDuel();
    const snap = saved?.tag.kind === 'friend' ? (saved.tag.meta?.room as RoomSnapshot | undefined) : undefined;
    if (snap?.match) {
      active?.close();
      active = new FriendSession(body, snap.role, snap.code, snap);
      void active.resume();
      return screen;
    }
    setTimeout(() => toast('That duel can no longer be resumed.', 'error'), 0);
  }

  if (active && !active.closed) {
    active.attach(body);
    return screen;
  }
  const join = params.join ? normalizeRoomCode(params.join) : null;
  if (join) {
    active = new FriendSession(body, 'guest', join);
    void active.open();
    return screen;
  }
  landing(body);
  return screen;
}

// ------------------------------------------------------------------ landing

function landing(body: HTMLElement, opts: { joining?: boolean; error?: string } = {}) {
  const art = h('div', { class: 'home-tile-art' });
  artInto(art, ART);
  const hero = h(
    'section',
    { class: 'fr-hero' },
    art,
    h('div', { class: 'home-tile-shade' }),
    h('div', { class: 'fr-hero-text' }, h('span', { class: 'home-eyebrow' }, 'Online · Peer to peer'), h('b', null, 'Duel a friend'), h('span', null, 'Each of you plays on your own phone. Share a room code and pick your decks.')),
  );

  const codeIn = h('input', {
    class: 'fr-code-input',
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: false,
    maxlength: 9,
    placeholder: 'ABCD-2345',
    'aria-label': 'Room code',
    'data-test': 'join-code',
  }) as HTMLInputElement;
  const joinBtn = button('Join', () => doJoin(), { variant: 'primary', cls: 'fr-join-btn' });
  const doJoin = () => {
    const code = normalizeRoomCode(codeIn.value);
    if (!code) {
      toast('Room codes look like ABCD-2345.', 'error');
      codeIn.focus();
      return;
    }
    active?.close();
    active = new FriendSession(body, 'guest', code);
    void active.open();
  };
  codeIn.addEventListener('input', () => {
    const raw = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    codeIn.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });
  const joinBox = h('div', { class: ['fr-join', opts.joining && 'is-open'] }, h('div', { class: 'fr-join-row' }, codeIn, joinBtn), h('p', { class: 'fr-hint' }, 'Ask your friend for the code on their screen, or open the link they sent you.'));

  const create = ctaButton(
    'Create room',
    () => {
      active?.close();
      active = new FriendSession(body, 'host', newRoomCode());
      void active.open();
    },
    'plus',
    'fr-create',
  );
  create.dataset.test = 'create-room';
  const joinToggle = h('button', { type: 'button', class: 'fr-join-toggle', 'data-test': 'join-room', onclick: () => (joinBox.classList.add('is-open'), codeIn.focus()) }, icon('door'), h('span', null, 'Join with a code'));

  const recs = Object.values(loadH2H()).sort((a, b) => b.last - a.last);
  const records = recs.length
    ? iosGroup(
        'Head to head',
        recs.slice(0, 12).map((r) =>
          h(
            'div',
            { class: 'ios-row fr-h2h' },
            avatar({ name: r.name }, 32),
            h('span', { class: 'fr-h2h-name' }, r.name),
            h('span', { class: 'fr-h2h-rec' }, `${r.w}–${r.l}${r.d ? `–${r.d}` : ''}`),
          ),
        ),
        'Matches against friends. Online games do not change your rating.',
      )
    : null;

  body.replaceChildren(
    h(
      'div',
      { class: 'fr-pane' },
      hero,
      opts.error ? h('div', { class: 'fr-error', role: 'alert' }, icon('warn'), h('span', null, opts.error)) : null,
      h('div', { class: 'fr-actions' }, create, joinToggle, joinBox),
      h(
        'button',
        { type: 'button', class: 'fl-link', 'data-test': 'friends-locals', onclick: () => go('friend-locals') },
        h('span', { class: 'fl-link-ic' }, icon('trophy')),
        h('span', { class: 'fl-link-text' }, h('b', null, 'Friends Locals'), h('span', null, 'A Swiss tournament for 3–8 friends, each on their own phone')),
        icon('chevron'),
      ),
      records,
      h(
        'p',
        { class: 'fr-foot' },
        `Your phones connect directly; a free connection service only introduces them. Both phones keep the whole game, so play with people you trust.`,
      ),
    ),
  );
  if (opts.joining) setTimeout(() => codeIn.focus(), 50);
}

// ------------------------------------------------------------------ one room on this phone

/**
 * Friends Locals drives a FriendSession for each tournament match: no lobby (the registered deck,
 * format and seed come from the organiser), only the paired opponent may join, and the match is
 * handed back to the tournament when it is decided.
 */
export interface MatchHooks {
  /** The paired opponent's clientId. */
  expectPeer: string;
  opponentName: string;
  deck: WireDeck;
  bestOf: 1 | 3;
  seed: number;
  skipFirstDraw: boolean;
  matchId: string;
  /** Duel caption, e.g. "Friends Locals · Round 2". */
  caption: string;
  claimAfterMs: number;
  /** How the saved duel finds its way back (resume card). */
  tag: (room: RoomSnapshot) => ResumeTag;
  /** The match is decided (or went out of sync). Called before the saved duel is cleared. */
  onDecided: (room: Room) => void;
  /** The duel screens closed after the match. */
  onDone: () => void;
  /** Connection trouble before the match. */
  onError?: (msg: string) => void;
  /** Lets friends watch this match (Friends Locals spectating). */
  feed?: { transport: () => Transport; build: string };
}

export class FriendSession {
  room: Room;
  closed = false;
  view: HTMLElement;
  private lobbyRefresh: (() => void) | null = null;
  private inMatch = false;
  /** The player left a duel without deciding it ("Leave (duel stays saved)"). */
  private leftSaved = false;
  private duel: { g: number; ctl: DuelControl | null } | null = null;
  private netChip: HTMLElement | null = null;
  private waitTimer = 0;
  private offline: { since: number; timer: number; el: HTMLElement | null } | null = null;
  private onWake = () => {
    if (document.visibilityState === 'visible') this.room.session.wake();
  };
  /** Called when something the between-games screen waits for changes. */
  private betweenRefresh: (() => void) | null = null;
  private readyWaiters = new Map<number, () => void>();
  private lastResult: Record<number, Game> = {};
  private matchEndRefresh: (() => void) | null = null;
  /** Side decking in progress for game `index` (saved, so a closed app comes back to it). */
  private siding: { index: number; deck: DeckIds; done?: boolean } | null = null;
  private feed: SpectateServer | null = null;
  private uiDone: (() => void) | null = null;

  constructor(
    body: HTMLElement,
    readonly role: 'host' | 'guest',
    readonly code: string,
    private snap?: RoomSnapshot,
    readonly hooks?: MatchHooks,
  ) {
    this.view = body;
    if (snap) {
      const saved = loadActiveDuel();
      const sd = saved?.tag.kind === 'friend' ? saved.siding : null;
      if (sd && sd.player === (role === 'host' ? 0 : 1)) this.siding = { index: sd.index, deck: sd.deck, done: sd.done };
    }
    const prefs = loadJSON<{ deck?: string; bestOf?: 1 | 3 }>(PREFS_KEY, {});
    this.room = new Room({
      role,
      code,
      me: snap?.me ? { ...snap.me, name: mePlayer().name } : mePlayer(),
      build: BUILD,
      transport: new PeerTransport(serverConfig()),
      snapshot: snap,
      expectPeer: hooks?.expectPeer,
    });
    if (hooks && !snap) this.room.mine = { deckKey: 'registered', deck: hooks.deck, ready: true, bestOf: hooks.bestOf };
    else if (!snap) {
      const d = prefs.deck ? allDeckInfos().find((x) => x.key === prefs.deck) : undefined;
      this.room.mine = { deckKey: d?.key ?? null, deck: d && !d.problems.length ? wireDeck(d) : null, ready: false, bestOf: prefs.bestOf === 3 ? 3 : 1 };
    }
    this.room.ev = {
      status: (s) => {
        this.lobbyRefresh?.();
        this.onStatus(s);
      },
      peer: (p) => {
        if (!this.inMatch) haptic('light');
        this.lobbyRefresh?.();
        void p;
      },
      lobby: () => {
        this.lobbyRefresh?.();
        this.maybeStart();
      },
      matchStart: () => {
        if (!this.inMatch) void this.playMatch();
      },
      gameReady: (g) => {
        this.readyWaiters.get(g)?.();
        this.betweenRefresh?.();
      },
      between: () => this.betweenRefresh?.(),
      gameEnd: (g, end) => this.peerEnded(g, end),
      waiting: (on) => this.waiting(on),
      rematch: () => {
        this.matchEndRefresh = null;
        if (!this.inMatch) this.lobby();
      },
      rematchAsked: () => {
        haptic('light');
        this.matchEndRefresh?.();
      },
      left: () => (hooks ? undefined : this.peerLeft()),
      refused: (r) => this.refused(r),
      changed: () => this.persist(),
      desync: (g, detail) => console.warn(`[online] game ${g + 1} out of sync: ${detail}`),
    };
    document.addEventListener('visibilitychange', this.onWake);
    if (botLevel()) this.exposeTestHooks();
  }

  attach(body: HTMLElement) {
    this.view = body;
    if (this.hooks) {
      if (!this.inMatch) this.lobby();
      return;
    }
    if (this.inMatch) body.replaceChildren(h('div', { class: 'fr-pane' }, h('p', { class: 'fr-hint' }, 'Duel in progress…')));
    else if (this.room.match) this.matchOver();
    else this.lobby();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener('visibilitychange', this.onWake);
    this.room.leave();
    this.feed?.close();
    if (active === this) active = null;
  }

  get inDuel() {
    return this.inMatch;
  }

  /** The tournament settled this match some other way (draw, time, drop, organiser): stop here. */
  abandon(reason: string) {
    if (this.duel?.ctl) this.duel.ctl.abort(null, reason);
    for (const w of [...this.readyWaiters.values()]) w();
    this.close();
    this.uiDone?.();
  }

  private startFeed() {
    const f = this.hooks?.feed;
    if (!f || this.feed) return;
    this.feed = new SpectateServer(this.room, f.transport(), this.room.mySeat, { build: f.build, me: this.room.me });
    void this.feed.start();
  }

  // ---------------------------------------------------------------- connect

  async open(): Promise<void> {
    if (this.hooks) {
      // both phones open the match room on their own: keep trying until the opponent's is there
      this.lobby();
      this.startFeed();
      await this.connectLoop(true);
      return;
    }
    this.busy(this.role === 'host' ? 'Opening a room…' : `Joining ${this.code}…`);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.room.start();
        break;
      } catch (e) {
        const err = e as TransportError;
        // someone else has this code: pick another (host only)
        if (this.role === 'host' && err.kind === 'id-taken' && attempt < 3) {
          this.close();
          active = new FriendSession(this.view, 'host', newRoomCode());
          return active.open();
        }
        this.fail(errorText(err));
        return;
      }
    }
    if (this.closed) return;
    // a reload from here should not join again as someone new
    if (location.hash.startsWith('#/friend?')) history.replaceState(null, '', '#/friend');
    this.lobby();
  }

  /** Reopened mid-match: rebuild the duel from the save and reconnect in the background. */
  async resume() {
    this.startFeed();
    void this.connectLoop();
    await this.playMatch();
  }

  private async connectLoop(fast = false) {
    for (let i = 0; !this.closed; i++) {
      try {
        await this.room.start();
        return;
      } catch (e) {
        if ((e as TransportError).kind === 'unsupported') return this.fail(errorText(e as TransportError));
        await new Promise((r) => setTimeout(r, fast ? Math.min(4000, 800 + i * 300) : Math.min(8000, 1500 + i * 1000)));
      }
    }
  }

  private fail(msg: string) {
    this.close();
    if (this.hooks) {
      this.hooks.onError?.(msg);
      this.hooks.onDone();
      return;
    }
    landing(this.view, { error: msg, joining: this.role === 'guest' });
  }

  private busy(text: string) {
    this.view.replaceChildren(h('div', { class: 'fr-pane fr-busy' }, h('span', { class: 'spinner' }), h('p', null, text)));
  }

  private refused(r: 'busy' | 'version') {
    const msg = r === 'version' ? 'Your friend is on a different version. Both of you reopen the app to update.' : 'That room is already in use by someone else.';
    if (this.inMatch) {
      toast(msg, 'error', 6000);
      return;
    }
    this.fail(msg);
  }

  private peerLeft() {
    const name = this.room.peer?.name ?? 'Your friend';
    if (this.inMatch) return; // only sent from the lobby or after the match
    toast(`${name} left the room.`, 'info', 3200);
    if (this.role === 'guest') {
      this.close();
      landing(this.view);
      return;
    }
    this.room.peer = null;
    this.room.theirs = null;
    this.room.match = null;
    this.matchEndRefresh = null;
    this.lobby();
  }

  // ---------------------------------------------------------------- lobby

  private lobby() {
    if (this.closed) return;
    if (this.hooks) return this.waitingPane();
    const room = this.room;
    const decks = allDeckInfos();
    const codeEl = h('div', { class: 'fr-code', 'data-test': 'room-code' }, this.code);
    const share = button('Share', () => void shareRoom(this.code), { icon: 'upload', variant: 'ghost', small: true, cls: 'fr-share' });
    const status = h('div', { class: 'fr-status', role: 'status' });
    const seats = h('div', { class: 'fr-seats' });
    const fmt = h('div', { class: 'fr-format' });
    const readyBtn = ctaButton('Ready', () => toggleReady(), 'check', 'fr-ready');
    readyBtn.dataset.test = 'ready';
    const note = h('p', { class: 'fr-note' });

    const toggleReady = () => {
      if (!room.mine.deck) {
        toast('Choose a legal deck first.', 'error');
        return;
      }
      haptic(room.mine.ready ? 'light' : 'success');
      room.setLobby({ ready: !room.mine.ready });
    };
    const pickDeck = (d: DeckInfo | null) => {
      if (!d) return;
      saveJSON(PREFS_KEY, { ...loadJSON(PREFS_KEY, {}), deck: d.key });
      if (d.problems.length) toast(`${d.name} is not legal: ${d.problems[0]}`, 'error', 3600);
      room.setLobby({ deckKey: d.key, deck: d.problems.length ? null : wireDeck(d), ready: false });
    };

    const seat = (p: NetPlayer | null, st: { deck: WireDeck | null; ready: boolean; deckKey: string | null } | null, you: boolean) => {
      if (!p)
        return h(
          'div',
          { class: 'fr-seat is-empty' },
          h('span', { class: 'fr-seat-av' }, h('span', { class: 'spinner' })),
          h('span', { class: 'fr-seat-text' }, h('b', null, 'Waiting for your friend'), h('span', null, `Room code ${this.code}`)),
        );
      const deckName = st?.deck?.name ?? (st?.deckKey ? 'Deck not legal' : 'Choosing a deck…');
      return h(
        'div',
        { class: ['fr-seat', st?.ready && 'is-ready'] },
        avatar({ name: p.name, human: you }, 40),
        h('span', { class: 'fr-seat-text' }, h('b', null, you ? `${p.name} (you)` : p.name), h('span', null, deckName)),
        h('span', { class: ['fr-badge', st?.ready ? 'on' : ''] }, st?.ready ? 'Ready' : 'Not ready'),
      );
    };

    const refresh = () => {
      const conn = room.status;
      status.className = `fr-status is-${conn}`;
      status.textContent =
        conn === 'connected' ? 'Connected' : room.peer && conn === 'reconnecting' ? 'Reconnecting…' : this.role === 'host' ? 'Room open · share the code' : 'Connecting…';
      seats.replaceChildren(seat(room.me, room.mine, true), seat(conn === 'connected' || room.peer ? room.peer : null, room.theirs, false));
      if (this.role === 'host') {
        fmt.replaceChildren(
          segmented<1 | 3>(
            [
              { value: 1, label: 'Single game' },
              { value: 3, label: 'Best of three' },
            ],
            room.mine.bestOf === 3 ? 3 : 1,
            (v) => {
              saveJSON(PREFS_KEY, { ...loadJSON(PREFS_KEY, {}), bestOf: v });
              room.setLobby({ bestOf: v, ready: false });
            },
            'Match format',
          ),
        );
      } else fmt.replaceChildren(h('div', { class: 'fr-format-ro' }, icon('list'), h('span', null, `${room.bestOf === 3 ? 'Best of three' : 'Single game'} · your friend chooses`)));
      readyBtn.classList.toggle('is-on', room.mine.ready);
      (readyBtn.querySelector(':scope > span:last-child') as HTMLElement).textContent = room.mine.ready ? 'Ready · tap to cancel' : 'Ready';
      readyBtn.toggleAttribute('disabled', !room.mine.deck);
      note.textContent = !room.mine.deck
        ? 'Choose a legal deck to get ready.'
        : !room.peer
          ? 'Send the code or the link to your friend.'
          : room.mine.ready && room.theirs?.ready
            ? 'Starting…'
            : room.mine.ready
              ? `Waiting for ${room.peer.name} to get ready.`
              : 'Tap Ready when you have your deck.';
    };

    const body = h(
      'div',
      { class: 'fr-pane fr-lobby' },
      h('section', { class: 'fr-room' }, h('div', { class: 'fr-room-l' }, h('span', { class: 'home-eyebrow' }, 'Room code'), codeEl), share),
      status,
      seats,
      lobbySection('Format', null, fmt),
      lobbySection('Your deck', null, deckShelf(decks, room.mine.deckKey, pickDeck, { label: 'Your deck', newDeck: () => go('deck-builder') })),
      h('button', { type: 'button', class: 'fr-leave', onclick: () => (this.close(), landing(this.view)) }, 'Leave room'),
      stickyBar(note, readyBtn),
    );
    this.view.replaceChildren(body);
    this.lobbyRefresh = () => {
      if (body.isConnected) refresh();
    };
    refresh();
    scrollToTop();
  }

  /** Friends Locals: before the match starts, a small pane in the tournament screen. */
  private waitingPane() {
    const hk = this.hooks!;
    const room = this.room;
    const text = h('span', null);
    const pane = h('div', { class: 'fl-wait', role: 'status' }, h('span', { class: 'spinner' }), text);
    const refresh = () => {
      text.textContent = room.status === 'connected' ? `${hk.opponentName} is here · starting…` : `Waiting for ${hk.opponentName} to sit down…`;
    };
    this.view.replaceChildren(pane);
    this.lobbyRefresh = refresh;
    refresh();
  }

  /** Host: both ready → start (after a short beat so both see "Ready"). */
  private maybeStart() {
    if (this.hooks) {
      if (this.role === 'host' && this.room.canStart && !this.closed) this.room.startMatch({ seed: this.hooks.seed, skipFirstDraw: this.hooks.skipFirstDraw, id: this.hooks.matchId });
      return;
    }
    if (this.role !== 'host' || !this.room.canStart) return;
    setTimeout(() => {
      if (this.room.canStart && !this.closed) this.room.startMatch({ skipFirstDraw: getSettings().skipFirstDraw });
    }, 700);
  }

  // ---------------------------------------------------------------- match

  private async playMatch() {
    if (this.inMatch || !this.room.match) return;
    this.inMatch = true;
    this.lobbyRefresh = null;
    const host = h('div', { class: 'duel-host fr-duel-host' });
    document.body.appendChild(host);
    document.body.classList.add('in-duel');
    lockNav(true);
    let uiClosed = false;
    const closeUi = () => {
      if (uiClosed) return;
      uiClosed = true;
      host.classList.add('closing');
      setTimeout(() => host.remove(), 300);
      document.body.classList.remove('in-duel');
      lockNav(false);
      this.inMatch = false;
      this.hideOffline();
      this.uiDone = null;
    };
    this.uiDone = () => {
      closeUi();
      this.hooks?.onDone();
    };
    this.persist();
    try {
      for (let guard = 0; guard < 12 && !this.closed && this.room.match; guard++) {
        const cur = this.room.current!;
        if (!cur.end) {
          if (!(cur.decks[0] && cur.decks[1] && cur.first != null)) await this.between(host, cur.index);
          if (!this.room.match) break;
          await this.playGame(host, cur.index);
          if (this.leftSaved) break;
          continue;
        }
        if (cur.end.kind === 'desync' || this.room.outcome()) break;
        await this.between(host, cur.index + 1);
      }
    } finally {
      closeUi();
    }
    if (this.closed) return;
    if (this.leftSaved) {
      // the duel stays saved (Home's resume card, or the event's match card picks it back up)
      this.close();
      if (this.hooks) this.hooks.onDone();
      else go('title');
      return;
    }
    this.recordMatch();
    if (this.hooks) {
      this.persist();
      this.hooks.onDone();
      return;
    }
    if (this.room.match) this.matchOver();
    else this.lobby();
  }

  private sideOf(seat: PlayerId, deck: WireDeck, game: GameState): DuelSide | null {
    const m = this.room.match!.start;
    const p = m.players[seat];
    const list = deckFromWire(deck);
    if (!list) return null;
    const mine = seat === this.room.mySeat;
    void game;
    return { name: p.name, avatar: p.avatar, sleeve: p.sleeve, control: mine ? 'human' : 'normal', title: mine ? deck.name : `Online · ${deck.name}`, deck: list };
  }

  private playGame(host: HTMLElement, g: number): Promise<void> {
    const room = this.room;
    const st = room.match!.games[g];
    const a = this.sideOf(0, st.decks[0]!, st);
    const b = this.sideOf(1, st.decks[1]!, st);
    if (!a || !b) {
      room.endGame(g, { winner: null, reason: 'A card in a deck is missing on this phone', turns: 0, kind: 'desync' });
      return Promise.resolve();
    }
    const friend = room.match!.start.players[room.peerSeat];
    const bo3 = room.match!.start.bestOf === 3;
    const caption = `vs ${friend.name} · ${this.hooks?.caption ?? 'Online'}${bo3 || g > 0 ? ` · Game ${g + 1}${bo3 ? ' of 3' : ''}` : ''}`;
    const remote = room.remoteController(g);
    const bot = botLevel();
    const playmat = getSettings().playmat;
    host.replaceChildren();
    this.duel = { g, ctl: null };
    const replay = st.logs[room.mySeat].slice();
    return startDuel(host, {
      sides: [a, b],
      playmat,
      oppPlaymat: opponentMat(friend.name, playmat),
      seed: st.seed,
      firstPlayer: typeof st.first === 'number' ? st.first : 'coin',
      skipFirstDraw: room.match!.start.skipFirstDraw,
      caption,
      allowSurrender: true,
      resumable: false,
      replay: replay.length ? replay : undefined,
      remote,
      localDriver: bot ? paced(new AsHuman(createAI(bot, st.seed + room.mySeat * 7919)), Number(query().get('netpace')) || 0) : undefined,
      onDecision: (log, game) => room.localDecision(g, log, game.turn),
      onMount: (ctl) => {
        this.duel = { g, ctl };
        this.lastResult[g] = ctl.game;
        this.netChip = h('div', { class: 'fr-chip', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'fr-chip-dot' }), h('span', { class: 'fr-chip-text' }, 'Opponent is thinking…'));
        // in the phase bar, next to "Opponent's turn"
        (ctl.root.querySelector('.phasebar') ?? ctl.root).appendChild(this.netChip);
        ctl.onAbort((winner, reason) => {
          remote.fail(new GameOver(winner, reason));
          if (reason === 'Surrender') room.endGame(g, { winner, reason: 'Conceded', turns: ctl.game.turn, kind: 'concede' });
        });
        if (room.status !== 'connected') this.onStatus(room.status);
      },
      onGameOver: (r) => {
        if (r.seen) st.seen = r.seen;
        if (!r.restoreFailed && !r.left) room.gameOver(g, { winner: r.winner, reason: r.reason, turns: r.turns });
        this.persist();
        // tests can keep the result screen up for a while (window.__edisonHoldResult, ms)
        if (bot) setTimeout(() => (document.querySelector('.result-continue') as HTMLButtonElement | null)?.click(), Number((globalThis as { __edisonHoldResult?: number }).__edisonHoldResult ?? 400));
      },
      resultTitle: (r) => (r.reason === 'Out of sync' ? 'Out of sync' : undefined),
    })
      .catch((e) => console.error('online duel failed', e))
      .then((r) => {
        // "Leave (duel stays saved)", from the Reconnecting banner or a stalled restore
        if (r && r.left) this.leftSaved = true;
        this.duel = null;
        this.netChip = null;
        window.clearTimeout(this.waitTimer);
      });
  }

  /** The friend's phone ended the game (concede, claim, desync): end it here too. */
  private peerEnded(g: number, end: GameEnd) {
    const name = this.room.match?.start.players[this.room.peerSeat].name ?? 'Your friend';
    const reason = end.kind === 'concede' ? `${name} conceded` : end.kind === 'claim' ? `${name} claimed the win after you lost connection` : end.kind === 'desync' ? 'Out of sync' : end.reason;
    if (this.duel?.g === g && this.duel.ctl) this.duel.ctl.abort(end.winner, reason);
    this.betweenRefresh?.();
  }

  private waiting(on: boolean) {
    window.clearTimeout(this.waitTimer);
    const chip = this.netChip;
    if (!chip) return;
    if (!on) {
      chip.classList.remove('is-on');
      return;
    }
    // only when the friend takes a moment (not for every instant reply)
    this.waitTimer = window.setTimeout(() => {
      if (this.duel?.ctl?.restoring) return;
      chip.classList.add('is-on');
    }, 350);
  }

  // ---------------------------------------------------------------- disconnects

  private onStatus(s: string) {
    if (!this.inMatch) return;
    if (s === 'connected') {
      if (this.offline) haptic('light');
      this.hideOffline();
      return;
    }
    if (s !== 'reconnecting' && s !== 'connecting') return;
    if (this.offline) return;
    this.offline = { since: Date.now(), timer: 0, el: null };
    // a short blip goes unnoticed
    this.offline.timer = window.setTimeout(() => this.showOffline(), 1200);
  }

  private showOffline() {
    const off = this.offline;
    if (!off || !this.inMatch) return;
    const name = this.room.match?.start.players[this.room.peerSeat].name ?? 'your friend';
    const el = h('div', { class: 'fr-offline', role: 'status' });
    let stage = '';
    const draw = () => {
      if (!this.offline) return;
      const waited = Date.now() - off.since;
      const canClaim = waited >= (this.hooks?.claimAfterMs ?? CLAIM_AFTER_MS) && !!this.duel?.ctl;
      // after a while, never just a spinner: say what helps, and offer a way out
      const long = waited >= OFFLINE_ACTIONS_MS;
      const text = canClaim ? `${name} has been away for ${Math.max(1, Math.floor(waited / 60000))} min.` : `Waiting for ${name}. Your game is safe.`;
      const key = `${long}|${canClaim}|${text}`;
      if (key === stage) return;
      const rebuildButtons = !stage.startsWith(`${long}|${canClaim}|`);
      stage = key;
      if (!rebuildButtons) {
        const small = el.querySelector('.fr-offline-row small');
        if (small) small.textContent = text;
        return;
      }
      el.classList.toggle('is-long', long);
      el.replaceChildren(
        ...([
          h('div', { class: 'fr-offline-row' }, h('span', { class: 'spinner' }), h('span', null, h('b', null, 'Reconnecting…'), h('small', null, text))),
          long ? h('p', { class: 'fr-offline-hint' }, `${cap(name)} needs to reopen the app where they started this duel.`) : null,
          long
            ? h(
                'div',
                { class: 'fr-offline-actions' },
                canClaim ? button('Keep waiting', () => ((off.since = Date.now()), draw()), { variant: 'ghost', small: true }) : null,
                button('Leave (duel stays saved)', () => this.leaveSaved(), { variant: canClaim ? 'ghost' : 'primary', small: true, cls: 'fr-offline-leave' }),
                canClaim ? button('Claim the win', () => this.claimWin(), { variant: 'primary', small: true }) : null,
              )
            : null,
        ].filter(Boolean) as HTMLElement[]),
      );
    };
    draw();
    off.el = el;
    off.timer = window.setInterval(draw, 1000);
    (this.duel?.ctl?.root ?? document.querySelector('.fr-duel-host') ?? document.body).appendChild(el);
  }

  private hideOffline() {
    const off = this.offline;
    if (!off) return;
    window.clearTimeout(off.timer);
    window.clearInterval(off.timer);
    off.el?.remove();
    this.offline = null;
  }

  /** Leave the duel without deciding it: it stays saved and resumes from Home (or the event). */
  private leaveSaved() {
    this.leftSaved = true;
    this.hideOffline();
    this.duel?.ctl?.leave();
  }

  private claimWin() {
    const d = this.duel;
    if (!d?.ctl) return;
    const me = this.room.mySeat;
    this.room.endGame(d.g, { winner: me, reason: 'Friend disconnected', turns: d.ctl.game.turn, kind: 'claim' });
    d.ctl.abort(me, 'Your friend disconnected');
    this.hideOffline();
  }

  // ---------------------------------------------------------------- between games

  /** Between games: the loser chooses who goes first, both submit their deck for game `g`. */
  private between(host: HTMLElement, g: number): Promise<void> {
    const room = this.room;
    const m = room.match!;
    const st = room.match!.games[g];
    return this.sideDeck(host, g).then(() => this.waitNext(host, g));
  }

  /**
   * Side decking before game `g`: each phone sides on its own siding screen, starting from its
   * previous game's deck, then sends the final list. The game starts once both lists arrived.
   */
  private async sideDeck(host: HTMLElement, g: number) {
    const room = this.room;
    const m = room.match!;
    const st = m.games[g];
    if (st.decks[room.mySeat]) return;
    const prev = (m.games[g - 1]?.decks[room.mySeat] ?? m.start.decks[room.mySeat])!;
    const original = m.start.decks[room.mySeat];
    let deck = deckIds(prev);
    const canSide = m.start.bestOf === 3 && getSettings().sideDecking && !!original.side?.length && (!botLevel() || query().get('netside') === '1');
    if (canSide) {
      const draft = this.siding?.index === g ? this.siding : null;
      if (draft?.done) deck = draft.deck;
      else {
        const res = room.results();
        const me = room.mySeat;
        const opp = room.peerSeat;
        const last = res[res.length - 1];
        const lastText = last?.winner == null ? `Game ${g} was a draw` : last.winner === me ? `You won game ${g}` : `You lost game ${g}`;
        // what the friend showed: the most copies seen in any one game
        const seen = new Map<string, number>();
        for (const pg of m.games.slice(0, g)) {
          const t = new Map<string, number>();
          for (const id of pg.seen?.[opp] ?? []) t.set(id, (t.get(id) ?? 0) + 1);
          for (const [id, n] of t) seen.set(id, Math.max(n, seen.get(id) ?? 0));
        }
        this.siding = { index: g, deck: draft?.deck ?? deck };
        this.persist();
        const friend = m.start.players[opp];
        deck = await sidingScreen(host, {
          caption: `vs ${friend.name} · Online`,
          gameNo: g + 1,
          status: `${lastText} · ${res.filter((r) => r.winner === me).length}–${res.filter((r) => r.winner === opp).length}`,
          opp: { name: friend.name, deck: (m.games[g - 1]?.decks[opp] ?? m.start.decks[opp]).name, seen: [...seen].sort((a, b) => b[1] - a[1]) },
          start: this.siding.deck,
          previous: deckIds(prev),
          original: deckIds(original),
          playmat: getSettings().playmat,
          onChange: (d) => {
            this.siding = { index: g, deck: d };
            this.persist();
          },
        });
      }
      this.siding = { index: g, deck, done: true };
    }
    if (!room.match || room.match !== m) return;
    room.submitDeck(g, { name: prev.name, main: deck.main, extra: deck.extra, side: deck.side });
  }

  /** After siding: the loser chooses who goes first; wait until both decks and the choice are in. */
  private waitNext(host: HTMLElement, g: number): Promise<void> {
    const room = this.room;
    const m = room.match!;
    const st = m.games[g];
    return new Promise<void>((resolve) => {
      let finished = false;
      let botPicked = false;
      const done = () => {
        finished = true;
        this.readyWaiters.delete(g);
        this.betweenRefresh = null;
        resolve();
      };
      if (st.decks[0] && st.decks[1] && st.first != null) return done();
      this.readyWaiters.set(g, done);
      const bg = h('div', { class: 'inter-bg' });
      applyPlaymat(bg, getSettings().playmat);
      const draw = () => {
        if (finished) return;
        if (!room.match) return done();
        const res = room.results();
        const last = room.match.games[g - 1]?.end;
        const players = m.start.players;
        const wa = res.filter((r) => r.winner === 0).length;
        const wb = res.filter((r) => r.winner === 1).length;
        const chooser = room.chooserFor(g);
        const friend = players[room.peerSeat].name;
        const actions = h('div', { class: 'inter-actions' });
        let msg = '';
        if (st.first != null) msg = `${st.decks[room.peerSeat] ? 'Starting…' : `Waiting for ${friend}…`}`;
        else if (chooser == null) msg = 'Waiting for your friend…';
        else if (chooser === room.mySeat) {
          msg = 'You lost the previous game, so you choose: go first or second?';
          const pick = (first: PlayerId) => {
            if (finished || st.first != null) return;
            haptic('selection');
            room.chooseFirst(g, first);
            draw();
          };
          actions.append(
            h(
              'div',
              { class: 'inter-choice' },
              ctaButton('Go first', () => pick(room.mySeat), 'bolt'),
              h('button', { type: 'button', class: 'cta cta--dark', onclick: () => pick(room.peerSeat) }, icon('hand'), h('span', null, 'Go second')),
            ),
          );
          if (botLevel() && !botPicked && (botPicked = true)) setTimeout(() => pick((g % 2 ? room.mySeat : room.peerSeat) as PlayerId), 300);
        } else msg = `${friend} lost the previous game and is choosing who goes first…`;
        const side = (i: PlayerId) =>
          h('div', { class: ['inter-side', last?.winner === i && 'won', i === 1 && 'right'] }, h('div', { class: 'inter-name' }, players[i].name), h('div', { class: 'inter-deck' }, (room.match!.games[g - 1]?.decks[i] ?? m.start.decks[i]).name));
        host.replaceChildren(
          bg,
          h(
            'div',
            { class: 'inter' },
            h('div', { class: 'inter-caption' }, `vs ${friend} · Online`),
            h('div', { class: 'inter-title' }, `Game ${g}`),
            h('div', { class: 'inter-result' }, last ? (last.winner == null ? 'Draw' : last.winner === room.mySeat ? 'You win' : `${players[last.winner].name} wins`) : ''),
            h('div', { class: 'inter-reason' }, last ? `${last.reason}${last.turns ? ` · ${last.turns} turn${last.turns === 1 ? '' : 's'}` : ''}` : ''),
            h('div', { class: 'inter-score' }, side(0), h('div', { class: 'inter-nums' }, h('b', null, String(wa)), h('span', null, '–'), h('b', null, String(wb))), side(1)),
            h('div', { class: 'inter-next' }, `Up next · Game ${g + 1} of 3`),
            h('p', { class: 'inter-msg' }, msg),
            actions,
          ),
        );
      };
      this.betweenRefresh = draw;
      draw();
    });
  }

  // ---------------------------------------------------------------- after the match

  private recordMatch() {
    const m = this.room.match;
    if (!m) return;
    const out = this.room.outcome();
    const desync = m.games.some((g) => g.end?.kind === 'desync');
    if (!out || desync) return;
    clearActiveDuelIfFriend(m.start.id);
    const me = this.room.mySeat === 0 ? 'a' : 'b';
    recordH2H(m.start.players[this.room.peerSeat].name, m.start.id, out === 'draw' ? 'D' : out === me ? 'W' : 'L');
  }

  private matchOver() {
    const room = this.room;
    const m = room.match;
    if (!m) return this.lobby();
    const desync = m.games.some((g) => g.end?.kind === 'desync');
    if (desync) clearActiveDuelIfFriend(m.start.id);
    const friend = m.start.players[room.peerSeat].name;
    const res = room.results();
    const wMe = res.filter((r) => r.winner === room.mySeat).length;
    const wThem = res.filter((r) => r.winner === room.peerSeat).length;
    const out = room.outcome();
    const meKey = room.mySeat === 0 ? 'a' : 'b';
    const title = desync ? 'Out of sync' : out === 'draw' ? 'Draw' : out === meKey ? 'You win' : `${friend} wins`;
    const pane = h('div', { class: 'fr-pane fr-over' });
    const draw = () => {
      if (!pane.isConnected && pane.parentElement) return;
      const asked = room.rematch[0];
      const theyAsked = room.rematch[1];
      const rec = loadH2H()[friend.trim().toLowerCase()];
      const rematch = ctaButton(asked ? `Waiting for ${friend}…` : theyAsked ? 'Accept rematch' : 'Rematch', () => (room.askRematch(), draw()), 'refresh', 'fr-rematch');
      rematch.dataset.test = 'rematch';
      if (asked) rematch.setAttribute('disabled', '');
      pane.replaceChildren(
        h(
          'section',
          { class: ['fr-result', desync ? 'is-desync' : out === meKey ? 'is-win' : out === 'draw' ? 'is-draw' : 'is-lose'] },
          h('span', { class: 'home-eyebrow' }, `vs ${friend} · Online`),
          h('h2', null, title),
          desync
            ? h('p', null, 'The two phones stopped agreeing on the game, so it was stopped. Nothing counts. Start a rematch to play again.')
            : h('div', { class: 'fr-score' }, h('b', null, String(wMe)), h('span', null, '–'), h('b', null, String(wThem))),
          !desync && rec ? h('p', { class: 'fr-hint' }, `Head to head vs ${friend}: ${rec.w}–${rec.l}${rec.d ? `–${rec.d}` : ''}`) : null,
          theyAsked && !asked ? h('p', { class: 'fr-ask' }, `${friend} wants a rematch.`) : null,
        ),
        h('div', { class: 'fr-actions' }, rematch, h('button', { type: 'button', class: 'fr-leave', onclick: () => (this.close(), landing(this.view)) }, 'Leave room')),
      );
    };
    this.matchEndRefresh = draw;
    this.view.replaceChildren(pane);
    draw();
    scrollToTop();
  }

  // ---------------------------------------------------------------- saving

  /** Save the match like any duel so closing the app can resume it. */
  private persist() {
    const room = this.room;
    const m = room.match;
    if (!m || this.closed) return;
    const ended = !!room.outcome() || m.games.some((g) => g.end?.kind === 'desync');
    const tag: ResumeTag = this.hooks ? this.hooks.tag(room.snapshot()) : { kind: 'friend', key: `friend:${m.start.id}`, route: 'friend', meta: { room: room.snapshot() as unknown as Record<string, unknown> } };
    if (ended) {
      this.hooks?.onDecided(room);
      const d = loadActiveDuel();
      if (d?.tag.key === tag.key) clearActiveDuel();
      return;
    }
    const cur = room.current!;
    const side = (seat: PlayerId): SavedSide => {
      const p = m.start.players[seat];
      const d = cur.decks[seat] ?? m.start.decks[seat];
      return { name: p.name, avatar: p.avatar, sleeve: p.sleeve, control: seat === room.mySeat ? 'human' : 'normal', title: d.name, main: d.main, extra: d.extra };
    };
    const rec: SavedDuel = {
      v: 1,
      tag,
      savedAt: Date.now(),
      setup: { sides: [side(0), side(1)], bestOf: m.start.bestOf, playmat: getSettings().playmat, caption: `vs ${m.start.players[room.peerSeat].name} · ${this.hooks?.caption ?? 'Online'}` },
      seed: m.start.seed,
      played: m.games.filter((x) => x.end).map((x) => ({ decks: [deckIds(x.decks[0] ?? m.start.decks[0]), deckIds(x.decks[1] ?? m.start.decks[1])] as [DeckIds, DeckIds], ...(x.seen ? { seen: x.seen } : {}) })),
      siding: this.siding && !cur.decks[room.mySeat] ? { index: this.siding.index, player: room.mySeat, deck: this.siding.deck, ...(this.siding.done ? { done: true } : {}) } : null,
      games: room.results(),
      game: cur.end || !(cur.decks[0] && cur.decks[1] && cur.first != null)
        ? null
        : { index: cur.index, seed: cur.seed, first: cur.first ?? 'coin', skipFirstDraw: m.start.skipFirstDraw, caption: '', log: cur.logs[room.mySeat], turn: cur.turn },
      live: true,
    };
    saveActiveDuel(rec);
  }

  // ---------------------------------------------------------------- tests

  private exposeTestHooks() {
    const self = this;
    (window as any).__edisonNet = {
      get room() {
        return self.room;
      },
      get status() {
        return self.room.status;
      },
      get inMatch() {
        return self.inMatch;
      },
      /** Drop the connection now and refuse to reconnect for `holdMs`. */
      drop: (holdMs = 0) => self.room.session.drop(holdMs),
      /** Final state of game `g` as both phones should see it. */
      state: (g: number) => {
        const game = self.lastResult[g];
        return game ? gameState(game) : null;
      },
      results: () => self.room.results(),
      outcome: () => self.room.outcome(),
    };
  }
}

/** Compact full state of a game for comparing the two phones. */
export function gameState(g: Game) {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return {
    turn: g.turn,
    phase: g.phase,
    winner: g.winner,
    over: g.over,
    players: g.players.map((p) => ({ lp: p.lp, hand: p.hand.map(ref), deck: p.deck.map(ref), m: p.mzone.map(ref), s: p.szone.map(ref), f: ref(p.fzone), gy: p.grave.map(ref), ban: p.banished.map(ref), ex: p.extra.map(ref) })),
  };
}

function clearActiveDuelIfFriend(matchId: string) {
  const d = loadActiveDuel();
  if (d?.tag.kind === 'friend' && d.tag.key === `friend:${matchId}`) clearActiveDuel();
}

export function errorText(e: TransportError | Error): string {
  const kind = (e as TransportError).kind;
  switch (kind) {
    case 'no-peer':
      return 'No room with that code is open. Check the code with your friend.';
    case 'server':
      return 'Couldn’t reach the connection service. Check your internet connection and try again.';
    case 'timeout':
      return 'Couldn’t connect to your friend’s phone. Try again, ideally on Wi-Fi.';
    case 'unsupported':
      return 'This browser can’t make direct connections. Open the app in Safari or Chrome.';
    case 'id-taken':
      return 'That room code is in use. Create a new room.';
    default:
      return `Couldn’t connect: ${e.message || 'unknown error'}`;
  }
}

async function shareRoom(code: string) {
  const url = `${location.origin}${location.pathname}#/friend?join=${code}`;
  const text = `Duel me in Edison Format. Room code ${code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Edison duel', text, url });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    toast('Link copied. Send it to your friend.', 'success');
  } catch {
    toast(`Room code ${code}`, 'info', 5000);
  }
}

// ------------------------------------------------------------------ settings (advanced)

/** Settings › Online: which PeerJS server introduces the phones. */
export function onlineSettingsGroup(): HTMLElement {
  const s = getSettings();
  const input = h('input', {
    class: 'ios-input',
    type: 'text',
    value: s.netServer,
    placeholder: 'PeerJS cloud (default)',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    'aria-label': 'Connection server',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (v && !parseServer(v)) {
      toast('Use host:port/path, e.g. peer.example.com/edison', 'error');
      return;
    }
    updateSettings({ netServer: v });
    toast(v ? `Play a friend uses ${describeServer(parseServer(v)!)}` : 'Play a friend uses the PeerJS cloud', 'success');
  });
  return iosGroup(
    'Online (advanced)',
    [iosRow('Connection server', null, input, { stack: true, cls: 'ios-row--input' })],
    'Play a friend uses a free public PeerJS server only to introduce the two phones; the duel itself goes directly between them. Both players must use the same server.',
  );
}

void (null as unknown as Child);
