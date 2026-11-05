// Painted mats: cards' official artwork painted into one picture on a canvas, the way official mats are printed.
//  - collage: three cards blended together. The key card stands large in the middle and its two partners fade in
//    from either side, with no hard edges between them.
//  - showcase: one boss card large on the right, fading into the deck's colour on the left, with the deck's
//    wordmark and a tagline printed along the player's edge (like the 2010 tournament and tin mats).
//  - duo: two cards facing each other from the two ends, with the wordmark between them.
// The deck's colour is washed over the whole picture, with a dark vignette at the edges. A printed motif (light rays
// or teleport rings) can sit behind the cards.
//
// It is painted once per mat and launch on a canvas and kept in memory as a JPEG data URL. Painting needs the
// artwork to load with CORS. When it can't (offline, a host that doesn't allow it, no DOM in the tests), the mat
// shows its key card alone, like an ordinary art mat.

export interface DeckTone {
  base: string;
  mid: string;
  dark: string;
  edge: string;
}

export type PaintedKind = 'collage' | 'showcase' | 'duo';
export type Motif = 'rays' | 'rings';

/** How a painted mat is laid out (its cards are passed separately, as artwork URLs). */
export interface PaintSpec {
  kind: PaintedKind;
  tone: DeckTone;
  motif?: Motif;
  /** Big printed name along the player's edge (showcase and duo). */
  wordmark?: string;
  /** Small spaced line above the wordmark. */
  tagline?: string;
}

/** How many cards each kind paints. */
export const PAINTED_CARDS: Record<PaintedKind, number> = { collage: 3, showcase: 1, duo: 2 };

/** Canvas size: about the shape of one player's half of the mat (it is cropped with `cover`). */
export const DECK_ART_W = 1600;
export const DECK_ART_H = 700;

const done = new Map<string, string | null>();
const running = new Map<string, Promise<string | null>>();

/** The painted picture for a deck mat: a data URL, null when it can't be painted, undefined while not tried yet. */
export function deckMatPicture(id: string): string | null | undefined {
  return done.get(id);
}

function loadCors(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

type Ctx = CanvasRenderingContext2D;

/** Draw `img` as a square of `size` at (x, y), cropped from its centre (the top for tall art), on a layer of its own. */
function layer(img: HTMLImageElement, x: number, y: number, size: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = DECK_ART_W;
  c.height = DECK_ART_H;
  const g = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - s) / 2;
  const sy = Math.max(0, (img.naturalHeight - s) * 0.15);
  g.drawImage(img, sx, sy, s, s, x, y, size, size);
  return { c, g };
}

/** Keep only where `stops` (x positions and opacities, left to right) say, fading in between. */
function fadeAcross(g: Ctx, stops: [number, number][]) {
  const grad = g.createLinearGradient(0, 0, DECK_ART_W, 0);
  for (const [x, a] of stops) grad.addColorStop(Math.min(1, Math.max(0, x / DECK_ART_W)), `rgba(0,0,0,${a})`);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = grad;
  g.fillRect(0, 0, DECK_ART_W, DECK_ART_H);
  g.globalCompositeOperation = 'source-over';
}

/** Fade the bottom of a layer out, so the card's art doesn't stop at a hard line. */
function fadeDown(g: Ctx, from: number, to: number) {
  const grad = g.createLinearGradient(0, 0, 0, DECK_ART_H);
  grad.addColorStop(from, 'rgba(0,0,0,1)');
  grad.addColorStop(to, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = grad;
  g.fillRect(0, 0, DECK_ART_W, DECK_ART_H);
  g.globalCompositeOperation = 'source-over';
}

/** Tint a layer toward the deck's colour and darken it a little (partners sit behind the key card). */
function tint(g: Ctx, colour: string, amount: number, darken: number) {
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = amount;
  g.fillStyle = colour;
  g.fillRect(0, 0, DECK_ART_W, DECK_ART_H);
  g.globalAlpha = darken;
  g.fillStyle = '#000';
  g.fillRect(0, 0, DECK_ART_W, DECK_ART_H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/** Paint the three artworks [left, centre, right] into one picture. */
export function paintDeckArt(imgs: [HTMLImageElement, HTMLImageElement, HTMLImageElement], tone: DeckTone): HTMLCanvasElement {
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  const [left, centre, right] = imgs;

  // the neoprene behind it all, in the deck's colour
  const bg = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.6);
  bg.addColorStop(0, tone.mid);
  bg.addColorStop(0.6, tone.base);
  bg.addColorStop(1, tone.dark);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // the partners: large, at the two ends, fading toward the middle
  const side = H * 1.18;
  const top = -H * 0.1;
  const l = layer(left, -W * 0.05, top, side);
  tint(l.g, tone.mid, 0.22, 0.18);
  fadeAcross(l.g, [
    [0, 1],
    [W * 0.24, 1],
    [W * 0.44, 0],
  ]);
  fadeDown(l.g, 0.7, 1);
  g.drawImage(l.c, 0, 0);
  const r = layer(right, W * 1.05 - side, top, side);
  tint(r.g, tone.mid, 0.22, 0.18);
  fadeAcross(r.g, [
    [W * 0.56, 0],
    [W * 0.76, 1],
    [W, 1],
  ]);
  fadeDown(r.g, 0.7, 1);
  g.drawImage(r.c, 0, 0);

  // a dark band down the middle so the key card stands out from its partners
  const band = g.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0.22, 'rgba(0,0,0,0)');
  band.addColorStop(0.5, 'rgba(0,0,0,.55)');
  band.addColorStop(0.78, 'rgba(0,0,0,0)');
  g.fillStyle = band;
  g.fillRect(0, 0, W, H);

  // the key card: bigger, in front, with soft edges all round
  const big = H * 1.3;
  const c = layer(centre, (W - big) / 2, -H * 0.12, big);
  tint(c.g, tone.mid, 0.08, 0);
  fadeAcross(c.g, [
    [(W - big) / 2 + big * 0.04, 0],
    [(W - big) / 2 + big * 0.26, 1],
    [(W + big) / 2 - big * 0.26, 1],
    [(W + big) / 2 - big * 0.04, 0],
  ]);
  fadeDown(c.g, 0.72, 1);
  g.drawImage(c.c, 0, 0);

  // one colour over everything, so three different artworks read as one print
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.55;
  const wash = g.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, tone.edge);
  wash.addColorStop(0.5, tone.mid);
  wash.addColorStop(1, tone.edge);
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);

  // soft light falling on the key card from above
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.1;
  const glow = g.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, H * 1.1);
  glow.addColorStop(0, tone.edge);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // darker at the edges, like a printed mat photographed on a table
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return out;
}

