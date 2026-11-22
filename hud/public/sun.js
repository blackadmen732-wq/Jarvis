/* Sun core: boiling plasma surface, pulsing corona, looping prominences and
   particles streaming off the surface. Colours follow the HUD colour theme. */
import * as THREE from 'three';

const NOISE = /* glsl */`
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.07; a *= 0.5; } return s; }`;

export const SUN_R = 1.55;

export function createSun(scene, glow, { mobile = false } = {}) {
  const group = new THREE.Group(); scene.add(group);
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const theme = { hot: new THREE.Color('#ffebc7'), mid: new THREE.Color('#ff8f29'), deep: new THREE.Color('#8c2108') };

  const surfMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uVis: { value: 0 }, uHot: { value: theme.hot }, uMid: { value: theme.mid }, uDeep: { value: theme.deep } },
    transparent: true,
    vertexShader: 'varying vec3 vP, vN, vV; void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime, uLevel, uVis; uniform vec3 uHot, uMid, uDeep; varying vec3 vP, vN, vV; ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        float g = fbm(p * 3.0 + vec3(0.0, uTime * 0.05, uTime * 0.04));                 // large convection
        float cells = fbm(p * 18.0 + g * 2.5 - uTime * 0.12);                           // granulation
        // fine fibrous texture (spicules), like a hydrogen-alpha photo of the sun
        float fib = fbm(vec3(p.x * 70.0 + g * 6.0, p.y * 70.0 - uTime * 0.2, p.z * 70.0));
        float fib2 = fbm(p * 140.0 + uTime * 0.05);
        float spots = smoothstep(0.6, 0.78, fbm(p * 2.0 + 11.0 + uTime * 0.01));
        float heat = clamp(g * 0.35 + cells * 0.45 + fib * 0.35 + fib2 * 0.15 - spots * 0.45 - 0.1, 0.0, 1.0);
        vec3 col = heat < 0.55 ? mix(uDeep * 0.6, uMid, heat / 0.55) : mix(uMid, uHot, (heat - 0.55) / 0.45);
        float mu = max(dot(normalize(vN), vV), 0.0);
        col *= 0.42 + 0.58 * pow(mu, 0.35);                                             // limb darkening inside
        col += uHot * pow(1.0 - mu, 9.0) * 3.0 + uMid * pow(1.0 - mu, 3.5) * 0.6;       // thin bright limb
        gl_FragColor = vec4(col * (0.78 + uLevel * 0.7) * uVis, uVis); }`,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 64), surfMat); group.add(surface);

  const coronaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uVis: { value: 0 }, uMid: { value: theme.mid }, uHot: { value: theme.hot } },
    side: THREE.BackSide, ...add,
    vertexShader: 'varying vec3 vN, vV, vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime, uLevel, uVis; uniform vec3 uMid, uHot; varying vec3 vN, vV, vP; ${NOISE}
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float fl = 0.6 + 0.8 * fbm(normalize(vP) * 5.0 + uTime * 0.3);
        vec3 c = mix(uMid, uHot, f * 0.5); float a = f * fl * (0.7 + uLevel) * uVis; gl_FragColor = vec4(c * a * 1.1, a); }`,
  });
  const corona = new THREE.Mesh(new THREE.SphereGeometry(SUN_R * 1.32, 64, 48), coronaMat); group.add(corona);
  const halo1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.mid.clone(), ...add, opacity: 0 })); halo1.scale.setScalar(SUN_R * 6); group.add(halo1);
  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: theme.deep.clone(), ...add, opacity: 0 })); halo2.scale.setScalar(SUN_R * 12); group.add(halo2);

  // prominences: glowing arcs that rise off the surface, live and fade
  const promMat = () => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLife: { value: 0 }, uVis: { value: 0 }, uMid: { value: theme.mid }, uHot: { value: theme.hot } }, ...add, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime, uLife, uVis; uniform vec3 uMid, uHot; varying vec2 vUv; ${NOISE}
      void main(){ float flow = fbm(vec3(vUv.x * 8.0 - uTime * 1.5, vUv.y * 3.0, 0.0));
        float edge = 1.0 - abs(vUv.y - 0.5) * 2.0; float life = sin(clamp(uLife, 0.0, 1.0) * 3.14159);
        float a = edge * edge * (0.4 + flow) * life * uVis * 0.9; gl_FragColor = vec4(mix(uMid, uHot, flow) * a * 1.4, a); }`,
  });
  const proms = Array.from({ length: mobile ? 4 : 7 }, () => {
    const mat = promMat(); const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); group.add(mesh);
    return { mesh, mat, life: Math.random(), dur: 4 + Math.random() * 5 };
  });
  function spawnProm(p) {
    const n = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const side = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0.3, 1, 0.1)).normalize();
    const span = 0.35 + Math.random() * 0.5, height = 0.4 + Math.random() * 0.9;
    const a = n.clone().multiplyScalar(SUN_R).addScaledVector(side, -span), b = n.clone().multiplyScalar(SUN_R).addScaledVector(side, span);
    const top = n.clone().multiplyScalar(SUN_R + height);
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(top, 0.6).addScaledVector(n, height * 0.3), top, b.clone().lerp(top, 0.6).addScaledVector(n, height * 0.3), b]);
    p.mesh.geometry.dispose();
    p.mesh.geometry = new THREE.TubeGeometry(curve, 48, 0.05 + Math.random() * 0.06, 8, false);
    p.life = 0; p.dur = 4 + Math.random() * 5;
  }
  proms.forEach(spawnProm); proms.forEach(p => { p.life = Math.random(); });

  // particles streaming off the surface
  const NP = mobile ? 250 : 600;
  const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3);
  const parts = Array.from({ length: NP }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: Math.random() * 3, max: 3 }));
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ map: glow, size: 0.09, vertexColors: true, ...add })); pts.frustumCulled = false; group.add(pts);

  function setTheme(th) {
    theme.hot.set(th.hot); theme.mid.set(th.mid); theme.deep.set(th.deep);
    halo1.material.color.set(th.mid); halo2.material.color.set(th.deep);
  }
  function update(dt, t, L, vis) {
    group.visible = vis > 0.01; if (!group.visible) return;
    group.scale.setScalar(0.3 + 0.7 * vis);
    surface.rotation.y += dt * 0.03;
    surfMat.uniforms.uTime.value = t; surfMat.uniforms.uLevel.value = L; surfMat.uniforms.uVis.value = vis;
    coronaMat.uniforms.uTime.value = t; coronaMat.uniforms.uLevel.value = L; coronaMat.uniforms.uVis.value = vis;
    corona.scale.setScalar(1 + L * 0.12 + Math.sin(t * 1.3) * 0.02);
    halo1.material.opacity = (0.32 + L * 0.35) * vis; halo2.material.opacity = (0.14 + L * 0.15) * vis;
    for (const p of proms) {
      p.life += dt / p.dur * (1 + L);
      if (p.life >= 1) spawnProm(p);
      p.mat.uniforms.uTime.value = t; p.mat.uniforms.uLife.value = p.life; p.mat.uniforms.uVis.value = vis;
    }
    for (let i = 0; i < NP; i++) {
      const q = parts[i];
      q.life += dt;
      if (q.life > q.max) {
        q.p.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(SUN_R * 1.02);
        q.v.copy(q.p).normalize().multiplyScalar(0.15 + Math.random() * 0.35).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.1));
        q.life = 0; q.max = 1.5 + Math.random() * 2.5;
      }
      q.p.addScaledVector(q.v, dt * (1 + L * 2));
      const f = Math.sin(q.life / q.max * Math.PI) * vis;
      pPos[i * 3] = q.p.x; pPos[i * 3 + 1] = q.p.y; pPos[i * 3 + 2] = q.p.z;
      pCol[i * 3] = theme.hot.r * f; pCol[i * 3 + 1] = theme.mid.g * f; pCol[i * 3 + 2] = theme.mid.b * f * 0.6;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }
  return { update, setTheme, group };
}
