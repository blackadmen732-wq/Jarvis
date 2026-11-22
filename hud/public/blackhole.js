/* Black hole scene: every pixel traces a light ray that bends around the hole
   (Schwarzschild geodesic, simple numeric integration). That bending is what wraps
   the accretion disk over and under the shadow and makes the photon ring.
   Rendered at reduced resolution into its own buffer, then drawn as the background.
   Orbiting planets (lit by the disk) and faint orbit lines sit in the normal 3D scene. */
import * as THREE from 'three';

const BH_FRAG = /* glsl */`
  precision highp float;
  uniform vec2 uRes; uniform float uTime, uLevel, uSteps, uVis;
  uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos;
  uniform mat3 uTilt, uSkyRot; uniform float uScale; uniform vec3 uHot, uMid, uDeep; uniform sampler2D uSky; uniform float uSkyGain;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }

  const float RIN = 2.6, ROUT = 8.5;

  vec4 disk(vec3 p, vec3 dir) {
    float r = length(p.xz);
    float t = (r - RIN) / (ROUT - RIN);
    float ang = atan(p.z, p.x);
    float spin = uTime * 1.6 * pow(r, -1.5) * 3.0;              // inner disk orbits faster (Kepler)
    float a2 = ang + spin;
    // long swirling streaks: stretched noise in polar coordinates
    float n = fbm2(vec2(a2 * 3.0 / 3.14159 * 4.0 + r * 0.35, r * 2.6));
    float fine = fbm2(vec2(a2 * 14.0, r * 9.0));
    float hair = fbm2(vec2(a2 * 40.0 + n * 3.0, r * 26.0));                   // hair-thin filaments
    float streaks = 0.22 + 1.25 * pow(n * (0.55 + 0.65 * fine) * (0.7 + 0.6 * hair), 1.35);
    float edgeIn = smoothstep(0.0, 0.06, t), edgeOut = 1.0 - smoothstep(0.55, 1.0, t);
    float fall = pow(clamp(1.0 - t, 0.0, 1.0), 1.7);
    vec3 hot = uHot, amber = uMid, deep = uDeep;
    vec3 col = t < 0.25 ? mix(hot, amber, t / 0.25) : mix(amber, deep, clamp((t - 0.25) / 0.6, 0.0, 1.0));
    // relativistic beaming: the side moving toward us is brighter
    vec3 vdisk = normalize(vec3(-p.z, 0.0, p.x));
    float beam = clamp(1.0 + 0.75 * dot(vdisk, -normalize(dir)), 0.25, 2.2);
    beam = beam * beam;
    float grav = sqrt(clamp(1.0 - 1.0 / r, 0.05, 1.0));        // gravitational dimming near the hole
    float I = streaks * fall * edgeIn * edgeOut * beam * grav * (0.95 + uLevel * 0.9);
    float a = clamp(I * 0.75, 0.0, 0.94);
    return vec4(col * I, a);
  }

  vec3 sky(vec3 d) {
    // the real Milky Way photo, bent around the hole by the ray tracing above
    vec3 w = uSkyRot * (transpose(uTilt) * d);
    vec2 uv = vec2(atan(w.z, w.x) / 6.28318 + 0.5, asin(clamp(w.y, -1.0, 1.0)) / 3.14159 + 0.5);
    vec3 c = texture2D(uSky, uv).rgb * uSkyGain;
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 160.0 : 420.0;
      vec3 p = d * sc, cell = floor(p), f = fract(p) - 0.5;
      float h = hash3(cell + float(k) * 17.0);
      if (h > (k == 0 ? 0.992 : 0.985)) {
        float b = smoothstep(0.32, 0.0, length(f)) * (k == 0 ? 1.4 : 0.6) * (0.5 + 0.5 * sin(uTime * (1.0 + h * 5.0) + h * 40.0));
        c += mix(vec3(1.0, 0.82, 0.6), vec3(0.75, 0.85, 1.0), fract(h * 91.0)) * b;
      }
    }
    return c;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, 1.0, 1.0); v /= v.w;
    vec3 rdW = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
    vec3 pos = uTilt * (uCamPos / uScale);
    vec3 vel = uTilt * rdW;
    vec3 cr = cross(pos, vel); float h2 = dot(cr, cr);
    vec3 col = vec3(0.0); float alpha = 0.0; bool captured = false; float rmin = 1e9;
    for (int i = 0; i < 400; i++) {
      if (float(i) >= uSteps) break;
      float r = length(pos); rmin = min(rmin, r);
      float dt = clamp(0.06 * r, 0.02, 1.2);
      vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
      vec3 nvel = vel + acc * dt;
      vec3 npos = pos + nvel * dt;
      if (pos.y * npos.y < 0.0) {
        vec3 hit = mix(pos, npos, pos.y / (pos.y - npos.y));
        float hr = length(hit.xz);
        if (hr > RIN && hr < ROUT) { vec4 d = disk(hit, nvel); col += (1.0 - alpha) * d.rgb; alpha += (1.0 - alpha) * d.a; }
      }
      pos = npos; vel = nvel;
      if (length(pos) < 1.0) { captured = true; break; }
      if (alpha > 0.985) break;
      if (r > 45.0 && dot(pos, vel) > 0.0) break;
    }
    if (!captured) col += (1.0 - alpha) * sky(normalize(vel));
    // photon ring: light that skimmed the photon sphere (r = 1.5) on its way to us
    float ring = exp(-pow((rmin - 1.53) / 0.035, 2.0));
    col += uHot * ring * (captured ? 0.0 : 1.0) * (1.2 + uLevel);
    // thin bright photon ring glow from rays that skimmed the hole
    gl_FragColor = vec4(col * uVis, 1.0);
  }`;

