// User-uploaded sleeve / playmat images (e.g. a photo of your real sleeves or mat).
// Images are downscaled on a canvas and kept in localStorage as JPEG data URLs.

export type CustomKind = 'sleeve' | 'mat';

const KEYS: Record<CustomKind, string> = { sleeve: 'edison.custom.sleeve', mat: 'edison.custom.mat' };
/** Target sizes: sleeves are card-shaped, mats are wide. */
const SIZE: Record<CustomKind, { w: number; h: number; fit: 'cover' | 'contain-width' }> = {
  sleeve: { w: 420, h: 612, fit: 'cover' },
  mat: { w: 1800, h: 1100, fit: 'contain-width' },
};

const mem: Partial<Record<CustomKind, string | null>> = {};

export function getCustomImage(kind: CustomKind): string | null {
  if (mem[kind] !== undefined) return mem[kind] ?? null;
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEYS[kind]);
  } catch {
    v = null;
  }
  mem[kind] = v;
  return v;
}

export function clearCustomImage(kind: CustomKind) {
  mem[kind] = null;
  try {
    localStorage.removeItem(KEYS[kind]);
  } catch {
    /* ignore */
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

async function toDataUrl(kind: CustomKind, file: File): Promise<string> {
  const img = await loadImage(file);
  const t = SIZE[kind];
  const canvas = document.createElement('canvas');
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (t.fit === 'cover') {
    // crop to card proportions from the centre
    const want = t.w / t.h;
    if (sw / sh > want) {
      const nw = sh * want;
      sx = (sw - nw) / 2;
      sw = nw;
    } else {
      const nh = sw / want;
      sy = (sh - nh) / 2;
      sh = nh;
    }
    canvas.width = t.w;
    canvas.height = t.h;
  } else {
    const scale = Math.min(1, t.w / sw, t.h / sh);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  let q = 0.86;
  let out = canvas.toDataURL('image/jpeg', q);
  while (out.length > 1_400_000 && q > 0.4) {
    q -= 0.12;
    out = canvas.toDataURL('image/jpeg', q);
  }
  return out;
}

/**
 * Ask the user for an image file and store it. Resolves true when saved.
 * Throws with a readable message when the image can't be used.
 */
export function pickCustomImage(kind: CustomKind): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(false);
      try {
        const url = await toDataUrl(kind, file);
        try {
          localStorage.setItem(KEYS[kind], url);
        } catch {
          reject(new Error('Your browser storage is full, so the image could not be saved. Try a smaller image.'));
          return;
        }
        mem[kind] = url;
        resolve(true);
      } catch (e) {
        reject(e);
      }
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Use an image from the web by link (loads in the browser; not stored as a copy). */
export function setCustomImageUrl(kind: CustomKind, url: string): Promise<void> {
  const u = url.trim();
  if (!/^https?:\/\/\S+$/i.test(u)) return Promise.reject(new Error('Paste a full image link starting with http:// or https://'));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        localStorage.setItem(KEYS[kind], u);
      } catch {
        /* storage unavailable: keep for this session */
      }
      mem[kind] = u;
      resolve();
    };
    img.onerror = () => reject(new Error("That link didn't load as an image here. Copy the image address itself (long-press the picture → Copy Image Address)."));
    img.src = u;
  });
}
