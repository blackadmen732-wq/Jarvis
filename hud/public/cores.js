/* Extra core faces for the adaptive ("Auto") core:
   circuit : a sphere wrapped in glowing circuit traces with light pulses running along them
   pulse   : a sphere of glowing spikes rippling with your voice
   portal  : a warp ring with data streaks rushing into it
   plasma  : a glass orb with a bright heart and electric veins
   liquid  : a shimmering liquid-glass blob
   Each face has update(vis) so faces can blend into each other. Colours follow the theme. */
import * as THREE from 'three';

const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

export const CORE_RADIUS = { circuit: 1.75, pulse: 1.7, portal: 1.5, plasma: 1.55, liquid: 1.7, bloom: 1.2 };

export function createCores(scene, glow, { mobile = false } = {}) {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const theme = { hot: new THREE.Color('#ffebc7'), mid: new THREE.Color('#ff8f29'), plasma: new THREE.Color('#ff7a45'), deep: new THREE.Color('#8c2108') };
  const shared = { uTime: { value: 0 }, uLevel: { value: 0 }, uHot: { value: theme.hot }, uMid: { value: theme.mid }, uPlasma: { value: theme.plasma } };
  const faces = {};

  // =============================================================== CIRCUIT SPHERE
  {
    const g = new THREE.Group(); scene.add(g);
    const pos = [], ph = [];
    const onSphere = (v, r) => v.normalize().multiplyScalar(r);
    const addPaths = (count, r, steps, stepLen) => {
      for (let k = 0; k < count; k++) {
        let p = onSphere(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), r);
        let dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(p).normalize();
        const p0 = rnd() * 10;
        for (let s = 0; s < steps; s++) {
          if (rnd() < 0.35) dir.applyAxisAngle(p.clone().normalize(), (rnd() < 0.5 ? 1 : -1) * Math.PI / 2);   // right-angle turns like PCB traces
          const q = onSphere(p.clone().addScaledVector(dir, stepLen * (0.6 + rnd() * 0.8)), r);
          pos.push(p.x, p.y, p.z, q.x, q.y, q.z); ph.push(p0 + s * 0.08, p0 + (s + 1) * 0.08);
          dir = q.clone().sub(p).normalize(); p = q;
        }
      }
    };
    addPaths(mobile ? 160 : 300, 1.55, 14, 0.09);
    addPaths(mobile ? 70 : 130, 1.05, 10, 0.07);
    // broken outer shell arcs
    for (let k = 0; k < (mobile ? 40 : 80); k++) {
      const r = 1.85 + rnd() * 0.35, tilt = new THREE.Euler(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.4);
      const a0 = rnd() * Math.PI * 2, len = 0.2 + rnd() * 0.9, n = 16, p0 = rnd() * 10;
      for (let i = 0; i < n; i++) {
        const a = a0 + len * i / n, b = a0 + len * (i + 1) / n;
        const P = new THREE.Vector3(Math.cos(a) * r, (rnd() - 0.5) * 0.02, Math.sin(a) * r).applyEuler(tilt), Q = new THREE.Vector3(Math.cos(b) * r, 0, Math.sin(b) * r).applyEuler(tilt);
        pos.push(P.x, P.y, P.z, Q.x, Q.y, Q.z); ph.push(p0 + i * 0.05, p0 + (i + 1) * 0.05);
      }
    }
    // two bright rings crossing the sphere
    for (const [rx, rz] of [[1.35, 0.15], [0.25, 1.1]]) for (let i = 0; i < 180; i++) {
      const a = i / 180 * Math.PI * 2, b = (i + 1) / 180 * Math.PI * 2, e = new THREE.Euler(rx, 0, rz);
      const P = new THREE.Vector3(Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05).applyEuler(e), Q = new THREE.Vector3(Math.cos(b) * 2.05, 0, Math.sin(b) * 2.05).applyEuler(e);
      pos.push(P.x, P.y, P.z, Q.x, Q.y, Q.z); ph.push(i * 0.03, (i + 1) * 0.03);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({ ...add, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: 'attribute float aPh; varying float vPh; void main(){ vPh = aPh; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime, uLevel, uVis; uniform vec3 uHot, uMid; varying float vPh;
        void main(){ float pulse = pow(fract(vPh - uTime * (0.25 + uLevel)), 14.0);
          float b = (0.32 + pulse * 1.6 + uLevel * 0.4) * uVis; gl_FragColor = vec4(mix(uMid, uHot, pulse) * b, b); }` });
    g.add(new THREE.LineSegments(geo, mat));
    faces.circuit = { g, update(dt, t, L, v) { g.visible = v > 0.01; if (!g.visible) return; mat.uniforms.uVis.value = v; g.rotation.y += dt * 0.12; g.rotation.x = Math.sin(t * 0.1) * 0.15; g.scale.setScalar(0.4 + 0.6 * v); } };
  }

  // =============================================================== PULSE SPHERE (spikes)
  {
    const g = new THREE.Group(); scene.add(g);
    const N = mobile ? 1000 : 1700, pos = new Float32Array(N * 6), tip = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), th = i * 2.39996;
      const d = [Math.cos(th) * r, y, Math.sin(th) * r];
      pos.set(d, i * 6); pos.set(d, i * 6 + 3); tip[i * 2] = 0; tip[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
    const mat = new THREE.ShaderMaterial({ ...add, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: `uniform float uTime, uLevel; attribute float aTip; varying float vB, vTip; ${NOISE}
        void main(){ vec3 d = normalize(position);
          float wave = sin(dot(d, vec3(3.0, 2.0, 1.0)) * 2.5 + uTime * 2.2) * 0.5 + 0.5;
          float n = n3(d * 3.0 + uTime * 0.6);
          float r = 1.45 * (1.0 + 0.07 * sin(d.y * 4.0 + uTime * 1.3) + (n - 0.5) * 0.12 * (1.0 + uLevel * 4.0));
          float len = 0.06 + 0.2 * wave * (0.4 + uLevel * 1.8);
          vB = 0.35 + wave * 0.65 + uLevel * 0.5; vTip = aTip;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(d * (r + len * aTip), 1.0); }`,
      fragmentShader: `uniform vec3 uHot, uMid; uniform float uVis; varying float vB, vTip;
        void main(){ float b = vB * (0.25 + vTip * 0.6) * uVis; gl_FragColor = vec4(mix(uMid, uHot, vTip * vB) * b, b); }` });
    g.add(new THREE.LineSegments(geo, mat));
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.mid.clone(), ...add, opacity: 0 })); heart.scale.setScalar(2.4); g.add(heart);
    faces.pulse = { g, heart, update(dt, t, L, v) { g.visible = v > 0.01; if (!g.visible) return; mat.uniforms.uVis.value = v; heart.material.opacity = 0.25 * v; g.rotation.y += dt * 0.25; g.scale.setScalar(0.4 + 0.6 * v); } };
  }

  // =============================================================== PLASMA ORB
  {
    const g = new THREE.Group(); scene.add(g);
    const shellMat = new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: 'varying vec3 vN, vV, vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime, uLevel, uVis; uniform vec3 uPlasma, uHot; varying vec3 vN, vV, vP; ${NOISE}
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5);
          vec3 p = normalize(vP) * 3.0; float veins = abs(n3(p + uTime * 0.4) - n3(p * 1.7 - uTime * 0.3));
          float web = smoothstep(0.06, 0.0, veins) * 0.8;
          float speck = step(0.93, n3(normalize(vP) * 60.0 + uTime));
          float b = (f * 0.9 + web * (0.5 + uLevel) + speck * 0.35) * uVis; gl_FragColor = vec4(mix(uPlasma, uHot, web) * b * 1.3, b); }` });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 64, 48), shellMat));
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.hot.clone(), ...add, opacity: 0 })); heart.scale.setScalar(1.6); g.add(heart);
    const heart2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.plasma.clone(), ...add, opacity: 0 })); heart2.scale.setScalar(3.6); g.add(heart2);
    const NV = 9, VN = 17;
    const veins = Array.from({ length: NV }, () => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VN * 3), 3));
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: theme.plasma.clone(), ...add, opacity: 0 })); l.frustumCulled = false; g.add(l);
      return { l, t: rnd(), end: new THREE.Vector3() };
    });
    const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3();
    function bolt(arr, end) {
      const n = arr.length / 3; arr.fill(0, 0, 3); arr.set([end.x, end.y, end.z], (n - 1) * 3);
      for (let step = (n - 1) / 2; step >= 1; step /= 2) for (let i = step; i < n; i += step * 2) {
        A.fromArray(arr, (i - step) * 3); B.fromArray(arr, (i + step) * 3);
        M.addVectors(A, B).multiplyScalar(0.5).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(A.distanceTo(B) * 0.35));
        arr.set([M.x, M.y, M.z], i * 3);
      }
    }
    faces.plasma = { g, update(dt, t, L, v) {
      g.visible = v > 0.01; if (!g.visible) return;
      shellMat.uniforms.uVis.value = v; g.scale.setScalar(0.4 + 0.6 * v);
      heart.material.opacity = (0.8 + L * 0.4) * v; heart.scale.setScalar(1.4 + L * 1.4); heart2.material.opacity = (0.3 + L * 0.3) * v;
      for (const vn of veins) {
        vn.t -= dt * (1 + L * 3);
        if (vn.t <= 0) { vn.t = 0.06 + rnd() * 0.2; vn.end.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(1.48); bolt(vn.l.geometry.attributes.position.array, vn.end); vn.l.geometry.attributes.position.needsUpdate = true; }
        vn.l.material.opacity = (0.35 + rnd() * 0.5) * v * (0.6 + L);
      }
    } };
    faces.plasma.colorize = () => { heart.material.color.copy(theme.hot); heart2.material.color.copy(theme.plasma); veins.forEach(vn => vn.l.material.color.copy(theme.plasma)); };
  }

  // =============================================================== WARP PORTAL
  {
    const g = new THREE.Group(); scene.add(g);
    const NS = mobile ? 700 : 1500, pos = new Float32Array(NS * 6), at = new Float32Array(NS * 2 * 3);
    for (let i = 0; i < NS; i++) {
      const a = rnd() * Math.PI * 2, sp = 0.25 + rnd() * 0.6, ph = rnd();
      for (let e = 0; e < 2; e++) at.set([a, sp, ph + e * 0.0001], (i * 2 + e) * 3);
      pos[i * 6 + 3] = 1;                                           // x of 2nd vertex marks the tail
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(at, 3));
    const streakMat = new THREE.ShaderMaterial({ ...add, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: `uniform float uTime, uLevel; attribute vec3 aS; varying float vA;
        void main(){ float u = fract(aS.z - uTime * aS.y * (0.5 + uLevel * 1.5));      // 1 = far out, 0 = at the ring
          float r = mix(1.35, 9.0, u * u); float tail = position.x; r += tail * (0.25 + u * 1.6);
          vec3 p = vec3(cos(aS.x) * r, sin(aS.x) * r, -u * 1.5);
          vA = (1.0 - u) * (1.0 - tail * 0.9) * smoothstep(1.0, 0.85, u);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: 'uniform vec3 uHot; uniform float uVis; varying float vA; void main(){ float a = vA * uVis; gl_FragColor = vec4(uHot * a * 1.2, a); }' });
    g.add(new THREE.LineSegments(geo, streakMat));
    // rings of dots + dark eye
    const ringMats = [];
    [1.25, 1.42, 1.6, 1.85].forEach((r, k) => {
      const n = 90 + k * 40, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; p.set([Math.cos(a) * r, Math.sin(a) * r, 0], i * 3); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.PointsMaterial({ map: glow, size: k === 0 ? 0.16 : 0.1, color: theme.hot.clone(), ...add, opacity: 0 }); ringMats.push(m);
      const pts = new THREE.Points(gg, m); pts.userData.spin = (k % 2 ? -1 : 1) * (0.2 + k * 0.1); g.add(pts);
    });
    const eye = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 })); eye.position.z = 0.01; g.add(eye);
    const glowRing = new THREE.Mesh(new THREE.RingGeometry(1.18, 1.32, 96), new THREE.MeshBasicMaterial({ color: theme.hot.clone(), ...add, opacity: 0, side: THREE.DoubleSide })); g.add(glowRing);
    g.rotation.set(-0.35, 0.5, 0.25);
    faces.portal = { g, update(dt, t, L, v, camera) {
      g.visible = v > 0.01; if (!g.visible) return;
      streakMat.uniforms.uVis.value = v; ringMats.forEach(m => { m.opacity = 0.85 * v; });
      eye.material.opacity = 0.92 * v; glowRing.material.opacity = (0.7 + L * 0.3) * v;
      g.children.forEach(c => { if (c.userData.spin) c.rotation.z += dt * c.userData.spin; });
      g.scale.setScalar(0.4 + 0.6 * v);
      if (camera) { const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(camera.position, new THREE.Vector3(), camera.up)); g.quaternion.slerp(target, 0.04); }
    } };
    faces.portal.colorize = () => { ringMats.forEach(m => m.color.copy(theme.hot)); glowRing.material.color.copy(theme.hot); };
  }

  // =============================================================== LIQUID GLASS
  {
    const g = new THREE.Group(); scene.add(g);
    const mat = new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: `uniform float uTime, uLevel; varying vec3 vN, vV, vP; ${NOISE}
        void main(){ vec3 d = normalize(position);
          float n = n3(d * 1.6 + uTime * 0.25) * 0.55 + n3(d * 3.2 - uTime * 0.4) * 0.3;
          vec3 p = d * 1.5 * (0.85 + n * (0.45 + uLevel * 0.4)) * vec3(1.15, 0.9, 1.0);
          vP = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uVis; uniform vec3 uHot, uMid; varying vec3 vN, vV, vP;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
          vec3 iri = 0.5 + 0.5 * cos(6.2832 * (f * 1.3 + vP.y * 0.3 + uTime * 0.05 + vec3(0.0, 0.33, 0.67)));   // thin-film colours
          vec3 col = mix(iri, uHot, 0.35) * f + uMid * 0.05;
          float b = (f * 1.1 + 0.03) * uVis; gl_FragColor = vec4(col * b * 1.4, b); }` });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, mobile ? 4 : 5), mat));
    const motes = Array.from({ length: 3 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.mid.clone(), ...add, opacity: 0 })); s.scale.setScalar(0.9); g.add(s); return s; });
    faces.liquid = { g, update(dt, t, L, v) {
      g.visible = v > 0.01; if (!g.visible) return;
      mat.uniforms.uVis.value = v; g.rotation.y += dt * 0.15; g.rotation.z = Math.sin(t * 0.2) * 0.3; g.scale.setScalar(0.4 + 0.6 * v);
      motes.forEach((s, i) => { s.position.set(Math.sin(t * 0.5 + i * 2.1) * 0.6, Math.cos(t * 0.4 + i) * 0.4, Math.sin(t * 0.3 + i) * 0.5); s.material.opacity = (0.45 + L * 0.4) * v; });
    } };
    faces.liquid.colorize = () => motes.forEach(s => s.material.color.copy(theme.mid));
  }

  // =============================================================== BLOOM (iridescent fibre flower)
  {
    const g = new THREE.Group(); scene.add(g);
    const PETALS = 6, STRANDS = mobile ? 2200 : 5200, SEG = mobile ? 18 : 26;
    const nV = STRANDS * SEG * 2;
    const pos = new Float32Array(nV * 3), aT = new Float32Array(nV), aS = new Float32Array(nV), aP = new Float32Array(nV), aR = new Float32Array(nV);
    let v = 0;
    for (let i = 0; i < STRANDS; i++) {
      const stamen = i % 9 === 0;                                   // some fibres burst straight out of the centre
      const petal = Math.floor(rnd() * PETALS) + (stamen ? 0.5 : 0);
      const side = stamen ? (rnd() - 0.5) * 0.3 : (rnd() * 2 - 1) * Math.pow(rnd(), 0.35) * Math.sign(rnd() - 0.5);
      const seedv = rnd(), len = stamen ? 0.35 + rnd() * 0.35 : 0.75 + rnd() * 0.25;
      for (let k = 0; k < SEG; k++) for (const e of [k, k + 1]) {
        aT[v] = e / SEG * len; aS[v] = side; aP[v] = petal; aR[v] = seedv; v++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (const [k, a] of [['aT', aT], ['aS', aS], ['aP', aP], ['aR', aR]]) geo.setAttribute(k, new THREE.BufferAttribute(a, 1));
    const mat = new THREE.ShaderMaterial({ ...add, uniforms: { ...shared, uVis: { value: 0 } },
      vertexShader: /* glsl */`
        uniform float uTime, uLevel; attribute float aT, aS, aP, aR; varying float vT, vS, vR, vEdge;
        ${NOISE}
        void main(){
          float petals = 6.0;
          float th = aP / petals * 6.28318 + uTime * 0.06 + sin(uTime * 0.3 + aP) * 0.08;
          vec3 axis = vec3(cos(th), 0.0, sin(th)), side = vec3(-sin(th), 0.0, cos(th)), up = vec3(0.0, 1.0, 0.0);
          float t = aT;
          float width = pow(sin(3.14159 * min(t * 1.08, 1.0)), 0.8) * 0.75;          // petal outline
          float lat = aS * width;
          // petal cups upward, tips curl, edges ruffle
          float lift = 0.55 * t * t - 0.25 * t + 0.35 * aS * aS * t;
          float ruffle = (n3(vec3(t * 6.0, aS * 3.0, aP * 4.0 + uTime * 0.25)) - 0.5) * (0.25 + abs(aS) * 0.55) * t;
          float breathe = 1.0 + 0.06 * sin(uTime * 0.9 + aP * 1.3) + uLevel * 0.25;
          float twist = t * 0.9 * sin(aP * 2.1);
          vec3 p = axis * (t * 2.2 * breathe) + side * (lat + sin(twist) * 0.2) + up * (lift + ruffle);
          // individual fibres wander a little, like hair in water
          p += vec3(n3(vec3(aR * 50.0, t * 4.0, uTime * 0.35)), n3(vec3(t * 4.0, aR * 50.0, uTime * 0.3)), n3(vec3(uTime * 0.3, t * 4.0, aR * 50.0)) ) * 0.12 * t - 0.06 * t;
          vT = t; vS = aS; vR = aR; vEdge = abs(aS);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uVis, uTime, uLevel; uniform vec3 uHot, uMid; varying float vT, vS, vR, vEdge;
        void main(){
          // thin-film iridescence: lavender, gold, sky blue, rose
          vec3 iri = 0.55 + 0.45 * cos(6.28318 * (vT * 0.9 + vS * 0.35 + vR * 0.5 + uTime * 0.03 + vec3(0.0, 0.33, 0.67)));
          vec3 col = mix(iri, mix(uHot, uMid, vT), 0.28);
          col = mix(col, vec3(1.0, 0.78, 0.45), smoothstep(0.25, 0.0, vT) * 0.6);      // warm golden heart
          float a = (0.055 + vEdge * 0.06 + smoothstep(0.2, 0.0, vT) * 0.08) * smoothstep(1.0, 0.82, vT / 1.0) * uVis * (1.0 + uLevel * 0.8);
          gl_FragColor = vec4(col * a * 2.2, a);
        }`,
    });
    const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; g.add(lines);
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color('#ffd08a'), ...add, opacity: 0 })); heart.scale.setScalar(1.4); g.add(heart);
    g.rotation.set(0.5, 0, 0.12);
    faces.bloom = { g, update(dt, t, L, vv) {
      g.visible = vv > 0.01; if (!g.visible) return;
      mat.uniforms.uVis.value = vv; heart.material.opacity = (0.5 + L * 0.4) * vv;
      g.rotation.y += dt * 0.05; g.rotation.x = 0.5 + Math.sin(t * 0.15) * 0.08; g.scale.setScalar(0.4 + 0.6 * vv);
    } };
  }

  function setTheme(th) {
    theme.hot.set(th.hot); theme.mid.set(th.mid); theme.plasma.set(th.plasma); theme.deep.set(th.deep);
    faces.pulse.heart.material.color.copy(theme.mid);
    Object.values(faces).forEach(f => f.colorize && f.colorize());
  }
  function update(dt, t, L, vis, camera) {
    shared.uTime.value = t; shared.uLevel.value = L;
    for (const k of Object.keys(faces)) faces[k].update(dt, t, L, vis[k] || 0, camera);
  }
  return { update, setTheme };
}
