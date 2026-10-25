// Friends Locals: the organiser's phone. Holds the event (players, registered decks, rounds, top
// cut), computes pairings and standings with the Locals Night Swiss engine (locals/swiss.ts),
// collects and verifies match reports, and broadcasts a view of the event to every player.
//
// The organiser is also a player: its own player side (TourneyClient) talks to this class over a
// LocalLink, exactly as the other phones do over the network, so there is one code path.
//
// Results: when a match ends both players report it with the decision logs. Each report is
// replayed headlessly (verify.ts). Two reports that verify and agree settle the match. One report
// is enough when every game in it was decided by the engine or given away by the reporter itself
// (a concede); a win the reporter was given outside the engine (the opponent disconnected) waits
// for the opponent's report or the organiser. Reports that disagree or do not verify become a
// dispute for the organiser: pick the winner, or have the match replayed in a fresh room.
//
// Every change bumps `rev`, is saved (`save`) and sent to every connected player as a `tview`.
// DOM-free: scripts/tourney-test.ts runs it in Node.
import { computeStandings, finalPlacements, nextTopRound, pairSwissRound, seedTopCut, topCutSeeds } from '../locals/swiss';
import { rand, shuffleIn } from '../locals/rng';
import { swissRoundsFor } from '../locals/shops';
import type { LocalsMatch } from '../locals/types';
import type { GameResult } from '../tournament/types';
import { NetHub } from './hub';
import { PROTOCOL_VERSION, type Msg, type NetPlayer, type WireDeck } from './protocol';
import type { NetStatus } from './session';
import type { Transport } from './transport';
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOURNEY_PROTO,
  tourneyPeerId,
  type MatchHow,
  type ReportGame,
  type TMatch,
  type TPhase,
  type TPlayerView,
  type TSettings,
  type TView,
} from './tourneyProtocol';
import { reportKey, verifyReport, wireDeckProblems, type Verdict } from './verify';

export interface TPlayer {
  id: string;
  name: string;
  avatar: string;
  sleeve: string;
  deck: WireDeck | null;
  deckProblem?: string;
  ready: boolean;
  seed: number;
  dropped?: number;
  joinedAt: number;
}

interface StoredReport {
  attempt: number;
  n: number;
  skipFirstDraw: boolean;
  games: ReportGame[];
  key?: string;
  verdict?: Verdict | null;
}

export interface HostState {
  v: 1;
  tid: string;
  code: string;
  createdAt: number;
  organiser: string;
  settings: TSettings;
  phase: TPhase;
  players: TPlayer[];
  rounds: TMatch[][];
  top: TMatch[][];
  swissRounds: number;
  topCut: 0 | 2 | 4 | 8;
  roundStartedAt: number;
  placements?: string[];
  rev: number;
  /** Mulberry32 state for pairings and match seeds. */
  rng: number;
  /** Reports of unsettled matches, by match id and reporter (dropped once the match is settled). */
  reports: Record<string, Record<string, StoredReport>>;
  /** The organiser closed the event. */
  closed?: boolean;
}

/** The organiser's own player side, wired to the host without the network. */
export class LocalLink {
  status: NetStatus = 'idle';
  onStatus: (s: NetStatus) => void = () => {};
  onMessage: (m: Msg) => void = () => {};
  onConnect: (h?: unknown) => void = () => {};
  private closed = false;
  constructor(
    private host: TourneyHost,
    readonly clientId: string,
  ) {}
  async start() {
    this.status = 'connected';
    this.onStatus('connected');
    this.onConnect();
    this.host.localConnected(this);
  }
  /** Player → organiser (asynchronously, as JSON, like the wire). */
  send(m: Msg) {
    if (this.closed) return;
    const raw = JSON.stringify(m);
    setTimeout(() => {
      if (!this.closed) this.host.receive(this.clientId, JSON.parse(raw));
    }, 0);
  }
  /** Organiser → player. */
  deliver(m: Msg) {
    if (this.closed) return;
    const raw = JSON.stringify(m);
    setTimeout(() => {
      if (!this.closed) this.onMessage(JSON.parse(raw));
    }, 0);
  }
  close() {
    this.closed = true;
    this.status = 'closed';
  }
  wake() {}
}

