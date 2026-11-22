/* Holographic tech layer: the "Jarvis workshop" look.
   - a machine assembly of gear-toothed rings around the core, each turning at its own speed
   - wireframe drones orbiting the core that fire scan beams at it
   - a radar sweep across the floor
   Everything is thin glowing linework in the colour theme. */
import * as THREE from 'three';

const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

function circlePts(r, n, y = 0, a0 = 0, a1 = Math.PI * 2) {
  const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return p;
}

export function createHolo(scene, glow, { mobile = false } = {}) {
  const root = new THREE.Group(); scene.add(root);
  const mats = [];
  const mat = (op, kind = 'mid') => { op *= 0.7; const m = new THREE.LineBasicMaterial({ color: 0xffa83a, ...add, opacity: op }); m.userData = { base: op, kind }; mats.push(m); return m; };

  // ---------------------------------------------------------------- machine assembly (exploded gear rings)
  const machine = new THREE.Group(); root.add(machine);
  machine.rotation.set(0.42, 0, -0.18);
  const ringSpecs = [
    { r: 2.75, y: -0.35, teeth: 96, speed: 0.16, dash: 5 },
    { r: 3.15, y: 0.3, teeth: 0, speed: -0.1, dash: 16 },
  ];
  const rings = ringSpecs.map((s, i) => {
    const g = new THREE.Group(); g.position.y = s.y; machine.add(g);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(s.r, 220)), mat(0.32)));
    if (s.teeth) {
      const t = [];
      for (let k = 0; k < s.teeth; k++) {
        const a = k / s.teeth * Math.PI * 2, a2 = a + Math.PI / s.teeth * 0.9, r2 = s.r + 0.07;
        t.push(new THREE.Vector3(Math.cos(a) * s.r, 0, Math.sin(a) * s.r), new THREE.Vector3(Math.cos(a) * r2, 0, Math.sin(a) * r2),
               new THREE.Vector3(Math.cos(a) * r2, 0, Math.sin(a) * r2), new THREE.Vector3(Math.cos(a2) * r2, 0, Math.sin(a2) * r2),
               new THREE.Vector3(Math.cos(a2) * r2, 0, Math.sin(a2) * r2), new THREE.Vector3(Math.cos(a2) * s.r, 0, Math.sin(a2) * s.r));
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(t), mat(0.4)));
    }
    // bright dashed arcs riding on the ring
    for (let d = 0; d < s.dash; d++) {
      const a0 = d / s.dash * Math.PI * 2 + i, len = (Math.PI * 2 / s.dash) * (0.25 + (d % 3) * 0.12);
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(s.r + 0.14, 24, 0, a0, a0 + len)), mat(0.75, d % 4 === 0 ? 'plasma' : 'mid')));
    }
    // vertical struts connecting to the next ring (the "exploded" look)
    if (false) {
      const n = ringSpecs[i + 1], st = [];
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.2; st.push(new THREE.Vector3(Math.cos(a) * s.r, 0, Math.sin(a) * s.r), new THREE.Vector3(Math.cos(a) * n.r, n.y - s.y, Math.sin(a) * n.r)); }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(st), mat(0.12)));
    }
    return { g, s };
  });

  // ---------------------------------------------------------------- wireframe drones with scan beams
  const shapes = [new THREE.IcosahedronGeometry(0.22, 0), new THREE.OctahedronGeometry(0.24, 0), new THREE.DodecahedronGeometry(0.2, 0), new THREE.TetrahedronGeometry(0.26, 0), new THREE.IcosahedronGeometry(0.18, 1)];
  const drones = shapes.slice(0, mobile ? 3 : 5).map((geo, i) => {
    const g = new THREE.Group(); root.add(g);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat(0.85)); g.add(wire);
    const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.08)), mat(0.9, 'plasma')); g.add(inner);
    const coreDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffa83a, ...add, opacity: 0.8 })); coreDot.scale.setScalar(0.35); g.add(coreDot);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const beamMat = mat(0, 'plasma'); const beam = new THREE.Line(beamGeo, beamMat); beam.frustumCulled = false; root.add(beam);
    const trailPts = 60, trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trailPts * 3), 3));
    const trail = new THREE.Line(trailGeo, mat(0.18)); trail.frustumCulled = false; root.add(trail);
    return { g, wire, inner, coreDot, beam, beamMat, trail, trailPts, hist: [],
      r: 5.2 + i * 0.55, inc: (i - 2) * 0.32, speed: 0.16 + (i % 3) * 0.05, phase: i * 1.3, scanT: 1 + i, scanLife: 0 };
  });

  // ---------------------------------------------------------------- radar sweep on the floor
  const sweepMat = new THREE.ShaderMaterial({
    ...add, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(0xffa83a) }, uVis: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uVis; varying vec2 vUv;
      void main(){ vec2 p = vUv - 0.5; float a = atan(p.y, p.x); float r = length(p) * 2.0;
        float trail = smoothstep(-1.0, 0.0, a) * step(a, 0.0);           // fades behind the leading edge
        float edge = smoothstep(0.03, 0.0, abs(a));
        float rings = 0.5 + 0.5 * step(0.92, fract(r * 6.0));
        float al = (trail * 0.16 * rings + edge * 0.55) * step(r, 1.0) * smoothstep(0.08, 0.2, r) * uVis;
        gl_FragColor = vec4(uColor * al, al); }`,
  });
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), sweepMat);
  sweep.rotation.x = -Math.PI / 2; sweep.position.y = -2.05; root.add(sweep);

  const colors = { mid: new THREE.Color(0xffa83a), plasma: new THREE.Color(0xff7a45) };
  function setTheme(th) {
    colors.mid.set(th.mid); colors.plasma.set(th.plasma);
    for (const m of mats) m.color.copy(colors[m.userData.kind]);
    for (const d of drones) d.coreDot.material.color.copy(colors.plasma);
    sweepMat.uniforms.uColor.value.copy(colors.mid);
  }

  let vis = 1;
  const tmp = new THREE.Vector3();
  let camRef = new THREE.Vector3(0, 3, 12);
  function update(dt, t, L, show, f, cam) {
    if (cam) camRef = cam;
    vis += ((show ? 1 : 0) - vis) * Math.min(1, dt * 2.5);
    root.visible = vis > 0.01; if (!root.visible) return;
    const busy = f.uiState === 'thinking' ? 3 : f.uiState === 'speaking' ? 1.8 : 1;
    for (const m of mats) m.opacity = m.userData.base * vis * (m.userData.kind === 'plasma' ? 0.7 + L * 0.6 : 1);
    rings.forEach(({ g, s }) => { g.rotation.y += dt * s.speed * busy; });
    machine.rotation.y += dt * 0.03;
    sweep.rotation.z -= dt * 0.9 * busy; sweepMat.uniforms.uVis.value = vis;
    for (const d of drones) {
      const a = d.phase + t * d.speed;
      d.g.position.set(Math.cos(a) * d.r, Math.sin(a * 2.0) * 0.4 + Math.sin(d.inc) * Math.sin(a) * d.r * 0.35 + 0.6, Math.sin(a) * d.r);
      d.wire.rotation.x += dt * 0.6; d.wire.rotation.y += dt * 0.9; d.inner.rotation.y -= dt * 2;
      d.coreDot.material.opacity = (0.55 + 0.4 * Math.sin(t * 4 + d.phase)) * vis;
      // trail
      d.hist.unshift(d.g.position.clone()); if (d.hist.length > d.trailPts) d.hist.pop();
      const arr = d.trail.geometry.attributes.position.array;
      for (let i = 0; i < d.trailPts; i++) { const p = d.hist[Math.min(i, d.hist.length - 1)]; arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; }
      d.trail.geometry.attributes.position.needsUpdate = true;
      // scan beam to the core every few seconds (more often while thinking)
      d.scanT -= dt * busy;
      if (d.scanT <= 0) { d.scanT = 3 + Math.random() * 5; d.scanLife = 0.6; }
      d.scanLife = Math.max(0, d.scanLife - dt);
      const ba = d.beam.geometry.attributes.position.array;
      tmp.copy(d.g.position).multiplyScalar(0.25);
      ba.set([d.g.position.x, d.g.position.y, d.g.position.z, tmp.x, tmp.y, tmp.z]); d.beam.geometry.attributes.position.needsUpdate = true;
      d.beamMat.opacity = d.scanLife > 0 && d.g.position.distanceTo(camRef) > 6 ? (0.2 + Math.random() * 0.25) * vis : 0;
    }
  }
  return { update, setTheme, root };
}
