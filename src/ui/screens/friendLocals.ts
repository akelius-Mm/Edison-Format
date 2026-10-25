// Friends Locals (route `friend-locals`): a private Swiss tournament for 3–8 friends, each on their
// own phone. Built on Play a friend (src/net); the logic lives in src/net/tournament.ts (the
// organiser) and src/net/tourneyClient.ts (every player, the organiser included).
//
//   Landing   → Create tournament (this phone organises and plays) or Join with a code
//   Lobby     → players, deck registration (locked once the event starts), format, Ready, Start
//   Event     → Round (your table, pairings, watch a match) · Standings · Bracket · Organiser
//   Ceremony  → your placing and prize, the champion, final standings; history on this phone
//
// Each pairing plays its match directly between the two phones (FriendSession with MatchHooks),
// reports it with the decision logs, and the organiser's phone verifies it by replaying it.
//
// The event survives reloads: the organiser's state and every player's last view are saved after
// each change, and app start restores a running event in the background (restoreFriendsLocals).
//
// Test hooks: the Play a friend hooks (`peer`, `netbot`, `netpace`) apply; with `netbot` the
// screen also starts your match by itself and exposes window.__edisonLocals.
import './friendLocals.css';
import { grantPrize } from '../../collection/api';
import type { PlayerId } from '../../engine/types';
import { matchOutcome } from '../../tournament/simulate';
import { newRoomCode, normalizeRoomCode, type WireDeck } from '../../net/protocol';
import { PeerTransport } from '../../net/peerTransport';
import type { Room, RoomSnapshot } from '../../net/room';
import { SpectateClient } from '../../net/spectate';
import { FRIENDS_PRIZES, TourneyHost, friendsPrizesFor, placeIn, viewStandings, type HostState } from '../../net/tournament';
import { TourneyClient, reportFromRoom, type ClientSnapshot } from '../../net/tourneyClient';
import { MAX_PLAYERS, MIN_PLAYERS, matchRoomCode, type TMatch, type TPlayerView, type TSettings, type TView } from '../../net/tourneyProtocol';
import { TransportError } from '../../net/transport';
import { deckFromWire } from '../../net/verify';
import type { DuelControl } from '../duel/api';
import { startDuel } from '../duel/duelScreen';
import { loadActiveDuel } from '../duel/resume';
import { haptic } from '../haptics';
import { getSettings, loadJSON, saveJSON } from '../settings';
import { ctaButton, deckShelf, iosGroup, lobbySection, stickyBar } from './components';
import { button, confirmDialog, h, icon, segmented, toast, toggle } from './dom';
import { FriendSession, botLevel, clientId, errorText, mePlayer, query, serverConfig, wireDeck } from './friend';
import { avatar, packIcon } from './locals';
import { frame, go, lockNav, scrollToTop, type Screen } from './nav';
import { allDeckInfos, ordinal, type DeckInfo } from './store';
import { artInto } from './title';

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const ACTIVE_KEY = 'edison.friendsLocals.active.v1';
const HOST_KEY = 'edison.friendsLocals.host.v1';
const HISTORY_KEY = 'edison.friendsLocals.history.v1';
const PREFS_KEY = 'edison.friendsLocals.prefs.v1';
/** A player gone this long from a match can be given the game by the opponent. */
const CLAIM_AFTER_MS = 3 * 60 * 1000;
const ART = 'Black Rose Dragon';

interface SavedEvent {
  v: 1;
  role: 'organiser' | 'player';
  code: string;
  client: ClientSnapshot;
}

export interface FriendsLocalsHistory {
  tid: string;
  code: string;
  date: number;
  players: number;
  names: string[];
  place: number;
  record: string;
  champion: string;
  championDeck: string | null;
  deckName: string | null;
  organiser: boolean;
  packs: number;
  coins: number;
}

interface Prefs {
  deck?: string;
  settings?: Partial<TSettings>;
}

export function loadFriendsLocalsHistory(): FriendsLocalsHistory[] {
  const h = loadJSON<FriendsLocalsHistory[]>(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
}

// ------------------------------------------------------------------ module state

/** The event this phone is in (survives route changes, like the Play a friend room). */
let ev: EventSession | null = null;

/** App start: bring a running event back in the background (the organiser's phone keeps it alive). */
export function restoreFriendsLocals() {
  if (ev) return;
  const saved = loadJSON<SavedEvent | null>(ACTIVE_KEY, null);
  if (!saved || saved.v !== 1 || !saved.client?.view) return;
  if (saved.client.view.phase === 'done') return;
  try {
    ev = EventSession.restore(saved);
  } catch (e) {
    console.error('[friends-locals] could not restore the event', e);
  }
}

export function friendsLocalsLive(): TView | null {
  return ev?.client.view ?? loadJSON<SavedEvent | null>(ACTIVE_KEY, null)?.client.view ?? null;
}

export function friendLocalsScreen(params: Record<string, string>): Screen {
  const el = frame('Friends Locals', { cls: 'fl-screen lx-screen friend-screen lobby-screen', compact: true, backTo: () => go('play'), backLabel: 'Duel' });
  const body = el.querySelector('.frame-body') as HTMLElement;
  const screen: Screen = {
    el,
    dispose: () => {
      if (ev?.body === body) ev.body = null;
    },
  };
  if (!ev) restoreFriendsLocals();
  const join = params.join ? normalizeRoomCode(params.join) : null;
  if (join && ev && ev.client.code !== join) {
    // a link to another event while one is running: stay in the running one
    setTimeout(() => toast('Finish or leave your current Friends Locals first.', 'error', 3600), 0);
  }
  if (params.join || params.resume) history.replaceState(null, '', '#/friend-locals');
  if (ev) {
    ev.attach(body, params.resume === '1');
    return screen;
  }
  if (join) {
    void EventSession.join(body, join);
    return screen;
  }
  landing(body);
  return screen;
}

// ------------------------------------------------------------------ landing

function landing(body: HTMLElement, opts: { error?: string; joining?: boolean } = {}) {
  const art = h('div', { class: 'home-tile-art' });
  artInto(art, ART);
  const hero = h(
    'section',
    { class: 'fr-hero' },
    art,
    h('div', { class: 'home-tile-shade' }),
    h(
      'div',
      { class: 'fr-hero-text' },
      h('span', { class: 'home-eyebrow' }, 'Online · 3 to 8 friends'),
      h('b', null, 'Friends Locals'),
      h('span', null, 'A private Swiss tournament on everyone’s own phone. Register a deck, play your rounds, crown a champion.'),
    ),
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
    'aria-label': 'Tournament code',
    'data-test': 'fl-join-code',
  }) as HTMLInputElement;
  const doJoin = () => {
    const code = normalizeRoomCode(codeIn.value);
    if (!code) {
      toast('Tournament codes look like ABCD-2345.', 'error');
      codeIn.focus();
      return;
    }
    void EventSession.join(body, code);
  };
  codeIn.addEventListener('input', () => {
    const raw = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    codeIn.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });
  const joinBox = h(
    'div',
    { class: ['fr-join', opts.joining && 'is-open'] },
    h('div', { class: 'fr-join-row' }, codeIn, button('Join', doJoin, { variant: 'primary', cls: 'fr-join-btn' })),
    h('p', { class: 'fr-hint' }, 'Ask the organiser for the code on their screen, or open the link they sent.'),
  );
  const create = ctaButton('Create tournament', () => void EventSession.create(body), 'trophy', 'fl-create');
  create.dataset.test = 'fl-create';
  const joinToggle = h('button', { type: 'button', class: 'fr-join-toggle', 'data-test': 'fl-join', onclick: () => (joinBox.classList.add('is-open'), codeIn.focus()) }, icon('door'), h('span', null, 'Join with a code'));

  const hist = loadFriendsLocalsHistory();
  const history = hist.length
    ? iosGroup(
        'Your Friends Locals',
        hist.slice(0, 12).map((x) =>
          h(
            'div',
            { class: 'ios-row fl-hist' },
            h('span', { class: ['fl-hist-place', x.place === 1 && 'is-first'] }, ordinal(x.place)),
            h(
              'span',
              { class: 'fl-hist-text' },
              h('b', null, `${new Date(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${x.players} players`),
              h('span', null, `${x.record}${x.deckName ? ` · ${x.deckName}` : ''} · Champion ${x.place === 1 ? 'you' : x.champion}`),
            ),
          ),
        ),
        'Online events do not change your rating.',
      )
    : null;

  body.replaceChildren(
    h(
      'div',
      { class: 'fr-pane fl-pane' },
      hero,
      opts.error ? h('div', { class: 'fr-error', role: 'alert' }, icon('warn'), h('span', null, opts.error)) : null,
      h('div', { class: 'fr-actions' }, create, joinToggle, joinBox),
      h(
        'div',
        { class: 'fl-how' },
        howRow('trophy', 'The organiser’s phone runs the event', 'It pairs each round, keeps the standings and checks every result by replaying the game. Keep it open.'),
        howRow('swords', 'Every match is phone to phone', 'Your table plays directly between your two phones, Best of 1 or Best of 3 with siding.'),
        howRow('eye', 'Free between rounds?', 'Watch a match still going. Hands and face-down cards stay hidden.'),
      ),
      history,
      h('p', { class: 'fr-foot' }, 'Your phones connect directly; a free connection service only introduces them. Play with people you trust.'),
    ),
  );
  if (opts.joining) setTimeout(() => codeIn.focus(), 50);
}