export interface HostOptions {
  code: string;
  me: NetPlayer;
  build: string;
  transport: Transport;
  settings?: Partial<TSettings>;
  /** Restore after a reload. */
  state?: HostState;
  /** Seed of the event's randomness (tests); random otherwise. */
  seed?: number;
  save?: (s: HostState) => void;
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Auto-pair waits this long after the last result (so everyone sees the standings). */
  autoPairDelayMs?: number;
}

export type PairResult = 'round' | 'top' | 'done' | null;

export class TourneyHost {
  state: HostState;
  readonly hub: NetHub;
  /** Something changed (re-render). */
  onChange: () => void = () => {};
  /** Hub registration state. */
  onListening: (on: boolean) => void = () => {};
  private local: LocalLink | null = null;
  private queue: Promise<void> = Promise.resolve();
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private closedHub = false;
  /** Report evaluations in flight (tests wait for them). */
  busy = 0;

  constructor(private o: HostOptions) {
    const now = Date.now();
    this.state = o.state ?? {
      v: 1,
      tid: `${o.code}-${now.toString(36)}`,
      code: o.code,
      createdAt: now,
      organiser: o.me.clientId,
      settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
      phase: 'lobby',
      players: [],
      rounds: [],
      top: [],
      swissRounds: 0,
      topCut: 0,
      roundStartedAt: 0,
      rev: 1,
      rng: (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0,
      reports: {},
    };
    this.hub = new NetHub(o.transport, {
      id: tourneyPeerId(o.code),
      heartbeatMs: o.heartbeatMs,
      timeoutMs: o.timeoutMs,
      hello: () => ({ t: 'hello', proto: PROTOCOL_VERSION, build: o.build, sid: 'organiser', role: 'host', player: o.me, match: null, game: null, have: 0 }),
      accept: (h) => (h.proto !== PROTOCOL_VERSION || h.build !== o.build ? 'version' : h.role === 'host' ? 'busy' : true),
    });
    this.hub.onConnect = (id) => this.connected(id);
    this.hub.onMessage = (id, m) => this.receive(id, m);
    this.hub.onDisconnect = (id) => {
      if (this.player(id)) this.changed(false);
    };
    this.hub.onListening = (on) => this.onListening(on);
  }

  get code() {
    return this.state.code;
  }
  get tid() {
    return this.state.tid;
  }

  /** Open the event for players (after a reload: take the id back). */
  async start() {
    await this.hub.start({ retryTaken: !!this.o.state });
    // reports that arrived before a reload and were never decided
    for (const mid of Object.keys(this.state.reports)) this.evaluate(mid);
  }

  /** The organiser's own player side. */
  localLink(): LocalLink {
    this.local?.close();
    this.local = new LocalLink(this, this.o.me.clientId);
    return this.local;
  }

  localConnected(l: LocalLink) {
    if (l === this.local) this.connected(l.clientId);
  }

  online(id: string) {
    return id === this.state.organiser ? !!this.local : this.hub.connected(id);
  }

  close(endEvent = false) {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    if (endEvent) {
      this.state.closed = true;
      this.save();
    }
    if (this.closedHub) return;
    this.closedHub = true;
    this.hub.close(endEvent ? { t: 'tref', tid: this.tid, reason: 'closed' } : undefined);
    this.local?.close();
  }

  // ------------------------------------------------------------------ queries

  player(id: string | null | undefined) {
    return this.state.players.find((p) => p.id === id);
  }

  matches(): TMatch[] {
    return [...this.state.rounds.flat(), ...this.state.top.flat()];
  }

  match(mid: string) {
    return this.matches().find((m) => m.id === mid);
  }

  currentRound(): TMatch[] {
    const s = this.state;
    if (s.phase === 'swiss') return s.rounds[s.rounds.length - 1] ?? [];
    if (s.phase === 'top') return s.top[s.top.length - 1] ?? [];
    return [];
  }

  /** Every match of the current round has a result. */
  roundComplete() {
    const r = this.currentRound();
    return r.length > 0 && r.every((m) => m.result != null);
  }

  /** Why the event cannot start yet (null = it can). */
  startProblem(): string | null {
    const ps = this.state.players;
    if (this.state.phase !== 'lobby') return 'Already started';
    if (ps.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players`;
    const notReady = ps.filter((p) => !p.deck || p.deckProblem || !p.ready);
    if (notReady.length) return `Waiting for ${notReady.map((p) => p.name).join(', ')}`;
    return null;
  }

  /** The Swiss rounds the event will have with the players in the lobby now. */
  plannedRounds() {
    return this.state.settings.rounds ?? swissRoundsFor(Math.max(2, this.state.players.length));
  }

  // ------------------------------------------------------------------ organiser actions

  setSettings(patch: Partial<TSettings>) {
    if (this.state.phase !== 'lobby') {
      // only the round timer and auto-pairing can change once the event runs
      const live: Partial<TSettings> = {};
      if (patch.timerMin != null) live.timerMin = patch.timerMin;
      if (patch.autoPair != null) live.autoPair = patch.autoPair;
      patch = live;
    }
    this.state.settings = { ...this.state.settings, ...patch };
    this.changed();
    this.maybeAutoPair();
  }

  /** Lobby: remove a player (they can join again). */
  kick(id: string) {
    if (this.state.phase !== 'lobby' || id === this.state.organiser) return;
    this.state.players = this.state.players.filter((p) => p.id !== id);
    this.hub.kick(id, { t: 'tref', tid: this.tid, reason: 'closed' });
    this.changed();
  }

  startEvent(): boolean {
    if (this.startProblem()) return false;
    const s = this.state;
    const n = s.players.length;
    const seeds = shuffleIn(s, Array.from({ length: n }, (_, i) => i + 1));
    s.players.forEach((p, i) => (p.seed = seeds[i]));
    s.swissRounds = Math.max(1, s.settings.rounds ?? swissRoundsFor(n));
    s.topCut = s.settings.topCut && n >= s.settings.topCut ? s.settings.topCut : 0;
    s.phase = 'swiss';
    this.pushSwiss();
    this.changed();
    return true;
  }

  /** Next round, the top cut, the next bracket round, or the end. */
  pairNext(): PairResult {
    const s = this.state;
    if (s.phase === 'lobby' || s.phase === 'done' || !this.roundComplete()) return null;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    let out: PairResult;
    if (s.phase === 'swiss') {
      const active = s.players.filter((p) => p.dropped == null).length;
      if (s.rounds.length < s.swissRounds && active >= 2) {
        this.pushSwiss();
        out = 'round';
      } else {
        const cut = this.effectiveCut();
        if (cut >= 2) {
          s.phase = 'top';
          s.topCut = cut;
          s.top.push(seedTopCut(this.night()).map((m) => this.wrap(m)));
          s.roundStartedAt = Date.now();
          out = 'top';
        } else out = this.finish();
      }
    } else {
      const last = s.top[s.top.length - 1];
      if (last.length === 1) out = this.finish();
      else {
        s.top.push(nextTopRound(s.top as LocalsMatch[][]).map((m) => this.wrap(m)));
        s.roundStartedAt = Date.now();
        out = 'top';
      }
    }
    this.changed();
    return out;
  }

  /** Settle a match by the organiser's decision. */
  resolve(mid: string, result: 'a' | 'b' | 'draw') {
    const m = this.match(mid);
    if (!m || (m.result && !m.dispute) || m.b == null) return;
    const verdicts = Object.values(this.state.reports[mid] ?? {})
      .map((r) => r.verdict)
      .filter((v): v is Verdict => !!v?.ok);
    const agreeing = verdicts.find((v) => v.result === result);
    this.settle(m, agreeing?.games ?? this.fill(result, 'Organiser decision'), result, 'organiser');
  }

  /** Accept the only report in (a win the reporter was given while the opponent was away). */
  acceptReport(mid: string) {
    const m = this.match(mid);
    if (!m || m.result) return;
    const v = Object.values(this.state.reports[mid] ?? {}).find((r) => r.attempt === m.attempt && r.verdict?.ok)?.verdict;
    if (v?.result) this.settle(m, v.games, v.result, 'confirmed');
  }

  /** Play the match again from scratch in a fresh room. */
  replay(mid: string) {
    const m = this.match(mid);
    if (!m || m.b == null || !this.currentRound().includes(m)) return;
    m.attempt++;
    m.seed = Math.floor(rand(this.state) * 2 ** 31);
    m.games = [];
    m.result = null;
    m.how = undefined;
    m.dispute = null;
    m.reported = [];
    m.idOffers = [];
    delete this.state.reports[mid];
    this.changed();
  }

  /** Round timer ran out: an unfinished Swiss match is a draw (a top-cut match goes to the higher seed). */
  callTime(mid: string) {
    const m = this.match(mid);
    if (!m || m.result || m.b == null) return;
    m.time = true;
    this.settle(m, [], m.stage === 'top' ? this.higherSeed(m) : 'draw', 'time');
  }

  /** Drop a player (they asked, or their phone is gone for good). */
  dropPlayer(id: string) {
    const s = this.state;
    const p = this.player(id);
    if (!p) return;
    if (s.phase === 'lobby') {
      if (id === s.organiser) return;
      s.players = s.players.filter((x) => x.id !== id);
      this.changed();
      return;
    }
    if (p.dropped != null || s.phase === 'done') return;
    p.dropped = s.phase === 'swiss' ? s.rounds.length : s.swissRounds;
    const m = this.currentRound().find((x) => x.result == null && (x.a === id || x.b === id));
    if (m && m.b != null) {
      const res = m.a === id ? 'b' : 'a';
      this.settle(m, this.fill(res, 'Opponent dropped'), res, 'drop');
    } else this.changed();
  }

  // ------------------------------------------------------------------ messages

  private connected(id: string) {
    if (this.player(id)) {
      this.sendView(id);
      this.changed(false); // online flags
    }
  }

  receive(id: string, msg: Msg) {
    const s = this.state;
    switch (msg.t) {
      case 'tj': {
        if (msg.tp !== TOURNEY_PROTO) return this.refuse(id, 'version');
        if (msg.tid && msg.tid !== s.tid) return this.refuse(id, 'closed');
        if (s.closed) return this.refuse(id, 'closed');
        let p = this.player(id);
        if (!p) {
          if (s.phase !== 'lobby') return this.refuse(id, 'started');
          if (s.players.length >= MAX_PLAYERS) return this.refuse(id, 'full');
          p = { id, name: '', avatar: '', sleeve: '', deck: null, ready: false, seed: s.players.length + 1, joinedAt: Date.now() };
          s.players.push(p);
        }
        p.name = (msg.player.name || 'Duelist').slice(0, 20);
        p.avatar = msg.player.avatar;
        p.sleeve = msg.player.sleeve;
        if (s.phase === 'lobby') {
          const problems = msg.deck ? wireDeckProblems(msg.deck) : [];
          p.deck = msg.deck;
          p.deckProblem = problems[0];
          p.ready = msg.ready && !!msg.deck && !problems.length;
        }
        this.changed();
        return;
      }
      case 'tdrop':
        if (msg.tid !== s.tid) return;
        this.dropPlayer(id);
        return;
      case 'tido': {
        if (msg.tid !== s.tid) return;
        const m = this.match(msg.mid);
        if (!m || m.result || m.stage !== 'swiss' || m.b == null || (m.a !== id && m.b !== id) || !this.currentRound().includes(m)) return;
        const offers = new Set(m.idOffers ?? []);
        if (msg.on) offers.add(id);
        else offers.delete(id);
        m.idOffers = [...offers];
        if (offers.has(m.a) && offers.has(m.b)) {
          m.intentional = true;
          this.settle(m, [], 'draw', 'id');
        } else this.changed();
        return;
      }
      case 'trg': {
        if (msg.tid !== s.tid) return;
        const m = this.match(msg.mid);
        if (!m || m.b == null || (m.a !== id && m.b !== id) || msg.attempt !== m.attempt) return;
        if (m.result && !m.dispute) return; // settled already (the view tells the player)
        const all = (s.reports[m.id] ??= {});
        let r = all[id];
        if (!r || r.attempt !== msg.attempt || r.n !== msg.n) r = all[id] = { attempt: msg.attempt, n: msg.n, skipFirstDraw: msg.skipFirstDraw, games: [] };
        const i = r.games.findIndex((x) => x.index === msg.g.index);
        if (i >= 0) r.games[i] = msg.g;
        else r.games.push(msg.g);
        if (r.games.length === r.n) {
          const key = reportKey({ mid: m.id, attempt: r.attempt, skipFirstDraw: r.skipFirstDraw, games: r.games });
          if (r.key === key && r.verdict !== undefined) return; // a re-send of what we have
          r.key = key;
          r.verdict = undefined;
          this.save();
          this.evaluate(m.id);
        }
        return;
      }
    }
  }

  private refuse(id: string, reason: 'started' | 'full' | 'version' | 'closed') {
    if (id === this.state.organiser) return;
    this.hub.kick(id, { t: 'tref', tid: this.tid, reason });
  }

  // ------------------------------------------------------------------ results

  /** Verify the reports of a match (queued: one replay at a time) and settle it when they allow. */
  private evaluate(mid: string) {
    this.busy++;
    this.queue = this.queue
      .then(() => this.evaluateNow(mid))
      .catch((e) => console.error('[friends-locals] evaluate failed', e))
      .finally(() => this.busy--);
  }

  private async evaluateNow(mid: string) {
    const m = this.match(mid);
    const all = this.state.reports[mid];
    if (!m || !all || m.b == null) return;
    if (m.result && !m.dispute) return;
    const a = this.player(m.a)!;
    const b = this.player(m.b)!;
    const reps = Object.entries(all).filter(([, r]) => r.attempt === m.attempt && r.games.length === r.n);
    for (const [, r] of reps) {
      if (r.verdict !== undefined) continue;
      r.verdict = await verifyReport(
        { mid, attempt: r.attempt, skipFirstDraw: r.skipFirstDraw, games: r.games },
        { bestOf: this.state.settings.bestOf, matchSeed: m.seed, decks: [a.deck!, b.deck!], names: [a.name, b.name], skipFirstDraw: this.state.settings.skipFirstDraw },
      );
      // the match may have been settled (or replayed) while we were replaying
      if (this.match(mid) !== m || r.attempt !== m.attempt) return;
    }
    if ((m.result && !m.dispute) || this.state.reports[mid] !== all) return;
    m.reported = reps.map(([id]) => id);
    const name = (id: string) => this.player(id)?.name ?? 'A player';
    const failed = reps.find(([, r]) => !r.verdict?.ok);
    if (failed) {
      m.dispute = { reason: `${name(failed[0])}’s report did not verify`, detail: failed[1].verdict?.detail };
      this.changed();
      return;
    }
    if (reps.length >= 2) {
      const [v1, v2] = reps.map(([, r]) => r.verdict!);
      const same = v1.result === v2.result && v1.games.map((g) => g.winner).join() === v2.games.map((g) => g.winner).join();
      if (!same) {
        m.dispute = { reason: 'The two reports disagree', detail: `${name(reps[0][0])}: ${scoreLine(v1)} · ${name(reps[1][0])}: ${scoreLine(v2)}` };
        this.changed();
        return;
      }
      this.settle(m, v1.games, v1.result!, v1.external.some((x) => x.kind === 'concede') ? 'concede' : 'verified');
      return;
    }
    if (reps.length === 1) {
      const [by, r] = reps[0];
      const v = r.verdict!;
      const seat = by === m.a ? 0 : 1;
      // a game handed to the reporter outside the engine needs the opponent (or the organiser)
      if (v.external.some((x) => x.winner === seat)) {
        m.dispute = null;
        this.changed();
        return;
      }
      this.settle(m, v.games, v.result!, v.external.length ? 'concede' : 'verified');
    }
  }

  private settle(m: TMatch, games: GameResult[], result: 'a' | 'b' | 'draw', how: MatchHow) {
    if (m.stage === 'top' && result === 'draw') result = this.higherSeed(m);
    m.games = games;
    m.result = result;
    m.how = how;
    m.dispute = null;
    m.idOffers = [];
    delete this.state.reports[m.id];
    this.changed();
    this.maybeAutoPair();
  }

  /** Games for a result decided without play (drop, organiser): the winner's wins only. */
  private fill(result: 'a' | 'b' | 'draw', reason: string): GameResult[] {
    if (result === 'draw') return [];
    const need = this.state.settings.bestOf === 3 ? 2 : 1;
    return Array.from({ length: need }, () => ({ winner: (result === 'a' ? 0 : 1) as 0 | 1, turns: 0, reason, how: 'human' as const }));
  }

  /** The better Swiss finisher (top-cut draws and time go to the higher seed). */
  private higherSeed(m: TMatch): 'a' | 'b' {
    const rank = new Map(computeStandings(this.night()).map((x) => [x.id, x.rank]));
    return (rank.get(m.a) ?? 99) <= (rank.get(m.b!) ?? 99) ? 'a' : 'b';
  }

  private maybeAutoPair() {
    const s = this.state;
    if (!s.settings.autoPair || this.autoTimer || s.phase === 'lobby' || s.phase === 'done' || !this.roundComplete()) return;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      if (this.state.settings.autoPair) this.pairNext();
    }, this.o.autoPairDelayMs ?? 4000);
  }

  // ------------------------------------------------------------------ pairing

  /** The event in the shape the Locals Night Swiss engine reads. */
  private night() {
    const s = this.state;
    return { entrants: s.players as any[], rounds: s.rounds as LocalsMatch[][], top: s.top as LocalsMatch[][], topCut: s.topCut as any };
  }

  private wrap(m: LocalsMatch): TMatch {
    return {
      id: m.id,
      stage: m.stage,
      round: m.round,
      table: m.table,
      a: m.a,
      b: m.b,
      label: m.label,
      games: m.games,
      result: m.result,
      seed: Math.floor(rand(this.state) * 2 ** 31),
      attempt: 0,
      reported: [],
      ...(m.b == null ? { how: 'bye' as const } : {}),
    };
  }

  private pushSwiss() {
    const s = this.state;
    const no = s.rounds.length + 1;
    s.rounds.push(pairSwissRound(this.night(), no, s).map((m) => this.wrap(m)));
    s.roundStartedAt = Date.now();
  }

  /** The cut the field allows: the largest power of two up to the setting that the active players fill. */
  private effectiveCut(): 0 | 2 | 4 | 8 {
    let cut = this.state.topCut as number;
    if (!cut) return 0;
    const eligible = topCutSeeds({ ...this.night(), topCut: 8 }).length;
    while (cut > eligible) cut /= 2;
    return cut >= 2 ? (cut as 2 | 4 | 8) : 0;
  }

  private finish(): PairResult {
    const s = this.state;
    s.phase = 'done';
    s.placements = finalPlacements(this.night());
    return 'done';
  }

  // ------------------------------------------------------------------ views

  viewFor(id: string): TView {
    const s = this.state;
    const show = (p: TPlayer) => p.id === id || !s.settings.hideDecks || s.phase === 'done';
    const players: TPlayerView[] = s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      sleeve: p.sleeve,
      deckName: show(p) ? (p.deck?.name ?? null) : null,
      hasDeck: !!p.deck && !p.deckProblem,
      ...(p.id === id && p.deckProblem ? { deckProblem: p.deckProblem } : {}),
      ready: p.ready,
      seed: p.seed,
      ...(p.dropped != null ? { dropped: p.dropped } : {}),
      ...(p.id === s.organiser ? { organiser: true } : {}),
      online: this.online(p.id),
    }));
    return {
      v: 1,
      tid: s.tid,
      code: s.code,
      rev: s.rev,
      organiser: s.organiser,
      createdAt: s.createdAt,
      settings: s.settings,
      phase: s.phase,
      players,
      rounds: s.rounds,
      top: s.top,
      swissRounds: s.phase === 'lobby' ? this.plannedRounds() : s.swissRounds,
      topCut: s.phase === 'lobby' ? (s.settings.topCut && s.players.length >= s.settings.topCut ? s.settings.topCut : 0) : s.topCut,
      roundStartedAt: s.roundStartedAt,
      ...(s.placements ? { placements: s.placements } : {}),
    };
  }

  private sendView(id: string) {
    const m: Msg = { t: 'tview', tid: this.tid, view: this.viewFor(id) };
    if (id === this.state.organiser) this.local?.deliver(m);
    else this.hub.send(id, m);
  }

  private save() {
    this.o.save?.(this.state);
  }

  /** Bump the revision, save, broadcast (and re-render). `important` = the event itself changed. */
  private changed(important = true) {
    this.state.rev++;
    if (important) this.save();
    for (const p of this.state.players) this.sendView(p.id);
    this.onChange();
  }
}

function scoreLine(v: Verdict) {
  const a = v.games.filter((g) => g.winner === 0).length;
  const b = v.games.filter((g) => g.winner === 1).length;
  return `${a}–${b}`;
}

// ------------------------------------------------------------------ prizes (each phone grants its own)

/** Modest, below Locals Night: a night with friends, not a store event. */
export const FRIENDS_PRIZES = {
  first: { packs: 3, coins: 150 },
  second: { packs: 2, coins: 100 },
  top4: { packs: 1, coins: 75 },
  participation: { packs: 0, coins: 50 },
};

export function placeIn(v: Pick<TView, 'placements' | 'players' | 'rounds'>, id: string): number {
  const order = v.placements ?? computeStandings({ entrants: v.players as any[], rounds: v.rounds as LocalsMatch[][] }).map((x) => x.id);
  return order.indexOf(id) + 1;
}

export function friendsPrizesFor(v: TView, id: string): { reason: string; packs: number; coins: number }[] {
  const place = placeIn(v, id);
  const n = v.players.length;
  const lines: { reason: string; packs: number; coins: number }[] = [];
  if (place === 1) lines.push({ reason: 'Friends Locals · 1st place', ...FRIENDS_PRIZES.first });
  else if (place === 2) lines.push({ reason: 'Friends Locals · 2nd place', ...FRIENDS_PRIZES.second });
  else if (place <= 4 && n >= 6) lines.push({ reason: 'Friends Locals · Top 4', ...FRIENDS_PRIZES.top4 });
  lines.push({ reason: 'Friends Locals · Participation', ...FRIENDS_PRIZES.participation });
  return lines;
}

/** Standings of a view (or the host state). */
export function viewStandings(v: Pick<TView, 'players' | 'rounds'>) {
  return computeStandings({ entrants: v.players as any[], rounds: v.rounds as LocalsMatch[][] });
}
