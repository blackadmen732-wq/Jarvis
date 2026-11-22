/* Jarvis HUD 3D scene (three.js + bloom).
   Amber particle reactor, wave-field floor, blue model nodes in 3D, red routes with
   energy pulses, council beams. Drag to rotate, scroll to zoom, click a node to route.
   Reads live state from window.JarvisHUD (hud.js). Falls back to the 2D canvas if WebGL
   is missing or the page is opened with ?2d. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, NoiseEffect, BlendFunction } from 'postprocessing';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createHolo } from './holo.js';
import { createScenes } from './scenes.js';
import { createBlackHole, BASE_SCALE } from './blackhole.js';
import { createPlay } from './bhplay.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createSun, SUN_R } from './sun.js';
import { createCores, CORE_RADIUS } from './cores.js';
import { createSky } from './sky.js';

// Colour themes: core, disk, sun, plasma lightning (the HUD panels follow via CSS in hud.js)
export const THEMES = {
  amber:   { hot: '#ffebc7', mid: '#ff8f29', deep: '#8c2108', plasma: '#ff7a45', route: '#ff4a32' },
  ice:     { hot: '#e8f6ff', mid: '#4fb8ff', deep: '#0e2a66', plasma: '#8fdcff', route: '#3a8cff' },
  violet:  { hot: '#f6e6ff', mid: '#b062ff', deep: '#360d6b', plasma: '#d9a0ff', route: '#9a4dff' },
  crimson: { hot: '#ffe3da', mid: '#ff3b30', deep: '#5a0404', plasma: '#ff6b5a', route: '#ff2d2d' },
  emerald: { hot: '#e6fff1', mid: '#2ee59d', deep: '#053f29', plasma: '#7dffc6', route: '#18c47e' },
  gold:    { hot: '#fff6da', mid: '#ffc53d', deep: '#6e4300', plasma: '#ffe183', route: '#ffb020' },
};

const TAU = Math.PI * 2;
const AMBER = new THREE.Color('#ffa83a'), HOT = new THREE.Color('#ffe2b0'), RED = new THREE.Color('#ff4a32'),
  BLUE = new THREE.Color('#4fb8ff'), GREY = new THREE.Color('#5b6675');

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function start() {
  const host = document.getElementById('scene3d');
  const hud = window.JarvisHUD;
  if (!host || !hud) return;
  const mobile = innerWidth < 860;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- power governor (the way games avoid overheating)
  // 1. pick a quality tier for this device once (Chromebook, 4 GB RAM or 4 cores -> eco), 2. cap the frame rate,
  // 3. drop to a trickle when nothing is happening, stop completely in a hidden tab, 4. lower the resolution while
  // frames are late and raise it again when there's headroom. Say "eco mode", "high quality" or "auto quality".
  let qPref = 'auto'; try { qPref = JSON.parse(localStorage.getItem('jarvis.quality')) || 'auto'; } catch {}
  if (new URLSearchParams(location.search).has('eco')) qPref = 'eco';
  const weak = mobile || /CrOS/.test(navigator.userAgent) || (navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4;
  const tier = qPref === 'high' ? 'high' : qPref === 'eco' ? 'eco' : weak ? 'eco' : 'high';
  const gov = tier === 'eco' ? { maxPR: 1, minPR: 0.5, fps: 30, idleFps: 12, msaa: 0, grain: false }
                             : { maxPR: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2), minPR: 0.75, fps: 60, idleFps: 24, msaa: mobile ? 0 : 4, grain: true };
  document.body.dataset.quality = tier;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
  let pr = gov.maxPR; renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;          // tone mapping happens in the post-processing chain
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.className = 'labels';
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#030508');
  // a real galaxy all around: ESO's Milky Way panorama (ESO/S. Brunier, CC BY 4.0)
  const sky = createSky(scene, { mobile, src: mobile || tier === 'eco' ? 'assets/milkyway-small.jpg' : 'assets/milkyway.jpg' });
  scene.fog = new THREE.FogExp2(0x030508, 0.028);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, mobile ? 4.2 : 3.0, mobile ? 21 : 12);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
  controls.minDistance = 6; controls.maxDistance = mobile ? 30 : 26;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(0, 0.2, 0);
  controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.35;
  let lastTouch = -1e9;
  controls.addEventListener('start', () => { controls.autoRotate = false; lastTouch = performance.now(); document.body.classList.add('gl-touched'); });
  controls.addEventListener('end', () => { lastTouch = performance.now(); });

  // cinematic finishing (pmndrs/postprocessing): HDR buffers, smooth edges, soft mipmap bloom, AgX colour
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: gov.msaa });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ mipmapBlur: true, intensity: 0.9, luminanceThreshold: 0.32, luminanceSmoothing: 0.35, radius: 0.72 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true }); grain.blendMode.opacity.value = 0.12;
  if (tier === 'eco') bloom.resolution.scale = 0.5;                       // half-size glow: looks the same, a quarter of the work
  const finish = [bloom, new VignetteEffect({ darkness: 0.62, offset: 0.28 }), ...(gov.grain ? [grain] : []), new ToneMappingEffect({ mode: ToneMappingMode.AGX })];
  composer.addPass(new EffectPass(camera, ...finish));
  composer.addPass(new EffectPass(camera, new SMAAEffect()));

  function frameView() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    // nudge the reactor up so the status text and dock below it stay clear
    camera.setViewOffset(w, h, 0, h * (mobile ? 0.07 : 0.05), w, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h); labels.setSize(w, h);
  }
  frameView();
  addEventListener('resize', frameView);

  const glow = glowTexture();
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // ---------------------------------------------------------------- reactor particles (GPU animated)
  const N = reduce ? 5000 : mobile ? 9000 : 22000;
  const rand = rng(11);
  const planes = Array.from({ length: 6 }, () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
  const aRadius = new Float32Array(N), aAngle = new Float32Array(N), aSpeed = new Float32Array(N), aSize = new Float32Array(N),
    aHue = new Float32Array(N), aAxis = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const inner = rand() < 0.2;
    const r = inner ? 0.18 + rand() * 0.8 : 1.15 + Math.pow(rand(), 0.75) * 1.55;
    const p = planes[i % planes.length];
    const ax = new THREE.Vector3(p.x + (rand() - 0.5) * 0.35, p.y + (rand() - 0.5) * 0.35, p.z + (rand() - 0.5) * 0.35).normalize();
    aRadius[i] = r; aAngle[i] = rand() * TAU;
    aSpeed[i] = (inner ? 1.4 + rand() * 1.8 : 0.18 + rand() * 0.6) * (i % 2 ? 1 : -1);
    aSize[i] = inner ? 1.2 + rand() * 1.6 : 0.6 + rand() * 1.4;
    aHue[i] = Math.min(1, Math.max(0, (r - 0.15) / 2.6 + (rand() - 0.5) * 0.15));
    aAxis.set([ax.x, ax.y, ax.z], i * 3);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  for (const [k, v, s] of [['aRadius', aRadius, 1], ['aAngle', aAngle, 1], ['aSpeed', aSpeed, 1], ['aSize', aSize, 1], ['aHue', aHue, 1], ['aAxis', aAxis, 3]]) pGeo.setAttribute(k, new THREE.BufferAttribute(v, s));
  const pMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uPhase: { value: 0 }, uTime: { value: 0 }, uLevel: { value: 0 }, uListen: { value: 0 }, uPixel: { value: renderer.getPixelRatio() },
      uHot: { value: new THREE.Color('#ffe0a8') }, uMid: { value: new THREE.Color('#ff8f21') }, uDeep: { value: new THREE.Color('#ff3d14') } },
    vertexShader: /* glsl */`
      uniform float uPhase, uTime, uLevel, uPixel;
      attribute float aRadius, aAngle, aSpeed, aSize, aHue; attribute vec3 aAxis;
      varying float vHue, vAlpha;
      void main() {
        vec3 k = aAxis;
        vec3 t = normalize(abs(k.y) < 0.98 ? cross(k, vec3(0.0, 1.0, 0.0)) : cross(k, vec3(1.0, 0.0, 0.0)));
        vec3 b = cross(k, t);
        float a = aAngle + uPhase * aSpeed;
        float r = aRadius * (1.0 + uLevel * 0.24 * sin(a * 5.0 + uTime * 3.0));
        vec3 p = (t * cos(a) + b * sin(a)) * r;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixel * (1.0 + uLevel * 0.9) * (11.0 / -mv.z);
        vHue = aHue;
        vAlpha = 0.5 + 0.5 * smoothstep(2.8, 0.2, aRadius);
      }`,
    fragmentShader: /* glsl */`
      uniform float uListen, uLevel; uniform vec3 uHot, uMid, uDeep;
      varying float vHue, vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float f = smoothstep(0.5, 0.0, d); f *= f;
        vec3 hot = uHot, amber = uMid, red = uDeep;
        vec3 col = vHue < 0.45 ? mix(hot, amber, vHue / 0.45) : mix(amber, red, (vHue - 0.45) / 0.55);
        vec3 blue = mix(vec3(0.85, 0.95, 1.0), vec3(0.3, 0.7, 1.0), vHue);
        col = mix(col, blue, uListen);
        gl_FragColor = vec4(col * f * vAlpha * (0.62 + uLevel * 0.8), f * vAlpha);
      }`,
  });
  const reactor = new THREE.Points(pGeo, pMat);
  reactor.frustumCulled = false;
  scene.add(reactor);

  // core: bright sphere + big soft glow
  const coreMat = new THREE.MeshBasicMaterial({ color: HOT.clone() });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 48, 32), coreMat);
  scene.add(core);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: AMBER.clone(), ...additive, opacity: 0.55 }));
  coreGlow.scale.setScalar(2.2); scene.add(coreGlow);

  // gyroscope rings around the core
  const gyro = [1.55, 1.95, 2.35].map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008 + i * 0.002, 8, 240), new THREE.MeshBasicMaterial({ color: AMBER.clone(), ...additive, opacity: 0.55 }));
    m.rotation.set(rand() * TAU, rand() * TAU, 0); scene.add(m); return m;
  });

  // group the reactor so scenes can shrink it away (e.g. Neural Brain replaces it)
  const reactorGroup = new THREE.Group(); scene.add(reactorGroup);
  reactorGroup.add(reactor, core, coreGlow, ...gyro);

  // horizontal HUD rings with rotating ticks
  const hudGroup = new THREE.Group(); scene.add(hudGroup);
  const ringLine = (r, op, color = AMBER) => {
    const pts = []; for (let i = 0; i <= 256; i++) { const a = i / 256 * TAU; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, ...additive, opacity: op }));
  };
  hudGroup.add(ringLine(3.0, 0.35));
  const ticks = []; for (let i = 0; i < 120; i++) { const a = i / 120 * TAU, l = i % 10 === 0 ? 0.22 : 0.09; ticks.push(new THREE.Vector3(Math.cos(a) * 3.1, 0, Math.sin(a) * 3.1), new THREE.Vector3(Math.cos(a) * (3.1 + l), 0, Math.sin(a) * (3.1 + l))); }
  const tickLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: AMBER, ...additive, opacity: 0.5 }));
  hudGroup.add(tickLines);
  const arcs = new THREE.Group(); hudGroup.add(arcs);
  [[0, 0.7], [1.2, 0.45], [2.4, 1.2], [4.2, 0.3], [5.0, 0.8]].forEach(([a0, len], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.022, 6, 64, len), new THREE.MeshBasicMaterial({ color: i % 2 ? RED : AMBER, ...additive, opacity: 0.7 }));
    m.rotation.x = Math.PI / 2; m.rotation.z = a0; arcs.add(m);
  });

  // ---------------------------------------------------------------- wave-field floor
  const FY = -2.1, rings = mobile ? 34 : 52, per = mobile ? 90 : 140;
  const fPos = new Float32Array(rings * per * 3);
  let fi = 0;
  for (let i = 0; i < rings; i++) for (let j = 0; j < per; j++) {
    const r = 2.4 + i * 0.19, a = j / per * TAU + i * 0.07;
    fPos[fi++] = Math.cos(a) * r; fPos[fi++] = FY; fPos[fi++] = Math.sin(a) * r;
  }
  const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  const fMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uVis: { value: 1 }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      uniform float uTime, uLevel, uPixel; varying float vA;
      void main() {
        vec3 p = position; float d = length(p.xz);
        float fall = smoothstep(13.0, 2.5, d);
        p.y += sin(d * 1.5 - uTime * 1.7) * 0.14 * (1.0 + uLevel * 3.0) * fall + sin(p.x * 0.7 + uTime) * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * 2.2 * (9.0 / -mv.z) * (1.0 + uLevel);
        vA = fall * (0.35 + 0.65 * smoothstep(-0.14, 0.2, p.y - ${FY.toFixed(2)}));
      }`,
    fragmentShader: /* glsl */`
      uniform float uVis; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = vA * uVis; gl_FragColor = vec4(vec3(0.31, 0.72, 1.0) * a, a); }`,
  });
  const floor = new THREE.Points(fGeo, fMat); floor.frustumCulled = false; scene.add(floor);
  const floorRing = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.03, 8, 200), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a2a'), ...additive, opacity: 0.9 }));
  floorRing.rotation.x = Math.PI / 2; floorRing.position.y = FY; scene.add(floorRing);

  // distant dust
  const dust = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(40 + rand() * 50); dust.set([v.x, v.y, v.z], i * 3); }
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  // (close dust replaced by the sky module's star layers)

  // holographic tech layer: gear-ring machine, drones, radar
  const holo = createHolo(scene, glow, { mobile });
  const scenes = createScenes(scene, { glow, mobile, reduce, pixelRatio: renderer.getPixelRatio() });
  let reactorVis = 1, floorVis = 1, hudVis = 1, firstFrame = true;
  const orbitAngle = {};
  const blackhole = createBlackHole(scene, renderer, camera, { mobile, reduce });
  // Play mode: throw light, gas, stars and planets into the hole
  const play = createPlay(blackhole.frame, { mobile, onFeed: m => blackhole.addFeed(m), onEvent: e => hud.fx && hud.fx(e === 'disrupt' ? 'route' : 'tick') });
  const playPlane = new THREE.Plane(), playHit = new THREE.Vector3();
  function playAt(type, cx, cy) {
    // where the click lands on the plane through the hole that faces the camera
    mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    playPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3());
    if (!ray.ray.intersectPlane(playPlane, playHit)) return;
    const local = blackhole.frame.worldToLocal(playHit.clone());
    const view = blackhole.frame.worldToLocal(camera.position.clone()).negate().normalize();
    play.spawn(type, local, view);
  }
  const sun = createSun(scene, glow, { mobile });
  const cores = createCores(scene, glow, { mobile });
  const hudMats = []; hudGroup.traverse(o => { if (o.material) { o.material.userData.base = o.material.opacity; hudMats.push(o.material); } });

  // ---- plasma lightning for live connections
  const plasmaCol = new THREE.Color(THEMES.amber.plasma), routeCol = new THREE.Color(THEMES.amber.route);
  const BOLT_N = 33, BR_N = 9;
  const lineMats = [];
  const mkLine = (n, width, kind) => {
    const g = new LineGeometry(); const arr = new Float32Array(n * 3); g.setPositions(arr);
    const m = new LineMaterial({ color: plasmaCol.getHex(), linewidth: width, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    m.resolution.set(innerWidth, innerHeight); lineMats.push(m);
    const l = new Line2(g, m); l.frustumCulled = false; l.visible = false; l.userData = { n, arr, kind }; scene.add(l); return l;
  };
  const pools = { main: Array.from({ length: 10 }, () => mkLine(BOLT_N, mobile ? 2.4 : 3.2, 'main')),
                  sub: Array.from({ length: 10 }, () => mkLine(BOLT_N, 1.5, 'sub')),
                  branch: Array.from({ length: 24 }, () => mkLine(BR_N, 1.2, 'branch')) };
  const boltPool = [...pools.main, ...pools.sub], branchPool = pools.branch;
  const releaseBolt = l => { l.visible = false; pools[l.userData.kind].push(l); };
  addEventListener('resize', () => lineMats.forEach(m => m.resolution.set(innerWidth, innerHeight)));
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3(), _r = new THREE.Vector3();
  function fillBolt(line, a, b, jitter) {
    const arr = line.userData.arr, n = line.userData.n;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[(n - 1) * 3] = b.x; arr[(n - 1) * 3 + 1] = b.y; arr[(n - 1) * 3 + 2] = b.z;
    for (let step = (n - 1) / 2; step >= 1; step /= 2) {
      for (let i = step; i < n; i += step * 2) {
        const i0 = (i - step) * 3, i1 = (i + step) * 3;
        _a.set(arr[i0], arr[i0 + 1], arr[i0 + 2]); _b.set(arr[i1], arr[i1 + 1], arr[i1 + 2]);
        _m.addVectors(_a, _b).multiplyScalar(0.5);
        _r.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(_a.distanceTo(_b) * jitter);
        _m.add(_r); arr[i * 3] = _m.x; arr[i * 3 + 1] = _m.y; arr[i * 3 + 2] = _m.z;
      }
    }
    line.geometry.setPositions(arr);
  }
  function boltPoint(line, k) { const arr = line.userData.arr, i = Math.min(line.userData.n - 1, Math.floor(k * (line.userData.n - 1))) * 3; return new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]); }
  // ---- solar flare connection (warm themes): a filament of plasma that rises from the
  // core, arcs out and loops around the active model, as if it captured it
  const WARM = ['amber', 'gold', 'crimson'];
  const flareU = { uTime: { value: 0 }, uGrow: { value: 0 }, uVis: { value: 0 }, uLevel: { value: 0 },
    uHot: { value: new THREE.Color('#ffe2b0') }, uMid: { value: new THREE.Color('#ff8a2a') }, uDeep: { value: new THREE.Color('#8c2108') } };
  const flareMat = (seed, strength) => new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { ...flareU, uSeed: { value: seed }, uStrength: { value: strength } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime, uGrow, uVis, uLevel, uSeed, uStrength; uniform vec3 uHot, uMid, uDeep;
      varying vec2 vUv; varying vec3 vN, vV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
      void main(){
        float u = vUv.x, v = vUv.y;
        if (u > uGrow) discard;
        // fine twisting strands flowing outward along the filament
        float twist = v * 6.2832 + u * 9.0 + uSeed;
        float strands = fbm(vec2(u * 26.0 - uTime * 1.6, sin(twist) * 2.5 + uSeed));
        float fine = fbm(vec2(u * 80.0 - uTime * 3.2, cos(twist * 2.0) * 4.0 + uSeed * 2.0));
        float fil = smoothstep(0.38, 0.95, strands * 0.75 + fine * 0.5);
        float edge = pow(1.0 - abs(dot(normalize(vN), vV)), 1.3);
        float ends = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.9, 1.0, u));
        float head = smoothstep(uGrow - 0.12, uGrow, u) * step(uGrow, 0.995) * 1.8;     // bright growing tip
        vec3 col = mix(uMid, uHot, fil * 0.9 + head * 0.5);
        col = mix(uDeep * 1.5, col, 0.35 + fil);
        float a = (0.08 + fil * 0.95 + head) * (0.35 + edge) * ends * uStrength * uVis * (1.0 + uLevel * 0.8);
        gl_FragColor = vec4(col * a * 1.6, a);
      }`,
  });
  const flareLayers = [{ r: 0.045, seed: 1.3, strength: 1.0, jit: 0 }, { r: 0.085, seed: 4.7, strength: 0.75, jit: 0.12 }, { r: 0.15, seed: 8.1, strength: 0.35, jit: 0.22 }]
    .map(L => ({ ...L, mesh: null, mat: flareMat(L.seed, L.strength) }));
  let flareFor = null, flareForId = null, flareCoreR = 0, flareGrow = 0;
  function buildFlare(n, coreR) {
    for (const L of flareLayers) if (L.mesh) { L.mesh.parent && L.mesh.parent.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh = null; }
    if (!n) return;
    const N = n.pos.clone(), out = N.clone().normalize();
    const S = out.clone().multiplyScalar(coreR * 0.98);
    const dir = N.clone().sub(S); const len = dir.length(); dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (const L of flareLayers) {
      const j = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(L.jit);
      const pts = [S.clone(), S.clone().addScaledVector(out, len * 0.15).addScaledVector(up, len * 0.18).add(j()),
        S.clone().lerp(N, 0.45).addScaledVector(up, len * 0.42).add(j()),
        S.clone().lerp(N, 0.8).addScaledVector(up, len * 0.3).add(j())];
      // loop around the model: the "capture"
      const R = 0.42;
      for (let k = 0; k <= 7; k++) {
        const a = Math.PI * 0.75 - k / 7 * Math.PI * 2.1;
        pts.push(N.clone().addScaledVector(up, Math.sin(a) * R).addScaledVector(side, Math.cos(a) * R * 0.9).addScaledVector(dir, Math.cos(a) * R * 0.35).add(j().multiplyScalar(0.5)));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      L.mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, L.r, 10, false), L.mat);
      L.mesh.frustumCulled = false; n.group.add(L.mesh);
    }
  }

  let themeName = '';
  function applyTheme(name) {
    const th = THEMES[name] || THEMES.amber; themeName = name;
    pMat.uniforms.uHot.value.set(th.hot); pMat.uniforms.uMid.value.set(th.mid).lerp(new THREE.Color(th.hot), 0.1); pMat.uniforms.uDeep.value.set(th.route);
    blackhole.setTheme(th); sun.setTheme(th); holo.setTheme(th); cores.setTheme(th);
    flareU.uHot.value.set(th.hot); flareU.uMid.value.set(th.mid); flareU.uDeep.value.set(th.deep);
    plasmaCol.set(th.plasma); routeCol.set(th.route);
    for (const m of lineMats) m.color.copy(plasmaCol);
    AMBER.set(th.mid); HOT.set(th.hot); RED.set(th.route);
    floorRing.material.color.set(th.mid);
    hudMats.forEach((m, i) => m.color && m.color.set(i % 3 === 2 ? th.route : th.mid));
  }

  // ---------------------------------------------------------------- model nodes + routes
  const nodeGroup = new THREE.Group(); scene.add(nodeGroup);
  let nodes = [], version = -1;
  const hitTargets = [];
  const pulseMat = new THREE.SpriteMaterial({ map: glow, color: new THREE.Color('#ffd0a0'), ...additive });
  const pulses = Array.from({ length: 60 }, () => { const s = new THREE.Sprite(pulseMat); s.scale.setScalar(0.22); s.visible = false; scene.add(s); return s; });

  function disposeNodes() {
    if (typeof buildFlare === 'function' && flareFor) { buildFlare(null); flareFor = null; }
    for (const n of nodes) {
      if (n.bolts) { n.bolts.forEach(releaseBolt); n.bolts = null; }
      n.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== pulseMat) o.material.dispose(); });
      if (n.label.element.parentNode) n.label.element.parentNode.removeChild(n.label.element);
      if (n.orbitLine) { nodeGroup.remove(n.orbitLine); n.orbitLine.geometry.dispose(); n.orbitLine.material.dispose(); }
      nodeGroup.remove(n.group);
    }
    nodes = []; hitTargets.length = 0;
  }

  function buildNodes() {
    disposeNodes();
    const list = hud.models().filter(m => m.installed || m.id === hud.getFrame().active);
    const n = list.length, R0 = mobile ? 2.7 : 3.55, dR = mobile ? 0.32 : 0.48;
    list.forEach((m, i) => {
      const a = i / n * TAU + 0.35;
      const R = R0 + (i % 4) * dR;                                       // different orbits = different speeds
      const pos = new THREE.Vector3(Math.cos(a) * R, 0.55 + Math.sin(i * 1.9) * (mobile ? 2.0 : 1.1), Math.sin(a) * R);
      const g = new THREE.Group(); nodeGroup.add(g);
      const st = m.status ? m.status.state : 'ready';
      const col = st === 'error' ? RED : st === 'missing' ? GREY : BLUE;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4) }));
      orb.position.copy(pos); g.add(orb);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col.clone(), ...additive, opacity: 0.85 }));
      halo.scale.setScalar(0.75); halo.position.copy(pos); g.add(halo);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.014, 6, 64, TAU * 0.8), new THREE.MeshBasicMaterial({ color: AMBER, ...additive, opacity: 0.95 }));
      ring.position.copy(pos); ring.visible = false; g.add(ring);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(pos); hit.userData.id = m.id; g.add(hit); hitTargets.push(hit);

      // jagged red route from the reactor to the node, plus side branches
      const r = rng(hash(m.id));
      const dir = pos.clone().normalize(), startP = dir.clone().multiplyScalar(0.75);
      const side1 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const side2 = new THREE.Vector3().crossVectors(dir, side1).normalize();
      const pts = [startP];
      const segs = 9;
      for (let s = 1; s < segs; s++) {
        const f = s / segs, amp = 0.55 * Math.sin(f * Math.PI);
        pts.push(startP.clone().lerp(pos, f).addScaledVector(side1, (r() - 0.5) * amp).addScaledVector(side2, (r() - 0.5) * amp * 0.7));
      }
      pts.push(pos.clone());
      const routeMat = new THREE.LineBasicMaterial({ color: RED.clone(), ...additive, opacity: 0.28 });
      const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), routeMat); g.add(route);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.016, 5, false), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a3a'), ...additive, opacity: 0.9 }));
      tube.visible = false; g.add(tube);
      const branchMat = new THREE.LineBasicMaterial({ color: RED.clone(), ...additive, opacity: 0.12 });
      for (let b = 0; b < 3; b++) {
        let p = pts[1 + Math.floor(r() * (segs - 2))].clone();
        const bp = [p.clone()], sgn = r() < 0.5 ? 1 : -1;
        for (let s = 0; s < 3; s++) { p = p.clone().addScaledVector(dir, 0.18 + r() * 0.15).addScaledVector(side1, sgn * (0.25 + r() * 0.2)).addScaledVector(side2, (r() - 0.5) * 0.3); bp.push(p); }
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bp), branchMat));
      }

      // label (HTML, crisp text)
      const el = document.createElement('div');
      el.className = 'node-label ' + st;
      el.innerHTML = '<span class="seat">◆</span><span class="name"></span><span class="meta"></span>';
      el.querySelector('.name').textContent = m.label;
      el.querySelector('.meta').textContent = st === 'ok' && m.status.ms ? `${m.group} · ${(m.status.ms / 1000).toFixed(1)}s` : st === 'error' ? `${m.group} · error` : st === 'missing' ? 'not downloaded' : m.group;
      el.addEventListener('click', () => hud.onNodeClick(m.id));
      el.addEventListener('mouseenter', () => { hoverId = m.id; hud.fx && hud.fx('tick'); });
      el.addEventListener('mouseleave', () => { if (hoverId === m.id) hoverId = null; });
      const label = new CSS2DObject(el); label.position.copy(pos).add(new THREE.Vector3(0, -0.42, 0)); g.add(label);

      // faint orbit path at this model's distance and height
      const op = []; for (let k = 0; k <= 160; k++) { const aa = k / 160 * TAU; op.push(new THREE.Vector3(Math.cos(aa) * R, pos.y, Math.sin(aa) * R)); }
      const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(op), new THREE.LineBasicMaterial({ color: BLUE, ...additive, opacity: 0.09 }));
      nodeGroup.add(orbitLine);
      nodes.push({ id: m.id, pos, R, group: g, orb, halo, ring, route, routeMat, tube, curve, label, el, orbitLine, phase: r() * TAU, w: 0.9 / Math.pow(R, 1.5) });
    });
  }
  const nodeById = id => nodes.find(n => n.id === id);

  // ---------------------------------------------------------------- council beams
  const beamObjs = new Map();
  function beamCurve(from, to) {
    const A = from.clone(), B = to.clone();
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const ctrl = mid.multiplyScalar(0.35).add(new THREE.Vector3(0, 2.2, 0));
    return new THREE.QuadraticBezierCurve3(A, ctrl, B);
  }
  const beamShader = {
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ vec3 c = mix(vec3(0.31,0.72,1.0), vec3(1.0,0.29,0.2), vUv.x); gl_FragColor = vec4(c * uA * 1.6, uA); }',
  };

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hoverId = null, downXY = null;
  function pick(e) {
    mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(hitTargets, false)[0];
    return hit ? hit.object.userData.id : null;
  }
  renderer.domElement.addEventListener('pointermove', e => {
    const id = pick(e);
    if (id !== hoverId && id && hud.fx) hud.fx('tick');
    if (held) return;
    if (!id && scenes.vis.blackhole > 0.5) { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
      if (ray.intersectObjects(grabTargets(), true).length) { renderer.domElement.style.cursor = 'grab'; renderer.domElement.title = 'Drag me into the black hole'; return; } }
    renderer.domElement.title = '';
    hoverId = id; renderer.domElement.style.cursor = id ? 'pointer' : (hud.getFrame().playTool && scenes.vis.blackhole > 0.5 ? 'crosshair' : 'grab');
  });
  renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });

  // ---------------------------------------------------------------- grab and throw (black hole mode)
  // Press on an orbiting planet, a drone, or anything you threw, drag it, let go: it flies with your swipe.
  let held = null;
  const grabPlane = new THREE.Plane(), grabHit = new THREE.Vector3();
  function grabTargets() { return scenes.vis.blackhole > 0.5 ? [...blackhole.grabbables(), ...holo.grabbables(), ...play.bodyObjects()] : []; }
  function grabPoint(e) {
    mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
    return ray.ray.intersectPlane(grabPlane, grabHit) ? play.toLocal(grabHit) : null;
  }
  addEventListener('pointerdown', e => {
    if (e.target !== renderer.domElement || e.button !== 0) return;
    const targets = grabTargets(); if (!targets.length) return;
    mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
    ray.params.Line.threshold = 0.15;
    const hit = ray.intersectObjects(targets, true)[0]; if (!hit) return;
    let top = hit.object; while (top && !targets.includes(top)) top = top.parent; if (!top) return;
    let body = play.bodyFor(top);
    if (!body && blackhole.take(top)) body = play.adopt(top, 'planet', { tidal: 3.8, debris: top.geometry?.parameters?.radius > 0.4 ? 1200 : 600, onGone: m => blackhole.giveBack(m) });
    else if (!body && holo.take(top)) body = play.adopt(top, 'drone', { tidal: 3.2, debris: 350, onGone: g => holo.giveBack(g) });
    if (!body) return;
    controls.enabled = false;
    grabPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), top.getWorldPosition(new THREE.Vector3()));
    held = { body, hist: [] }; renderer.domElement.style.cursor = 'grabbing'; hud.fx && hud.fx('tick');
    renderer.domElement.setPointerCapture(e.pointerId);
  }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (!held) return;
    const p = grabPoint(e); if (!p) return;
    play.hold(held.body, p);
    const now = performance.now(); held.hist.push({ p: p.clone(), t: now });
    while (held.hist.length > 2 && now - held.hist[0].t > 120) held.hist.shift();
  });
  function letGo() {
    if (!held) return;
    const h = held.hist, now = performance.now(), v = new THREE.Vector3();
    if (h.length > 1 && now - h[h.length - 1].t < 80) {
      const a = h[0], b = h[h.length - 1];
      v.subVectors(b.p, a.p).divideScalar(Math.max(0.016, (b.t - a.t) / 1000) * 16);     // swipe speed -> simulation speed
    }
    play.release(held.body, v); followBody = held.body; held = null;
    controls.enabled = true; downXY = null; renderer.domElement.style.cursor = 'grab';
  }
  renderer.domElement.addEventListener('pointerup', letGo);
  renderer.domElement.addEventListener('pointercancel', letGo);

  // ---------------------------------------------------------------- camera views for the black hole
  let camMode = 'free', camGoal = 0, camMoving = false, followBody = null;
  const homeTarget = new THREE.Vector3(0, 0.2, 0), lastTarget = new THREE.Vector3(0, 0.2, 0), goalTarget = new THREE.Vector3();
  function setView(m) {
    camMode = m; camMoving = true; lastTouch = performance.now();
    camGoal = m === 'wide' ? 13 : m === 'close' ? 4.0 : 3.0;
    controls.autoRotate = m === 'wide';
    if (m === 'follow') followBody = play.lastBody();
  }
  renderer.domElement.addEventListener('pointerup', e => {
    if (held || !downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6) return;
    const id = pick(e); if (id) { hud.onNodeClick(id); return; }
    const tool = hud.getFrame().playTool;
    if (tool && scenes.vis.blackhole > 0.5) playAt(tool, e.clientX, e.clientY);
  });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let phase = 0, listen = 0, t = 0, statT = 0;
  function tick() {
    const dt = Math.min(0.05, clock.getDelta()); t += dt;
    const f = hud.getFrame();
    if (f.version !== version) { version = f.version; buildNodes(); }
    const speed = ({ idle: 1, listening: 0.55, thinking: 2.8, speaking: 1.6 })[f.uiState] || 1;
    phase += dt * speed * (reduce ? 0.4 : 1);
    listen += ((f.uiState === 'listening' ? 1 : 0) - listen) * 0.08;
    const L = f.level;

    pMat.uniforms.uPhase.value = phase; pMat.uniforms.uTime.value = t; pMat.uniforms.uLevel.value = L; pMat.uniforms.uListen.value = listen;
    fMat.uniforms.uTime.value = t; fMat.uniforms.uLevel.value = L;
    const coreCol = HOT.clone().lerp(new THREE.Color('#cfeaff'), listen);
    coreMat.color.copy(coreCol).multiplyScalar(1.1 + L * 1.4);
    core.scale.setScalar(1 + L * 0.55 + Math.sin(t * 2) * 0.03);
    coreGlow.material.color.copy(AMBER).lerp(BLUE, listen);
    coreGlow.scale.setScalar(2.1 + L * 2.6);
    gyro.forEach((m, i) => { m.rotation.x += dt * (0.12 + i * 0.07) * speed; m.rotation.y += dt * (0.09 - i * 0.05) * speed; m.material.color.copy(AMBER).lerp(BLUE, listen); m.material.opacity = 0.32 + L * 0.45; });
    tickLines.rotation.y = t * 0.06; arcs.rotation.y = -t * 0.12 * speed;
    const sc = scenes.update(dt, t, L, f);
    const kk = firstFrame ? 1 : Math.min(1, dt * 1.6);
    reactorVis += (sc.reactor - reactorVis) * kk;
    floorVis += (sc.floor - floorVis) * kk;
    reactorGroup.visible = reactorVis > 0.01; reactorGroup.scale.setScalar(Math.max(0.001, reactorVis));
    fMat.uniforms.uVis.value = floorVis; floor.visible = floorVis > 0.01;
    floorRing.material.opacity = (0.65 + L * 0.35) * floorVis; floorRing.visible = floorVis > 0.01;
    if ((f.theme || 'amber') !== themeName) applyTheme(f.theme || 'amber');
    hudVis += ((sc.hud ?? 1) - hudVis) * kk; firstFrame = false;
    hudMats.forEach(m => { m.opacity = m.userData.base * hudVis; }); hudGroup.visible = hudVis > 0.01;
    blackhole.update(dt, t, L, scenes.vis.blackhole);
    sun.update(dt, t, L, scenes.vis.sun);
    cores.update(dt, t, L, scenes.vis, camera);
    const orbitVis = scenes.vis.blackhole + scenes.vis.sun;
    // gravity: every model orbits on its own path, inner ones faster (Kepler), keeping its spin between rebuilds
    const orbitSpeed = 0.35 + 1.0 * orbitVis;
    for (const n of nodes) { orbitAngle[n.id] = (orbitAngle[n.id] || 0) + dt * n.w * orbitSpeed; n.group.rotation.y = orbitAngle[n.id];
      n.orbitLine.material.opacity = (n.id === f.active ? 0.28 : 0.08) * (0.4 + 0.6 * orbitVis); n.orbitLine.material.color.copy(n.id === f.active ? AMBER : BLUE); }
    play.update(dt, scenes.vis.blackhole, renderer.getPixelRatio());
    sky.setGain(1 - 0.62 * scenes.vis.blackhole);               // space around a black hole is darker
    sky.update(dt, t, camera, renderer.getPixelRatio());
    const bhOn = scenes.vis.blackhole > 0.5;
    if (bhOn !== document.body.classList.contains('bh-mode')) document.body.classList.toggle('bh-mode', bhOn);
    if ((statT -= dt) <= 0) { statT = 0.3; const bs = blackhole.stats(), ps = play.stats(); hud.playStats && hud.playStats({ mass: bs.mass, feed: bs.feed, particles: ps.particles, fed: ps.fed }); }
    const coreR = 0.75 * reactorVis + 2.7 * BASE_SCALE * blackhole.stats().mass * scenes.vis.blackhole + SUN_R * 1.08 * scenes.vis.sun + 2.0 * scenes.vis.brain + Object.keys(CORE_RADIUS).reduce((s, k) => s + CORE_RADIUS[k] * (scenes.vis[k] || 0), 0);
    bloom.intensity = (0.85 + L * 0.9) * (1 - 0.15 * scenes.vis.blackhole);
    f.floorVis = floorVis;
    holo.update(dt, t, L, f.holo !== false, f, camera.position);

    // nodes + routes
    let pi = 0;
    // fade labels on the far side of the reactor so the near ones stay readable
    for (const n of nodes) n.group.position.y = Math.sin(t * 1.3 + n.phase) * 0.06;
    const warm = WARM.includes(themeName);
    const activeNode = nodes.find(n => n.id === f.active) || null;
    if (warm && activeNode && (flareFor !== activeNode || Math.abs(flareCoreR - coreR) > 0.15)) {
      if (flareForId !== activeNode.id) flareGrow = 0;
      flareFor = activeNode; flareForId = activeNode.id; flareCoreR = coreR; buildFlare(activeNode, coreR);
    }
    if ((!warm || !activeNode) && flareFor) { buildFlare(null); flareFor = null; flareForId = null; }
    flareGrow = Math.min(1, flareGrow + dt * 0.8);
    flareU.uGrow.value = 1 - Math.pow(1 - flareGrow, 3);
    flareU.uTime.value = t; flareU.uLevel.value = L; flareU.uVis.value = warm ? 1 : 0;
    nodeGroup.updateMatrixWorld(true);
    const wpos = nodes.map(n => n.orb.getWorldPosition(new THREE.Vector3()));
    const ds = wpos.map(w => camera.position.distanceTo(w));
    const dMin = Math.min(...ds), dMax = Math.max(...ds);
    nodes.forEach((n, i) => {
      const k = dMax > dMin ? (ds[i] - dMin) / (dMax - dMin) : 0;
      const keep = n.id === f.active || n.id === f.speakingId || n.id === hoverId;
      n.el.style.opacity = keep ? 1 : (1 - k * 0.72).toFixed(2);
    });
    for (const n of nodes) {
      const active = n.id === f.active, speaking = n.id === f.speakingId, hover = n.id === hoverId;
      const wp = wpos[nodes.indexOf(n)];
      const s = (speaking ? 1.25 + L * 0.8 : active ? 1.2 : 1) * (hover ? 1.3 : 1);
      n.orb.scale.setScalar(s); n.halo.scale.setScalar(0.75 * s * (speaking ? 1.4 : 1));
      n.ring.visible = active; if (active) { n.ring.quaternion.copy(camera.quaternion); n.ring.rotateZ(t * 1.6); }
      n.routeMat.opacity = active || speaking ? 0.12 : 0.24;
      n.routeMat.color.copy(routeCol);
      n.tube.visible = false;
      // plasma lightning from the core to every live connection
      if ((active && !warm) || (speaking && !(warm && active))) {
        n.boltT = (n.boltT || 0) - dt;
        const startP = wp.clone().normalize().multiplyScalar(coreR);
        const lines = n.bolts || (n.bolts = [pools.main.pop(), pools.sub.pop(), pools.branch.pop(), pools.branch.pop(), pools.branch.pop()].filter(Boolean));
        if (n.boltT <= 0) {
          n.boltT = speaking ? 0.035 : 0.09 + Math.random() * 0.12;
          if (lines[0]) fillBolt(lines[0], startP, wp, 0.22);
          if (lines[1]) fillBolt(lines[1], startP, wp, 0.32);
          for (let bi = 2; bi < lines.length; bi++) {
            const from = boltPoint(lines[0], 0.2 + Math.random() * 0.6);
            const to = from.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9 + L));
            fillBolt(lines[bi], from, to, 0.35);
          }
        }
        const flick = speaking ? 0.75 + Math.random() * 0.25 : 0.45 + Math.random() * 0.4;
        lines.forEach((l, li) => { l.visible = true; l.material.opacity = flick * (li === 0 ? 1 : li === 1 ? 0.55 : 0.4) * (speaking ? 1 : 0.8); });
      } else if (n.bolts) {
        n.bolts.forEach(releaseBolt); n.bolts = null;
      }
      n.el.classList.toggle('active', active); n.el.classList.toggle('speaking', speaking); n.el.classList.toggle('hover', hover);
      n.el.classList.toggle('seat-on', f.council.includes(n.id)); n.el.classList.toggle('council', f.councilMode);
      if ((active || speaking) && pi < pulses.length) {
        const count = speaking ? 6 : 2, sp = speaking ? 0.9 : 0.22;
        for (let k = 0; k < count && pi < pulses.length; k++) {
          let u = (t * sp + k / count) % 1; if (speaking && f.flowDir < 0) u = 1 - u;
          const p = pulses[pi++]; p.visible = true;
          p.position.copy(n.curve.getPointAt(u)).applyMatrix4(n.group.matrixWorld);
          p.scale.setScalar(speaking ? 0.3 : 0.2);
        }
      }
    }

    // council beams (from hud.js beam list)
    const live = new Set();
    for (const b of f.beams) {
      const A = nodeById(b.from), B = b.to === 'core' ? { pos: new THREE.Vector3() } : nodeById(b.to);
      if (!A || !B) continue;
      const key = b.from + '>' + b.to; live.add(key);
      let o = beamObjs.get(key);
      if (!o) {
        const geo = new LineGeometry(); const mat = new LineMaterial({ vertexColors: true, linewidth: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        mat.resolution.set(innerWidth, innerHeight); lineMats.push(mat);
        const mesh = new Line2(geo, mat); mesh.frustumCulled = false; scene.add(mesh); o = { mesh, mat }; beamObjs.set(key, o);
      }
      const Aw = A.orb.getWorldPosition(new THREE.Vector3()), Bw = B.orb ? B.orb.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      const curve = beamCurve(Aw, Bw), P = [], C = [];
      for (let k = 0; k <= 32; k++) { const q = curve.getPoint(k / 32); P.push(q.x, q.y, q.z); const c = BLUE.clone().lerp(RED, k / 32); C.push(c.r, c.g, c.b); }
      o.mesh.geometry.setPositions(P); o.mesh.geometry.setColors(C);
      const a = Math.min(1, b.life / 0.6); o.mat.opacity = a;
      for (let k = 0; k < 3 && pi < pulses.length; k++) {
        const p = pulses[pi++]; p.visible = true; p.position.copy(curve.getPoint((t * 0.8 + k / 3) % 1)); p.scale.setScalar(0.26 * a);
      }
    }
    for (const [key, o] of beamObjs) if (!live.has(key)) { scene.remove(o.mesh); o.mesh.geometry.dispose(); lineMats.splice(lineMats.indexOf(o.mat), 1); o.mat.dispose(); beamObjs.delete(key); }
    for (; pi < pulses.length; pi++) pulses[pi].visible = false;

    // black hole views: get closer, or ride along with the last thing you threw
    controls.minDistance = scenes.vis.blackhole > 0.5 ? 2.2 : 6;
    if (scenes.vis.blackhole < 0.5 && camMode !== 'free') { camMode = 'free'; camMoving = false; }
    let tgt = homeTarget;
    if (camMode === 'follow') { if (!followBody || !followBody.obj.parent) followBody = play.lastBody(); if (followBody) tgt = followBody.obj.getWorldPosition(goalTarget); }
    else if (camMode === 'close') tgt = goalTarget.set(0, 0, 0);
    if (camMode !== 'free' || controls.target.distanceToSquared(homeTarget) > 1e-4) {
      lastTarget.copy(controls.target);
      controls.target.lerp(tgt, camMode === 'follow' ? 0.12 : 0.06);
      if (camMode === 'follow') camera.position.add(goalTarget.subVectors(controls.target, lastTarget));   // move with it
    }
    if (camMoving) {
      const off = camera.position.clone().sub(controls.target), d = off.length(), nd = d + (camGoal - d) * 0.06;
      camera.position.copy(controls.target).add(off.setLength(nd)); if (Math.abs(nd - camGoal) < 0.05) camMoving = false;
    }
    if (camMode === 'follow' || camMode === 'close') lastTouch = performance.now();
    if (!controls.autoRotate && !reduce && performance.now() - lastTouch > 6000) controls.autoRotate = true;
    controls.autoRotateSpeed = f.uiState === 'thinking' ? 1.2 : 0.35;
    controls.update();
    composer.render();
    labels.render(scene, camera);
  }

  // the governor's loop: frame cap, idle trickle, hidden-tab stop, dynamic resolution
  let lastFrame = 0, lastInput = performance.now(), running = true, ftAvg = 1000 / gov.fps, prT = 0, roomy = 0;
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  function loop(now) {
    if (document.hidden) { running = false; return; }                  // nothing on screen: use nothing
    requestAnimationFrame(loop);
    const f = hud.getFrame();
    const idle = f.uiState === 'idle' && !f.playOpen && now - lastInput > 20000;
    const cap = idle ? gov.idleFps : gov.fps, budget = 1000 / cap;
    const ft = now - lastFrame;
    if (ft < budget - 1.5) return;                                     // too early: skip this screen refresh
    lastFrame = now;
    if (!idle && ft < 1000) {                                          // late frames -> fewer pixels; headroom -> more
      ftAvg += (ft - ftAvg) * 0.1; prT += ft;
      if (prT > 2000) {
        prT = 0;
        if (ftAvg > budget * 1.35 && pr > gov.minPR) { pr = Math.max(gov.minPR, pr * 0.85); roomy = 0; }
        else if (ftAvg < budget * 1.1 && pr < gov.maxPR && ++roomy >= 3) { pr = Math.min(gov.maxPR, pr * 1.1); roomy = 0; }
        else return tick();
        renderer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
      }
    }
    tick();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !running) { running = true; lastFrame = 0; requestAnimationFrame(loop); } });

  document.body.classList.add('gl');
  window.JarvisScene = { ready: true, renderer, scene, camera,
    // voice / button entry: throw something from a random spot around the hole
    setView, setDensity: d => blackhole.setDensity(d),
    play: (type) => { if (type === 'clear') { play.clear(); blackhole.reset(); return; }
      const a = Math.random() * Math.PI * 2; playAt(type, innerWidth / 2 + Math.cos(a) * innerWidth * 0.2, innerHeight * 0.46 + Math.sin(a) * innerHeight * 0.16); },
    quality: () => ({ tier, pixelRatio: pr, fps: gov.fps }) };
  requestAnimationFrame(loop);
}

if (webglOK() && !new URLSearchParams(location.search).has('2d')) {
  const go = () => { try { start(); } catch (e) { console.warn('3D scene failed, using 2D:', e); document.body.classList.remove('gl'); } };
  if (window.JarvisHUD) go(); else addEventListener('jarvis-ready', go, { once: true });
}
