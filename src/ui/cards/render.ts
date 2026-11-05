// Card face / back renderer shared by the whole app (duel, deck builder, collection...).
import '../theme/theme.css';
import './cards.css';
import type { CardData, CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import { getSettings } from '../settings';
import { applySleeve } from '../theme/sleeves';
import { esc } from '../theme/util';
import { cardArtSVG, cardArtSrc } from './art';
import { attachOfficialArt, attachOfficialCard, cachedOfficialImage, getOfficialImage, officialArtEnabled } from './officialArt';
import { LEVEL_STAR_SVG, attributeIconSVG, spellTypeIcon } from './icons';

export { cardArtSVG, cardArtSrc };

/** An empty 1×1 image: what a thumbnail shows while its official artwork is looked up. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Point a small artwork thumbnail at the card's official cropped art: straight away when the lookup is cached,
 * otherwise once it arrives (blank meanwhile). The drawn art is only a fallback: official images off, or no
 * official artwork for this card, or it can't load.
 */
export function setArtThumb(img: HTMLImageElement, data: CardData) {
  img.decoding = 'async';
  img.draggable = false;
  if (!img.alt) img.alt = '';
  const drawn = () => {
    img.onerror = null;
    img.src = cardArtSrc(data);
  };
  img.onerror = drawn;
  const official = officialArtEnabled() && !data.isToken;
  const hit = official ? cachedOfficialImage(data.name) : null;
  if (hit) {
    img.src = hit.art;
    return img;
  }
  if (!official || hit === null) {
    drawn();
    return img;
  }
  img.src = BLANK;
  void getOfficialImage(data.name).then((o) => {
    if (!o) return drawn();
    const pre = new Image();
    pre.onload = () => (img.src = o.art);
    pre.onerror = drawn;
    pre.src = o.art;
  });
  return img;
}

/** A new <img> thumbnail of a card's artwork (official crop when available). */
export function artThumb(data: CardData, cls = ''): HTMLImageElement {
  const img = new Image();
  if (cls) img.className = cls;
  return setArtThumb(img, data);
}

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface RenderCardOptions {
  size?: CardSize;
  faceDown?: boolean;
  sleeve?: string;
  /** Live instance: shows modified ATK/DEF when on the field. */
  instance?: CardInstance;
  game?: Game;
  /** Show the Forbidden/Limited badge. */
  showLimit?: boolean;
  /** In a long scrolling grid: let the browser load the artwork when it nears the screen. */
  lazy?: boolean;
}

export const CARD_WIDTHS: Record<CardSize, number> = { xs: 56, sm: 84, md: 124, lg: 210, xl: 320 };
/** Height / width ratio of a card. */
export const CARD_RATIO = 86 / 59;

export type FrameKind = 'normal' | 'effect' | 'fusion' | 'synchro' | 'ritual' | 'token' | 'spell' | 'trap';

export function frameOf(data: CardData): FrameKind {
  if (data.kind === 'spell') return 'spell';
  if (data.kind === 'trap') return 'trap';
  const t = data.mtypes ?? [];
  if (data.isToken || t.includes('token')) return 'token';
  if (t.includes('fusion')) return 'fusion';
  if (t.includes('synchro')) return 'synchro';
  if (t.includes('ritual')) return 'ritual';
  if (t.includes('effect') || (data.effects?.length ?? 0) > 0) return 'effect';
  return 'normal';
}

const TYPE_NAMES: Record<string, string> = {
  fusion: 'Fusion',
  synchro: 'Synchro',
  ritual: 'Ritual',
  tuner: 'Tuner',
  flip: 'Flip',
  gemini: 'Gemini',
  spirit: 'Spirit',
  union: 'Union',
  toon: 'Toon',
  token: 'Token',
};

/** "Dragon / Synchro / Effect" style type line. */
export function typeLine(data: CardData): string {
  if (data.kind === 'spell') return `${stName(data.stype)} Spell`;
  if (data.kind === 'trap') return `${stName(data.ttype)} Trap`;
  const t = data.mtypes ?? [];
  const parts: string[] = [data.race ?? 'Monster'];
  for (const k of ['fusion', 'synchro', 'ritual', 'tuner', 'flip', 'gemini', 'spirit', 'union', 'toon', 'token']) if (t.includes(k as any)) parts.push(TYPE_NAMES[k]);
  if (t.includes('effect') || (data.effects?.length ?? 0) > 0) parts.push('Effect');
  else if (parts.length === 1) parts.push('Normal');
  return parts.join(' / ');
}

function stName(t: string | undefined) {
  switch (t) {
    case 'quickplay':
      return 'Quick-Play';
    case 'continuous':
      return 'Continuous';
    case 'equip':
      return 'Equip';
    case 'field':
      return 'Field';
    case 'ritual':
      return 'Ritual';
    case 'counter':
      return 'Counter';
    default:
      return 'Normal';
  }
}

export function isFoil(data: CardData) {
  const t = data.mtypes ?? [];
  return t.includes('synchro') || t.includes('fusion') || t.includes('ritual') || (data.aiValue ?? 0) >= 1200;
}

function nameFontSize(name: string) {
  const n = name.length;
  if (n <= 13) return 6.9;
  if (n <= 17) return 6.2;
  if (n <= 21) return 5.4;
  if (n <= 26) return 4.6;
  if (n <= 32) return 3.9;
  return 3.3;
}

export function liveStats(data: CardData, instance?: CardInstance, game?: Game) {
  let atk = data.atk ?? 0;
  let def = data.def ?? 0;
  let atkMod = 0;
  let defMod = 0;
  if (instance && game && instance.location === 'mzone' && instance.faceUp) {
    try {
      atk = game.getAtk(instance);
      def = game.getDef(instance);
      atkMod = Math.sign(atk - (data.atk ?? 0));
      defMod = Math.sign(def - (data.def ?? 0));
    } catch {
      /* ignore */
    }
  }
  return { atk, def, atkMod, defMod };
}

function statHTML(v: number, mod: number) {
  const cls = mod > 0 ? ' up' : mod < 0 ? ' down' : '';
  return `<b class="yc-num${cls}">${v < 0 ? '?' : v}</b>`;
}

/** Render a full card face (or its sleeved back). */
export function renderCard(data: CardData, opts: RenderCardOptions = {}): HTMLElement {
  const size = opts.size ?? 'md';
  const el = document.createElement('div');
  el.className = `yc yc--${size}`;
  if (opts.faceDown) {
    el.classList.add('yc--back');
    const back = document.createElement('div');
    back.className = 'yc-back';
    applySleeve(back, opts.sleeve ?? getSettings().sleeve);
    el.appendChild(back);
    return el;
  }
  const frame = frameOf(data);
  el.dataset.frame = frame;
  el.dataset.cardId = data.id;
  el.dataset.cardName = data.name;
  // Real card scans replace the drawn face (tokens have no scan). With official images on, the drawn art is only a
  // fallback: it is never drawn for a card whose scan is known, and drawn for the others only once their scan
  // turns out to be missing or fails to load.
  const official = officialArtEnabled() && !data.isToken;
  const known = official ? cachedOfficialImage(data.name) : null;
  if (known) {
    const img = new Image();
    img.className = 'official-card';
    img.decoding = 'async';
    img.alt = data.name;
    img.draggable = false;
    if (opts.lazy) img.loading = 'lazy';
    img.onerror = () => {
      el.classList.remove('yc--official');
      el.innerHTML = cardFaceHTML(data, opts);
    };
    img.src = known.full;
    el.classList.add('yc--official');
    el.appendChild(img);
    el.insertAdjacentHTML('beforeend', limitHTML(data, opts));
    return el;
  }
  const waiting = official && known === undefined;
  el.innerHTML = cardFaceHTML(data, opts, waiting);
  if (waiting)
    attachOfficialCard(el, data.name, () => {
      // no scan for this card after all: draw its art
      const art = el.querySelector('.yc-art');
      if (art && !art.firstChild) art.innerHTML = artImgHTML(data, opts);
    });
  else if (data.isToken) {
    const art = el.querySelector('.yc-art') as HTMLElement | null;
    if (art) attachOfficialArt(art, data.name);
  }
  return el;
}

const artImgHTML = (data: CardData, opts: RenderCardOptions) => `<img src="${cardArtSrc(data)}" alt="" draggable="false" decoding="async"${opts.lazy ? ' loading="lazy"' : ''}>`;

function limitHTML(data: CardData, opts: RenderCardOptions): string {
  return opts.showLimit && data.limit !== undefined && data.limit < 3
    ? `<div class="yc-limit yc-limit--${data.limit}" title="${['Forbidden', 'Limited', 'Semi-Limited'][data.limit]}">${data.limit === 0 ? '✕' : data.limit}</div>`
    : '';
}

/** The drawn card face. `blankArt`: leave the art box empty (the official scan is on its way). */
export function cardFaceHTML(data: CardData, opts: RenderCardOptions = {}, blankArt = false): string {
  const frame = frameOf(data);
  const isMon = data.kind === 'monster';
  const attr = isMon ? data.attribute ?? 'EARTH' : data.kind === 'spell' ? 'SPELL' : 'TRAP';
  const foil = isFoil(data);
  let row = '';
  if (isMon) {
    const lv = Math.max(0, Math.min(12, data.level ?? 0));
    row = `<div class="yc-level">${LEVEL_STAR_SVG.repeat(lv)}</div>`;
  } else {
    const t = data.kind === 'spell' ? data.stype : data.ttype;
    const label = data.kind === 'spell' ? 'Spell Card' : 'Trap Card';
    row = `<div class="yc-sttype">[${label}${spellTypeIcon(t) ? ` ${spellTypeIcon(t)}` : ''}]</div>`;
  }
  const text = esc(data.text || '').replace(/\n/g, '<br>');
  const len = (data.text || '').length;
  const descCls = len > 420 ? ' xlong' : len > 260 ? ' long' : '';
  let stats = '';
  if (isMon) {
    const s = liveStats(data, opts.instance, opts.game);
    stats = `<div class="yc-stats"><span>ATK/${statHTML(s.atk, s.atkMod)}</span><span>DEF/${statHTML(s.def, s.defMod)}</span></div>`;
  }
  const typeRow = isMon ? `<div class="yc-type">[${esc(typeLine(data)).replace(/ \/ /g, '/')}]</div>` : '';
  const flavor = frame === 'normal' ? ' flavor' : '';
  const limit = limitHTML(data, opts);
  return `<div class="yc-in">
  <div class="yc-frame"></div>
  <div class="yc-name${foil ? ' yc-name--foil' : ''}"><span class="yc-name-text" style="--nfs:${nameFontSize(data.name)}cqw">${esc(data.name)}</span><span class="yc-attr">${attributeIconSVG(attr as any)}</span></div>
  ${row}
  <div class="yc-art">${blankArt ? '' : artImgHTML(data, opts)}</div>
  <div class="yc-box${isMon ? '' : ' yc-box--st'}">${typeRow}<div class="yc-desc${descCls}${flavor}">${text}</div>${stats}${isMon ? '' : `<div class="yc-mini">${esc(typeLine(data))}</div>`}</div>
  ${foil ? '<div class="yc-foil"></div>' : ''}
</div>${limit}`;
}
