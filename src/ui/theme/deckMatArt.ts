// Deck mats: three cards' official artwork painted into one picture, the way official collage mats blend a deck's
// monsters together. The key card stands large in the middle and its two partners fade in from either side, with no
// hard edges between them. The deck's colour is washed over the whole picture, with a dark vignette at the edges.
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

/** Paint a deck mat's picture from its three artwork URLs (once; later calls share the result). */
export function ensureDeckMatPicture(id: string, urls: readonly (string | undefined)[], tone: DeckTone): Promise<string | null> {
  if (done.has(id)) return Promise.resolve(done.get(id)!);
  let p = running.get(id);
  if (p) return p;
  p = (async () => {
    // no DOM (the tests), or a card whose artwork isn't known: show the key card alone
    if (typeof document === 'undefined' || urls.length !== 3 || !urls.every(Boolean)) return null;
    const imgs = await Promise.all((urls as string[]).map(loadCors));
    if (imgs.some((i) => !i)) return null;
    try {
      return paintDeckArt(imgs as [HTMLImageElement, HTMLImageElement, HTMLImageElement], tone).toDataURL('image/jpeg', 0.86);
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