function background(g: Ctx, tone: DeckTone, cx: number) {
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  const bg = g.createRadialGradient(cx, H * 0.45, 0, cx, H * 0.45, W * 0.7);
  bg.addColorStop(0, tone.mid);
  bg.addColorStop(0.55, tone.base);
  bg.addColorStop(1, tone.dark);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
}

/** Light rays fanning out from (x, y), or concentric teleport rings around it, printed faintly behind the cards. */
function motif(g: Ctx, kind: Motif | undefined, tone: DeckTone, x: number, y: number) {
  if (!kind) return;
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  g.save();
  g.globalCompositeOperation = 'screen';
  if (kind === 'rays') {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spread = 0.045 + (i % 3) * 0.02;
      const grad = g.createRadialGradient(x, y, 0, x, y, W);
      grad.addColorStop(0, tone.edge);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = i % 2 ? 0.1 : 0.18;
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a - spread) * W * 1.5, y + Math.sin(a - spread) * W * 1.5);
      g.lineTo(x + Math.cos(a + spread) * W * 1.5, y + Math.sin(a + spread) * W * 1.5);
      g.closePath();
      g.fill();
    }
  } else {
    g.strokeStyle = tone.edge;
    for (let i = 1; i <= 9; i++) {
      const r = H * 0.16 * i;
      g.globalAlpha = 0.22 - i * 0.018;
      g.lineWidth = i % 3 === 0 ? 5 : 2;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // a few sparks orbiting the rings
    g.fillStyle = tone.edge;
    for (let i = 0; i < 26; i++) {
      const r = H * (0.3 + ((i * 37) % 100) / 70);
      const a = i * 2.39996;
      g.globalAlpha = 0.25 + ((i * 13) % 10) / 30;
      g.beginPath();
      g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.42, 2 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** The printed name: a tagline in spaced capitals over a big metallic wordmark, along the player's edge. */
function wordmark(g: Ctx, spec: PaintSpec, x: number, align: CanvasTextAlign) {
  const H = DECK_ART_H;
  if (!spec.wordmark) return;
  const size = H * 0.13;
  const base = H * 0.9;
  g.save();
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  (g as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(size * 0.08)}px`;
  g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const w = g.measureText(spec.wordmark).width;
  const left = align === 'center' ? x - w / 2 : x;
  const metal = g.createLinearGradient(0, base - size, 0, base);
  metal.addColorStop(0, '#ffffff');
  metal.addColorStop(0.45, spec.tone.edge);
  metal.addColorStop(0.55, spec.tone.mid);
  metal.addColorStop(1, spec.tone.edge);
  g.shadowColor = spec.tone.edge;
  g.shadowBlur = size * 0.35;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.09;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(spec.wordmark, x, base);
  g.shadowBlur = 0;
  g.fillStyle = metal;
  g.fillText(spec.wordmark, x, base);
  // a thin rule and the tagline above the wordmark
  if (spec.tagline) {
    // as large as fits over the wordmark (a long tagline gets smaller, never wider than the name)
    let ts = H * 0.036;
    const setTag = () => {
      (g as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(ts * 0.45)}px`;
      g.font = `700 ${ts}px "Arial Narrow", Arial, sans-serif`;
    };
    setTag();
    while (ts > H * 0.018 && g.measureText(spec.tagline).width > w) {
      ts *= 0.92;
      setTag();
    }
    g.fillStyle = spec.tone.edge;
    g.globalAlpha = 0.9;
    g.fillText(spec.tagline, x, base - size * 1.08);
    g.globalAlpha = 0.6;
    g.fillRect(left, base - size * 1.0, w, 2);
  }
  g.restore();
}

/** The wash, top light and vignette that make the painted parts read as one print. */
function finish(g: Ctx, tone: DeckTone, lightX: number) {
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.5;
  const wash = g.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, tone.edge);
  wash.addColorStop(0.5, tone.mid);
  wash.addColorStop(1, tone.edge);
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.1;
  const glow = g.createRadialGradient(lightX, -H * 0.1, 0, lightX, -H * 0.1, H * 1.1);
  glow.addColorStop(0, tone.edge);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.restore();
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}

