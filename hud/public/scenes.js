/* Switchable scenes for the Jarvis HUD.
   reactor : the default amber particle reactor
   brain   : a blue neural-network brain with firing signals inside a geodesic shell
   stream  : rivers of glowing particles flowing around the reactor
   Each scene fades in/out smoothly; scene3d.js asks how visible the reactor and the
   floor should be for the current scene. */
import * as THREE from 'three';

const FACE = { reactor: 0, floor: 0.45, hud: 0.6 };
export const SCENES = {
  auto:      { label: 'Auto', ...FACE },
  circuit:   { label: 'Circuit', ...FACE },
  pulse:     { label: 'Pulse', ...FACE },
  portal:    { label: 'Portal', ...FACE, hud: 0.3 },
  plasma:    { label: 'Plasma', ...FACE },
  liquid:    { label: 'Liquid', ...FACE },
  blackhole: { label: 'Black Hole', reactor: 0, floor: 0, hud: 0.12 },
  sun:       { label: 'Sun', reactor: 0, floor: 0.5, hud: 0.6 },
  reactor:   { label: 'Reactor', reactor: 1, floor: 1, hud: 1 },
  brain:     { label: 'Neural Brain', reactor: 0, floor: 1, hud: 1 },
  stream:    { label: 'Data Stream', reactor: 1, floor: 0.45, hud: 1 },
};

