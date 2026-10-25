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

// ---------------------------------------------------------------- collection
// Several real sleeves / mats can be kept. Ids look like 'custom' (legacy single slot) or 'custom-<n>'.
export interface CustomItem {
  id: string;
  src: string;
}
const LIST_KEYS: Record<CustomKind, string> = { sleeve: 'edison.custom.sleeve.list', mat: 'edison.custom.mat.list' };

export function listCustom(kind: CustomKind): CustomItem[] {
  let list: CustomItem[] = [];
  try {
    list = JSON.parse(localStorage.getItem(LIST_KEYS[kind]) ?? '[]');
  } catch {
    list = [];
  }
  const legacy = getCustomImage(kind);
  if (legacy && !list.some((i) => i.id === 'custom')) list.unshift({ id: 'custom', src: legacy });
  return list;
}

function saveList(kind: CustomKind, list: CustomItem[]) {
  try {
    localStorage.setItem(LIST_KEYS[kind], JSON.stringify(list.filter((i) => i.id !== 'custom')));
  } catch {
    throw new Error('Your browser storage is full. Remove a saved image or use an image link instead of an upload.');
  }
}

export function customSrc(kind: CustomKind, id: string): string | null {
  return listCustom(kind).find((i) => i.id === id)?.src ?? null;
}

/** Add an image (data URL or http link) to the collection; returns its id. */
export function addCustom(kind: CustomKind, src: string): string {
  const list = listCustom(kind);
  const existing = list.find((i) => i.src === src);
  if (existing) return existing.id;
  const n = list.reduce((m, i) => Math.max(m, Number(i.id.split('-')[1] ?? 0) || 0), 0) + 1;
  const item = { id: `custom-${n}`, src };
  saveList(kind, [...list, item]);
  return item.id;
}

export function removeCustom(kind: CustomKind, id: string) {
  if (id === 'custom') clearCustomImage(kind);
  else saveList(kind, listCustom(kind).filter((i) => i.id !== id));
}

/** Pick a photo from the device and add it to the collection. Resolves the new id, or null if cancelled. */
export async function pickIntoCollection(kind: CustomKind): Promise<string | null> {
  const prev = getCustomImage(kind);
  const ok = await pickCustomImage(kind);
  if (!ok) return null;
  const src = getCustomImage(kind)!;
  // the picker writes the legacy slot; move it into the list and restore the slot
  if (prev) {
    mem[kind] = prev;
    try {
      localStorage.setItem(KEYS[kind], prev);
    } catch {
      /* ignore */
    }
  } else clearCustomImage(kind);
  return addCustom(kind, src);
}

/** Add an image link to the collection after checking it loads. */
export async function linkIntoCollection(kind: CustomKind, url: string): Promise<string> {
  const prev = getCustomImage(kind);
  await setCustomImageUrl(kind, url);
  const src = getCustomImage(kind)!;
  if (prev) {
    mem[kind] = prev;
    try {
      localStorage.setItem(KEYS[kind], prev);
    } catch {
      /* ignore */
    }
  } else clearCustomImage(kind);
  return addCustom(kind, src);
}
