// Sign-in hero: a pallet of cartons rendered in three.js, then redrawn as
// coloured ASCII. A laser sweeps the stack; each box it crosses flashes
// Yuken blue and its label number appears in the readout.
import * as THREE from '../vendor/three.min.js';

const RAMP = ' .\'`:-~=+*cxoO#%@';
// Render targets hold linear light; convert to sRGB on read-back.
const GAMMA = new Uint8Array(256).map((_, i) => Math.round(255 * Math.pow(i / 255, 1 / 2.2)));
const KRAFT = new THREE.Color('#E2B47C');
const BLUE = new THREE.Color('#2BB6F5');

export function mountHero(host, readout) {
  const canvas = document.createElement('canvas');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let gl;
  try { gl = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: false }); }
  catch { return () => canvas.remove(); }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

  // ----- the pallet -----
  const stack = new THREE.Group();
  const boxes = [];
  const geo = new THREE.BoxGeometry(1, 0.72, 0.9);
  const labelGeo = new THREE.PlaneGeometry(0.46, 0.3);
  const labelMat = new THREE.MeshBasicMaterial({ color: '#F4F7FB' });
  const tapeGeo = new THREE.BoxGeometry(1.002, 0.06, 0.18);
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#0A84C6', roughness: .6 });
  let id = 4270036177;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 2; z++) {
    if (y === 3 && (x + z) % 2 === 0) continue; // ragged top, like a real load
    const mat = new THREE.MeshStandardMaterial({ color: KRAFT.clone(), roughness: .85, metalness: 0, emissive: new THREE.Color(0) });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x - 1) * 1.06, y * 0.76 + 0.46, (z - 0.5) * 0.96);
    const lbl = new THREE.Mesh(labelGeo, labelMat);
    lbl.position.set(0.12, 0.04, 0.451);
    m.add(lbl);
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, 0.33, 0);
    m.add(tape);
    m.userData = { flash: 0, code: `${id + y}-${x * 2 + z + 1}`, seen: false };
    stack.add(m); boxes.push(m);
  }
  const pallet = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 2.1), new THREE.MeshStandardMaterial({ color: '#6E5434', roughness: 1 }));
  pallet.position.y = 0.02;
  stack.add(pallet);
  scene.add(stack);

  // ----- the laser -----
  const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.07, 2.6), new THREE.MeshBasicMaterial({ color: '#FF3B3B', transparent: true, opacity: .9 }));
  scene.add(beam);

  scene.add(new THREE.AmbientLight('#9DC4F0', 1.1));
  const key = new THREE.DirectionalLight('#FFF4E6', 3.2); key.position.set(-3, 8, 4); scene.add(key);
  const fill = new THREE.DirectionalLight('#7FB6FF', 0.6); fill.position.set(5, 2, 3); scene.add(fill);
  const rim = new THREE.PointLight('#049FE0', 30, 20); rim.position.set(3, 3, -4); scene.add(rim);

  // ----- sizing -----
  const FONT = 10, CW = 6, CH = 10;
  let cols = 0, rows = 0, target, buf, dpr = 1;
  function size() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    cols = Math.max(20, Math.floor(r.width / CW));
    rows = Math.max(10, Math.floor(r.height / CH));
    target?.dispose();
    target = new THREE.WebGLRenderTarget(cols, rows);
    gl.setSize(cols, rows, false);
    buf = new Uint8Array(cols * rows * 4);
    camera.aspect = (cols * CW) / (rows * CH);
    camera.updateProjectionMatrix();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `600 ${FONT}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'top';
  }
  size();
  const ro = new ResizeObserver(size); ro.observe(host);

  // ----- pointer parallax -----
  let mx = 0, my = 0, tx = 0, ty = 0;
  const onMove = e => { const r = host.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - .5) * 2; ty = ((e.clientY - r.top) / r.height - .5) * 2; };
  host.addEventListener('pointermove', onMove);

  const log = [];
  function scanned(m) {
    log.unshift(`BOX ${m.userData.code}  OK`);
    if (log.length > 5) log.pop();
    if (readout) readout.textContent = `${log.join('\n')}\n— ${boxes.filter(b => b.userData.seen).length} of ${boxes.length} loaded`;
  }

  // ----- draw -----
  function frame(t) {
    mx += (tx - mx) * .05; my += (ty - my) * .05;
    const a = t * 0.00012 + mx * 0.5 + 0.6;
    camera.position.set(Math.sin(a) * 10.5, 5.2 - my * 1.4, Math.cos(a) * 10.5);
    camera.lookAt(0, 1.0, 0);

    // laser sweeps bottom → top, then pauses
    const cycle = (t % 5200) / 5200;
    const by = cycle < .78 ? 0.2 + (cycle / .78) * 3.2 : -5;
    beam.position.y = by;
    beam.material.opacity = cycle < .78 ? .9 : 0;
    if (cycle < .02) boxes.forEach(b => { b.userData.seen = false; });
    for (const b of boxes) {
      if (!b.userData.seen && Math.abs(b.position.y - by) < 0.08) { b.userData.seen = true; b.userData.flash = 1; scanned(b); }
      b.userData.flash *= 0.94;
      b.material.color.copy(KRAFT).lerp(BLUE, b.userData.flash * .85);
      b.material.emissive.copy(BLUE).multiplyScalar(b.userData.flash * .35);
    }

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.readRenderTargetPixels(target, 0, 0, cols, rows, buf);
    gl.setRenderTarget(null);

    ctx.fillStyle = '#050B16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let last = '';
    for (let y = 0; y < rows; y++) {
      const row = (rows - 1 - y) * cols * 4; // GL rows are bottom-up
      for (let x = 0; x < cols; x++) {
        const i = row + x * 4;
        const r = GAMMA[buf[i]], g = GAMMA[buf[i + 1]], b = GAMMA[buf[i + 2]];
        const lum = (r * .3 + g * .59 + b * .11) / 255;
        if (lum < 0.07) continue;
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length * 1.25))];
        // quantise and lift colours so the glyphs glow on the dark ground
        const q = v => Math.min(255, (v >> 4 << 4) + 24);
        const c = `rgb(${q(r)},${q(g)},${q(b)})`;
        if (c !== last) { ctx.fillStyle = c; last = c; }
        ctx.fillText(ch, x * CW, y * CH);
      }
    }
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf, lastT = 0;
  const loop = t => { raf = requestAnimationFrame(loop); if (t - lastT < 33) return; lastT = t; frame(t); };
  if (still) frame(2600); else raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); host.removeEventListener('pointermove', onMove);
    target?.dispose(); gl.dispose(); canvas.remove();
  };
}
