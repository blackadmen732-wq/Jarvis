/* Black hole "Play" mode: throw light, gas, stars and planets at the hole and watch real physics.
   Units: Schwarzschild radius = 1, light speed = 1, GM = 0.5.
   - Light follows the same bending law the black hole renderer uses, so beams that pass close
     curve round the hole, some loop the photon sphere, the rest fall in.
   - Matter feels the Paczynski-Wiita pull (Newton-like far away, much stronger near the hole),
     so a star or planet that dives in is stretched into a stream (tidal "spaghetti") before it falls.
   - Gas loses a little speed (friction in the disk), spirals inward, heats up from red to white and
     feeds the hole: the disk flares, jets fire and the hole grows slightly. */
import * as THREE from 'three';

const GM = 0.5;
const SIM = 16;          // simulated time units per real second (matter)
const LIGHT = 9;         // light travels this many Schwarzschild radii per second (slow motion so you can see it)

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,0.8)'); r.addColorStop(0.4, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// temperature colour: cool red -> orange -> yellow-white -> blue-white
function heatColor(T, out) {
  if (T < 0.33) out.setRGB(0.6 + T * 1.2, 0.1 + T * 0.6, 0.03);
  else if (T < 0.66) { const k = (T - 0.33) / 0.33; out.setRGB(1.0, 0.3 + k * 0.55, 0.03 + k * 0.45); }
  else { const k = Math.min(1, (T - 0.66) / 0.34); out.setRGB(1.0 - k * 0.2, 0.85 + k * 0.07, 0.48 + k * 0.52); }
  return out;
}

