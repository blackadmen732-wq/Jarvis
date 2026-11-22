/* Black hole scene: every pixel traces a light ray that bends around the hole
   (Schwarzschild geodesic, simple numeric integration). That bending is what wraps
   the accretion disk over and under the shadow and makes the photon ring.
   Rendered at reduced resolution into its own buffer, then drawn as the background.
   Orbiting planets (lit by the disk) and faint orbit lines sit in the normal 3D scene. */
import * as THREE from 'three';

const BH_FRAG = /* glsl */`
  precision highp float;
  uniform vec2 uRes; uniform float uTime, uLevel, uSteps, uVis, uFeed, uJet, uDensity;
  uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos;
  uniform mat3 uTilt; uniform float uScale; uniform vec3 uHot, uMid, uDeep;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }

  // units: Schwarzschild radius = 1. Matter orbits down to RIN; the disk reaches far out.
  const float RIN = 2.6, ROUT = 15.0, PERIOD = 26.0;

  // gas pattern after "tau" seconds: inner gas orbits faster (Kepler) and slowly drifts inward
  float gas(float ang, float r, float tau) {
    float lr = log(r);
    float a2 = ang - tau * 3.2 * pow(r, -1.5);
    float rr = lr + tau * 0.012;
    float arms = fbm2(vec2(a2 * 1.6 + lr * 3.2, rr * 3.4));            // broad spiral clumps
    float fine = fbm2(vec2(a2 * 7.0 + lr * 9.0, rr * 11.0));           // streaks
    float hair = vnoise(vec2(a2 * 26.0 + arms * 5.0, rr * 40.0));      // fine filaments
    return arms * (0.55 + 0.7 * fine) * (0.8 + 0.4 * hair);
  }

  vec4 disk(vec3 p, vec3 dir) {
    float r = length(p.xz);
    float ang = atan(p.z, p.x);
    // two copies of the pattern cross-fade so the winding never gets infinitely tight
    float ph = fract(uTime / PERIOD), w = abs(ph * 2.0 - 1.0);
    float n = mix(gas(ang, r, ph * PERIOD), gas(ang + 2.1, r * 1.03, fract(ph + 0.5) * PERIOD), w);
    float clumps = 0.16 + 1.45 * pow(n, 1.25);
    float prof = pow(RIN / r, 1.25) * smoothstep(RIN, RIN * 1.12, r);   // bright inner edge, long glowing tail
    float edgeOut = 1.0 - smoothstep(ROUT * 0.45, ROUT, r);
    float x = clamp((r - RIN) / (ROUT * 0.55), 0.0, 1.0);
    vec3 col = x < 0.22 ? mix(uHot, uMid, x / 0.22) : mix(uMid, uDeep, clamp((x - 0.22) / 0.7, 0.0, 1.0));
    col = mix(col, vec3(1.0), 0.35 * uFeed * exp(-(r - RIN) / 2.0));     // fresh matter makes the inner disk white-hot
    // relativistic beaming: the side rushing toward us is brighter
    vec3 vdisk = normalize(vec3(-p.z, 0.0, p.x));
    float beta = clamp(sqrt(0.5 / r), 0.0, 0.6);
    float beam = clamp(pow(1.0 + beta * 1.6 * dot(vdisk, -normalize(dir)), 2.5), 0.15, 3.0);
    float grav = sqrt(clamp(1.0 - 1.0 / r, 0.05, 1.0));
    // a thick disk seen edge-on is brighter (longer path through the gas)
    float graze = clamp(1.0 / max(abs(normalize(dir).y), 0.1), 1.0, 10.0);
    float I = clumps * prof * edgeOut * beam * grav * sqrt(graze) * (0.9 + uLevel * 0.8) * (1.0 + 0.9 * uFeed) * uDensity;
    float a = clamp(1.0 - exp(-I * 1.1), 0.0, 0.96);
    return vec4(col * I, a);
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, 1.0, 1.0); v /= v.w;
    vec3 rdW = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
    vec3 pos = uTilt * (uCamPos / uScale);
    vec3 vel = uTilt * rdW;
    vec3 cr = cross(pos, vel); float h2 = dot(cr, cr);
    vec3 col = vec3(0.0); float alpha = 0.0; bool captured = false; float rmin = 1e9;
    vec3 jetC = mix(vec3(0.5, 0.68, 1.0), uHot, 0.2);
    for (int i = 0; i < 400; i++) {
      if (float(i) >= uSteps) break;
      float r = length(pos); rmin = min(rmin, r);
      float dt = clamp(0.06 * r, 0.02, 1.2);
      vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);           // light bending (Schwarzschild)
      vec3 nvel = vel + acc * dt;
      vec3 npos = pos + nvel * dt;
      if (pos.y * npos.y < 0.0) {
        vec3 hit = mix(pos, npos, pos.y / (pos.y - npos.y));
        float hr = length(hit.xz);
        if (hr > RIN && hr < ROUT) { vec4 d = disk(hit, nvel); col += (1.0 - alpha) * d.rgb; alpha += (1.0 - alpha) * d.a; }
      }
      // glowing gas above and below the disk (makes it thick and soft, not a sharp blade) + polar jets
      float rc = length(pos.xz), ay = abs(pos.y);
      float H = 0.11 * rc + 0.12;
      if (r < 34.0 && (ay < 3.0 * H * sqrt(uDensity) || rc < 0.6 + 0.3 * ay)) {
        float env = uDensity * exp(-pos.y * pos.y / (H * H * uDensity)) * smoothstep(RIN * 0.9, RIN * 1.7, rc) * exp(-rc / (ROUT * 0.3));
        float jw = 0.2 + 0.09 * ay;
        float jet = exp(-rc * rc / (jw * jw)) * smoothstep(1.2, 3.5, ay) * exp(-ay / 15.0) * uJet;
        if (env + jet > 0.002) {
          float nz = vnoise(vec2(atan(pos.z, pos.x) * 2.5 + uTime * 0.6 / (rc + 1.0), rc * 1.3 + ay * 2.0));
          float nj = vnoise(vec2(ay * 1.4 - uTime * 5.0, rc * 6.0));
          vec3 envC = mix(mix(uDeep, uMid, exp(-rc / 7.0)), uHot, exp(-rc / 3.0) * 0.5);
          vec3 e = (envC * env * 0.045 * (1.0 + 1.2 * uFeed) * (0.35 + nz) + jetC * jet * 0.16 * (0.5 + nj)) * dt;
          col += (1.0 - alpha) * e; alpha += (1.0 - alpha) * clamp(dot(e, vec3(0.3)), 0.0, 0.5);
        }
      }
      pos = npos; vel = nvel;
      if (length(pos) < 1.0) { captured = true; break; }
      if (alpha > 0.985) break;
      if (r > 45.0 && dot(pos, vel) > 0.0) break;
    }
    // the sky is drawn separately (unbent, as Mark asked): here only the hole, the matter and the rings
    if (captured) alpha = 1.0;
    // photon rings: light that skimmed the photon sphere (r = 1.5) on its way to us
    float ring = captured ? 0.0 : exp(-pow((rmin - 1.53) / 0.03, 2.0)) + 0.35 * exp(-pow((rmin - 1.6) / 0.12, 2.0));
    float halo = captured ? 0.0 : 0.12 * exp(-(rmin - 1.5) / 0.9);
    col += uHot * (ring * (1.2 + uLevel + uFeed) + halo);
    alpha = clamp(alpha + ring * 0.6 + halo * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col * uVis, alpha * uVis);
  }`;

