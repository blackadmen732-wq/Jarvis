/* Sky: the real Milky Way photo, colour-graded into deep blues and violets, plus
   three layers of sharp twinkling stars, soft nebula colour, a big ringed planet,
   and mouse parallax (near layers move more than far ones). */
import * as THREE from 'three';

const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }`;

export function createSky(scene, { mobile = false, src } = {}) {
  const root = new THREE.Group(); scene.add(root);
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // ---------------------------------------------------------------- graded Milky Way
  const tex = new THREE.TextureLoader().load(src);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uTex: { value: tex }, uRot: { value: new THREE.Matrix3() }, uTime: { value: 0 }, uGain: { value: 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform sampler2D uTex; uniform mat3 uRot; uniform float uTime, uGain; varying vec3 vD; ${NOISE}
      void main(){
        vec3 d = uRot * normalize(vD);
        vec2 uv = vec2(atan(d.z, d.x) / 6.28318 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5);
        vec3 c = texture2D(uTex, uv).rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // colour grade: dust lanes stay dark, glow goes royal blue -> lavender -> warm white core
        vec3 grade = lum < 0.18 ? mix(vec3(0.004, 0.006, 0.02), vec3(0.05, 0.08, 0.32), lum / 0.18)
                   : lum < 0.45 ? mix(vec3(0.05, 0.08, 0.32), vec3(0.42, 0.36, 0.85), (lum - 0.18) / 0.27)
                   : mix(vec3(0.42, 0.36, 0.85), vec3(1.0, 0.9, 0.82), clamp((lum - 0.45) / 0.45, 0.0, 1.0));
        vec3 col = mix(c, grade, 0.72);
        col = pow(col, vec3(1.12)) * 1.25;                                   // more contrast
        // soft nebula colour drifting through the band
        float neb = fbm(d * 2.2 + vec3(uTime * 0.004, 0.0, 0.0));
        float neb2 = fbm(d * 4.5 + 7.0);
        col += vec3(0.05, 0.09, 0.28) * smoothstep(0.45, 0.85, neb) * 0.5 + vec3(0.22, 0.06, 0.24) * smoothstep(0.6, 0.9, neb2) * 0.25;
        gl_FragColor = vec4(col * uGain, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), skyMat);
  sky.renderOrder = -2000; sky.frustumCulled = false; root.add(sky);

  // ---------------------------------------------------------------- star layers (parallax)
  const starLayer = (count, radius, size, seed) => {
    let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(radius);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = r(); const c = t < 0.5 ? [0.75, 0.85, 1.0] : t < 0.75 ? [1.0, 1.0, 1.0] : t < 0.9 ? [0.82, 0.72, 1.0] : [1.0, 0.82, 0.62];   // blue, white, violet, warm
      col.set(c, i * 3); sz[i] = size * (0.5 + Math.pow(r(), 5) * 3.5); ph[i] = r() * 50;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ ...add, depthTest: true, uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: `uniform float uTime, uPixel; attribute vec3 color; attribute float aSize, aPh; varying vec3 vC; varying float vT;
        void main(){ vC = color; vT = 0.65 + 0.35 * sin(uTime * (0.8 + fract(aPh) * 2.5) + aPh);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPixel; }`,
      fragmentShader: `varying vec3 vC; varying float vT;
        void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p);
          float core = smoothstep(0.5, 0.0, d); core *= core;
          float spike = max(0.0, 1.0 - abs(p.x) * 14.0) * max(0.0, 1.0 - abs(p.y) * 2.2) + max(0.0, 1.0 - abs(p.y) * 14.0) * max(0.0, 1.0 - abs(p.x) * 2.2);
          float a = (core + spike * 0.35) * vT; gl_FragColor = vec4(vC * a, a); }` });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; root.add(pts); return { pts, m };
  };
  const layers = [starLayer(mobile ? 1800 : 4200, 300, 1.6, 11), starLayer(mobile ? 600 : 1400, 220, 2.4, 29), starLayer(mobile ? 120 : 260, 160, 3.6, 53)];

  // ---------------------------------------------------------------- ringed planet (like the reference photo)
  const planet = new THREE.Group(); root.add(planet);
  planet.position.set(-46, 24, -150);
  const PR = 26;
  const sunDir = new THREE.Vector3(0.85, 0.25, 0.35).normalize();          // light from behind-right: a lit crescent
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vN, vW, vP; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uSun; uniform float uTime; varying vec3 vN, vW, vP; ${NOISE}
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW), p = normalize(vP);
        float lit = max(dot(n, uSun), 0.0);
        float bands = 0.5 + 0.5 * sin(p.y * 26.0 + fbm(p * 5.0 + uTime * 0.003) * 4.0);
        vec3 base = mix(vec3(0.05, 0.12, 0.26), vec3(0.42, 0.62, 0.85), bands * 0.6 + fbm(p * 12.0) * 0.4);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = base * (0.015 + pow(lit, 0.8) * 1.15) + vec3(0.45, 0.7, 1.0) * rim * (0.15 + lit * 1.2);
        gl_FragColor = vec4(col, 1.0); }`,
  });
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(PR, 96, 64), pMat));
  // atmosphere glow on the lit side
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(PR * 1.04, 64, 48), new THREE.ShaderMaterial({ ...add, side: THREE.BackSide, uniforms: { uSun: { value: sunDir } },
    vertexShader: 'varying vec3 vN, vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 uSun; varying vec3 vN, vW; void main(){ vec3 v = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), v)), 4.0); float lit = max(dot(normalize(vN), uSun) + 0.35, 0.0); float a = f * lit * 0.9; gl_FragColor = vec4(vec3(0.45, 0.72, 1.0) * a, a); }' }));
  planet.add(atmo);
  // rings: hundreds of fine bands, lit on the sun side
  const ringGeo = new THREE.RingGeometry(PR * 1.35, PR * 2.6, 256, 1);
  const rp = ringGeo.attributes.position, ruv = ringGeo.attributes.uv;
  for (let i = 0; i < ruv.count; i++) ruv.setX(i, (Math.hypot(rp.getX(i), rp.getY(i)) - PR * 1.35) / (PR * 1.25));
  const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uSun: { value: sunDir } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uSun; varying vec2 vUv; varying vec3 vW;
      float h(float x){ return fract(sin(x * 127.1) * 43758.5453); }
      void main(){ float x = vUv.x;
        float fine = 0.5 + 0.5 * sin(x * 420.0) * sin(x * 133.0 + 1.3);
        float lanes = h(floor(x * 60.0)) * 0.7 + 0.3;
        float gap = smoothstep(0.0, 0.02, abs(x - 0.42)) * smoothstep(0.0, 0.015, abs(x - 0.78));     // Cassini-like gaps
        float dens = lanes * (0.45 + 0.55 * fine) * gap * smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.9, x);
        vec3 col = mix(vec3(0.55, 0.68, 0.85), vec3(0.95, 0.92, 0.85), fine) * (0.35 + 0.9 * dens);
        gl_FragColor = vec4(col * dens, dens * 0.85); }` }));
  ring.rotation.set(Math.PI / 2 - 0.42, 0.35, 0.2); planet.add(ring);
  planet.rotation.z = 0.35;

  // ---------------------------------------------------------------- mouse parallax
  const mouse = new THREE.Vector2(), smooth = new THREE.Vector2();
  addEventListener('pointermove', e => { mouse.set(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); });
  const baseRot = new THREE.Euler(0.12, -Math.PI / 2 + 0.25, 0.62, 'YZX'), m4 = new THREE.Matrix4(), e = new THREE.Euler(0, 0, 0, 'YZX');

  function update(dt, t, camera, pixelRatio) {
    smooth.lerp(mouse, Math.min(1, dt * 2.5));
    root.position.copy(camera.position);                           // the sky is "infinitely" far: it travels with the camera
    e.set(baseRot.x + smooth.y * 0.035, baseRot.y + smooth.x * 0.05 + t * 0.002, baseRot.z);
    skyMat.uniforms.uRot.value.setFromMatrix4(m4.makeRotationFromEuler(e)); skyMat.uniforms.uTime.value = t;
    layers.forEach((L, i) => {                                      // nearer star layers shift more
      const k = 0.012 * (i + 1);
      L.pts.rotation.set(smooth.y * k, smooth.x * k * 1.4 + t * 0.002 * (i + 1), 0);
      L.m.uniforms.uTime.value = t; L.m.uniforms.uPixel.value = pixelRatio;
    });
    planet.position.set(-46 - smooth.x * 6, 24 + smooth.y * 4, -150);
    planet.rotation.y += dt * 0.004; pMat.uniforms.uTime.value = t;
  }
  return { update, texture: tex, setGain: g => { skyMat.uniforms.uGain.value = g; } };
}