export function createPlay(frame, { mobile = false, onFeed = () => {}, onEvent = () => {} } = {}) {
  const root = new THREE.Group(); frame.add(root);
  const glow = glowTex();

  // ------------------------------------------------------------ matter particles
  const MAX = mobile ? 2500 : 6000;
  const P = new Float32Array(MAX * 3), V = new Float32Array(MAX * 3), C = new Float32Array(MAX * 3), S = new Float32Array(MAX);
  const kind = new Uint8Array(MAX), age = new Float32Array(MAX);
  let n = 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uPix: { value: 1 } },
    vertexShader: `attribute float aSize; varying vec3 vC; uniform float uPix;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPix * 260.0 / -mv.z, 1.0, 40.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 3.5) * step(d, 1.0); gl_FragColor = vec4(vC * a, a); }`,
  });
  const points = new THREE.Points(geo, pmat); points.frustumCulled = false; root.add(points);

  function addParticle(px, py, pz, vx, vy, vz, k) {
    if (n >= MAX) return;
    const i = n++;
    P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
    kind[i] = k; age[i] = 0;
  }
  function removeParticle(i) {
    const j = --n; if (i === j) return;
    for (let c = 0; c < 3; c++) { P[i * 3 + c] = P[j * 3 + c]; V[i * 3 + c] = V[j * 3 + c]; }
    kind[i] = kind[j]; age[i] = age[j];
  }

  // ------------------------------------------------------------ light rays
  const PH = 48, TRAIL = 150;
  const photons = [];
  for (let k = 0; k < PH; k++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    line.frustumCulled = false; line.visible = false; root.add(line);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xdfeaff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    head.scale.setScalar(0.9); head.visible = false; root.add(head);
    photons.push({ line, head, p: new THREE.Vector3(), v: new THREE.Vector3(), h2: 0, alive: false, fade: 0, hist: [], last: new THREE.Vector3() });
  }

  // ------------------------------------------------------------ whole bodies (star, planet) until tides tear them apart
  const bodies = [];
  function makeBody(type, p, v) {
    let obj;
    if (type === 'star') {
      obj = new THREE.Group();
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff4dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); core.scale.setScalar(1.4);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb060, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(4.5);
      obj.add(core, halo);
    } else {
      obj = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 20), new THREE.ShaderMaterial({
        uniforms: { uHeat: { value: 0 } },
        vertexShader: 'varying vec3 vN, vW, vP; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
        fragmentShader: `uniform float uHeat; varying vec3 vN, vW, vP;
          float h(vec3 p){ return fract(sin(dot(floor(p), vec3(12.9898,78.233,37.719))) * 43758.5453); }
          void main(){ vec3 L = normalize(-vW); float lit = max(dot(normalize(vN), L), 0.0);
            float pat = h(vP * 9.0) * 0.5 + h(vP * 23.0) * 0.5;
            vec3 base = mix(vec3(0.18, 0.32, 0.55), vec3(0.35, 0.55, 0.3), step(0.55, pat));
            vec3 col = base * (0.03 + lit * 1.4) + vec3(1.0, 0.35, 0.08) * uHeat * (0.5 + pat);
            gl_FragColor = vec4(col, 1.0); }`,
      }));
    }
    obj.position.copy(p); root.add(obj);
    const b = { type, obj, p: p.clone(), v: v.clone(), tidal: type === 'star' ? 5.5 : 4.0, heat: obj.material?.uniforms?.uHeat };
    bodies.push(b); return b;
  }

  // take over an object from the scene (an orbiting planet or a drone) so it can be held and thrown
  function adopt(obj, kindName, { tidal = 3.6, debris = 450, onGone = () => {} } = {}) {
    const wp = obj.getWorldPosition(new THREE.Vector3()), ws = obj.getWorldScale(new THREE.Vector3()).x;
    root.updateWorldMatrix(true, false);
    const rs = root.getWorldScale(new THREE.Vector3()).x;
    root.attach(obj); obj.scale.setScalar(ws / rs);
    const p = root.worldToLocal(wp.clone());
    const b = { type: kindName, obj, p, v: new THREE.Vector3(), tidal, adopted: true, held: true, debris, onGone, heat: obj.material?.uniforms?.uHeat };
    obj.position.copy(p); bodies.push(b); return b;
  }
  function hold(b, local) { b.held = true; b.p.copy(local); b.obj.position.copy(local); }
  function release(b, vel) { b.held = false; b.v.copy(vel); if (b.v.length() > 0.7) b.v.setLength(0.7); onEvent('throw'); }
  function toLocal(world) { root.updateWorldMatrix(true, false); return root.worldToLocal(world.clone()); }
  function bodyObjects() { return bodies.map(b => b.obj); }
  function bodyFor(obj) { let o = obj; while (o) { const b = bodies.find(x => x.obj === o); if (b) return b; o = o.parent; } return null; }
  function lastBody() { return bodies[bodies.length - 1] || null; }

  // ------------------------------------------------------------ physics helpers
  function accel(px, py, pz, out) {               // Paczynski-Wiita pull toward the hole
    const r = Math.hypot(px, py, pz), d = Math.max(0.02, r - 1);
    const f = -GM / (d * d * r);
    return out.set(px * f, py * f, pz * f);
  }
  const vCirc = r => Math.sqrt(GM * r) / Math.max(0.05, r - 1);
  // prograde direction (same way the disk turns) at position p
  function tangent(p) {
    const rh = tmpA.copy(p).normalize();
    const t = new THREE.Vector3().crossVectors(rh, Math.abs(rh.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    return t;
  }
  // speed that puts the closest approach at roughly rp
  const plungeSpeed = (r, rp) => vCirc(r) * Math.sqrt(2 * rp / (r + rp));

  // ------------------------------------------------------------ spawning
  let flash = 0;
  function spawn(type, local, viewDir) {
    const p = local.clone();
    const minR = type === 'light' ? 13 : type === 'gas' ? 7 : 10;
    if (p.length() < minR) p.setLength(minR);
    const r = p.length();
    if (type === 'light') {
      const d = p.clone().negate().normalize();
      const e = new THREE.Vector3().crossVectors(d, viewDir); if (e.lengthSq() < 1e-4) e.set(0, 1, 0); e.normalize();
      const offsets = [-6, -4.6, -3.6, -3, -2.7, -2.62, -2.5, -1.6, 0, 1.6, 2.5, 2.62, 2.7, 3, 3.6, 4.6, 6];
      for (const b of offsets) {
        const ph = photons.find(q => !q.alive && q.fade <= 0); if (!ph) break;
        ph.p.copy(p).addScaledVector(e, b); ph.v.copy(d);
        ph.h2 = tmpB.crossVectors(ph.p, ph.v).lengthSq();
        ph.alive = true; ph.fade = 1; ph.hist = [ph.p.clone()]; ph.last.copy(ph.p);
        ph.line.visible = true; ph.head.visible = true;
      }
      onEvent('light');
      return;
    }
    const t = tangent(p);
    if (type === 'gas') {
      const sp = plungeSpeed(r, 4.5);
      for (let k = 0; k < (mobile ? 350 : 700); k++) {
        // a lumpy cloud
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = Math.cbrt(Math.random()) * 1.1;
        const ox = Math.sqrt(1 - u * u) * Math.cos(a) * rr, oy = u * rr * 0.6, oz = Math.sqrt(1 - u * u) * Math.sin(a) * rr;
        addParticle(p.x + ox, p.y + oy, p.z + oz, t.x * sp + (Math.random() - 0.5) * 0.01, t.y * sp + (Math.random() - 0.5) * 0.01, t.z * sp + (Math.random() - 0.5) * 0.01, 0);
      }
      onEvent('gas');
    } else if (type === 'star') {
      makeBody('star', p, t.multiplyScalar(plungeSpeed(r, 3.2))); onEvent('star');
    } else if (type === 'planet') {
      makeBody('planet', p, t.multiplyScalar(plungeSpeed(r, 2.4))); onEvent('planet');
    }
  }

  function disrupt(b) {
    // tidal disruption: the body becomes a cloud that the hole's uneven pull stretches into a long stream
    const count = Math.round((b.debris || (b.type === 'star' ? 1100 : 500)) * (mobile ? 0.5 : 1));
    const rad = b.type === 'star' ? 0.45 : 0.3;
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = Math.cbrt(Math.random()) * rad;
      const s = Math.sqrt(1 - u * u);
      addParticle(b.p.x + s * Math.cos(a) * rr, b.p.y + u * rr, b.p.z + s * Math.sin(a) * rr,
        b.v.x * (1 + (Math.random() - 0.5) * 0.04), b.v.y + (Math.random() - 0.5) * 0.004, b.v.z * (1 + (Math.random() - 0.5) * 0.04), b.type === 'star' ? 2 : b.type === 'drone' ? 3 : 1);
    }
    root.remove(b.obj);
    if (b.adopted) b.onGone(b.obj); else b.obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    flash = 1; onEvent('disrupt');
  }

  // ------------------------------------------------------------ update
  const col = new THREE.Color();
  let fedTotal = 0;
  function update(dt, vis, pixelRatio) {
    root.visible = vis > 0.01;
    pmat.uniforms.uPix.value = pixelRatio;
    if (!root.visible) return;
    const h = dt * SIM;
    // matter
    for (let i = 0; i < n; i++) {
      let px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2], vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
      let r = Math.hypot(px, py, pz);
      const steps = Math.min(16, Math.max(1, Math.ceil(h / (0.08 * Math.pow(r, 1.5)))));
      const sh = h / steps, k = kind[i];
      const drag = k === 0 ? 0.0035 : k === 2 ? 0.002 : 0.0012;
      let gone = false;
      for (let s = 0; s < steps; s++) {
        accel(px, py, pz, tmpA);
        tmpA.x -= drag * vx; tmpA.y -= drag * vy + 0.004 * vy; tmpA.z -= drag * vz;      // friction + settling into the disk
        vx += tmpA.x * sh; vy += tmpA.y * sh; vz += tmpA.z * sh;
        px += vx * sh; py += vy * sh; pz += vz * sh;
        r = Math.hypot(px, py, pz);
        if (r < 1.05) { gone = true; break; }
      }
      age[i] += dt;
      if (gone || r > 90 || age[i] > 150) { if (gone) { fedTotal++; onFeed(k === 2 ? 1.4 : 1); } removeParticle(i); i--; continue; }
      P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      // hotter (and whiter) the deeper it falls; dimmed by gravitational redshift right at the edge
      const T = Math.min(1, Math.pow(4.5 / r, 0.9) * (k === 1 ? 0.75 : 1));
      if (k === 3 && r > 4) col.setRGB(0.35, 0.8, 1.0); else heatColor(k === 1 && r > 5 ? 0.12 : T, col);
      const red = Math.sqrt(Math.max(0, 1 - 1 / r));
      const b = (k === 1 && r > 5 ? 0.35 : 0.5 + 1.4 * T) * red * Math.min(1, age[i] * 3);
      C[i * 3] = col.r * b; C[i * 3 + 1] = col.g * b; C[i * 3 + 2] = col.b * b;
      S[i] = (k === 1 ? 0.22 : 0.34) * (1 + T * 0.6);
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.aSize.needsUpdate = true;

    // whole bodies
    for (let j = bodies.length - 1; j >= 0; j--) {
      const b = bodies[j];
      if (b.held) { b.obj.position.copy(b.p); continue; }
      const steps = Math.min(20, Math.max(1, Math.ceil(h / (0.06 * Math.pow(b.p.length(), 1.5)))));
      for (let s = 0; s < steps; s++) { accel(b.p.x, b.p.y, b.p.z, tmpA); b.v.addScaledVector(tmpA, h / steps); b.p.addScaledVector(b.v, h / steps); }
      b.obj.position.copy(b.p);
      const r = b.p.length();
      if (b.heat) b.heat.value = Math.min(1, Math.max(0, (8 - r) / 4));
      if (b.type === 'star' && !b.adopted) b.obj.children[1].material.opacity = 0.5 + 0.3 * Math.sin(performance.now() / 120);
      else b.obj.rotation.y += dt;
      if (r < b.tidal) { disrupt(b); bodies.splice(j, 1); }
      else if (r > 90) { root.remove(b.obj); bodies.splice(j, 1); if (b.adopted) b.onGone(b.obj); }
    }

    // light
    for (const ph of photons) {
      if (ph.alive) {
        let dist = LIGHT * dt;
        while (dist > 0 && ph.alive) {
          const r = ph.p.length();
          const sh = Math.min(dist, Math.max(0.01, Math.min(0.4, 0.03 * r * r)));
          tmpA.copy(ph.p).multiplyScalar(-1.5 * ph.h2 / Math.pow(r, 5));
          ph.v.addScaledVector(tmpA, sh).normalize();
          ph.p.addScaledVector(ph.v, sh); dist -= sh;
          if (ph.p.distanceToSquared(ph.last) > 0.04) { ph.hist.push(ph.p.clone()); ph.last.copy(ph.p); if (ph.hist.length > TRAIL) ph.hist.shift(); }
          const rr = ph.p.length();
          if (rr < 1.0) { ph.alive = false; onFeed(0.3); }
          else if (rr > 70) ph.alive = false;
        }
        ph.head.position.copy(ph.p);
      } else if (ph.fade > 0) {
        ph.fade -= dt * 0.6;
        if (ph.hist.length > 1) ph.hist.splice(0, Math.max(1, Math.ceil(ph.hist.length * dt * 1.5)));
        if (ph.fade <= 0) { ph.line.visible = false; ph.hist = []; }
      }
      ph.head.visible = ph.alive;
      if (!ph.line.visible) continue;
      const pa = ph.line.geometry.attributes.position.array, ca = ph.line.geometry.attributes.color.array, m = ph.hist.length;
      for (let q = 0; q < m; q++) {
        const pt = ph.hist[q]; pa[q * 3] = pt.x; pa[q * 3 + 1] = pt.y; pa[q * 3 + 2] = pt.z;
        const w = Math.pow(q / Math.max(1, m - 1), 1.6) * Math.max(0, ph.fade) * 1.4;
        ca[q * 3] = 0.75 * w; ca[q * 3 + 1] = 0.86 * w; ca[q * 3 + 2] = 1.0 * w;
      }
      ph.line.geometry.setDrawRange(0, m);
      ph.line.geometry.attributes.position.needsUpdate = true; ph.line.geometry.attributes.color.needsUpdate = true;
    }
    flash = Math.max(0, flash - dt * 1.5);
  }

  function clear() {
    n = 0; geo.setDrawRange(0, 0);
    for (const b of bodies) { root.remove(b.obj); if (b.adopted) b.onGone(b.obj); } bodies.length = 0;
    for (const ph of photons) { ph.alive = false; ph.fade = 0; ph.hist = []; ph.line.visible = false; ph.head.visible = false; }
    fedTotal = 0;
  }
  return { spawn, adopt, hold, release, toLocal, bodyObjects, bodyFor, lastBody, update, clear, stats: () => ({ particles: n, fed: fedTotal, flash }) };
}