const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.02; a *= 0.5; } return s; }`;

const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export function createScenes(scene, { glow, mobile = false, reduce = false, pixelRatio = 1 }) {
  let rs = 99;
  const rand = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const vis = { brain: 0, stream: 0, blackhole: 0, sun: 0, circuit: 0, pulse: 0, portal: 0, plasma: 0, liquid: 0, reactor: 0 };

  // =============================================================== NEURAL BRAIN
  const brain = new THREE.Group(); scene.add(brain);
  const NB = mobile ? 420 : 720;
  const nodes = [];
  while (nodes.length < NB) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (v.length() > 1 || v.length() < 0.35) continue;
    v.normalize().multiplyScalar(0.82 + rand() * 0.18);                 // mostly on a shell
    if (Math.abs(v.x) < 0.12) v.multiplyScalar(0.86);                   // groove between hemispheres
    v.y -= Math.max(0, -v.y) * 0.25;                                     // flatter underside
    nodes.push(v.multiply(new THREE.Vector3(2.55, 2.0, 2.25)));
  }
  const adj = nodes.map(() => []), edges = [];
  for (let i = 0; i < NB; i++) {
    const near = [];
    for (let j = 0; j < NB; j++) if (i !== j) { const d = nodes[i].distanceToSquared(nodes[j]); if (d < 0.9) near.push([d, j]); }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, j] of near.slice(0, 3)) if (i < j || !adj[j].includes(i)) { if (adj[i].includes(j)) continue; adj[i].push(j); adj[j].push(i); edges.push([i, j]); }
  }
  const ePos = new Float32Array(edges.length * 6), eCol = new Float32Array(edges.length * 6), heat = new Float32Array(edges.length);
  edges.forEach(([a, b], k) => { ePos.set([nodes[a].x, nodes[a].y, nodes[a].z, nodes[b].x, nodes[b].y, nodes[b].z], k * 6); });
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3)); eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  brain.add(new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({ vertexColors: true, ...add })));
  const nPos = new Float32Array(NB * 3); nodes.forEach((v, i) => nPos.set([v.x, v.y, v.z], i * 3));
  const nGeo = new THREE.BufferGeometry(); nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  const nMat = new THREE.PointsMaterial({ map: glow, size: 0.11, color: new THREE.Color('#7fb0ff'), ...add });
  brain.add(new THREE.Points(nGeo, nMat));
  const edgeIndex = new Map(); edges.forEach(([a, b], k) => { edgeIndex.set(a + ':' + b, k); edgeIndex.set(b + ':' + a, k); });
  // signals hopping from neuron to neuron
  const NS = mobile ? 40 : 80;
  const sigs = Array.from({ length: NS }, () => { const a = (rand() * NB) | 0; return { a, b: adj[a][0] ?? a, u: rand(), speed: 1.2 + rand() * 1.5 }; });
  const sPos = new Float32Array(NS * 3), sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const sMat = new THREE.PointsMaterial({ map: glow, size: 0.28, color: new THREE.Color('#e6f0ff'), ...add });
  brain.add(new THREE.Points(sGeo, sMat));
  // geodesic shell + radial spikes
  const shellMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#3fd0ff'), ...add, opacity: 0.22 });
  const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.25, 2)), shellMat); brain.add(shell);
  const spk = [];
  for (let i = 0; i < 260; i++) { const d = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(); const l = 0.08 + rand() * 0.25; spk.push(d.clone().multiplyScalar(3.4), d.clone().multiplyScalar(3.4 + l)); }
  const spikeMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#7fe3ff'), ...add, opacity: 0.35 });
  const spikes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spk), spikeMat); brain.add(spikes);
  const brainGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color('#2f6bff'), ...add, opacity: 0.35 }));
  brainGlow.scale.setScalar(8); brain.add(brainGlow);
  const cBase = new THREE.Color('#2b56d8'), cHot = new THREE.Color('#dfe9ff');

  function updateBrain(dt, t, L, f) {
    const v = vis.brain;
    brain.visible = v > 0.01; if (!brain.visible) return;
    brain.scale.setScalar(0.35 + 0.65 * v);
    brain.rotation.y += dt * 0.08;
    shell.rotation.y -= dt * 0.05; shell.rotation.x += dt * 0.02; spikes.rotation.y += dt * 0.03;
    const busy = f.uiState === 'thinking' ? 2.6 : f.uiState === 'speaking' ? 1.8 : f.uiState === 'listening' ? 1.2 : 0.7;
    for (const s of sigs) {
      s.u += dt * s.speed * busy;
      if (s.u >= 1) {
        const k = edgeIndex.get(s.a + ':' + s.b); if (k !== undefined) heat[k] = 1;
        s.a = s.b; const nb = adj[s.a]; s.b = nb.length ? nb[(rand() * nb.length) | 0] : s.a; s.u = 0;
      }
    }
    sigs.forEach((s, i) => { const A = nodes[s.a], B = nodes[s.b]; sPos.set([A.x + (B.x - A.x) * s.u, A.y + (B.y - A.y) * s.u, A.z + (B.z - A.z) * s.u], i * 3); });
    sGeo.attributes.position.needsUpdate = true;
    const decay = Math.exp(-dt * 1.6);
    for (let k = 0; k < edges.length; k++) {
      heat[k] *= decay;
      const h = heat[k], b = (0.28 + h * 1.4 + L * 0.3) * v;
      const r = (cBase.r + (cHot.r - cBase.r) * h) * b, g = (cBase.g + (cHot.g - cBase.g) * h) * b, bl = (cBase.b + (cHot.b - cBase.b) * h) * b;
      eCol[k * 6] = eCol[k * 6 + 3] = r; eCol[k * 6 + 1] = eCol[k * 6 + 4] = g; eCol[k * 6 + 2] = eCol[k * 6 + 5] = bl;
    }
    eGeo.attributes.color.needsUpdate = true;
    nMat.opacity = 0.8 * v; sMat.opacity = v; shellMat.opacity = (0.18 + L * 0.2) * v; spikeMat.opacity = 0.32 * v;
    brainGlow.material.opacity = (0.25 + L * 0.35) * v;
  }

  // =============================================================== DATA STREAM
  const NSTR = reduce ? 6 : mobile ? 10 : 18, PER = mobile ? 380 : 650;
  const N = NSTR * PER;
  const aU = new Float32Array(N), aSpeed = new Float32Array(N), aStream = new Float32Array(N * 4), aOff = new Float32Array(N * 3), aHue = new Float32Array(N);
  for (let s = 0; s < NSTR; s++) {
    const theta = rand() * Math.PI * 2, twist = (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 2.2), rad = 3.8 + rand() * 4.2, height = -1.5 + rand() * 4.5;
    for (let k = 0; k < PER; k++) {
      const i = s * PER + k;
      aU[i] = rand(); aSpeed[i] = 0.025 + rand() * 0.04;
      aStream.set([theta, twist, rad, height], i * 4);
      const spread = Math.pow(rand(), 2.0) * 0.55;
      aOff.set([(rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread], i * 3);
      aHue[i] = rand();
    }
  }
  const flGeo = new THREE.BufferGeometry();
  flGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  flGeo.setAttribute('aU', new THREE.BufferAttribute(aU, 1)); flGeo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  flGeo.setAttribute('aStream', new THREE.BufferAttribute(aStream, 4)); flGeo.setAttribute('aOff', new THREE.BufferAttribute(aOff, 3)); flGeo.setAttribute('aHue', new THREE.BufferAttribute(aHue, 1));
  const flMat = new THREE.ShaderMaterial({ ...add, uniforms: { uPhase: { value: 0 }, uTime: { value: 0 }, uVis: { value: 0 }, uLevel: { value: 0 }, uPixel: { value: pixelRatio } },
    vertexShader: /* glsl */`
      uniform float uPhase, uTime, uPixel, uLevel; attribute float aU, aSpeed, aHue; attribute vec4 aStream; attribute vec3 aOff;
      varying float vU, vHue;
      void main(){
        float u = fract(aU + uPhase * aSpeed);
        float th = aStream.x + u * aStream.y;
        // a river that starts near the reactor, sweeps outward in a wide S-curve, and loops back
        float r = mix(1.2, aStream.z, smoothstep(0.0, 0.35, u)) * (1.0 + 0.18 * sin(u * 9.0 + aStream.x));
        float y = aStream.w + sin(u * 6.2832 + aStream.x * 2.0) * 1.3 + (u - 0.5) * 1.5;
        vec3 p = vec3(cos(th) * r, y, sin(th) * r) + aOff * (0.6 + u * 1.6) * (1.0 + uLevel);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * (1.4 + aHue * 2.0) * (24.0 / -mv.z);
        vU = u; vHue = aHue;
      }`,
    fragmentShader: /* glsl */`
      uniform float uVis, uTime; varying float vU, vHue;
      void main(){
        float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        vec3 orange = vec3(1.0, 0.52, 0.16), teal = vec3(0.2, 0.95, 0.8), white = vec3(0.92, 0.95, 1.0);
        vec3 c = mix(orange, teal, smoothstep(0.15, 0.85, vU + (vHue - 0.5) * 0.4));
        c = mix(c, white, step(0.93, vHue));                      // a few bright white grains
        c = mix(c, vec3(0.6, 0.5, 1.0), step(0.86, vHue) * (1.0 - step(0.93, vHue)));   // iridescent violet grains
        float a = smoothstep(0.5, 0.0, d) * smoothstep(0.0, 0.08, vU) * smoothstep(1.0, 0.85, vU) * uVis;
        gl_FragColor = vec4(c * a * 1.25, a);
      }`,
  });
  const flow = new THREE.Points(flGeo, flMat); flow.frustumCulled = false; scene.add(flow);
  let flowPhase = 0;
  function updateStream(dt, t, L, f) {
    const v = vis.stream;
    flow.visible = v > 0.01; if (!flow.visible) return;
    const speed = f.uiState === 'thinking' ? 3 : f.uiState === 'speaking' ? 2 : 1;
    flowPhase += dt * speed;
    flMat.uniforms.uPhase.value = flowPhase; flMat.uniforms.uTime.value = t; flMat.uniforms.uVis.value = v; flMat.uniforms.uLevel.value = L;
  }

  // =============================================================== control
  let current = 'reactor', started = false;
  function update(dt, t, L, f) {
    current = SCENES[f.scene] ? f.scene : 'auto';
    // Auto: the core changes with what Jarvis is doing
    if (current === 'auto') {
      const home = SCENES[f.home] && f.home !== 'auto' ? f.home : 'blackhole';
      current = f.uiState === 'listening' ? 'pulse' : f.uiState === 'thinking' ? 'portal'
        : f.uiState === 'speaking' ? (f.councilMode ? 'liquid' : 'plasma') : home;
    }
    const k = started ? Math.min(1, dt * 1.8) : 1; started = true;   // no fade on first load
    for (const key of Object.keys(vis)) vis[key] += ((current === key ? 1 : 0) - vis[key]) * k;
    updateBrain(dt, t, L, f); updateStream(dt, t, L, f);
    return { ...SCENES[current], name: current };
  }
  return { update, vis };
}
