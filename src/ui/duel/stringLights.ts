// Regional decorations: strings of the 50 state flags with warm bulbs, hung in 3D over the
// board like at a real event. The flags sway and the bulbs twinkle; real shadows fall on the mats.
// Loaded on demand (three.js is a separate chunk), so it costs nothing while the toggle is off.
import * as THREE from 'three';

const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
/** The flag sheet (public/flags/state-flags.jpg): 10 × 5 flags, 192 × 128 px each, in STATES order.
 *  State flags are public domain; drawn from the SVGs in the us-state-flags package (ISC). */
const ATLAS_COLS = 10;
const ATLAS_ROWS = 5;
const FPS = 30;

interface Flag {
  mesh: THREE.Mesh;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
  phase: number;
  rest: Float32Array;
}
interface Bulb {
  glow: THREE.Sprite;
  phase: number;
  speed: number;
}

export interface StringLights {
  dispose(): void;
}

/** Hang the string lights over the board in `stage`; returns a handle to remove them. */
export function mountStringLights(stage: HTMLElement): StringLights {
  const canvas = document.createElement('canvas');
  canvas.className = 'string-lights';
  stage.insertBefore(canvas, stage.firstChild?.nextSibling ?? null);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // A high, long-lens camera: the table looks flat (like the board) but hanging things have depth.
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
  cam.position.set(0, 15, 3.4);
  cam.lookAt(0, 0, -0.35);

  const scene = new THREE.Scene();
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.3 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  scene.add(catcher);
  scene.add(new THREE.HemisphereLight('#fff8ee', '#404050', 1.6));
  const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const atlas = new THREE.TextureLoader().load(`${(import.meta as any).env?.BASE_URL ?? "./"}flags/state-flags.jpg`, () => (dirty = true));
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  const flagMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.75, side: THREE.DoubleSide });
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe2a8' });
  const glowTex = makeGlow();

  const strands = new THREE.Group();
  scene.add(strands);
  let flags: Flag[] = [];
  let bulbs: Bulb[] = [];
  let dirty = true;
  let seed = 21;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const ray = new THREE.Raycaster();

  /** A point on screen (stage px) lifted to height h above the table. */
  function at(sx: number, sy: number, h: number, w: number, hgt: number) {
    ray.setFromCamera(new THREE.Vector2((sx / w) * 2 - 1, -((sy / hgt) * 2 - 1)), cam);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p);
    return p;
  }

  function clear() {
    strands.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    strands.clear();
    flags = [];
    bulbs = [];
  }

  /** Lay the strands out around the two mats as they are on screen now. */
  function layout() {
    const sr = stage.getBoundingClientRect();
    const w = sr.width;
    const hgt = sr.height;
    if (w < 10 || hgt < 10) return;
    renderer.setSize(w, hgt, false);
    cam.aspect = w / hgt;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const opp = matRect(stage.querySelector('.side-opp'), sr);
    const me = matRect(stage.querySelector('.side-me'), sr);
    if (!opp || !me) return;
    clear();
    seed = 21;
    // Everything scales with the mat, so phones, tablets and landscape look the same.
    const k = at(opp.right, opp.top, 0, w, hgt).distanceTo(at(opp.left, opp.top, 0, w, hgt)) / 2.75;
    const P = (x: number, y: number, h: number) => at(x, y, h * k, w, hgt);
    const mid = (opp.bottom + me.top) / 2;
    const l = Math.min(opp.left, me.left);
    const r = Math.max(opp.right, me.right);
    strand(P(l - 12, opp.top - 6, 0.9), P(r + 12, opp.top - 6, 0.9), 0.55 * k, k);
    strand(P(l - 12, mid, 1.0), P(r + 12, mid, 1.0), 0.6 * k, k);
    strand(P(l - 12, me.bottom + 9, 0.9), P(r + 12, me.bottom + 9, 0.9), 0.55 * k, k);
    strand(P(l - 2, opp.top - 10, 0.8), P(l - 2, me.bottom + 12, 0.8), 0.45 * k, k);
    strand(P(r + 2, opp.top - 10, 0.8), P(r + 2, me.bottom + 12, 0.8), 0.45 * k, k);
    sun.position.set(-4 * k, 12 * k, 5 * k);
    sun.target.position.set(0, 0, -0.4 * k);
    Object.assign(sun.shadow.camera, { left: -4 * k, right: 4 * k, top: 5 * k, bottom: -5 * k, near: 1, far: 40 * k });
    sun.shadow.camera.updateProjectionMatrix();
    dirty = true;
  }

  let flagIndex = 0;
  function strand(A: THREE.Vector3, B: THREE.Vector3, sag: number, k: number) {
    const pt = (t: number) => new THREE.Vector3().lerpVectors(A, B, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 41 }, (_, i) => pt(i / 40)));
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.006 * k, 6), ropeMat);
    rope.castShadow = true;
    strands.add(rope);
    const n = Math.max(2, Math.floor(A.distanceTo(B) / (0.15 * k)));
    const fw = 0.17 * k;
    const fh = fw * 0.66;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = pt(t);
      const tan = new THREE.Vector3().subVectors(pt(Math.min(1, t + 0.01)), pt(Math.max(0, t - 0.01))).normalize();
      if (i % 2 === 0) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.018 * k, 12, 10), bulbMat);
        bulb.position.copy(p).add(new THREE.Vector3(0, -0.02 * k, 0));
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        glow.scale.set(0.2 * k, 0.2 * k, 1);
        glow.position.copy(bulb.position);
        strands.add(bulb, glow);
        bulbs.push({ glow, phase: rnd() * 6.28, speed: 1.2 + rnd() * 2.2 });
        continue;
      }
      const g = new THREE.PlaneGeometry(fw, fh, 10, 4);
      g.translate(0, -fh / 2, 0);
      // Point the plane's UVs at this state's cell in the flag sheet (inset to avoid bleeding).
      const cell = flagIndex++ % STATES.length;
      const cx = cell % ATLAS_COLS;
      const cy = Math.floor(cell / ATLAS_COLS);
      const uv = g.attributes.uv;
      const inset = 0.004;
      for (let v = 0; v < uv.count; v++) {
        uv.setXY(v, (cx + inset + uv.getX(v) * (1 - 2 * inset)) / ATLAS_COLS, 1 - (cy + inset + (1 - uv.getY(v)) * (1 - 2 * inset)) / ATLAS_ROWS);
      }
      const mesh = new THREE.Mesh(g, flagMat);
      mesh.castShadow = true;
      // Hang from the rope, swung part way toward the camera so the flag reads from above.
      const toCam = new THREE.Vector3().subVectors(cam.position, p).normalize();
      const Z = toCam.clone().sub(tan.clone().multiplyScalar(toCam.dot(tan))).normalize();
      const hangN = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, -1, 0)).normalize();
      if (hangN.dot(toCam) < 0) hangN.negate();
      const N = hangN.lerp(Z, 0.55).normalize();
      const Y = new THREE.Vector3().crossVectors(N, tan).normalize();
      if (Y.dot(toCam) < 0 && Y.y < 0) Y.negate();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tan, Y, new THREE.Vector3().crossVectors(tan, Y)));
      mesh.rotateZ((rnd() - 0.5) * 0.12);
      mesh.position.copy(p);
      strands.add(mesh);
      flags.push({ mesh, base: mesh.quaternion.clone(), axis: tan, phase: rnd() * 6.28, rest: Float32Array.from(g.attributes.position.array as Float32Array) });
    }
  }

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const q = new THREE.Quaternion();
  function animate(t: number) {
    for (const f of flags) {
      // Sway on the rope, plus a ripple running through the cloth.
      q.setFromAxisAngle(f.axis, Math.sin(t * 1.3 + f.phase) * 0.14 + Math.sin(t * 0.7 + f.phase * 2) * 0.05);
      f.mesh.quaternion.copy(q).multiply(f.base);
      const pos = f.mesh.geometry.attributes.position;
      const g = f.mesh.geometry as THREE.PlaneGeometry;
      const fw = g.parameters.width;
      const fh = g.parameters.height;
      for (let v = 0; v < pos.count; v++) {
        const x = f.rest[v * 3];
        const d = -f.rest[v * 3 + 1] / fh;
        pos.setZ(v, Math.sin((x / fw) * 7 + f.phase + t * 3.2) * fw * 0.06 * (0.25 + d));
      }
      pos.needsUpdate = true;
    }
    for (const b of bulbs) b.glow.material.opacity = 0.65 + 0.35 * Math.sin(t * b.speed + b.phase);
  }

  let raf = 0;
  let last = 0;
  let alive = true;
  function frame(now: number) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    if (!reduced) {
      if (now - last < 1000 / FPS) return;
      last = now;
      animate(now / 1000);
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, cam);
      dirty = false;
    }
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  layout();
  if (reduced) animate(0);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      clear();
      for (const m of [flagMat, ropeMat, bulbMat]) m.dispose();
      atlas.dispose();
      glowTex.dispose();
      (catcher.material as THREE.Material).dispose();
      catcher.geometry.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** A mat's on-screen rectangle (its drawn mat, which extends past the zones), relative to the stage. */
function matRect(side: Element | null, stage: DOMRect) {
  if (!side) return null;
  const r = side.getBoundingClientRect();
  const cs = getComputedStyle(side, '::before');
  const left = r.left - stage.left + (parseFloat(cs.left) || 0);
  const top = r.top - stage.top + (parseFloat(cs.top) || 0);
  const width = parseFloat(cs.width) || r.width;
  const height = parseFloat(cs.height) || r.height;
  return { left, top, right: left + width, bottom: top + height };
}

function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,140,0.9)');
  gr.addColorStop(0.25, 'rgba(255,190,100,0.35)');
  gr.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