/** One boss card large on the right, fading into the deck's colour on the left, wordmark bottom left. */
export function paintShowcase(img: HTMLImageElement, spec: PaintSpec): HTMLCanvasElement {
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  const tone = spec.tone;
  background(g, tone, W * 0.65);
  const size = H * 1.5;
  const x0 = W * 1.0 - size;
  motif(g, spec.motif, tone, x0 + size * 0.5, H * 0.3);
  const hero = layer(img, x0, -H * 0.2, size);
  tint(hero.g, tone.mid, 0.08, 0);
  fadeAcross(hero.g, [
    [x0 + size * 0.02, 0],
    [x0 + size * 0.38, 1],
    [W, 1],
  ]);
  fadeDown(hero.g, 0.74, 1);
  g.drawImage(hero.c, 0, 0);
  // the deck's colour comes in from the left, where the wordmark is printed
  const panel = g.createLinearGradient(0, 0, W * 0.6, 0);
  panel.addColorStop(0, tone.dark);
  panel.addColorStop(0.45, 'rgba(0,0,0,.35)');
  panel.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.85;
  g.fillStyle = panel;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  finish(g, tone, x0 + size * 0.5);
  // printed last, so the wash and vignette don't dull it; kept inside the part every mat shape shows
  wordmark(g, spec, W * 0.18, 'left');
  return out;
}

/** Two cards facing each other from the two ends, wordmark centred between them. */
export function paintDuo(imgs: [HTMLImageElement, HTMLImageElement], spec: PaintSpec): HTMLCanvasElement {
  const W = DECK_ART_W;
  const H = DECK_ART_H;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  const tone = spec.tone;
  background(g, tone, W / 2);
  motif(g, spec.motif, tone, W / 2, H * 0.42);
  const size = H * 1.32;
  const l = layer(imgs[0], -W * 0.03, -H * 0.14, size);
  fadeAcross(l.g, [
    [0, 1],
    [W * 0.26, 1],
    [W * 0.5, 0],
  ]);
  fadeDown(l.g, 0.72, 1);
  g.drawImage(l.c, 0, 0);
  const r = layer(imgs[1], W * 1.03 - size, -H * 0.14, size);
  fadeAcross(r.g, [
    [W * 0.5, 0],
    [W * 0.74, 1],
    [W, 1],
  ]);
  fadeDown(r.g, 0.72, 1);
  g.drawImage(r.c, 0, 0);
  // where the two meet: a soft glow in the deck's colour instead of a seam
  const meet = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, H * 0.6);
  meet.addColorStop(0, tone.edge);
  meet.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.18;
  g.fillStyle = meet;
  g.fillRect(0, 0, W, H);
  g.restore();
  finish(g, tone, W / 2);
  wordmark(g, spec, W / 2, 'center');
  return out;
}

/** Paint a mat's picture from its cards' artwork URLs (once per launch; later calls share the result). */
export function ensureDeckMatPicture(id: string, urls: readonly (string | undefined)[], spec: PaintSpec): Promise<string | null> {
  if (done.has(id)) return Promise.resolve(done.get(id)!);
  let p = running.get(id);
  if (p) return p;
  p = (async () => {
    // no DOM (the tests), or a card whose artwork isn't known: the mat shows its key card alone
    if (typeof document === 'undefined' || urls.length !== PAINTED_CARDS[spec.kind] || !urls.every(Boolean)) return null;
    const imgs = await Promise.all((urls as string[]).map(loadCors));
    if (imgs.some((i) => !i)) return null;
    try {
      const all = imgs as HTMLImageElement[];
      const canvas =
        spec.kind === 'showcase'
          ? paintShowcase(all[0], spec)
          : spec.kind === 'duo'
            ? paintDuo([all[0], all[1]], spec)
            : paintDeckArt([all[0], all[1], all[2]], spec.tone);
      return canvas.toDataURL('image/jpeg', 0.86);
    } catch {
      // the artwork loaded without CORS after all (a tainted canvas can't be read back)
      return null;
    }
  })().then((url) => {
    done.set(id, url);
    running.delete(id);
    return url;
  });
  running.set(id, p);
  return p;
}