function howRow(ic: Parameters<typeof icon>[0], title: string, text: string) {
  return h('div', { class: 'fl-how-row' }, h('span', { class: 'fl-how-ic' }, icon(ic)), h('span', null, h('b', null, title), h('span', null, text)));
}

// ------------------------------------------------------------------ one event on this phone

type Tab = 'round' | 'standings' | 'bracket' | 'organiser';

class EventSession {
  client: TourneyClient;
  host: TourneyHost | null;
  body: HTMLElement | null = null;
  private tab: Tab = 'round';
  /** The match this phone is playing (or about to). */
  private match: { key: string; mid: string; attempt: number; session: FriendSession } | null = null;
  private matchPane = h('div', { class: 'fl-match-pane' });
  private watching: { stop: () => void; mid: string; spec: SpectateClient } | null = null;
  private timerTick = 0;
  private closed = false;
  private error: string | null = null;
  private autoStarted = new Set<string>();
  private resumeWanted = false;
  private onWake = () => {
    if (document.visibilityState !== 'visible') return;
    this.client.wake();
    this.host?.hub.wake();
  };

  private constructor(client: TourneyClient, host: TourneyHost | null) {
    this.client = client;
    this.host = host;
    client.ev = {
      status: () => this.render(),
      view: (v, prev) => this.onView(v, prev),
      refused: (r) => this.refused(r),
      changed: () => this.persist(),
    };
    if (host) {
      host.onChange = () => {
        if (this.tab === 'organiser') this.render();
      };
      host.onListening = () => this.render();
    }
    document.addEventListener('visibilitychange', this.onWake);
    document.body.classList.add('in-online');
    this.timerTick = window.setInterval(() => this.tickTimers(), 1000);
    if (botLevel()) this.exposeTestHooks();
  }

  // ---------------------------------------------------------------- lifecycles