export function createBlackHole(scene, renderer, camera, { mobile = false, reduce = false, sky = null } = {}) {
  const res = mobile ? 0.45 : reduce ? 0.45 : 0.8;
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const bhScene = new THREE.Scene();
  const bhCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tilt = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.22, 0, -0.32)).invert());
  const bhMat = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uLevel: { value: 0 }, uSteps: { value: mobile || reduce ? 140 : 240 }, uVis: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uTilt: { value: tilt }, uScale: { value: 0.5 },
      uSky: { value: sky }, uSkyGain: { value: 0.55 }, uSkyRot: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.55, 0.3, 0.42))) },
      uHot: { value: new THREE.Color('#ffebc7') }, uMid: { value: new THREE.Color('#ff8f29') }, uDeep: { value: new THREE.Color('#8c2108') },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BH_FRAG, depthTest: false, depthWrite: false,
  });
  bhScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhMat));

  // background quad in the main scene that shows the black hole buffer
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: target.texture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uTex, vUv); }',
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
    { r: 0.32, orbit: 6.4, speed: 0.11, phase: 0.6, mat: planetMat('#3a3530', '#8a7a68', 0) },
    { r: 0.72, orbit: 11.5, speed: 0.045, phase: 2.4, mat: planetMat('#a8693a', '#f0d2a0', 1), ring: true },
    { r: 0.2, orbit: 8.8, speed: 0.075, phase: 4.2, mat: planetMat('#7d8ea8', '#d8e4f0', 0) },
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
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * b.orbit, 0, Math.sin(a) * b.orbit)); }
    const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    orbitFrame.add(orbitLine);
    return { ...b, mesh: m, orbitLine };
  });

  const size = new THREE.Vector2();
  function setTheme(th) { bhMat.uniforms.uHot.value.set(th.hot); bhMat.uniforms.uMid.value.set(th.mid); bhMat.uniforms.uDeep.value.set(th.deep); }
  function update(dt, t, L, vis) {
    const on = vis > 0.01;
    bg.visible = on; orbitFrame.visible = on;
    if (!on) return;
    renderer.getSize(size);
    const w = Math.max(2, Math.round(size.x * res)), h = Math.max(2, Math.round(size.y * res));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    camera.updateMatrixWorld();
    bhMat.uniforms.uRes.value.set(w, h);
    bhMat.uniforms.uTime.value = t; bhMat.uniforms.uLevel.value = L; bhMat.uniforms.uVis.value = vis;
    bhMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    bhMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    bhMat.uniforms.uCamPos.value.copy(camera.position);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target); renderer.render(bhScene, bhCam); renderer.setRenderTarget(prev);
    for (const b of bodies) {
      const a = b.phase + t * b.speed;
      b.mesh.position.set(Math.cos(a) * b.orbit, 0, Math.sin(a) * b.orbit);
      b.mesh.rotation.y += dt * 0.2;
      b.mat.uniforms.uVis.value = vis; b.mat.uniforms.uTime.value = t;
      if (b.ringMat) b.ringMat.uniforms.uVis.value = vis;
      b.orbitLine.material.opacity = 0.05 * vis;
    }
  }
  return { update, setTheme };
}