// world units per Schwarzschild radius (shadow radius on screen is about 2.6x this)
export const BASE_SCALE = 0.36;

export function createBlackHole(scene, renderer, camera, { mobile = false, reduce = false } = {}) {
  const baseRes = mobile ? 0.45 : reduce ? 0.45 : 0.8;
  let res = baseRes, frameAvg = 0.016, qualityT = 0;
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const bhScene = new THREE.Scene();
  const bhCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tilt = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.22, 0, -0.32)).invert());
  const bhMat = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uLevel: { value: 0 }, uSteps: { value: mobile || reduce ? 140 : 240 }, uVis: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uTilt: { value: tilt }, uScale: { value: BASE_SCALE }, uFeed: { value: 0 }, uJet: { value: 0.12 }, uDensity: { value: 1 },
      uHot: { value: new THREE.Color('#ffebc7') }, uMid: { value: new THREE.Color('#ff8f29') }, uDeep: { value: new THREE.Color('#8c2108') },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BH_FRAG, depthTest: false, depthWrite: false,
  });
  bhScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhMat));

  // background quad in the main scene that shows the black hole buffer
  // The shadow (and the dense disk) also write depth, so planets, lines and play objects behind the hole disappear behind it.
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: target.texture }, uDepth: { value: 1 } }, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,   // premultiplied: sky shows through
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: 'uniform sampler2D uTex; uniform float uDepth; varying vec2 vUv; void main(){ vec4 c = texture2D(uTex, vUv); gl_FragColor = c; gl_FragDepth = c.a > 0.9 ? uDepth : 1.0; }',
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false; bg.renderOrder = -1000; scene.add(bg);

  // ---- planets orbiting in the disk's plane, lit by the disk
  const orbitFrame = new THREE.Group(); scene.add(orbitFrame);
  orbitFrame.rotation.set(0.22, 0, -0.32);
  const planetMat = (c1, c2, bands) => new THREE.ShaderMaterial({
    uniforms: { uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uBands: { value: bands }, uVis: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    vertexShader: 'varying vec3 vN, vW, vP; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }',
    fragmentShader: `uniform vec3 uC1, uC2; uniform float uBands, uVis, uTime; varying vec3 vN, vW, vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 L = normalize(-vW);                                  // light comes from the disk at the centre
        float lit = max(dot(normalize(vN), L), 0.0);
        vec3 p = normalize(vP);
        float pat = uBands > 0.5 ? 0.5 + 0.5 * sin(p.y * 22.0 + n3(p * 6.0) * 3.0) : n3(p * 5.0) * 0.6 + n3(p * 17.0) * 0.4;
        vec3 base = mix(uC1, uC2, pat);
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0) * lit;
        vec3 col = base * (0.02 + lit * vec3(1.6, 1.15, 0.75)) + vec3(1.0, 0.6, 0.25) * rim * 0.6;
        gl_FragColor = vec4(col * uVis, uVis); }`,
  });
  const bodies = [
    { r: 0.28, orbit: 6.4, speed: 0.10, phase: 0.6, tilt: 0.12, mat: planetMat('#3a3530', '#8a7a68', 0) },
    { r: 0.6, orbit: 7.8, speed: 0.07, phase: 2.4, tilt: -0.18, mat: planetMat('#a8693a', '#f0d2a0', 1), ring: true },
    { r: 0.22, orbit: 9.2, speed: 0.05, phase: 4.2, tilt: 0.3, mat: planetMat('#7d8ea8', '#d8e4f0', 0) },
  ].map(b => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(b.r, 48, 32), b.mat); orbitFrame.add(m);
    if (b.ring) {
      const ringMat = new THREE.ShaderMaterial({
        uniforms: { uVis: { value: 0 } }, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uVis; varying vec2 vUv; void main(){ float b = 0.5 + 0.5 * sin(vUv.x * 80.0); float a = (0.25 + 0.35 * b) * uVis; gl_FragColor = vec4(vec3(0.95, 0.72, 0.45) * a, a); }',
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(b.r * 1.4, b.r * 2.3, 96, 1), ringMat);
      // RingGeometry uv.x runs around; remap so bands go outward
      const uv = ring.geometry.attributes.uv, pos = ring.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setX(i, (Math.hypot(x, y) - b.r * 1.4) / (b.r * 0.9)); }
      ring.rotation.x = Math.PI / 2 + 0.35; m.add(ring); b.ringMat = ringMat;
    }
    // faint orbit line
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(orbitPos(b, a)); }
    const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    orbitFrame.add(orbitLine);
    return { ...b, mesh: m, orbitLine };
  });

  function orbitPos(b, a, out = new THREE.Vector3()) {
    return out.set(Math.cos(a) * b.orbit, Math.sin(a) * b.orbit * Math.sin(b.tilt), Math.sin(a) * b.orbit * Math.cos(b.tilt));
  }

  // ---- play space: objects thrown in live here, in black-hole units (1 = Schwarzschild radius)
  const frame = new THREE.Group(); orbitFrame.add(frame); frame.scale.setScalar(BASE_SCALE);
  let feed = 0, mass = 1;
  function addFeed(m) { feed = Math.min(2.5, feed + m * 0.006); mass = Math.min(1.6, mass + m * 0.00025); }
  function reset() { feed = 0; mass = 1; }
  const centre = new THREE.Vector3();

  const size = new THREE.Vector2();
  function setTheme(th) { bhMat.uniforms.uHot.value.set(th.hot); bhMat.uniforms.uMid.value.set(th.mid); bhMat.uniforms.uDeep.value.set(th.deep); }
  function update(dt, t, L, vis) {
    const on = vis > 0.01;
    bg.visible = on; orbitFrame.visible = on;
    if (!on) return;
    // automatic quality: if frames get slow, render the hole at a lower resolution (and back up when there's headroom)
    frameAvg += (dt - frameAvg) * 0.05; qualityT += dt;
    if (qualityT > 2) {
      qualityT = 0;
      if (frameAvg > 0.04 && res > 0.3) { res = Math.max(0.3, res * 0.8); bhMat.uniforms.uSteps.value = Math.max(110, bhMat.uniforms.uSteps.value * 0.85); }
      else if (frameAvg < 0.02 && res < baseRes) { res = Math.min(baseRes, res * 1.12); bhMat.uniforms.uSteps.value = Math.min(mobile || reduce ? 140 : 240, bhMat.uniforms.uSteps.value * 1.08); }
    }
    renderer.getSize(size);
    const w = Math.max(2, Math.round(size.x * res)), h = Math.max(2, Math.round(size.y * res));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    camera.updateMatrixWorld();
    bhMat.uniforms.uRes.value.set(w, h);
    bhMat.uniforms.uTime.value = t; bhMat.uniforms.uLevel.value = L; bhMat.uniforms.uVis.value = vis;
    bhMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    bhMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    bhMat.uniforms.uCamPos.value.copy(camera.position);
    feed *= Math.exp(-dt / 7);
    const sc = BASE_SCALE * mass; bhMat.uniforms.uScale.value = sc; frame.scale.setScalar(sc);
    bhMat.uniforms.uFeed.value = Math.min(1.5, feed); bhMat.uniforms.uJet.value = 0.12 + Math.min(1.2, feed * 0.9);
    bgMat.uniforms.uDepth.value = centre.set(0, 0, 0).project(camera).z * 0.5 + 0.5;
    const prev = renderer.getRenderTarget();
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target); renderer.clear(); renderer.render(bhScene, bhCam); renderer.setRenderTarget(prev);
    renderer.setClearColor(cc, ca);
    for (const b of bodies) {
      const a = b.phase + t * b.speed;
      if (b.taken) continue;
      b.fadeIn = Math.min(1, (b.fadeIn ?? 1) + dt * 0.4);
      orbitPos(b, a, b.mesh.position);
      b.mesh.rotation.y += dt * 0.2;
      b.mat.uniforms.uVis.value = vis * b.fadeIn; b.mat.uniforms.uTime.value = t;
      if (b.ringMat) b.ringMat.uniforms.uVis.value = vis * b.fadeIn;
      b.orbitLine.material.opacity = 0.05 * vis;
    }
  }
  // the orbiting planets can be grabbed and thrown in; a new one forms on the same orbit a few seconds later
  function grabbables() { return bodies.filter(b => !b.taken).map(b => b.mesh); }
  function take(mesh) { const b = bodies.find(x => x.mesh === mesh); if (b) b.taken = true; return b; }
  function giveBack(mesh) {
    const b = bodies.find(x => x.mesh === mesh); if (!b) return;
    setTimeout(() => { orbitFrame.add(mesh); mesh.scale.setScalar(1); mesh.rotation.set(0, 0, 0); b.fadeIn = 0; b.taken = false; }, 6000);
  }
  return { update, setTheme, frame, addFeed, reset, grabbables, take, giveBack, setDensity: d => { bhMat.uniforms.uDensity.value = d; },
    stats: () => ({ mass, feed }) };
}