  static async create(body: HTMLElement) {
    if (ev) return ev.attach(body);
    busy(body, 'Opening your tournament…');
    const me = mePlayer();
    const prefs = loadJSON<Prefs>(PREFS_KEY, {});
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newRoomCode();
      const host = new TourneyHost({ code, me, build: BUILD, transport: new PeerTransport(serverConfig()), settings: { skipFirstDraw: getSettings().skipFirstDraw, ...(prefs.settings ?? {}) }, save: (s) => saveJSON(HOST_KEY, s) });
      try {
        await host.start();
      } catch (e) {
        host.close();
        if ((e as TransportError).kind === 'id-taken') continue;
        landing(body, { error: errorText(e as TransportError) });
        return;
      }
      const client = new TourneyClient({ code, me, build: BUILD, link: host.localLink() });
      ev = new EventSession(client, host);
      ev.body = body;
      await client.start();
      const d = prefs.deck ? allDeckInfos().find((x) => x.key === prefs.deck) : undefined;
      if (d && !d.problems.length) client.register(wireDeck(d), false);
      else client.register(null, false);
      host.onChange();
      ev.persist();
      ev.render();
      return;
    }
    landing(body, { error: 'Could not open a tournament. Try again.' });
  }

  static async join(body: HTMLElement, code: string) {
    if (ev) return ev.attach(body);
    busy(body, `Joining ${code}…`);
    const me = mePlayer();
    const client = new TourneyClient({ code, me, build: BUILD, transport: new PeerTransport(serverConfig()) });
    try {
      await client.start();
    } catch (e) {
      client.close();
      landing(body, { error: (e as TransportError).kind === 'no-peer' ? 'No tournament with that code is open. Check the code with the organiser.' : errorText(e as TransportError), joining: true });
      return;
    }
    ev = new EventSession(client, null);
    ev.body = body;
    const prefs = loadJSON<Prefs>(PREFS_KEY, {});
    const d = prefs.deck ? allDeckInfos().find((x) => x.key === prefs.deck) : undefined;
    client.register(d && !d.problems.length ? wireDeck(d) : null, false);
    ev.persist();
    ev.render();
  }

  /** After a reload: rebuild from the saves and reconnect in the background. */
  static restore(saved: SavedEvent): EventSession {
    const me = { ...saved.client.me, name: mePlayer().name, clientId: clientId() };
    let host: TourneyHost | null = null;
    let client: TourneyClient;
    if (saved.role === 'organiser') {
      const state = loadJSON<HostState | null>(HOST_KEY, null);
      if (!state || state.code !== saved.code) throw new Error('organiser state missing');
      host = new TourneyHost({ code: saved.code, me, build: BUILD, transport: new PeerTransport(serverConfig()), state, save: (s) => saveJSON(HOST_KEY, s) });
      client = new TourneyClient({ code: saved.code, me, build: BUILD, link: host.localLink(), snapshot: saved.client });
    } else {
      client = new TourneyClient({ code: saved.code, me, build: BUILD, transport: new PeerTransport(serverConfig()), snapshot: saved.client });
    }
    const s = new EventSession(client, host);
    void s.connect();
    return s;
  }

  private async connect() {
    if (this.host) {
      for (let i = 0; !this.closed; i++) {
        try {
          await this.host.start();
          break;
        } catch (e) {
          if ((e as TransportError).kind === 'unsupported') return;
          await sleep(Math.min(8000, 2000 + i * 1000));
        }
      }
    }
    for (let i = 0; !this.closed; i++) {
      try {
        await this.client.start();
        return;
      } catch (e) {
        if ((e as TransportError).kind === 'unsupported') return;
        this.render();
        await sleep(Math.min(6000, 1500 + i * 700));
      }
    }
  }

  attach(body: HTMLElement, resume = false) {
    this.body = body;
    if (resume) this.resumeWanted = true;
    this.render();
    this.maybeResumeMatch();
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    this.match?.session.close();
    this.match = null;
    this.watching?.stop();
    this.client.close();
    this.host?.close(true);
    window.clearInterval(this.timerTick);
    document.removeEventListener('visibilitychange', this.onWake);
    document.body.classList.remove('in-online');
    try {
      localStorage.removeItem(ACTIVE_KEY);
      if (this.host) localStorage.removeItem(HOST_KEY);
    } catch {
      /* ignore */
    }
    if (ev === this) ev = null;
  }

  private leave() {
    const body = this.body;
    this.close();
    if (body) landing(body);
  }

  private persist() {
    if (this.closed) return;
    const saved: SavedEvent = { v: 1, role: this.host ? 'organiser' : 'player', code: this.client.code, client: this.client.snapshot() };
    saveJSON(ACTIVE_KEY, saved);
  }

  private refused(r: string) {
    const msg =
      r === 'started'
        ? 'This tournament has already started.'
        : r === 'full'
          ? `This tournament is full (${MAX_PLAYERS} players).`
          : r === 'version'
            ? 'The organiser is on a different version of the app. Everyone reopen the app to update.'
            : r === 'busy'
              ? 'That code belongs to someone else’s game.'
              : 'The organiser closed this tournament.';
    if (this.client.view && this.client.view.phase !== 'lobby' && r === 'closed') {
      toast(msg, 'info', 5000);
      const body = this.body;
      this.close();
      if (body) landing(body);
      return;
    }
    const body = this.body;
    this.close();
    if (body) landing(body, { error: msg, joining: true });
  }

  // ---------------------------------------------------------------- view updates

  private onView(v: TView, prev: TView | null) {
    // a new round: back to the round tab, a little buzz
    const round = (x: TView | null) => (x ? `${x.phase}:${x.rounds.length}:${x.top.length}` : '');
    if (prev && round(prev) !== round(v)) {
      this.tab = 'round';
      if (v.phase !== 'lobby') haptic('light');
    }
    this.reconcileMatch();
    if (v.phase === 'done') this.finish(v);
    this.render();
    this.autoPlay();
  }

  /**
   * Let go of a match the organiser has settled. Called on every view, when the duel screens
   * close and once a second: the settling view often arrives while the result screen is still
   * up, and the next round's pairings can too, so no single moment is enough.
   */
  private reconcileMatch() {
    const mm = this.match;
    if (!mm || this.closed) return;
    const m = this.findMatch(mm.mid);
    if (m && m.attempt === mm.attempt && m.result == null) return;
    const room = mm.session.room;
    if (!room.outcome() || !m || m.attempt !== mm.attempt) {
      // settled some other way while we play it: stop here
      const why = !m || m.attempt !== mm.attempt ? 'The organiser restarted this match' : m.how === 'id' ? 'Intentional draw' : m.how === 'time' ? 'Time was called' : m.how === 'drop' ? 'A player dropped' : 'The organiser decided this match';
      if (mm.session.inDuel) toast(why, 'info', 4000);
      this.match = null;
      mm.session.abandon(why);
      this.render();
    } else if (!mm.session.inDuel) {
      // played out and confirmed: close the room (the opponent has had our last entries)
      this.match = null;
      mm.session.close();
      this.render();
    }
  }

  private findMatch(mid: string): TMatch | null {
    const v = this.client.view;
    return v ? [...v.rounds.flat(), ...v.top.flat()].find((m) => m.id === mid) ?? null : null;
  }

  // ---------------------------------------------------------------- my match

  private matchKey(m: TMatch) {
    return `fl:${this.client.view!.tid}:${m.id}:${m.attempt}`;
  }

  /** Sit down at my table: open (or rejoin) the match room. */
  private playMatch(m: TMatch, snap?: RoomSnapshot) {
    const v = this.client.view!;
    if (this.match?.key === this.matchKey(m)) return;
    // an earlier match still holding its room (decided, not yet confirmed): let it go
    if (this.match && !this.match.session.inDuel) {
      this.match.session.close();
      this.match = null;
    }
    this.watching?.stop();
    const opp = v.players.find((p) => p.id === (m.a === this.client.me.clientId ? m.b : m.a))!;
    const r = this.client.roomFor(m);
    const label = m.stage === 'swiss' ? `Round ${m.round}` : m.label;
    const key = this.matchKey(m);
    const deck = this.client.deck as WireDeck;
    const session = new FriendSession(this.matchPane, snap?.role ?? r.role, snap?.code ?? r.code, snap, {
      expectPeer: r.opponent,
      opponentName: opp.name,
      deck,
      bestOf: v.settings.bestOf,
      seed: m.seed,
      skipFirstDraw: v.settings.skipFirstDraw,
      matchId: `${m.id}#${m.attempt}`,
      caption: `Friends Locals · ${label}`,
      claimAfterMs: Number(query().get('netclaim')) || CLAIM_AFTER_MS,
      tag: (room) => ({ kind: 'friend-locals', key, route: 'friend-locals', meta: { room: room as unknown as Record<string, unknown>, tid: v.tid, mid: m.id, attempt: m.attempt } }),
      onDecided: (room: Room) => {
        const rep = reportFromRoom(room, m.id, m.attempt);
        if (rep && !this.closed) this.client.report(rep);
      },
      onDone: () => {
        if (this.match?.session === session && !session.inDuel) {
          // a decided match keeps its room open until the organiser settles it (the opponent may
          // still need our last entries); one that never got going is closed now
          if (session.room.outcome() || session.room.match?.games.some((g) => g.end?.kind === 'desync')) this.reconcileMatch();
          else {
            this.match = null;
            session.close();
          }
        }
        this.render();
        this.autoPlay();
      },
      onError: (msg) => {
        this.error = msg;
        this.render();
      },
      feed: { transport: () => new PeerTransport(serverConfig()), build: BUILD },
    });
    this.match = { key, mid: m.id, attempt: m.attempt, session };
    this.error = null;
    if (snap) void session.resume();
    else void session.open();
    this.render();
  }

  /** A saved duel for my current match (the app was closed mid-match): pick it back up. */
  private savedDuelFor(m: TMatch): RoomSnapshot | null {
    const d = loadActiveDuel();
    if (d?.tag.kind !== 'friend-locals' || d.tag.key !== this.matchKey(m)) return null;
    const snap = d.tag.meta?.room as RoomSnapshot | undefined;
    return snap?.match ? snap : null;
  }

  private maybeResumeMatch() {
    if (!this.resumeWanted) return;
    const m = this.myPending();
    if (!m) return;
    const snap = this.savedDuelFor(m);
    if (!snap) return;
    this.resumeWanted = false;
    this.playMatch(m, snap);
  }

  /** My unplayed match this round (null for a bye, after a drop, or once reported). */
  private myPending(): TMatch | null {
    const m = this.client.myMatch();
    if (!m || m.result != null || m.b == null || this.client.dropped) return null;
    if (this.client.reportPending(m.id)) return null;
    return m;
  }

  /** Test hook: with `netbot` the phone sits down at its table by itself. */
  private autoPlay() {
    if (!botLevel() || this.closed) return;
    const m = this.myPending();
    if (!m || this.match) return;
    const k = this.matchKey(m);
    if (this.autoStarted.has(k)) return;
    this.autoStarted.add(k);
    setTimeout(() => {
      if (this.myPending()?.id === m.id && !this.match) this.playMatch(m, this.savedDuelFor(m) ?? undefined);
    }, 300);
  }

  // ---------------------------------------------------------------- spectating

  /** Watch a match at another table: dial one of its players and replay the stream read-only. */
  private async watch(m: TMatch) {
    if (this.watching || this.match?.session.inDuel) return;
    const v = this.client.view!;
    const spec = new SpectateClient({ roomCode: matchRoomCode(v.code, m), transport: () => new PeerTransport(serverConfig()), build: BUILD, me: this.client.me });
    let stopped = false;
    const host = h('div', { class: 'duel-host fl-watch-host' });
    let ctl: DuelControl | null = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      ctl?.abort(null, 'Spectating stopped');
      spec.close();
      host.classList.add('closing');
      setTimeout(() => host.remove(), 300);
      document.body.classList.remove('in-duel');
      lockNav(false);
      if (this.watching?.stop === stop) this.watching = null;
      this.render();
    };
    this.watching = { stop, mid: m.id, spec };
    document.body.appendChild(host);
    document.body.classList.add('in-duel');
    lockNav(true);
    const pane = (title: string, text: string, actions = true) =>
      host.replaceChildren(
        h(
          'div',
          { class: 'fl-watch-wait' },
          h('span', { class: 'spinner' }),
          h('b', null, title),
          h('span', null, text),
          actions ? button('Stop watching', stop, { variant: 'ghost', small: true }) : null,
        ),
      );
    const a = v.players.find((p) => p.id === m.a)!;
    const b = v.players.find((p) => p.id === m.b)!;
    const table = m.stage === 'swiss' ? `Table ${m.table}` : m.label;
    pane(`${table} · ${a.name} vs ${b.name}`, 'Connecting to the table…');
    try {
      await spec.begin([0, 1]);
    } catch {
      if (!stopped) {
        toast('Couldn’t reach that table. The players’ phones may be busy; try again in a moment.', 'error', 4000);
        stop();
      }
      return;
    }
    for (let g = 0; !stopped; g++) {
      // wait for the game's setup (decks after siding, who goes first)
      pane(`${table} · ${a.name} vs ${b.name}`, g ? `Waiting for game ${g + 1}…` : 'Waiting for the duel to start…');
      const t0 = Date.now();
      let ready = false;
      while (!stopped) {
        const st = spec.start;
        const wg = spec.games[g];
        const done = st && matchOutcome(spec.games.slice(0, g).map((x) => ({ winner: x.end?.winner ?? null, turns: 0, reason: '', how: 'human' as const })), st.bestOf).result;
        if (done || this.findMatch(m.id)?.result != null) break;
        if (st && wg?.decks[0] && wg.decks[1] && wg.first != null) {
          ready = true;
          break;
        }
        if (Date.now() - t0 > 10 * 60 * 1000) break;
        await sleep(250);
      }
      if (!ready || stopped) break;
      const st = spec.start!;
      const wg = spec.games[g];
      const da = deckFromWire(wg.decks[0]!);
      const db = deckFromWire(wg.decks[1]!);
      if (!da || !db) break;
      const bo3 = st.bestOf === 3;
      let caught = false;
      const onWaiting = (on: boolean) => {
        if (on && !caught) {
          caught = true;
          ctl?.endCatchUp();
        }
      };
      host.replaceChildren();
      const P = st.players;
      await startDuel(host, {
        sides: [
          { name: P[0].name, avatar: P[0].avatar, sleeve: P[0].sleeve, control: 'normal', title: v.settings.hideDecks ? undefined : wg.decks[0]!.name, deck: da },
          { name: P[1].name, avatar: P[1].avatar, sleeve: P[1].sleeve, control: 'normal', title: v.settings.hideDecks ? undefined : wg.decks[1]!.name, deck: db },
        ],
        playmat: getSettings().playmat,
        seed: wg.seed,
        firstPlayer: typeof wg.first === 'number' ? wg.first : 'coin',
        skipFirstDraw: st.skipFirstDraw,
        caption: `${table} · Watching${bo3 ? ` · Game ${g + 1} of 3` : ''}`,
        spectate: { controllers: [spec.remote(g, 0, onWaiting), spec.remote(g, 1, onWaiting)], catchUp: true },
        onMount: (c) => {
          ctl = c;
          c.root.classList.add('fl-watching');
          (c.root.querySelector('.phasebar') ?? c.root).appendChild(h('div', { class: 'fr-chip is-on fl-watch-chip', role: 'status' }, icon('eye'), h('span', { class: 'fr-chip-text' }, `Watching · ${table}`)));
          c.onAbort(() => {
            if (!stopped) stop();
          });
        },
        onGameOver: () => {
          if (botLevel()) setTimeout(() => (host.querySelector('.result-continue') as HTMLButtonElement | null)?.click(), 400);
        },
        resultTitle: (r) => (r.reason === 'Spectating stopped' ? 'Stopped watching' : undefined),
      }).catch((e) => console.error('[friends-locals] spectating failed', e));
      ctl = null;
    }
    stop();
  }

  // ---------------------------------------------------------------- finishing

  /** The event is over: grant this phone's prize once and write the history entry. */
  private finish(v: TView) {
    const me = this.client.me.clientId;
    const hist = loadFriendsLocalsHistory();
    if (hist.some((x) => x.tid === v.tid)) return;
    const st = viewStandings(v).find((x) => x.id === me);
    if (!st) return;
    const lines = friendsPrizesFor(v, me);
    for (const l of lines) if (l.packs || l.coins) grantPrize({ packs: l.packs || undefined, coins: l.coins || undefined, reason: l.reason });
    const champ = v.players.find((p) => p.id === v.placements?.[0]);
    const entry: FriendsLocalsHistory = {
      tid: v.tid,
      code: v.code,
      date: v.createdAt,
      players: v.players.length,
      names: v.players.map((p) => p.name),
      place: placeIn(v, me),
      record: `${st.w}-${st.l}${st.d ? `-${st.d}` : ''}`,
      champion: champ?.name ?? '?',
      championDeck: champ?.deckName ?? null,
      deckName: this.client.deck?.name ?? null,
      organiser: !!this.host,
      packs: lines.reduce((a, l) => a + l.packs, 0),
      coins: lines.reduce((a, l) => a + l.coins, 0),
    };
    saveJSON(HISTORY_KEY, [entry, ...hist].slice(0, 50));
    haptic('success');
  }

  // ---------------------------------------------------------------- rendering

  render() {
    const body = this.body;
    // A body that is not attached yet still renders: the router builds a screen before attaching
    // it, and skipping here left the screen blank when returning to Friends Locals. A screen that
    // was left clears `body` in its dispose, so nothing renders into a closed screen.
    if (!body || this.closed) return;
    const v = this.client.view;
    if (!v) {
      busy(body, this.client.connected ? 'Joining…' : 'Connecting to the organiser…', () => this.leave());
      return;
    }
    const keepScroll = document.body.scrollTop || window.scrollY;
    if (v.phase === 'lobby') body.replaceChildren(this.lobbyView(v));
    else body.replaceChildren(this.eventView(v));
    if (keepScroll) {
      window.scrollTo(0, keepScroll);
      document.body.scrollTop = keepScroll;
    }
  }

  private statusBanner(v: TView): HTMLElement | null {
    if (this.host) {
      if (!this.host.hub || this.client.status !== 'connected') return null;
      return null;
    }
    if (this.client.connected) return null;
    return h(
      'div',
      { class: 'fl-banner', role: 'status', 'data-test': 'fl-offline' },
      h('span', { class: 'spinner' }),
      h('span', null, h('b', null, 'Waiting for the organiser'), h('small', null, v.phase === 'lobby' ? 'Their phone may be asleep. Keep this screen open.' : 'Matches keep going; results are sent when they are back.')),
    );
  }

  private me(v: TView): TPlayerView | undefined {
    return v.players.find((p) => p.id === this.client.me.clientId);
  }

  // ---------------------------------------------------------------- lobby

  private lobbyView(v: TView): HTMLElement {
    const org = !!this.host;
    const me = this.me(v);
    const decks = allDeckInfos();
    const reg = this.client.deck;
    const selKey = loadJSON<Prefs>(PREFS_KEY, {}).deck ?? null;
    const pickDeck = (d: DeckInfo | null) => {
      if (!d) return;
      saveJSON(PREFS_KEY, { ...loadJSON<Prefs>(PREFS_KEY, {}), deck: d.key });
      if (d.problems.length) {
        toast(`${d.name} is not legal: ${d.problems[0]}`, 'error', 3600);
        this.client.register(null, false);
      } else this.client.register(wireDeck(d), false);
      this.render();
    };
    const ready = !!me?.ready;
    const toggleReady = () => {
      if (!reg) return toast('Choose a legal deck first.', 'error');
      haptic(ready ? 'light' : 'success');
      this.client.register(reg, !ready);
    };
    const problem = this.host?.startProblem() ?? null;
    const players = h(
      'div',
      { class: 'fr-seats fl-players', 'data-test': 'fl-players' },
      v.players.map((p) => {
        const you = p.id === this.client.me.clientId;
        const deckLine = p.deckProblem ? `Deck refused: ${p.deckProblem}` : p.hasDeck ? (p.deckName ?? 'Deck registered · hidden') : 'Choosing a deck…';
        return h(
          'div',
          { class: ['fr-seat', p.ready && 'is-ready', p.online === false && 'is-away'] },
          avatar({ name: p.name, human: you }, 40),
          h('span', { class: 'fr-seat-text' }, h('b', null, `${p.name}${you ? ' (you)' : ''}`, p.organiser ? h('span', { class: 'fl-tag' }, 'Organiser') : null), h('span', null, p.online === false ? `${deckLine} · away` : deckLine)),
          h('span', { class: ['fr-badge', p.ready ? 'on' : ''] }, p.ready ? 'Ready' : 'Not ready'),
          org && !you ? h('button', { type: 'button', class: 'fl-kick', 'aria-label': `Remove ${p.name}`, onclick: () => this.host!.kick(p.id) }, icon('x')) : null,
        );
      }),
      v.players.length < MAX_PLAYERS
        ? h('div', { class: 'fr-seat is-empty' }, h('span', { class: 'fr-seat-av' }, h('span', { class: 'spinner' })), h('span', { class: 'fr-seat-text' }, h('b', null, v.players.length < MIN_PLAYERS ? `Waiting for ${MIN_PLAYERS - v.players.length} more` : 'Room for more'), h('span', null, `Code ${v.code} · up to ${MAX_PLAYERS} players`)))
        : null,
    );
    const s = v.settings;
    const fmt = org ? this.settingsEditor(v) : h('div', { class: 'fl-format-ro' }, formatChips(v));
    const cta = org && !problem
      ? ctaButton('Start tournament', () => this.startEvent(), 'play', 'fl-start')
      : ctaButton(ready ? 'Ready · tap to cancel' : 'Ready', toggleReady, 'check', ['fr-ready', ready && 'is-on'].filter(Boolean).join(' '));
    cta.dataset.test = org && !problem ? 'fl-start' : 'fl-ready';
    if (!reg && !(org && !problem)) cta.setAttribute('disabled', '');
    const note = h(
      'p',
      { class: 'fr-note' },
      !reg
        ? 'Choose a legal deck to register it.'
        : org
          ? problem
            ? `${problem}.`
            : 'Everyone is ready.'
          : ready
            ? 'Registered and ready. The organiser starts the event.'
            : 'Tap Ready to register your deck. It is locked once the event starts.',
    );
    return h(
      'div',
      { class: 'fr-pane fr-lobby fl-lobby' },
      this.statusBanner(v),
      h(
        'section',
        { class: 'fr-room' },
        h('div', { class: 'fr-room-l' }, h('span', { class: 'home-eyebrow' }, 'Tournament code'), h('div', { class: 'fr-code', 'data-test': 'fl-code' }, v.code)),
        button('Share', () => void shareEvent(v.code), { icon: 'upload', variant: 'ghost', small: true, cls: 'fr-share' }),
      ),
      lobbySection(`Players · ${v.players.length}`, null, players),
      lobbySection('Format', null, fmt),
      lobbySection(
        'Your deck',
        null,
        deckShelf(decks, selKey, pickDeck, { label: 'Your deck', newDeck: () => go('deck-builder') }),
        h('p', { class: 'fr-hint' }, 'Main, Extra and Side Deck are registered together. In Best of 3 you side from your registered Side Deck between games.'),
      ),
      h('button', { type: 'button', class: 'fr-leave', 'data-test': 'fl-leave', onclick: () => void this.confirmLeave() }, org ? 'Cancel tournament' : 'Leave tournament'),
      stickyBar(note, cta),
    );
    void s;
  }

  private settingsEditor(v: TView): HTMLElement {
    const host = this.host!;
    const s = host.state.settings;
    const n = v.players.length;
    const set = (p: Partial<TSettings>) => {
      host.setSettings(p);
      saveJSON(PREFS_KEY, { ...loadJSON<Prefs>(PREFS_KEY, {}), settings: { ...s, ...p } });
      this.render();
    };
    const row = (label: string, ctl: HTMLElement, hint?: string) => h('div', { class: 'fl-set-row' }, h('span', { class: 'fl-set-k' }, h('b', null, label), hint ? h('small', null, hint) : null), ctl);
    const auto = host.plannedRounds();
    return h(
      'div',
      { class: 'fl-settings', 'data-test': 'fl-settings' },
      row('Match', segmented<1 | 3>([{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }], s.bestOf, (x) => set({ bestOf: x }), 'Match length')),
      row(
        'Swiss rounds',
        segmented<number>(
          [{ value: 0, label: `Auto · ${auto}` }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 5, label: '5' }],
          s.rounds ?? 0,
          (x) => set({ rounds: x || null }),
          'Swiss rounds',
        ),
        'Auto follows the player count, like Locals Night.',
      ),
      row(
        'Top cut',
        segmented<0 | 4 | 8>([{ value: 0, label: 'None' }, { value: 4, label: 'Top 4' }, { value: 8, label: 'Top 8' }], s.topCut, (x) => set({ topCut: x }), 'Top cut'),
        s.topCut && n < s.topCut ? `Needs ${s.topCut} players (now ${n}); otherwise none.` : 'Single elimination after Swiss.',
      ),
      row('Round timer', segmented<number>([{ value: 0, label: 'Off' }, { value: 30, label: '30m' }, { value: 45, label: '45m' }, { value: 60, label: '60m' }], s.timerMin, (x) => set({ timerMin: x }), 'Round timer')),
      row('Hide deck names', toggle(s.hideDecks, (x) => set({ hideDecks: x }), 'Hide deck names'), 'Revealed at the end.'),
      row('Pair rounds automatically', toggle(s.autoPair, (x) => set({ autoPair: x }), 'Pair automatically'), 'Otherwise you tap “Pair next round”.'),
    );
  }

  private startEvent() {
    const host = this.host;
    if (!host) return;
    const p = host.startProblem();
    if (p) return toast(p, 'error');
    haptic('success');
    host.startEvent();
  }

  private async confirmLeave() {
    const v = this.client.view;
    const org = !!this.host;
    const started = v && v.phase !== 'lobby' && v.phase !== 'done';
    if (v?.phase !== 'done') {
      const ok = await confirmDialog(
        org ? (started ? 'End the tournament?' : 'Cancel the tournament?') : started ? 'Drop from the tournament?' : 'Leave the tournament?',
        org ? 'Everyone’s event ends here. Results so far are not kept.' : started ? 'Your current match is conceded and you are not paired again. You can still watch.' : 'You can join again with the code.',
        org ? (started ? 'End it' : 'Cancel it') : started ? 'Drop' : 'Leave',
        true,
      );
      if (!ok) return;
    }
    if (!org && started) {
      this.dropMe();
      return;
    }
    if (!org && v?.phase === 'lobby') this.client.drop();
    setTimeout(() => this.leave(), org ? 0 : 200);
  }

  /** Drop: concede the match in progress, tell the organiser, keep watching. */
  private dropMe() {
    const mm = this.match;
    if (mm) {
      this.match = null;
      mm.session.abandon('Dropped');
    }
    this.client.drop();
    this.render();
  }

  // ---------------------------------------------------------------- the event

  private eventView(v: TView): HTMLElement {
    const org = !!this.host;
    const done = v.phase === 'done';
    const tabs: { value: Tab; label: string }[] = [
      { value: 'round', label: done ? 'Prizes' : 'Round' },
      { value: 'standings', label: 'Standings' },
      ...(v.topCut ? [{ value: 'bracket' as Tab, label: 'Bracket' }] : []),
      ...(org ? [{ value: 'organiser' as Tab, label: 'Organiser' }] : []),
    ];
    if (!tabs.some((t) => t.value === this.tab)) this.tab = 'round';
    const content =
      this.tab === 'standings' ? standingsView(v, this.client.me.clientId) : this.tab === 'bracket' ? bracketView(v, this.client.me.clientId) : this.tab === 'organiser' ? this.organiserView(v) : done ? this.ceremonyView(v) : this.roundView(v);
    const label = done ? 'Final standings' : v.phase === 'swiss' ? `Round ${v.rounds.length} of ${v.swissRounds}` : (v.top[v.top.length - 1]?.[0]?.label ?? 'Top cut');
    const timer = !done && v.settings.timerMin ? h('span', { class: 'fl-timer', 'data-start': String(v.roundStartedAt), 'data-min': String(v.settings.timerMin) }, timerText(v.roundStartedAt, v.settings.timerMin)) : null;
    const disputes = org && !done ? this.currentRound(v).filter((m) => m.dispute || (m.result == null && m.reported.length === 1 && this.claimWaiting(m))).length : 0;
    return h(
      'div',
      { class: 'fr-pane fl-event' },
      this.statusBanner(v),
      h(
        'header',
        { class: 'fl-head' },
        h('div', null, h('span', { class: 'home-eyebrow' }, `${v.code} · ${v.players.length} players · Best of ${v.settings.bestOf}`), h('h2', { class: 'fl-head-title' }, label)),
        timer,
      ),
      h(
        'div',
        { class: 'fl-tabs' },
        segmented<Tab>(
          tabs.map((t) => (t.value === 'organiser' && disputes ? { ...t, label: `Organiser · ${disputes}` } : t)),
          this.tab,
          (t) => {
            this.tab = t;
            this.render();
            scrollToTop();
          },
          'Event view',
        ),
      ),
      content,
      done
        ? h('div', { class: 'fr-actions' }, ctaButton('Done', () => this.leave(), 'check', 'fl-done'))
        : h('button', { type: 'button', class: 'fr-leave', 'data-test': 'fl-leave', onclick: () => void this.confirmLeave() }, org ? 'End tournament' : this.client.dropped ? 'Leave (you dropped)' : 'Drop from tournament'),
    );
  }

  private currentRound(v: TView): TMatch[] {
    return v.phase === 'swiss' ? (v.rounds[v.rounds.length - 1] ?? []) : v.phase === 'top' ? (v.top[v.top.length - 1] ?? []) : [];
  }

  private claimWaiting(m: TMatch) {
    return !m.dispute && m.result == null && m.reported.length === 1;
  }

  private roundView(v: TView): HTMLElement {
    const round = this.currentRound(v);
    return h('div', { class: 'fl-round' }, this.myMatchCard(v), pairingsSheet(v, round, this.client.me.clientId, (m) => this.canWatch(v, m), (m) => void this.watch(m)));
  }

  private canWatch(v: TView, m: TMatch) {
    const me = this.client.me.clientId;
    return m.result == null && m.b != null && m.a !== me && m.b !== me && !this.myPending() && !this.match?.session.inDuel && v.phase !== 'done';
  }

  private myMatchCard(v: TView): HTMLElement {
    const me = this.client.me.clientId;
    const m = this.client.myMatch();
    const name = (id: string | null) => v.players.find((p) => p.id === id)?.name ?? '';
    const card = (cls: string, ...kids: (HTMLElement | string | null)[]) => h('section', { class: ['fl-card', cls], 'data-test': 'fl-my-match' }, ...kids);
    if (this.client.dropped) return card('is-quiet', h('span', { class: 'lx-k' }, 'Your event'), h('b', { class: 'fl-card-title' }, 'You dropped'), h('p', null, 'You are not paired again. Watch the matches still going below.'));
    if (!m) {
      const out = v.phase === 'top';
      return card('is-quiet', h('span', { class: 'lx-k' }, out ? 'Top cut' : 'This round'), h('b', { class: 'fl-card-title' }, out ? 'Not in this bracket round' : 'No match for you'), h('p', null, 'Watch a match below while you wait.'));
    }
    if (m.b == null) return card('is-bye', h('span', { class: 'lx-k' }, `Round ${m.round}`), h('b', { class: 'fl-card-title' }, 'Bye'), h('p', null, 'A free win: 3 points. Watch a match below while you wait.'));
    const oppId = m.a === me ? m.b : m.a;
    const opp = v.players.find((p) => p.id === oppId)!;
    const where = m.stage === 'swiss' ? `Table ${m.table}` : m.label;
    const head = h(
      'div',
      { class: 'fl-card-head' },
      avatar({ name: opp.name }, 44),
      h('span', null, h('span', { class: 'lx-k' }, `${where} · ${v.settings.bestOf === 3 ? 'Best of 3' : 'Best of 1'}`), h('b', { class: 'fl-card-title' }, `vs ${opp.name}`), h('small', null, opp.deckName ?? (v.settings.hideDecks ? 'Deck hidden' : ''))),
    );
    if (m.result != null) {
      const mine = m.a === me ? 0 : 1;
      const w = m.games.filter((g) => g.winner === mine).length;
      const l = m.games.filter((g) => g.winner === 1 - mine).length;
      const won = (m.result === 'a') === (mine === 0) && m.result !== 'draw';
      const title = m.result === 'draw' ? (m.intentional ? 'Intentional draw' : 'Draw') : won ? 'You won' : `${opp.name} won`;
      const rest = this.currentRound(v).filter((x) => x.result == null).length;
      return card(
        m.result === 'draw' ? 'is-draw' : won ? 'is-win' : 'is-lose',
        head,
        h('div', { class: 'fl-card-res' }, h('b', null, title), m.games.length ? h('span', null, `${w}–${l}`) : null, h('small', null, howText(m))),
        h('p', null, rest ? `Waiting for ${rest} more table${rest === 1 ? '' : 's'}. Watch one below.` : this.host ? 'Every result is in. Pair the next round from the Organiser tab.' : 'Every result is in. The organiser pairs the next round.'),
      );
    }
    if (this.client.reportPending(m.id) || m.reported.includes(me)) {
      const waitingOrg = !this.client.connected && !this.host;
      return card(
        'is-wait',
        head,
        h('div', { class: 'fl-wait' }, h('span', { class: 'spinner' }), h('span', null, m.dispute ? 'The organiser is checking this result.' : waitingOrg ? 'Result saved · waiting for the organiser to come back.' : m.reported.includes(me) ? `Result sent · waiting for ${opp.name}’s report or the organiser.` : 'Sending the result…')),
        this.match ? this.matchPane : null,
      );
    }
    const playing = this.match && this.match.mid === m.id && this.match.attempt === m.attempt;
    const saved = this.savedDuelFor(m);
    const offered = this.client.idOffers.has(m.id);
    const theyOffered = (m.idOffers ?? []).includes(oppId!);
    const actions = h('div', { class: 'fl-card-actions' });
    if (!playing) {
      const go = ctaButton(saved ? 'Resume match' : 'Start match', () => this.playMatch(m, saved ?? undefined), 'swords', 'fl-play');
      go.dataset.test = 'fl-play';
      actions.append(go);
    } else if (this.match!.session.inDuel) actions.append(h('p', { class: 'fr-hint' }, 'Duel in progress…'));
    if (m.stage === 'swiss')
      actions.append(
        h(
          'button',
          { type: 'button', class: ['fl-id', offered && 'is-on'], 'data-test': 'fl-id', onclick: () => (haptic('selection'), this.client.offerId(m.id, !offered), this.render()) },
          icon('hand'),
          h('span', null, offered ? 'Draw offered · tap to withdraw' : theyOffered ? `${opp.name} offers a draw · accept` : 'Offer an intentional draw'),
        ),
      );
    return card(
      'is-live',
      head,
      this.error && !playing ? h('div', { class: 'fr-error', role: 'alert' }, icon('warn'), h('span', null, this.error)) : null,
      playing ? this.matchPane : null,
      theyOffered && !offered ? h('p', { class: 'fr-ask' }, `${opp.name} offered an intentional draw.`) : null,
      actions,
    );
    void name;
  }

  // ---------------------------------------------------------------- organiser tools

  private organiserView(v: TView): HTMLElement {
    const host = this.host!;
    const round = this.currentRound(v);
    const name = (id: string | null) => v.players.find((p) => p.id === id)?.name ?? '—';
    const timeUp = !!v.settings.timerMin && Date.now() - v.roundStartedAt > v.settings.timerMin * 60000;
    const rows = round
      .filter((m) => m.b != null)
      .map((m) => {
        const status = m.result != null ? `${resultText(m, name)} · ${howText(m)}` : m.dispute ? m.dispute.reason : this.claimWaiting(m) ? `${name(m.reported[0])} reported a win given while ${name(m.reported[0] === m.a ? m.b : m.a)} was away` : m.reported.length ? `Reported by ${m.reported.map(name).join(' and ')}` : 'Playing';
        const decide = (r: 'a' | 'b' | 'draw') => async () => {
          const label = r === 'draw' ? 'a draw' : `a win for ${name(r === 'a' ? m.a : m.b)}`;
          if (await confirmDialog('Decide this match?', `Record ${label}. This replaces any reported result.`, 'Record it')) host.resolve(m.id, r);
          this.render();
        };
        const open = m.result == null;
        return h(
          'div',
          { class: ['fl-org-row', m.dispute && 'is-dispute', open && 'is-open'] },
          h('div', { class: 'fl-org-top' }, h('span', { class: 'fl-org-tbl' }, m.stage === 'swiss' ? `T${m.table}` : m.label), h('b', null, `${name(m.a)} vs ${name(m.b)}`)),
          h('div', { class: 'fl-org-status' }, status),
          m.dispute?.detail ? h('div', { class: 'fl-org-detail' }, m.dispute.detail) : null,
          open
            ? h(
                'div',
                { class: 'fl-org-actions' },
                this.claimWaiting(m) ? button('Accept', () => (host.acceptReport(m.id), this.render()), { variant: 'primary', small: true }) : null,
                button(`${name(m.a)} wins`, decide('a'), { variant: 'ghost', small: true }),
                button(`${name(m.b)} wins`, decide('b'), { variant: 'ghost', small: true }),
                m.stage === 'swiss' ? button('Draw', decide('draw'), { variant: 'ghost', small: true }) : null,
                m.dispute ? button('Replay match', () => (host.replay(m.id), this.render()), { variant: 'ghost', small: true }) : null,
                timeUp ? button('Call time', () => (host.callTime(m.id), this.render()), { variant: 'ghost', small: true }) : null,
              )
            : null,
        );
      });
    const complete = host.roundComplete();
    const next = v.phase === 'done' ? null : ctaButton(nextLabel(v, host), () => (haptic('success'), host.pairNext(), this.render()), 'shuffle', 'fl-pair');
    next?.setAttribute('data-test', 'fl-pair');
    if (next && !complete) next.setAttribute('disabled', '');
    const players = v.players.map((p) =>
      h(
        'div',
        { class: ['fl-org-player', p.dropped != null && 'is-drop'] },
        h('span', { class: ['fl-dot', p.online ? 'on' : ''] }),
        h('b', null, p.name),
        h('small', null, p.dropped != null ? `Dropped after round ${p.dropped}` : p.online ? 'Connected' : 'Away'),
        p.dropped == null && v.phase !== 'done' && p.id !== this.client.me.clientId
          ? button('Drop', async () => {
              if (await confirmDialog(`Drop ${p.name}?`, 'Their current match goes to the opponent and they are not paired again.', 'Drop', true)) host.dropPlayer(p.id);
              this.render();
            }, { variant: 'ghost', small: true })
          : null,
      ),
    );
    return h(
      'div',
      { class: 'fl-org' },
      lobbySection('This round', null, rows.length ? h('div', { class: 'fl-org-list' }, rows) : h('p', { class: 'fr-hint' }, 'Only byes this round.')),
      next ? h('div', { class: 'fl-org-next' }, next, h('p', { class: 'fr-hint' }, complete ? 'Every result is in.' : 'Pairs once every result is in. Results are verified by replaying each game.')) : null,
      lobbySection(
        'Settings',
        null,
        h(
          'div',
          { class: 'fl-settings' },
          h('div', { class: 'fl-set-row' }, h('span', { class: 'fl-set-k' }, h('b', null, 'Pair rounds automatically')), toggle(v.settings.autoPair, (x) => (host.setSettings({ autoPair: x }), this.render()), 'Pair automatically')),
          h(
            'div',
            { class: 'fl-set-row' },
            h('span', { class: 'fl-set-k' }, h('b', null, 'Round timer')),
            segmented<number>([{ value: 0, label: 'Off' }, { value: 30, label: '30m' }, { value: 45, label: '45m' }, { value: 60, label: '60m' }], v.settings.timerMin, (x) => (host.setSettings({ timerMin: x }), this.render()), 'Round timer'),
          ),
        ),
      ),
      lobbySection('Players', null, h('div', { class: 'fl-org-players' }, players)),
      h('p', { class: 'fr-hint fl-org-foot' }, 'Keep this phone open: it runs the event. If it sleeps, matches keep going and results wait until it is back.'),
    );
  }

  // ---------------------------------------------------------------- ceremony

  private ceremonyView(v: TView): HTMLElement {
    const me = this.client.me.clientId;
    const place = placeIn(v, me);
    const st = viewStandings(v).find((x) => x.id === me);
    const lines = friendsPrizesFor(v, me);
    const packs = lines.reduce((a, l) => a + l.packs, 0);
    const coins = lines.reduce((a, l) => a + l.coins, 0);
    const champ = v.players.find((p) => p.id === v.placements?.[0])!;
    const madeCut = !!v.top[0]?.some((m) => m.a === me || m.b === me);
    const headline = place === 1 ? 'Champion' : place === 2 && v.top.length ? 'Finalist' : madeCut ? `Top ${v.topCut}` : 'Thanks for playing';
    const art = h('span', { class: 'lx-cer-art' });
    artInto(art, ART);
    return h(
      'section',
      { class: ['lx-ceremony', 'fl-ceremony', place === 1 && 'is-champ'], 'data-test': 'fl-ceremony' },
      h(
        'div',
        { class: 'lx-cer-hero' },
        art,
        h('span', { class: 'lx-cer-shade' }),
        h(
          'div',
          { class: 'lx-cer-body' },
          h('span', { class: 'lx-k' }, headline),
          h('div', { class: 'lx-cer-place' }, h('b', null, ordinal(place)), h('span', null, `of ${v.players.length}`)),
          h('div', { class: 'lx-cer-line' }, `${this.client.deck?.name ?? 'Your deck'} · Swiss ${st ? `${st.w}-${st.l}${st.d ? `-${st.d}` : ''}` : ''}${madeCut ? ` · Top ${v.topCut}` : ''}`),
        ),
      ),
      h(
        'div',
        { class: 'lx-cer-prize' },
        h('span', { class: 'lx-k' }, 'Your prize'),
        packs
          ? h(
              'div',
              { class: 'lx-packstack', style: { '--n': String(packs) } },
              Array.from({ length: packs }, (_, i) => h('span', { class: 'lx-pack', style: { '--i': String(i) } }, h('span', { class: 'lx-pack-crimp' }), h('span', { class: 'lx-pack-mark' }, 'EDISON'), h('span', { class: 'lx-pack-crimp' }))),
            )
          : null,
        h('div', { class: 'lx-cer-total' }, packs ? h('b', null, `${packs} booster pack${packs === 1 ? '' : 's'}`) : null, h('span', null, `${packs ? ' + ' : ''}${coins} DP`)),
        h('div', { class: 'lx-cer-lines' }, lines.map((l) => h('div', { class: 'lx-cer-row' }, h('span', null, l.reason.replace(/^Friends Locals · /, '')), h('span', null, [l.packs ? `${l.packs} pack${l.packs === 1 ? '' : 's'}` : '', l.coins ? `${l.coins} DP` : ''].filter(Boolean).join(' · '))))),
      ),
      h(
        'div',
        { class: 'lx-cer-champ' },
        avatar({ name: champ.name, human: champ.id === me }, 40),
        h('div', null, h('span', { class: 'lx-k' }, 'Champion'), h('b', null, champ.id === me ? 'You' : champ.name), h('span', null, champ.deckName ?? '')),
      ),
      h('p', { class: 'fr-hint fl-cer-foot' }, `Prizes are on this phone: ${FRIENDS_PRIZES.first.packs} packs for 1st, ${FRIENDS_PRIZES.second.packs} for 2nd, DP for everyone. Online events do not change your rating.`),
    );
  }

  // ---------------------------------------------------------------- timers and tests

  private tickTimers() {
    this.reconcileMatch();
    this.autoPlay();
    const b = this.body;
    if (!b?.isConnected) return;
    for (const el of b.querySelectorAll<HTMLElement>('.fl-timer')) {
      const t = timerText(Number(el.dataset.start), Number(el.dataset.min));
      if (el.textContent !== t) el.textContent = t;
      el.classList.toggle('is-over', t === 'Time');
    }
  }

  private exposeTestHooks() {
    const self = this;
    (window as any).__edisonLocals = {
      get view() {
        return self.client.view;
      },
      get client() {
        return self.client;
      },
      get host() {
        return self.host;
      },
      get connected() {
        return self.client.connected;
      },
      get playing() {
        return !!self.match?.session.inDuel;
      },
      get watching() {
        return !!self.watching;
      },
      /** Decisions the spectator feed has delivered so far. */
      get watchEntries() {
        return self.watching?.spec.games.reduce((a, g) => a + (g ? g.logs[0].length + g.logs[1].length : 0), 0) ?? 0;
      },
      watch: (mid: string) => {
        const m = self.findMatch(mid);
        if (m) void self.watch(m);
      },
      stopWatching: () => self.watching?.stop(),
      standings: () => (self.client.view ? viewStandings(self.client.view) : []),
    };
  }
}

// ------------------------------------------------------------------ pieces

function busy(body: HTMLElement, text: string, onCancel?: () => void) {
  body.replaceChildren(h('div', { class: 'fr-pane fr-busy' }, h('span', { class: 'spinner' }), h('p', null, text), onCancel ? h('button', { type: 'button', class: 'fr-leave', onclick: onCancel }, 'Cancel') : null));
}

function formatChips(v: TView) {
  const s = v.settings;
  const chip = (t: string) => h('span', { class: 'fl-chip' }, t);
  return [
    chip(s.bestOf === 3 ? 'Best of 3 · siding' : 'Best of 1'),
    chip(`${v.swissRounds} Swiss rounds`),
    chip(v.topCut ? `Top ${v.topCut}` : 'No top cut'),
    s.timerMin ? chip(`${s.timerMin} min rounds`) : null,
    s.hideDecks ? chip('Decks hidden') : null,
  ];
}

function timerText(start: number, min: number) {
  const left = Math.round(min * 60 - (Date.now() - start) / 1000);
  if (left <= 0) return 'Time';
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function howText(m: TMatch) {
  switch (m.how) {
    case 'verified':
      return 'Verified by replay';
    case 'confirmed':
      return 'Accepted by the organiser';
    case 'concede':
      return 'Conceded';
    case 'drop':
      return 'Opponent dropped';
    case 'id':
      return 'Agreed draw';
    case 'organiser':
      return 'Organiser decision';
    case 'time':
      return 'Time called';
    case 'bye':
      return 'Bye';
    default:
      return '';
  }
}

function resultText(m: TMatch, name: (id: string | null) => string) {
  if (m.result === 'draw') return m.intentional ? 'ID' : 'Draw';
  const w = m.games.filter((g) => g.winner === 0).length;
  const l = m.games.filter((g) => g.winner === 1).length;
  return `${name(m.result === 'a' ? m.a : m.b)} wins${m.games.length ? ` ${Math.max(w, l)}–${Math.min(w, l)}` : ''}`;
}

function nextLabel(v: TView, host: TourneyHost) {
  if (v.phase === 'swiss') return v.rounds.length < v.swissRounds ? `Pair round ${v.rounds.length + 1}` : v.topCut ? `Post the Top ${v.topCut}` : 'Final standings';
  return (v.top[v.top.length - 1]?.length ?? 0) <= 1 ? 'Crown the champion' : 'Pair the next bracket round';
  void host;
}

/** The pairings sheet, Locals Night style, with a Watch button on live tables. */
function pairingsSheet(v: TView, round: TMatch[], me: string, canWatch: (m: TMatch) => boolean, watch: (m: TMatch) => void) {
  const top = round[0]?.stage === 'top';
  const prior = viewStandings({ players: v.players, rounds: top ? v.rounds : v.rounds.slice(0, -1) });
  const pts = new Map(prior.map((x) => [x.id, x.mp]));
  const name = (id: string | null) => (id === me ? 'You' : (v.players.find((p) => p.id === id)?.name ?? ''));
  const label = top ? round[0].label : `Round ${round[0]?.round ?? 1}`;
  const rows = [...round].sort((a, b) => (a.b == null ? 1 : 0) - (b.b == null ? 1 : 0) || a.table - b.table);
  const firstRound = !top && (round[0]?.round ?? 1) === 1;
  const cell = (id: string | null, m: TMatch, right = false) => {
    if (!id) return h('span', { class: ['lx-cell', 'is-bye', right && 'right'] }, h('span', { class: 'lx-cell-n' }, 'Bye'));
    const won = m.result && m.result !== 'draw' && (m.result === 'a' ? m.a : m.b) === id;
    const lost = m.result && m.result !== 'draw' && !won;
    return h('span', { class: ['lx-cell', right && 'right', id === me && 'is-me', lost && 'is-lost', won && 'is-won'] }, h('span', { class: 'lx-cell-n' }, name(id)), h('span', { class: 'lx-cell-p' }, firstRound || top ? '' : String(pts.get(id) ?? 0)));
  };
  const mid = (m: TMatch) => {
    if (m.b == null) return h('span', { class: 'lx-mid is-res' }, 'Bye');
    if (m.result == null) {
      if (canWatch(m)) return h('button', { type: 'button', class: 'lx-mid fl-watch', 'data-test': 'fl-watch', 'aria-label': `Watch ${name(m.a)} vs ${name(m.b)}`, onclick: () => watch(m) }, icon('eye'));
      return h('span', { class: ['lx-mid', m.dispute && 'is-dispute'] }, m.reported.length ? '…' : 'vs');
    }
    if (m.intentional) return h('span', { class: 'lx-mid is-res is-id' }, 'ID');
    const wa = m.games.filter((g) => g.winner === 0).length;
    const wb = m.games.filter((g) => g.winner === 1).length;
    return h('span', { class: ['lx-mid', 'is-res', m.result === 'draw' && 'is-draw'] }, m.games.length ? (m.time ? `${wa}–${wb} T` : `${wa}–${wb}`) : m.result === 'draw' ? 'D' : 'W');
  };
  return h(
    'section',
    { class: ['lx-sheet', 'lx-sheet--pairings', 'fl-sheet'], 'aria-label': `Pairings, ${label}`, 'data-test': 'fl-pairings' },
    h('span', { class: 'lx-tape lx-tape--l', 'aria-hidden': 'true' }),
    h('span', { class: 'lx-tape lx-tape--r', 'aria-hidden': 'true' }),
    h('header', { class: 'lx-sheet-head' }, h('div', { class: 'lx-sheet-title' }, h('b', null, 'Pairings'), h('span', null, label)), h('div', { class: 'lx-sheet-meta' }, h('span', null, 'Friends Locals'), h('span', null, v.code))),
    h('div', { class: ['lx-sheet-cols', (firstRound || top) && 'no-pts'], 'aria-hidden': 'true' }, h('span', null, 'Tbl'), h('span', null, 'Player'), h('span', null, top ? '' : 'Pts'), h('span', null, ''), h('span', null, top ? '' : 'Pts'), h('span', { class: 'right' }, 'Opponent')),
    h(
      'div',
      { class: 'lx-rows' },
      rows.map((m) =>
        h('div', { class: ['lx-row', (m.a === me || m.b === me) && 'is-mine'] }, h('span', { class: 'lx-tbl' }, m.b == null ? '—' : String(m.table)), cell(m.a, m, false), mid(m), cell(m.b, m, true)),
      ),
    ),
    h('footer', { class: 'lx-sheet-foot' }, `${top ? 'Single elimination' : 'Swiss'} · ${v.settings.bestOf === 3 ? 'Best of 3' : 'Best of 1'}${round.some((m) => canWatch(m)) ? ' · tap the eye to watch a table' : ''}`),
  );
}

function standingsView(v: TView, me: string) {
  const st = viewStandings(v);
  const played = v.rounds.filter((r) => r.every((m) => m.result != null)).length;
  if (!played) return h('div', { class: 'lx-empty' }, icon('list'), h('b', null, 'No standings yet'), h('span', null, 'Standings go up after round one.'));
  const pct = (x: number) => (x * 100).toFixed(1);
  const cutIds = new Set(v.top[0]?.flatMap((m) => [m.a, m.b]) ?? []);
  const rows: HTMLElement[] = [];
  let eligible = 0;
  for (const s of st) {
    const p = v.players.find((x) => x.id === s.id)!;
    if (!s.dropped) eligible++;
    rows.push(
      h(
        'div',
        { class: ['lx-st-row', s.id === me && 'is-me', s.dropped && 'is-drop', cutIds.has(s.id) && 'is-cut'] },
        h('span', { class: 'lx-st-rank' }, String(s.rank)),
        h('span', { class: 'lx-st-name' }, h('b', null, s.id === me ? `${p.name} (you)` : p.name), (() => {
          const line = s.dropped ? 'Dropped' : (p.deckName ?? '');
          return line ? h('span', null, line) : null;
        })()),
        h('span', { class: 'lx-st-rec' }, `${s.w}-${s.l}${s.d ? `-${s.d}` : ''}`),
        h('span', { class: 'lx-st-pts' }, String(s.mp)),
        h('span', { class: 'lx-st-tb' }, pct(s.omw)),
        h('span', { class: 'lx-st-tb' }, pct(s.oomw)),
      ),
    );
    if (v.phase === 'swiss' && v.topCut && eligible === v.topCut && !s.dropped) rows.push(h('div', { class: 'lx-cutline' }, h('span', null, `Top ${v.topCut} cut`)));
  }
  return h(
    'section',
    { class: 'lx-standings', 'data-test': 'fl-standings' },
    h('div', { class: 'lx-st-caption' }, v.phase === 'swiss' ? `After round ${played} of ${v.swissRounds}` : 'Final Swiss standings', h('span', null, 'OMW% and OOMW% break ties')),
    h(
      'div',
      { class: 'lx-st-table', role: 'table' },
      h('div', { class: 'lx-st-row lx-st-hd', role: 'row' }, h('span', { class: 'lx-st-rank' }, '#'), h('span', { class: 'lx-st-name' }, 'Player'), h('span', { class: 'lx-st-rec' }, 'Rec'), h('span', { class: 'lx-st-pts' }, 'Pts'), h('span', { class: 'lx-st-tb' }, 'OMW'), h('span', { class: 'lx-st-tb' }, 'OOMW')),
      rows,
    ),
  );
}

function bracketView(v: TView, me: string) {
  if (!v.top.length) return h('div', { class: 'lx-empty' }, icon('bracket'), h('b', null, 'Top cut after Swiss'), h('span', null, `The Top ${v.topCut} is single elimination. A drawn match goes to the higher seed.`));
  const seed = new Map<string, number>();
  const st = viewStandings(v).filter((x) => !x.dropped);
  st.forEach((x, i) => seed.set(x.id, i + 1));
  const champ = v.phase === 'done' && v.placements ? v.players.find((p) => p.id === v.placements![0]) : null;
  const slot = (id: string | null, m: TMatch) => {
    const p = v.players.find((x) => x.id === id);
    if (!p) return h('div', { class: 'lx-br-slot is-tbd' }, h('span', { class: 'lx-br-seed' }, ''), h('span', { class: 'lx-br-name' }, 'TBD'));
    const won = m.result && (m.result === 'a' ? m.a : m.b) === id;
    const lost = m.result && !won;
    const mine = m.a === id ? 0 : 1;
    const score = m.result ? String(m.games.filter((g) => g.winner === mine).length) : '';
    return h(
      'div',
      { class: ['lx-br-slot', id === me && 'is-me', won && 'is-won', lost && 'is-lost'] },
      h('span', { class: 'lx-br-seed' }, String(seed.get(id!) ?? '')),
      avatar({ name: p.name, human: id === me }, 26),
      h('span', { class: 'lx-br-name' }, h('b', null, id === me ? 'You' : p.name), h('span', null, p.deckName ?? '')),
      h('span', { class: 'lx-br-score' }, score),
    );
  };
  return h(
    'section',
    { class: 'lx-bracket', 'data-test': 'fl-bracket' },
    champ ? h('div', { class: 'lx-champ' }, icon('trophy'), h('div', null, h('span', { class: 'lx-k' }, 'Champion'), h('b', null, champ.id === me ? 'You' : champ.name), h('span', null, champ.deckName ?? ''))) : null,
    v.top.map((r) =>
      h(
        'div',
        { class: 'lx-br-round' },
        h('h3', { class: 'lx-br-h' }, r[0]?.label ?? '', r.every((m) => m.result) ? h('span', null, 'Complete') : h('span', { class: 'is-live' }, 'In progress')),
        h('div', { class: 'lx-br-grid' }, r.map((m) => h('div', { class: ['lx-br-match', (m.a === me || m.b === me) && 'has-me'] }, slot(m.a, m), slot(m.b, m)))),
      ),
    ),
  );
}

async function shareEvent(code: string) {
  const url = `${location.origin}${location.pathname}#/friend-locals?join=${code}`;
  const text = `Join my Friends Locals in Edison Format. Code ${code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Friends Locals', text, url });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    toast('Link copied. Send it to your friends.', 'success');
  } catch {
    toast(`Tournament code ${code}`, 'info', 5000);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
void packIcon;
void (null as unknown as PlayerId);
