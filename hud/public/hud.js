/* Jarvis HUD: reactor core, red neural routes to blue model nodes, voice in/out. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const TAU = Math.PI * 2;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('jarvis.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); } catch {} try { notePref(k); } catch {} },
  };

  // ------------------------------------------------------------------ app state
  const S = { models: [], active: null, councilMode: false, council: [], router: {}, local: {} };
  const history = [];
  let uiState = 'idle';
  let level = 0, micLevel = 0, speakBoost = 0;
  const levelHist = new Array(90).fill(0);
  let speakingId = null, flowDir = 0;          // 1 = core -> node, -1 = node -> core
  let voiceOn = store.get('voice', true), wakeOn = false;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fxOn = store.get('fx', true), lastType = 0, ac = null, holoOn = store.get('holo', true), sceneName = store.get('scene2', 'auto'), homeCore = store.get('home', 'blackhole'), themeName = store.get('theme', 'amber');
  { const R = { circuit: 'plasma', pulse: 'liquid', stream: 'brain' }; sceneName = R[sceneName] || sceneName; homeCore = R[homeCore] || homeCore; }   // retired cores
  if (sceneName === 'space') sceneName = 'auto';
  document.body.dataset.scene = sceneName;
  const GLYPHS = '▓▒░<>/\\|=+*#ABCDEF0123456789';

  function setState(s) {
    uiState = s;
    document.body.dataset.state = s;
    const label = ({ idle: 'Standby', listening: 'Listening', thinking: 'Routing', speaking: 'Speaking' })[s] || s;
    if ($('#state-label').dataset.v !== label) { $('#state-label').dataset.v = label; decipher($('#state-label'), label, 380); }
  }

  // ------------------------------------------------------------------ scene
  const cv = $('#scene'), ctx = cv.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, R = 100, t0 = performance.now();
  let parts = [], floor = [], nodes = [], beams = [], hoverId = null;
  const isMobile = () => W < 860;

  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H * (isMobile() ? 0.4 : 0.44);
    R = Math.min(W, H) * (isMobile() ? 0.17 : 0.15);
    buildParticles(); buildFloor(); layoutNodes();
  }

  function buildParticles() {
    const n = reduceMotion ? 500 : isMobile() ? 750 : 1500;
    const rand = rng(7);
    parts = [];
    for (let i = 0; i < n; i++) {
      const inner = rand() < 0.18;
      const r = inner ? R * (0.12 + rand() * 0.38) : R * (0.55 + Math.pow(rand(), 0.7) * 0.7);
      parts.push({ r, a: rand() * TAU, w: (0.12 + rand() * 0.45) * (rand() < 0.5 ? 1 : -1) * (inner ? 2.2 : 1), len: 0.015 + rand() * (inner ? 0.25 : 0.09), ring: i % 3, inner });
    }
  }
  function buildFloor() {
    floor = [];
    const rings = isMobile() ? 14 : 22, per = isMobile() ? 44 : 70;
    for (let i = 0; i < rings; i++) for (let j = 0; j < per; j++) floor.push({ r: R * (1.25 + i * 0.13), a: (j / per) * TAU + i * 0.13 });
  }

  function layoutNodes() {
    const list = S.models.filter(m => m.installed || m.id === S.active);
    const n = list.length;
    if (!n) { nodes = []; return; }
    const side = isMobile() ? 0 : 420;            // keep nodes clear of the side panels
    const rx = isMobile() ? W / 2 - 52 : Math.max(R * 1.9, Math.min(R * 2.9, W / 2 - side + 10));
    const ry = isMobile() ? Math.min(H * 0.27, R * 2.6) : Math.min(R * 1.9, H * 0.3);
    const gap = 0.9;                                      // keep the bottom (status text) clear
    nodes = list.map((m, i) => {
      const a = Math.PI / 2 + gap / 2 + (i + 0.5) * (TAU - gap) / n;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      return { ...m, x, y, ang: a, route: makeRoute(m.id, x, y) };
    });
  }

  // Jagged red route from the core to a node, with small side branches.
  function makeRoute(id, x, y) {
    const rand = rng(hash(id));
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    const sx = cx + dx / d * R * 1.05, sy = cy + dy / d * R * 1.05;
    const nx = -dy / d, ny = dx / d;
    const pts = [[sx, sy]];
    const segs = 7;
    for (let i = 1; i < segs; i++) {
      const f = i / segs, j = (rand() - 0.5) * R * 0.34 * Math.sin(f * Math.PI);
      pts.push([sx + (x - sx) * f + nx * j, sy + (y - sy) * f + ny * j]);
    }
    pts.push([x, y]);
    const branches = [];
    for (let b = 0; b < 3; b++) {
      const k = 1 + Math.floor(rand() * (segs - 2));
      let [bx, by] = pts[k];
      const dir = rand() < 0.5 ? 1 : -1, br = [[bx, by]];
      for (let s = 0; s < 3; s++) {
        bx += (dx / d * 0.35 + nx * dir * 0.8) * R * (0.12 + rand() * 0.1) + (rand() - 0.5) * 8;
        by += (dy / d * 0.35 + ny * dir * 0.8) * R * (0.12 + rand() * 0.1) + (rand() - 0.5) * 8;
        br.push([bx, by]);
      }
      branches.push(br);
    }
    let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
    return { pts, branches, len, cum };
  }
  function pointOn(route, f) {
    const target = f * route.len;
    for (let i = 1; i < route.pts.length; i++) {
      if (route.cum[i] >= target) {
        const seg = route.cum[i] - route.cum[i - 1] || 1, k = (target - route.cum[i - 1]) / seg;
        const a = route.pts[i - 1], b = route.pts[i];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
    }
    return route.pts[route.pts.length - 1];
  }
  const nodeById = id => nodes.find(n => n.id === id);

  // ---- drawing helpers
  function polyline(pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }

  function drawFloor(t) {
    const fy = cy + R * 0.95, flat = 0.3, amp = R * 0.05 * (1 + level * 3);
    ctx.fillStyle = 'rgba(79,184,255,0.55)';
    for (const p of floor) {
      const rr = p.r, wave = Math.sin(rr / R * 4 - t * 1.6) * amp * (1 - (rr - R) / (R * 4));
      const x = cx + Math.cos(p.a) * rr, y = fy + Math.sin(p.a) * rr * flat - wave;
      const s = Math.sin(p.a) > 0 ? 1.6 : 1.1;
      ctx.globalAlpha = 0.15 + 0.35 * (Math.sin(p.a) * 0.5 + 0.5) * (1 - (rr - R) / (R * 4.2));
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    // glowing amber ring on the floor
    ctx.save();
    ctx.shadowColor = '#ff8a2a'; ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255,150,50,${0.45 + level * 0.4})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, fy, R * 1.55, R * 1.55 * flat, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function drawRoutes(t) {
    for (const n of nodes) {
      const r = n.route;
      const isActive = n.id === S.active, isSpeaking = n.id === speakingId;
      const err = n.status && n.status.state === 'error';
      ctx.lineCap = 'round';
      // faint branches
      ctx.strokeStyle = err ? 'rgba(255,74,50,0.08)' : 'rgba(255,74,50,0.14)';
      ctx.lineWidth = 1;
      for (const b of r.branches) { polyline(b); ctx.stroke(); }
      // main route
      ctx.save();
      if (isActive || isSpeaking) { ctx.shadowColor = '#ff4a32'; ctx.shadowBlur = 14; }
      ctx.strokeStyle = isSpeaking ? 'rgba(255,120,70,0.95)' : isActive ? 'rgba(255,74,50,0.75)' : err ? 'rgba(255,74,50,0.12)' : 'rgba(255,74,50,0.25)';
      ctx.lineWidth = isSpeaking ? 2.6 : isActive ? 1.8 : 1;
      polyline(r.pts); ctx.stroke();
      ctx.restore();
      // energy pulses travelling along the route
      if (isActive || isSpeaking) {
        const speed = isSpeaking ? 0.9 : 0.22, count = isSpeaking ? 5 : 2;
        const dir = isSpeaking && flowDir < 0 ? -1 : 1;
        for (let k = 0; k < count; k++) {
          let f = ((t * speed + k / count) % 1); if (dir < 0) f = 1 - f;
          const [px, py] = pointOn(r, f);
          ctx.fillStyle = '#ffd38a';
          ctx.beginPath(); ctx.arc(px, py, isSpeaking ? 2.6 : 1.8, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,90,50,0.25)';
          ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.fill();
        }
      }
    }
  }

  function drawBeams(t, dt) {
    beams = beams.filter(b => (b.life -= dt) > 0);
    for (const b of beams) {
      const A = nodeById(b.from), B = b.to === 'core' ? { x: cx, y: cy } : nodeById(b.to);
      if (!A || !B) continue;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const qx = mx + (cx - mx) * 0.55, qy = my + (cy - my) * 0.55;
      const alpha = Math.min(1, b.life / 0.6);
      const g = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
      g.addColorStop(0, `rgba(79,184,255,${alpha})`); g.addColorStop(1, `rgba(255,74,50,${alpha})`);
      ctx.save(); ctx.shadowColor = '#ff4a32'; ctx.shadowBlur = 12;
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(qx, qy, B.x, B.y); ctx.stroke();
      ctx.restore();
      for (let k = 0; k < 3; k++) {
        const f = (t * 0.8 + k / 3) % 1, u = 1 - f;
        const px = u * u * A.x + 2 * u * f * qx + f * f * B.x, py = u * u * A.y + 2 * u * f * qy + f * f * B.y;
        ctx.fillStyle = `rgba(255,230,200,${alpha})`; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, TAU); ctx.fill();
      }
    }
  }

  function drawReactor(t) {
    const speed = ({ idle: 1, listening: 0.6, thinking: 2.6, speaking: 1.5 })[uiState] || 1;
    const tilts = [[0.35 + Math.sin(t * 0.2) * 0.15, t * 0.05], [1.15, t * 0.09 + 2], [-0.75 + Math.sin(t * 0.13) * 0.2, -t * 0.07 + 4]];
    const cs = tilts.map(([x, y]) => [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y)]);
    const listen = uiState === 'listening';
    const buckets = [[], [], [], [], []];
    const amp = 0.16 * level;
    for (const p of parts) {
      p.a += p.w * 0.004 * speed;
      const [cxr, sxr, cyr, syr] = cs[p.ring];
      const wob = 1 + amp * Math.sin(p.a * 6 + t * 4);
      const r = p.r * wob;
      const proj = a => {
        const x = r * Math.cos(a), y = r * Math.sin(a);
        const y1 = y * cxr, z1 = y * sxr;
        return [x * cyr + z1 * syr, y1, -x * syr + z1 * cyr];
      };
      const [x1, y1, z] = proj(p.a), [x2, y2] = proj(p.a - p.len * Math.sign(p.w));
      const depth = (z / (R * 1.3) + 1) / 2;
      const b = p.inner ? 4 : Math.min(3, Math.floor(depth * 3.2 + level * 1.2));
      buckets[b].push(cx + x1, cy + y1, cx + x2, cy + y2);
    }
    const colors = listen
      ? ['rgba(79,184,255,0.18)', 'rgba(79,184,255,0.35)', 'rgba(140,210,255,0.6)', 'rgba(200,235,255,0.85)', 'rgba(255,211,138,0.9)']
      : ['rgba(255,110,30,0.2)', 'rgba(255,140,40,0.38)', 'rgba(255,168,58,0.62)', 'rgba(255,211,138,0.88)', 'rgba(255,236,200,0.95)'];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < buckets.length; i++) {
      const arr = buckets[i]; if (!arr.length) continue;
      ctx.strokeStyle = colors[i]; ctx.lineWidth = i >= 3 ? 1.6 : 1.1;
      ctx.beginPath();
      for (let k = 0; k < arr.length; k += 4) { ctx.moveTo(arr[k], arr[k + 1]); ctx.lineTo(arr[k + 2], arr[k + 3]); }
      ctx.stroke();
    }
    // core glow
    const gr = R * (0.55 + level * 0.35);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
    g.addColorStop(0, listen ? 'rgba(220,240,255,0.95)' : 'rgba(255,240,210,0.95)');
    g.addColorStop(0.25, listen ? 'rgba(79,184,255,0.55)' : 'rgba(255,168,58,0.55)');
    g.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, gr, 0, TAU); ctx.fill();
    // inner swirl loops
    ctx.strokeStyle = listen ? 'rgba(180,225,255,0.55)' : 'rgba(255,211,138,0.55)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * (0.18 + i * 0.03) * (1 + level * 0.5), R * (0.08 + i * 0.02), t * (0.6 + i * 0.25) * speed + i, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHudRings(t) {
    const col = uiState === 'listening' ? '79,184,255' : '255,168,58';
    ctx.save();
    ctx.strokeStyle = `rgba(${col},0.22)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.38, 0, TAU); ctx.stroke();
    // ticks
    const rot = t * 0.05;
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = rot + i * TAU / 120, long = i % 10 === 0;
      const r1 = R * 1.43, r2 = R * (long ? 1.52 : 1.47);
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    }
    ctx.strokeStyle = `rgba(${col},0.35)`; ctx.stroke();
    // rotating arc segments
    ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${col},${0.45 + level * 0.4})`;
    const segs = [[0, 0.7], [1.2, 1.6], [2.4, 3.6], [4.2, 4.5], [5.0, 5.8]];
    for (const [a1, a2] of segs) { ctx.beginPath(); ctx.arc(cx, cy, R * 1.62, a1 - t * 0.12, a2 - t * 0.12); ctx.stroke(); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(255,74,50,0.5)`;
    for (const [a1, a2] of segs.slice(0, 3)) { ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, a1 + t * 0.2, a1 + t * 0.2 + (a2 - a1) * 0.4); ctx.stroke(); }
    ctx.restore();
  }

  function drawNodes(t) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const n of nodes) {
      const active = n.id === S.active, speaking = n.id === speakingId, hover = n.id === hoverId;
      const st = n.status ? n.status.state : 'ready';
      const pulse = speaking ? 1 + level * 0.6 : 1 + Math.sin(t * 2 + n.ang * 3) * 0.06;
      const r = (active ? 11 : 8) * pulse * (hover ? 1.2 : 1);
      const base = st === 'error' ? '255,74,50' : st === 'missing' ? '120,130,145' : '79,184,255';
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
      g.addColorStop(0, `rgba(230,245,255,0.95)`); g.addColorStop(0.3, `rgba(${base},0.85)`); g.addColorStop(1, `rgba(${base},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(${base},0.9)`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
      if (active) {
        ctx.strokeStyle = 'rgba(255,168,58,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 9, t * 1.5, t * 1.5 + TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if (S.council.includes(n.id)) {
        ctx.fillStyle = S.councilMode ? '#ff4a32' : 'rgba(255,74,50,0.5)';
        ctx.beginPath(); const dy = n.y - r - 14; ctx.moveTo(n.x, dy - 5); ctx.lineTo(n.x + 5, dy); ctx.lineTo(n.x, dy + 5); ctx.lineTo(n.x - 5, dy); ctx.fill();
      }
      ctx.fillStyle = active ? '#ffd38a' : hover ? '#ffffff' : '#cfe7ff';
      ctx.font = `600 ${isMobile() ? 11 : 13}px Rajdhani, system-ui, sans-serif`;
      ctx.fillText(n.label.toUpperCase(), n.x, n.y + r + 18);
      ctx.fillStyle = st === 'error' ? '#ff8a7a' : 'rgba(150,170,195,0.85)';
      ctx.font = `400 ${isMobile() ? 9 : 10}px "JetBrains Mono", monospace`;
      const meta = st === 'ok' && n.status.ms ? `${n.group} · ${(n.status.ms / 1000).toFixed(1)}s` : st === 'error' ? `${n.group} · error` : st === 'missing' ? 'not downloaded' : n.group;
      ctx.fillText(meta.toUpperCase(), n.x, n.y + r + 31);
    }
    ctx.restore();
  }

  function drawSignal() {
    const c = $('#signal'); if (!c || !c.offsetWidth) return;
    const w = c.offsetWidth, h = 48, dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = h * dpr; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,168,58,0.15)'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.strokeStyle = '#ffa83a'; g.lineWidth = 1.5; g.beginPath();
    levelHist.forEach((v, i) => { const x = i / (levelHist.length - 1) * w, y = h - 4 - v * (h - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    $('#signal-meta').textContent = Math.round(level * 100) + '%';
  }

  let last = performance.now(), frame = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    let target;
    if (uiState === 'listening') target = micLevel;
    else if (uiState === 'speaking' && studioAudio && studioAnalyser) {
      studioAnalyser.getByteTimeDomainData(studioData);
      let sum = 0; for (const v of studioData) sum += ((v - 128) / 128) ** 2;
      target = Math.min(1, Math.sqrt(sum / studioData.length) * 5);
    }
    else if (uiState === 'speaking') { target = 0.35 + 0.3 * Math.abs(Math.sin(t * 7.3)) * Math.abs(Math.sin(t * 2.1)) + speakBoost; speakBoost *= 0.9; }
    else if (uiState === 'thinking') target = 0.25 + 0.12 * Math.sin(t * 6);
    else target = 0.06 + 0.04 * Math.sin(t * 1.2);
    level += (Math.min(1, target) - level) * 0.15;
    if (frame++ % 3 === 0) { levelHist.push(level); levelHist.shift(); drawSignal(); }

    if (window.JarvisScene && window.JarvisScene.ready) {   // 3D scene draws; we only age the beams
      beams = beams.filter(b => (b.life -= dt) > 0);
      requestAnimationFrame(loop);
      return;
    }
    ctx.clearRect(0, 0, W, H);
    drawFloor(t);
    drawRoutes(t);
    drawBeams(t, dt);
    drawReactor(t);
    drawHudRings(t);
    drawNodes(t);
    requestAnimationFrame(loop);
  }

  // node hover / click
  function nodeAt(x, y) { let best = null, bd = 26; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } } return best; }
  cv.addEventListener('mousemove', e => { const n = nodeAt(e.clientX, e.clientY); hoverId = n ? n.id : null; cv.style.cursor = n ? 'pointer' : 'crosshair'; });
  cv.addEventListener('click', e => { const n = nodeAt(e.clientX, e.clientY); if (n) switchTo(n.id); });

  // ------------------------------------------------------------------ server state + panels
  async function refreshState() {
    try {
      const r = await fetch('/api/state'); if (!r.ok) throw new Error();
      Object.assign(S, await r.json());
      if (S.assistant) applyAssistant(S.assistant);
    } catch { S.router = { online: false }; }
    render();
  }
  let modelsVersion = 0;
  function render() {
    modelsVersion++;
    layoutNodes();
    const chip = (id, ok, text) => { const el = $(id); el.className = 'chip ' + (ok ? 'ok' : 'bad'); el.lastChild.textContent = text; };
    chip('#chip-router', S.router.online, S.router.online ? 'Router online' : 'Router offline');
    chip('#chip-local', S.local.online, S.local.online ? `Local · ${S.local.models.length}` : 'Local offline');
    const okN = S.models.filter(m => m.status.state === 'ok').length;
    const errN = S.models.filter(m => m.status.state === 'error').length;
    chip('#chip-links', okN > 0, `Links ${okN}/${S.models.filter(m => m.installed).length}`);
    if (!okN && !errN) $('#chip-links').className = 'chip';
    const mode = $('#chip-mode'); mode.textContent = S.councilMode ? 'Council' : 'Single'; mode.classList.toggle('council', S.councilMode);
    const tc = $('#t-council'); tc.classList.toggle('on', S.councilMode); tc.setAttribute('aria-pressed', S.councilMode);
    const a = S.models.find(m => m.id === S.active);
    const am = a ? (S.councilMode ? `Council chair · ${a.label}` : `Routed · ${a.label} · ${a.group}`) : '—';
    if ($('#active-model').dataset.v !== am) { $('#active-model').dataset.v = am; decipher($('#active-model'), am, 600); }
    $('#links-meta').textContent = `${S.models.length} models`;

    const box = $('#links'); box.innerHTML = '';
    box.classList.toggle('first', !box.dataset.done); box.dataset.done = '1';
    const groups = [];
    for (const m of S.models) { let g = groups.find(x => x.name === m.group); if (!g) groups.push(g = { name: m.group, items: [] }); g.items.push(m); }
    for (const g of groups) {
      const lab = document.createElement('div'); lab.className = 'group-label'; lab.textContent = g.name; box.appendChild(lab);
      for (const m of g.items) {
        const st = m.status.state;
        const row = document.createElement('div');
        row.className = `link ${st}${m.id === S.active ? ' active' : ''}`;
        row.setAttribute('role', 'button'); row.tabIndex = 0;
        row.title = m.note || m.model;
        const meta = m.id === S.active ? `⚡ linked${st === 'ok' ? ' · ' + (m.status.ms / 1000).toFixed(1) + 's' : ''}` : st === 'ok' ? `${(m.status.ms / 1000).toFixed(1)}s` : st === 'error' ? 'error' : st === 'missing' ? 'not downloaded' : m.paid ? 'paid' : 'ready';
        row.innerHTML = `<span class="dot"></span><span class="name"></span><span class="meta">${meta}</span><button class="seat${S.council.includes(m.id) ? ' on' : ''}" type="button" aria-label="Council seat">◆</button>`;
        row.querySelector('.name').textContent = m.label;
        if (st === 'error' && m.status.error) { const e = document.createElement('span'); e.className = 'err-text'; e.textContent = m.status.error; row.appendChild(e); }
        row.addEventListener('click', ev => { if (ev.target.closest('.seat')) return; switchTo(m.id); });
        row.addEventListener('keydown', ev => { if (ev.key === 'Enter') switchTo(m.id); });
        row.addEventListener('mouseenter', () => fx('tick'));
        row.querySelector('.seat').addEventListener('click', () => toggleSeat(m.id));
        box.appendChild(row);
      }
    }
  }
  async function command(body) {
    try { const r = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); Object.assign(S, await r.json()); } catch {}
    render();
  }
  function switchTo(id) {
    if (id === S.active) return;
    const from = S.models.find(x => x.id === S.active), to = S.models.find(x => x.id === id);
    command({ action: 'switch', id });
    fx('route');
    flash(id);
    if (to) linkCard(from, to);
  }

  // ---- LINK TRANSFER card: shows exactly which model the link moves to
  let pendingLink = null;
  function linkCard(from, to) {
    const tag = (txt, cls) => `<span class="lc-tag ${cls}">${txt}</span>`;
    const badge = m => !m ? '' : String(m.model).startsWith('cli/') ? [tag('YOUR ACCOUNT', 'local'), tag('ON THIS COMPUTER', 'free')].join('')
      : [m.local ? tag('LOCAL', 'local') : tag('CLOUD', 'cloud'), m.paid ? tag('PAID', 'paid') : tag('FREE', 'free')].join('');
    const el = document.createElement('div');
    el.className = 'link-card';
    el.innerHTML = `
      <div class="lc-head"><span>⚡ LINK TRANSFER</span><span class="lc-status">ESTABLISHING…</span></div>
      <div class="lc-row lc-from"><span class="lc-k">FROM</span><span class="lc-name"></span><span class="lc-sub"></span></div>
      <div class="lc-beam"><i></i></div>
      <div class="lc-row lc-to"><span class="lc-k">TO</span><span class="lc-name"></span><span class="lc-sub"></span></div>
      <div class="lc-tags">${badge(to)}</div>
      <div class="lc-model"></div>`;
    el.querySelector('.lc-from .lc-name').textContent = from ? from.label : '—';
    el.querySelector('.lc-from .lc-sub').textContent = from ? from.group : '';
    el.querySelector('.lc-to .lc-name').textContent = to.label;
    el.querySelector('.lc-to .lc-sub').textContent = to.group;
    el.querySelector('.lc-model').textContent = to.model;
    log.appendChild(el); log.scrollTop = log.scrollHeight;
    decipher(el.querySelector('.lc-to .lc-name'), to.label, 700);
    setTimeout(() => { el.classList.add('done'); el.querySelector('.lc-status').textContent = 'LINKED'; fx('msg'); }, 1100);
    pendingLink = { el, id: to.id };
  }
  function linkLatency(id, ms) {
    if (!pendingLink || pendingLink.id !== id) return;
    const s = pendingLink.el.querySelector('.lc-status'); s.textContent = `LINKED · ${(ms / 1000).toFixed(2)} s`;
    pendingLink = null;
  }
  function toggleSeat(id) {
    let ids = S.council.includes(id) ? S.council.filter(x => x !== id) : [...S.council, id];
    if (ids.length > 4) ids = ids.slice(-4);
    command({ action: 'councilMembers', ids });
  }
  function flash(id) { speakingId = id; flowDir = 1; setTimeout(() => { if (speakingId === id && uiState === 'idle') speakingId = null; }, 1400); }

  // ------------------------------------------------------------------ log
  const log = $('#log');
  function addMsg(kind, who, text, extra = '') {
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.innerHTML = `<div class="who"><span></span><span class="ms">${extra}</span></div><div class="text"></div>`;
    decipher(el.querySelector('.who span'), who, 420);
    el.querySelector('.text').textContent = text;
    if (kind !== 'user') fx(kind.includes('err') ? 'click' : 'msg');
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  $('#clear-log').addEventListener('click', () => { log.innerHTML = ''; history.length = 0; });

  // ------------------------------------------------------------------ Jarvis Hands (your computer, ../../hands/hands.js)
  // This page (in YOUR browser, on your computer) is what talks to Jarvis Hands, never the server in Docker.
  // Pair once: start `node hands/hands.js`, then type "hands code <code>". Steps run straight away.
  const HANDS = 'http://localhost:3003';   // Jarvis Hands (terminal); laptop control is 3002
  let handsToken = store.get('handsToken', ''), handsInfo = null, queuedStep = null, queuedAgent = null, queuedBrain = null;
  async function handsFetch(p, body) {
    const r = await fetch(HANDS + p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-token': handsToken }, body: JSON.stringify(body) }
                                          : { headers: { 'x-jarvis-token': handsToken } });
    const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  }
  async function handsConnect(quiet) {
    if (!handsToken) { handsInfo = null; return false; }
    try {
      handsInfo = await handsFetch('/info');
      if (!quiet) { addMsg('sys', 'Jarvis', `Hands connected to ${handsInfo.os}. Work folder: ${handsInfo.cwd}.`); chime(660, 990); }
      return true;
    } catch (e) {
      handsInfo = null;
      if (!quiet) addMsg('err', 'Hands', `Couldn't reach Jarvis Hands (${e.message}). Is "node hands/hands.js" running on this computer?`);
      return false;
    }
  }
  // opened by the Jarvis app launcher (scripts/jarvis-launch.sh): it passes the pairing code in the address, so Mark
  // never has to type it. The code is stored, then removed from the address bar.
  // ---- your choices follow you: voices, theme, eco, wake word, Jarvis/Sophia go to Supabase through the HUD server
  // (never the Hands pairing code or anything secret). The newest copy wins; a new computer picks them up on load.
  const PREF_KEYS = ['fx', 'holo', 'scene2', 'home', 'theme', 'voice', 'engine', 'studioVoice', 'voiceName', 'rate', 'pitch', 'wake',
                     'assistant', 'voice.jarvis', 'voice.sophia', 'quality'];
  let prefTimer = null, applyingPrefs = false;
  function notePref(k) {
    if (applyingPrefs || !PREF_KEYS.includes(k)) return;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => {
      const value = {};
      try { for (const key of PREF_KEYS) { const v = localStorage.getItem('jarvis.' + key); if (v !== null) value[key] = v; } } catch { return; }
      const at = new Date().toISOString(); try { localStorage.setItem('jarvis.prefs_at', JSON.stringify(at)); } catch {}
      fetch('/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value, updated_at: at }) }).catch(() => {});
    }, 2500);
  }
  (async () => {
    try {
      const r = await (await fetch('/api/prefs')).json();
      const localAt = store.get('prefs_at', null);
      if (!r.updated_at || (localAt && Date.parse(localAt) >= Date.parse(r.updated_at))) return;
      applyingPrefs = true;
      for (const [k, v] of Object.entries(r.value || {})) if (PREF_KEYS.includes(k) && typeof v === 'string') localStorage.setItem('jarvis.' + k, v);
      localStorage.setItem('jarvis.prefs_at', JSON.stringify(r.updated_at));
      if (!sessionStorage.getItem('jarvis.prefsLoaded')) { sessionStorage.setItem('jarvis.prefsLoaded', '1'); location.reload(); }
    } catch {} finally { applyingPrefs = false; }
  })();
  const fromLauncher = location.hash.match(/hands=([a-f0-9]{12})/);
  if (fromLauncher) { handsToken = fromLauncher[1]; store.set('handsToken', handsToken); window.history.replaceState(null, '', location.pathname + location.search); }
  handsConnect(!fromLauncher);
  async function handsRun(step) {
    try {
      if (step.action === 'open') { await handsFetch('/open', { url: step.url }); addMsg('sys', 'Jarvis', `Opened ${step.url}`); return null; }
      const r = await handsFetch('/run', { command: step.command });
      const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
      const el = addMsg('sys hands-out', `Hands · ${r.code === 0 ? 'done' : 'exit ' + r.code}`, `$ ${r.command}\n${out || '(no output)'}`, (r.ms / 1000).toFixed(1) + 's');
      el.classList.toggle('err', r.code !== 0);
      return r;
    } catch (e) { addMsg('err', 'Hands', e.message); return null; }
  }

  // ------------------------------------------------------------------ agents (hands/agents.js, on your computer)
  const seenRuns = new Set(store.get('seenRuns', []));
  const markSeen = id => { seenRuns.add(id); store.set('seenRuns', [...seenRuns].slice(-200)); };
  const routineText = a => a.at ? `every day at ${a.at}` : a.every_minutes ? `every ${a.every_minutes} min` : 'on request';
  function say(text) { addMsg('sys', 'Jarvis', text); speakText(text); }
  async function watchRun(runId, name) {
    markSeen(runId); let shown = 0;
    for (let i = 0; i < 400; i++) {                      // up to ~20 minutes
      await new Promise(r => setTimeout(r, 2500));
      let run; try { run = (await handsFetch('/runs?id=' + encodeURIComponent(runId))).run; } catch { continue; }
      for (; shown < run.steps.length; shown++) {
        const st = run.steps[shown];
        const head = st.action === 'run' ? `$ ${st.command}` : st.action === 'open' ? `open ${st.url}`
          : st.action === 'brain' ? `${st.engine === 'codex' ? 'ChatGPT' : 'Claude'} (your account) worked on it:` : '(unclear reply, asked again)';
        addMsg('sys hands-out', `${name} · step ${shown + 1}`, `${head}${st.why ? '   # ' + st.why : ''}\n${String(st.result || '').trim()}`);
      }
      if (run.status !== 'running') { say(`${name}: ${run.summary || run.status}`); return; }
    }
  }
  async function agentOp(d) {
    try {
      if (d.op === 'create') {
        const { agent: a } = await handsFetch('/agents', { name: d.name, role: d.role, task: d.task, model: d.model, every_minutes: d.every_minutes, at: d.at, engine: d.engine || 'router' });
        say(`${a.name} is on the team. Job: ${a.role}. Routine: ${routineText(a)}. Say "ask ${a.name} to ..." to give it work.`);
      } else if (d.op === 'list') {
        const { agents, running } = await handsFetch('/agents');
        if (!agents.length) return say('No agents yet. Say "create an agent called scout that ..." to hire one.');
        addMsg('sys hands-out', 'Team', agents.map(a => `${a.name}${running.includes(a.id) ? ' (working)' : ''} · ${routineText(a)}\n  ${a.role}${a.last_summary ? '\n  last: ' + a.last_summary : ''}`).join('\n'));
        speakText(`You have ${agents.length} agent${agents.length > 1 ? 's' : ''}: ${agents.map(a => a.name).join(', ')}.`);
      } else if (d.op === 'delete') {
        const r = await handsFetch('/agents/delete', { name: d.name }); say(`${r.removed} has left the team.`);
      } else if (d.op === 'run') {
        const r = await handsFetch('/agents/run', { name: d.name, task: d.task || '' });
        if (r.already) { say(`${r.agent} is already working on something.`); return; }
        watchRun(r.run, r.agent);
      } else if (d.op === 'report') {
        const { runs } = await handsFetch('/runs?agent=' + encodeURIComponent(d.name));
        const last = runs[runs.length - 1];
        if (!last) return say(`${d.name} hasn't done anything yet.`);
        addMsg('sys hands-out', `${last.name} · last run (${last.why})`, `Task: ${last.task}\n${last.steps.map((s, i) => `${i + 1}. ${s.command ? '$ ' + s.command : s.url || s.action}`).join('\n')}`);
        say(`${last.name}: ${last.summary || last.status}`);
      }
    } catch (e) { addMsg('err', 'Agents', e.message); }
  }
  // your own Claude / ChatGPT accounts: Claude Code or Codex does the work on this computer (hands/brains.js)
  async function runBrain(d) {
    setState('thinking'); flowDir = 1;
    const wait = addMsg('sys', d.label, d.chat ? 'Thinking…' : 'Working on it on your computer…');
    let r; try { r = await handsFetch('/brain', { engine: d.engine, prompt: d.prompt, system: d.system || '' }); } catch (e) { r = { ok: false, text: e.message }; }
    wait.remove();
    if (!r.ok) { addMsg('err', d.label, r.text || 'no answer'); setState('idle'); return; }
    if (d.chat) {
      addMsg('', `${myName()} · ${d.label}`, r.text, ((r.ms || 0) / 1000).toFixed(1) + 's');
      history.push({ role: 'user', content: d.prompt.split('Mark: ').pop() }, { role: 'assistant', content: r.text });
      speakText(r.text);
    } else {
      addMsg('sys hands-out', `${d.label} · done`, r.text, ((r.ms || 0) / 1000).toFixed(1) + 's');
      speakText(r.text.replace(/```[\s\S]*?```/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' '));   // the gist out loud
    }
    if (!speaking) setState('idle');
  }

  // ---- API keys form: Hands writes them into .env on this computer and restarts the model router
  const KEYS = [
    ['GROQ_API_KEY', 'Groq (fast, free)', 'https://console.groq.com/keys'],
    ['OPENROUTER_API_KEY', 'OpenRouter (free models; Grok and Claude with credit)', 'https://openrouter.ai/keys'],
    ['GEMINI_API_KEY', 'Gemini (free, small)', 'https://aistudio.google.com/apikey'],
    ['NVIDIA_NIM_API_KEY', 'NVIDIA (Nemotron, Kimi)', 'https://build.nvidia.com/settings/api-keys'],
    ['ZAI_API_KEY', 'Z.ai (GLM)', 'https://z.ai/manage-apikey/apikey-list'],
    ['ELEVENLABS_API_KEY', 'ElevenLabs (Jarvis and Sophia voices)', 'https://elevenlabs.io/app/settings/api-keys'],
    ['JARVIS_SYNC_TOKEN', 'Supabase sync code (your own random code)', ''],
  ];
  async function openKeys() {
    const panel = $('#keys-panel'), form = $('#keys-form'), msg = $('#keys-msg');
    if (!handsInfo) { addMsg('sys', myName(), 'The keys form saves through Jarvis Hands on your computer. Open Jarvis from its app icon (it starts Hands), then try again.'); return; }
    let have = {}; try { have = (await handsFetch('/keys')).keys; } catch (e) { addMsg('err', 'Keys', e.message); return; }
    form.innerHTML = '';
    for (const [k, label, link] of KEYS) {
      const row = document.createElement('div'); row.className = 'kp-row';
      row.innerHTML = `<label for="kp-${k}"></label>${link ? `<a target="_blank" rel="noopener" href="${link}">get a key ↗</a>` : '<span></span>'}<input id="kp-${k}" type="password" spellcheck="false"><span class="kp-set"></span>`;
      row.querySelector('label').textContent = label;
      const st = row.querySelector('.kp-set'); st.textContent = have[k] ? '✓ saved' : 'not set'; st.classList.toggle('no', !have[k]);
      row.querySelector('input').placeholder = have[k] ? 'paste a new one to replace it' : 'paste your key';
      row.querySelector('input').dataset.key = k; form.appendChild(row);
    }
    msg.textContent = ''; panel.hidden = false;
  }
  $('#t-keys').addEventListener('click', () => { const p = $('#keys-panel'); if (p.hidden) openKeys(); else p.hidden = true; });
  $('#keys-close').addEventListener('click', () => { $('#keys-panel').hidden = true; });
  $('#keys-save').addEventListener('click', async () => {
    const keys = {}; for (const i of $('#keys-form').querySelectorAll('input')) if (i.value.trim()) keys[i.dataset.key] = i.value.trim();
    const msg = $('#keys-msg');
    if (!Object.keys(keys).length) { msg.textContent = 'Nothing new to save.'; return; }
    try {
      const r = await handsFetch('/keys', { keys });
      for (const i of $('#keys-form').querySelectorAll('input')) i.value = '';                  // don't keep keys on screen
      msg.textContent = r.saved.length ? `Saved ${r.saved.length}. Restarting the model router…` : 'Those didn\'t look like keys (no spaces, at least 8 characters).';
      if (r.saved.length) { chime(660, 990); setTimeout(() => { $('#keys-panel').hidden = true; say(`Keys saved. Give me about thirty seconds to restart, then say status.`); }, 1500); }
    } catch (e) { msg.textContent = e.message; }
  });

  // routines run on their own while Hands is on; tell Mark when one finishes
  let primed = false;                                   // the first check only notes runs that finished before
  setInterval(async () => {
    if (!handsInfo) return;
    try {
      const { agents } = await handsFetch('/agents');
      for (const a of agents) if (a.last_run && !seenRuns.has(a.last_run)) { markSeen(a.last_run); if (primed) say(`${a.name} finished its routine: ${a.last_summary || a.last_status}`); }
      primed = true;
    } catch {}
  }, 20e3);

  // ------------------------------------------------------------------ chat
  let busy = false;
  // Conversation mode (Mark: "don't make me tap again every time"): once he talks by voice, the mic opens again by
  // itself after each reply, so it's a back-and-forth like a phone call. A silent turn, "stop", Esc or typing ends it.
  let convo = false;
  const ENDS_CONVO = /^(?:(?:jarvis|sophia)[,\s]+)?(?:stop( listening)?|goodbye|bye|that'?s all|thanks,? that'?s all|never ?mind|go to sleep)[.!]?$/i;
  function followUp() { if (convo) setTimeout(() => { if (convo && !busy && !speaking && !rec) startListening(); }, 350); }
  async function send(text, extra = null) {
    text = String(text || '').trim();
    if (!text || busy) return;
    const pair = text.match(/^(?:jarvis[,\s]+)?hands (?:code|pair)\s+([a-f0-9]{12})$/i);
    if (pair || /^(?:jarvis[,\s]+)?hands (?:disconnect|unpair|forget)$/i.test(text)) {
      $('#input').value = ''; addMsg('user', 'You', pair ? 'hands code ••••' : text);
      handsToken = pair ? pair[1].toLowerCase() : ''; store.set('handsToken', handsToken);
      if (pair) await handsConnect(false); else { handsInfo = null; addMsg('sys', 'Jarvis', 'Hands disconnected. I can no longer touch your computer.'); }
      return;
    }
    busy = true;
    stopSpeaking();
    $('#input').value = '';
    if (!extra) addMsg('user', 'You', text);
    setState('thinking'); flowDir = 1; speakingId = S.active;
    let bubble = null, bubbleText = '', prevSpeaker = null, finalText = '', pending = null, role = '';
    const flushSpeech = () => { if (pending) { speakText(pending); pending = null; } };
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, history: history.slice(-12), hands: handsInfo, ...(extra || {}) }) });
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data:')) continue;
          let d; try { d = JSON.parse(chunk.slice(5)); } catch { continue; }
          if (d.type === 'start') {
            flushSpeech();
            role = d.role;
            const kind = ({ member: 'member', verdict: 'verdict', system: 'sys' })[d.role] || '';
            const who = d.role === 'member' ? `${d.label} · council` : d.role === 'verdict' ? `${myName()} verdict · ${d.label}` : d.role === 'system' ? (d.label || myName()) : d.role === 'lina' ? `Lina writer · ${d.label}` : `${myName()} · ${d.label}`;
            bubble = addMsg(kind + ' typing', who, ''); bubbleText = '';
            if (d.speaker !== 'jarvis') {
              if (S.councilMode && prevSpeaker && prevSpeaker !== d.speaker) beams.push({ from: prevSpeaker, to: d.speaker, life: 2.6 });
              if (d.role === 'verdict') for (const id of S.council) beams.push({ from: id, to: S.active, life: 3 });
              speakingId = d.speaker; prevSpeaker = d.speaker;
            }
          } else if (d.type === 'token') {
            if (uiState !== 'speaking') setState('speaking');
            flowDir = -1; speakBoost = 0.25; fx('type');
            bubbleText += d.text;
            if (bubble) { bubble.querySelector('.text').textContent = bubbleText; log.scrollTop = log.scrollHeight; }
          } else if (d.type === 'replace') {
            bubbleText = d.text; if (bubble) bubble.querySelector('.text').textContent = d.text;
            if (pending !== null) pending = d.text;
          } else if (d.type === 'end') {
            if (bubble) { bubble.classList.remove('typing'); if (d.ms) bubble.querySelector('.ms').textContent = (d.ms / 1000).toFixed(1) + 's'; }
            if (d.ms) linkLatency(d.speaker, d.ms);
            const speakIt = role === 'lina' ? false : role !== 'member' || !S.councilMode ? true : store.get('speakMembers', false);   // Jarvis explains Lina in English
            if (speakIt) pending = bubbleText;
            if (role === 'answer' || role === 'verdict') finalText = bubbleText;
            if (role === 'system' && !finalText) finalText = bubbleText;
          } else if (d.type === 'error') {
            if (bubble) bubble.classList.remove('typing');
            addMsg('err', d.label || 'Link', `${d.label || 'Model'}: ${d.message}`);
            chime(300, 220);
          } else if (d.type === 'fallback') {
            addMsg('sys', 'Jarvis', `${d.label} taking over.`);
            beams.push({ from: d.from, to: d.to, life: 2.5 });
          } else if (d.type === 'command') {
            if (d.action === 'switch') { const from = S.models.find(x => x.id === S.active), to = S.models.find(x => x.id === d.id); S.active = d.id; render(); flash(d.id); fx('route'); if (to) linkCard(from, to); }
            if (d.action === 'voice') changeVoice(d.query);
            if (d.action === 'holo') setHolo(d.on, true);
            if (d.action === 'play') window.JarvisScene?.play?.(d.what);
            if (d.action === 'control') controlCmd(d);
            if (d.action === 'scene') setScene(d.scene, true);
            if (d.action === 'theme') setTheme(d.theme, true);
            if (d.action === 'council') { S.councilMode = d.on; render(); chime(d.on ? 520 : 880, d.on ? 780 : 520); }
            if (d.action === 'lina') { if (d.status === 'invalid') chime(300, 220); else chime(660, d.status === 'saved' ? 990 : 880); }
            if (d.action === 'hands_proposal') { addMsg('sys hands-out', 'Proposed step · waiting for "confirm"', d.step.action === 'open' ? `open ${d.step.url}` : `$ ${d.step.command}`); chime(520, 660); }
            if (d.action === 'hands_refused') { addMsg('err', 'Hands · locked', `$ ${d.command}\nRefused: ${d.reason}`); chime(300, 220); }
            if (d.action === 'hands_run') queuedStep = d.step;
            if (d.action === 'quality') { try { localStorage.setItem('jarvis.quality', JSON.stringify(d.level)); } catch {} notePref('quality'); if (window.JarvisScene) setTimeout(() => location.reload(), 4500); }
            if (d.action === 'assistant') { S.assistantLabel = d.label; applyAssistant(d.name); if (d.active) { S.active = d.active; render(); } chime(d.name === 'sophia' ? 740 : 520, d.name === 'sophia' ? 1110 : 780); }
            if (d.action === 'agent') queuedAgent = d;
            if (d.action === 'brain') queuedBrain = d;
            if (d.action === 'keys') openKeys();
          } else if (d.type === 'council') {
            d.members.forEach((id, k) => setTimeout(() => beams.push({ from: S.active, to: id, life: 1.6 }), k * 150));
          } else if (d.type === 'done') {
            flushSpeech();
          }
        }
      }
    } catch (e) {
      addMsg('err', 'System', 'Lost connection to the HUD server. Is it running?');
    }
    if (finalText && !extra) { history.push({ role: 'user', content: text }, { role: 'assistant', content: finalText }); }
    busy = false;
    speakingId = null;
    if (!speaking) setState(wakeOn ? 'idle' : 'idle');
    refreshState();
    if (queuedAgent) { const d = queuedAgent; queuedAgent = null; agentOp(d); }
    if (!speaking) followUp();                                  // nothing to say out loud (voice off): listen again now
    if (queuedBrain) { const d = queuedBrain; queuedBrain = null; runBrain(d); }
    if (queuedStep) {                                   // run it on your computer, then explain the result
      const step = queuedStep; queuedStep = null;
      const r = await handsRun(step);
      if (r) send('result', { hands_result: r });
    }
  }
  $('#form').addEventListener('submit', e => { e.preventDefault(); convo = false; send($('#input').value); });
  // voice first: the typing box stays hidden until the keyboard button or the first letter typed (outside other fields)
  function setTyping(on) { $('#form').classList.toggle('typing', on); if (on) $('#input').focus(); }
  $('#kbd').addEventListener('click', () => setTyping(!$('#form').classList.contains('typing')));
  $('#input').addEventListener('blur', () => { setTimeout(() => { if (!$('#input').value && document.activeElement !== $('#input')) setTyping(false); }, 200); });
  addEventListener('keydown', e => {
    if ($('#form').classList.contains('typing') || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || /^(input|textarea|select)$/i.test(document.activeElement.tagName)) return;
    setTyping(true);
  });

  // ------------------------------------------------------------------ voice out (text-to-speech)
  const synth = window.speechSynthesis;
  let voice = null, speaking = false, speechQueue = [];
  let voiceName = store.get('voiceName', null), voiceRate = store.get('rate', 1.03), voicePitch = store.get('pitch', 0.9);
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    if (voiceName) { const v = vs.find(v => v.name === voiceName); if (v) { voice = v; renderVoices(); return; } }
    const prefs = [/Google UK English Male/i, /Ryan.*United Kingdom/i, /Thomas.*United Kingdom/i, /George/i, /Daniel/i, /Arthur/i, /en-GB/i];
    for (const p of prefs) { const v = vs.find(v => p.test(v.name) || p.test(v.lang)); if (v) { voice = v; return; } }
    voice = vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
    renderVoices();
  }
  const plain = s => s.replace(/```[\s\S]*?```/g, ' code block on screen. ').replace(/[*_#>`~|]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/\s+/g, ' ').trim();
  let engine = store.get('engine', 'browser'), studioVoice = store.get('studioVoice', 'bm_george'), studio = { online: false, voices: [] };
  let studioAudio = null, studioAnalyser = null, studioData = null, ttsLevel = 0;
  // ---- two assistants, Jarvis and Sophia: each keeps her/his own voice (and the server keeps each one's model)
  let assistant = store.get('assistant', 'jarvis');
  function saveVoiceFor() { store.set('voice.' + assistant, { engine, studioVoice, voiceName }); }
  function defaultVoiceFor(name) {
    // Mark's own ElevenLabs voice first (he asked for it), else voices that cost nothing: Kokoro or the browser's own
    const el = studio.online && studio.voices.find(v => v.id === 'el_' + (name === 'sophia' ? 'sophia' : 'jarvis'));
    if (el) return { engine: 'studio', studioVoice: el.id, voiceName: null };
    const local = studio.online ? studio.voices.filter(v => !v.cloud) : [];
    if (name !== 'sophia') { const g = local.find(v => v.id === 'bm_george') || local.find(v => v.gender === 'male'); return { engine: g ? 'studio' : 'browser', studioVoice: g ? g.id : 'bm_george', voiceName: null }; }
    const sv = local.find(v => v.id === 'af_heart') || local.find(v => v.gender === 'female');
    const sys = synth ? synth.getVoices().find(v => kindOf(v) === 'female' && /^en/i.test(v.lang)) : null;
    return { engine: sv ? 'studio' : 'browser', studioVoice: sv ? sv.id : 'af_heart', voiceName: sys ? sys.name : null };
  }
  function brand() {
    const n = document.querySelector('.brand-name'); if (n) n.textContent = assistant === 'sophia' ? 'S.O.P.H.I.A' : 'J.A.R.V.I.S';
    document.body.dataset.assistant = assistant; document.title = assistant === 'sophia' ? 'Sophia · Jarvis OS' : 'Jarvis OS';
  }
  function applyAssistant(name) {
    if (!name || name === assistant) { brand(); return; }
    saveVoiceFor(); assistant = name; store.set('assistant', name);
    const v = store.get('voice.' + name, null) || defaultVoiceFor(name);
    engine = v.engine; studioVoice = v.studioVoice; voiceName = v.voiceName; voice = null;
    if (engine === 'studio' && !studio.online) engine = 'browser';
    store.set('studioVoice', studioVoice); if (voiceName) store.set('voiceName', voiceName); store.set('engine', engine);
    pickVoice(); brand(); renderVoices();
  }
  const myName = () => S.assistantLabel || (assistant === 'sophia' ? 'Sophia' : 'Jarvis');
  async function loadStudioVoices() {
    try { studio = await (await fetch('/api/voices')).json(); } catch { studio = { online: false, voices: [] }; }
    if (!studio.online && engine === 'studio') engine = 'browser';
    // the first time Mark's ElevenLabs voices show up, switch both assistants to them once (he can still pick another)
    if (studio.voices.some(v => /^el_/.test(v.id)) && !store.get('elAdopted', false)) {
      store.set('elAdopted', true);
      for (const n of ['jarvis', 'sophia']) store.set('voice.' + n, defaultVoiceFor(n));
      const v = defaultVoiceFor(assistant); engine = v.engine; studioVoice = v.studioVoice;
      store.set('engine', engine); store.set('studioVoice', studioVoice);
    }
    renderVoices();
  }
  function studioFetch(text) {
    return fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: studioVoice, speed: voiceRate }) })
      .then(r => { if (!r.ok) throw new Error('tts'); return r.blob(); });
  }
  function meterAudio(el) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaElementSource(el);
      studioAnalyser = ac.createAnalyser(); studioAnalyser.fftSize = 512; studioData = new Uint8Array(512);
      src.connect(studioAnalyser); studioAnalyser.connect(ac.destination);
    } catch { studioAnalyser = null; }
  }
  function speakText(text) {
    if (!voiceOn || !text) return;
    if (engine !== 'studio' && !synth) return;
    const parts = plain(text).match(/[^.!?]+[.!?]*\s*/g) || [];
    let chunk = '';
    const limit = engine === 'studio' && /^(fish|el)_/.test(studioVoice) ? 1200 : 220;   // cloud voices: one request per reply (daily limit)
    for (const p of parts) { if ((chunk + p).length > limit) { speechQueue.push(chunk); chunk = ''; } chunk += p; }
    if (chunk.trim()) speechQueue.push(chunk);
    // studio voices: start generating audio for every chunk right away so playback is gapless
    if (engine === 'studio') speechQueue = speechQueue.map(c => typeof c === 'string' ? { text: c, audio: studioFetch(c).catch(() => null) } : c);
    if (!speaking) nextSpeech();
  }
  async function nextSpeech() {
    const item = speechQueue.shift();
    if (!item) { speaking = false; ttsLevel = 0; if (!busy) setState('idle'); if (convo && !busy) followUp(); else resumeWake(); return; }
    speaking = true; pauseWake();
    if (typeof item === 'object') {
      const blob = await item.audio;
      if (!speaking) return;                                   // stopped while generating
      if (!blob) { speakBrowser(item.text); return; }          // engine failed: use a built-in voice for this part
      const el = new Audio(URL.createObjectURL(blob));
      studioAudio = el; meterAudio(el);
      el.onplay = () => setState('speaking');
      el.onended = el.onerror = () => { URL.revokeObjectURL(el.src); studioAudio = null; nextSpeech(); };
      el.play().catch(() => { studioAudio = null; speakBrowser(item.text); });
      return;
    }
    speakBrowser(item);
  }
  function speakBrowser(text) {
    if (!synth) { nextSpeech(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = voiceRate; u.pitch = voicePitch;
    u.onstart = () => setState('speaking');
    u.onboundary = () => { speakBoost = 0.35; };
    u.onend = u.onerror = () => nextSpeech();
    synth.speak(u);
  }
  // ---- Voice Studio: choose any voice installed on this computer/browser
  const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|aria|jenny|sonia|libby|hazel|susan|emma|ava|allison|natasha|michelle|sara|catherine|joanna|salli|kimberly|ivy|amy|emily|olivia|elsa|maisie|mia|clara|kate|nicky|veena|kathy|vicki|paulina|monica|amelie|anna|alice|ellen|joana|luciana|yuna|tingting|meijia|sinji|ting-ting|mei-jia|lekha|nora|zuzana|laura|ioana|milena|sara|xiaoxiao|denise|katja|elena|isabella|nanami/i;
  const MALE = /\bmale\b|\bman\b|daniel|alex\b|fred|\btom\b|arthur|oliver|ryan|george|\bguy\b|david|\bmark\b|thomas|aaron|rishi|james|eddy|reed|rocko|ralph|bruce|junior|albert|jorge|diego|luca|brian|christopher|eric|roger|steffan|andrew|davis|liam|william|matthew|conrad|henri|xander|maged|yuri|jacques/i;
  const NATURAL = /natural|neural|online|enhanced|premium|google/i;
  const kindOf = v => (/female/i.test(v.name) || (FEMALE.test(v.name) && !/\bmale\b/i.test(v.name))) ? 'female' : MALE.test(v.name) ? 'male' : 'other';
  let voiceFilter = 'all';
  function renderVoices() {
    const list = $('#vp-list'); if (!list) return;
    list.innerHTML = '';
    const head = txt => { const h = document.createElement('div'); h.className = 'group-label'; h.textContent = txt; list.appendChild(h); };
    // ---- Studio voices (Kokoro, natural, run on this computer)
    if (studio.online) {
      let sv = studio.voices.slice();
      if (voiceFilter === 'female' || voiceFilter === 'male') sv = sv.filter(v => v.gender === voiceFilter);
      if (sv.length) head('Studio voices · natural · run on your computer');
      for (const v of sv) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'vp-item' + (engine === 'studio' && v.id === studioVoice ? ' on' : '');
        b.innerHTML = '<span class="n"></span><span class="l"></span>';
        b.querySelector('.n').textContent = v.name;
        b.querySelector('.l').textContent = `${v.accent} · ${v.gender}${v.grade ? ' · grade ' + v.grade : ''}`;
        b.title = v.id;
        b.addEventListener('click', () => { engine = 'studio'; studioVoice = v.id; store.set('engine', engine); saveVoiceFor(); store.set('studioVoice', v.id); renderVoices(); stopSpeaking(); speakText(`Voice selected. Hello, I'm ${myName()}.`); });
        b.addEventListener('mouseenter', () => fx('tick'));
        list.appendChild(b);
      }
    }
    if (!synth) { $('#vp-note').textContent = studio.online ? `${studio.voices.length} studio voices` : 'No voices available'; return; }
    if (voiceFilter !== 'natural' || !studio.online) head('System voices · built into this device');
    const lang = (navigator.language || 'en').slice(0, 2);
    let vs = synth.getVoices().slice();
    vs.sort((a, b) => (b.lang.startsWith(lang) - a.lang.startsWith(lang)) || (NATURAL.test(b.name) - NATURAL.test(a.name)) || a.name.localeCompare(b.name));
    if (voiceFilter === 'female' || voiceFilter === 'male') vs = vs.filter(v => kindOf(v) === voiceFilter);
    if (voiceFilter === 'natural') vs = vs.filter(v => NATURAL.test(v.name));
    if (voiceFilter === 'natural' && studio.online) vs = [];
    for (const v of vs) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vp-item' + (engine !== 'studio' && voice && v.name === voice.name ? ' on' : '');
      b.innerHTML = '<span class="n"></span><span class="l"></span>';
      b.querySelector('.n').textContent = v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-\s*.*$/, '').replace(/ \(.*?\)$/, '');
      const k = kindOf(v);
      b.querySelector('.l').textContent = [v.lang, k !== 'other' ? k : '', NATURAL.test(v.name) ? 'natural' : '', v.localService ? 'offline' : 'online'].filter(Boolean).join(' · ');
      b.title = v.name;
      b.addEventListener('click', () => { voice = v; voiceName = v.name; store.set('voiceName', v.name); engine = 'browser'; store.set('engine', engine); saveVoiceFor(); renderVoices(); stopSpeaking(); speakText(`Voice selected. Hello, I'm ${myName()}.`); });
      b.addEventListener('mouseenter', () => fx('tick'));
      list.appendChild(b);
    }
    const total = synth.getVoices().length;
    $('#vp-note').textContent = (studio.online ? `${studio.voices.length} studio + ` : '') + (total ? `${total} system voices` : 'system voices load on first use');
  }
  // ---- laptop control: the helper (control/jarvis_control.py) runs on the laptop at 127.0.0.1:3002
  const CONTROL_URL = 'http://127.0.0.1:3002';
  let ctrlOn = false, ctrlPoll = null, ctrlSeen = '';
  async function ctrlFetch(path, body) {
    const r = await fetch(CONTROL_URL + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis': '1' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }
  function ctrlFail(e) {
    const msg = /fetch|network|load/i.test(e.message) ? "The laptop control helper isn't running. On your laptop run: control/install.sh" : 'Laptop control: ' + e.message;
    addMsg('jarvis err', 'Jarvis', msg); speakText(msg); setControl(false);
  }
  function controlCmd(d) {
    if (!d.on) { ctrlFetch('/stop', {}).catch(() => {}); setControl(false); return; }
    setControl(true);
    if (d.direct) ctrlFetch('/do', d.direct).catch(ctrlFail);
    else if (d.task) { ctrlSeen = ''; ctrlFetch('/task', { goal: d.task }).catch(ctrlFail); }
    else ctrlFetch('/status').then(s => { if (s.problem) ctrlFail(new Error(s.problem)); }).catch(ctrlFail);
  }
  function setControl(on) {
    ctrlOn = on; document.body.classList.toggle('control-on', on);
    $('#ctrl-banner').hidden = !on;
    if (on && !ctrlPoll) ctrlPoll = setInterval(pollControl, 900);
    if (!on && ctrlPoll) { clearInterval(ctrlPoll); ctrlPoll = null; }
    if (on) fx('route');
  }
  async function pollControl() {
    try {
      const s = await ctrlFetch('/status');
      $('#ctrl-step').textContent = s.active ? `STEP ${s.step}` : 'READY';
      $('#ctrl-thought').textContent = s.active ? (s.thought || s.action || 'Working…') : 'Waiting for your order · say what to do';
      const fin = s.error ? 'ERR:' + s.error : s.done;
      if (!s.active && fin && fin !== ctrlSeen) {
        ctrlSeen = fin;
        if (s.error) { addMsg('jarvis err', 'Jarvis', 'Laptop control: ' + s.error); }
        else { addMsg('jarvis', 'Jarvis', s.done); speakText(s.done); }
      }
    } catch { $('#ctrl-thought').textContent = 'Helper not reachable'; }
  }
  $('#ctrl-stop').addEventListener('click', () => send('stop control'));

  // ---- black hole play bar
  let playTool = null, playOpen = false;
  function setupPlay() {
    const bar = $('#play-bar'), btn = $('#t-play'), tools = bar.querySelectorAll('[data-tool]');
    const pick = id => { playTool = id; tools.forEach(b => b.classList.toggle('on', b.dataset.tool === id));
      $('#pb-hint').textContent = id ? `Click in space to throw ${id === 'light' ? 'light' : 'a ' + id} · drag to turn` : 'Pick something, then click in space · drag to turn'; };
    const open = on => { playOpen = on; bar.hidden = !on; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); if (!on) pick(null); else if (!playTool) pick('light'); };
    btn.addEventListener('click', () => { fx('click'); open(bar.hidden); });
    tools.forEach(b => b.addEventListener('click', () => { fx('click'); pick(b.dataset.tool); }));
    $('#pb-clear').addEventListener('click', () => { fx('click'); window.JarvisScene?.play?.('clear'); });
    bar.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { fx('click');
      bar.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b)); window.JarvisScene?.setView?.(b.dataset.view); }));
    const dens = $('#pb-density'); dens.value = store.get('density', 1);
    const applyDens = () => window.JarvisScene?.setDensity?.(+dens.value);
    dens.addEventListener('input', () => { store.set('density', +dens.value); applyDens(); });
    addEventListener('load', () => setTimeout(applyDens, 500)); setTimeout(applyDens, 1500);
  }
  function playStats(st) {
    const el = $('#pb-stats'); if (!el || $('#play-bar').hidden) return;
    el.textContent = `MASS ${st.mass.toFixed(2)} · FED ${st.fed} · IN FLIGHT ${st.particles}${st.feed > 0.15 ? ' · JETS ACTIVE' : ''}`;
  }
  function setupVoiceStudio() {
    const panel = $('#voice-panel'), btn = $('#t-voices');
    const open = on => { panel.hidden = !on; btn.classList.toggle('on', on); btn.setAttribute('aria-expanded', on); if (on) loadStudioVoices(); };
    btn.addEventListener('click', () => { fx('click'); open(panel.hidden); });
    $('#voice-close').addEventListener('click', () => open(false));
    document.querySelectorAll('.vp-filters button').forEach(b => b.addEventListener('click', () => {
      voiceFilter = b.dataset.filter; document.querySelectorAll('.vp-filters button').forEach(x => x.classList.toggle('on', x === b)); fx('click'); renderVoices();
    }));
    const rate = $('#vp-rate'), pitch = $('#vp-pitch');
    const show = () => { $('#vp-rate-out').textContent = (+voiceRate).toFixed(2); $('#vp-pitch-out').textContent = (+voicePitch).toFixed(2); };
    rate.value = voiceRate; pitch.value = voicePitch; show();
    rate.addEventListener('input', () => { voiceRate = +rate.value; store.set('rate', voiceRate); show(); });
    pitch.addEventListener('input', () => { voicePitch = +pitch.value; store.set('pitch', voicePitch); show(); });
    $('#vp-test').addEventListener('click', () => { stopSpeaking(); const was = voiceOn; voiceOn = true; speakText('Good evening. All systems are online, and every route is standing by.'); voiceOn = was; });
    if (!synth) $('#vp-note').textContent = 'This browser has no speech voices.';
  }
  setupVoiceStudio();
  setupPlay();
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  loadStudioVoices();

  // "Jarvis, use a female voice" / "switch voice to Emma" / "British male voice"
  function changeVoice(query) {
    const q = String(query || '').toLowerCase();
    const want = /female|woman|girl|lady/.test(q) ? 'female' : /\bmale\b|\bman\b|guy|boy|gentleman/.test(q) ? 'male' : null;
    const accent = /british|english|uk/.test(q) ? 'British' : /american|us\b/.test(q) ? 'American' : null;
    const words = q.split(/\s+/).filter(w => w.length > 2 && !/female|male|woman|man|british|american|voice|the|one|please/.test(w));
    let pick = null;
    if (studio.online) {
      const pool = studio.voices.filter(v => (!want || v.gender === want) && (!accent || v.accent === accent));
      pick = studio.voices.find(v => words.some(w => v.name.toLowerCase() === w || v.id === w)) || (words.length ? null : pool[0]) || null;
      if (pick) { engine = 'studio'; studioVoice = pick.id; store.set('engine', engine); saveVoiceFor(); store.set('studioVoice', pick.id); }
    }
    if (!pick && synth) {
      const vs = synth.getVoices();
      const sys = vs.find(v => words.some(w => v.name.toLowerCase().includes(w))) || (words.length ? null : vs.find(v => (!want || kindOf(v) === want) && (!accent || (accent === 'British' ? /en-GB/i : /en-US/i).test(v.lang))));
      if (sys) { pick = { name: sys.name }; voice = sys; voiceName = sys.name; engine = 'browser'; store.set('voiceName', sys.name); store.set('engine', engine); saveVoiceFor(); }
    }
    renderVoices();
    const msg = pick ? `Voice changed to ${pick.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-.*$/, '')}. How do I sound?` : `I couldn't find a voice like "${query}". Open Voices to see them all.`;
    addMsg('sys', 'Jarvis', msg); stopSpeaking(); speakText(msg);
  }

  function stopSpeaking() {
    speechQueue = []; if (synth) synth.cancel(); speaking = false; ttsLevel = 0;
    if (studioAudio) { try { studioAudio.pause(); } catch {} studioAudio = null; }
  }

  // ------------------------------------------------------------------ voice in (speech recognition)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#mic');
  let rec = null, recMode = null, finalHeard = '';
  if (!SR) { mic.classList.add('unsupported'); mic.title = 'Voice input needs Chrome or Edge. You can still type.'; }

  let analyser = null, micData = null;
  async function ensureMicMeter() {
    if (analyser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ac.createAnalyser(); analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      micData = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(micData);
        let sum = 0; for (const v of micData) sum += ((v - 128) / 128) ** 2;
        micLevel = Math.min(1, Math.sqrt(sum / micData.length) * 6);
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* meter is optional */ }
  }

  function startListening() {
    if (!SR) { addMsg('sys', 'Jarvis', 'Voice input needs Chrome or Edge. Typing works everywhere.'); return; }
    stopSpeaking(); stopRec();
    ensureMicMeter();
    rec = new SR(); recMode = 'ptt'; finalHeard = '';
    rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = e => {
      let fin = '', inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (inter += e.results[i][0].transcript));
      if (fin) finalHeard += fin;
      $('#input').value = (finalHeard + inter).trim();
    };
    rec.onerror = e => { if (e.error === 'not-allowed') addMsg('err', 'Mic', 'Microphone permission was blocked. Allow it in the browser address bar.'); };
    rec.onend = () => {
      mic.classList.remove('live'); rec = null; recMode = null;
      const heard = finalHeard.trim();
      if (heard) { convo = !ENDS_CONVO.test(heard); if (convo) send(heard); else { stopSpeaking(); setState('idle'); resumeWake(); } }
      else { convo = false; if (uiState === 'listening') setState('idle'); resumeWake(); }
    };
    try { rec.start(); mic.classList.add('live'); setState('listening'); chime(880, 1180); } catch {}
  }
  function stopRec() { if (rec) { const r = rec; rec = null; r.onend = null; try { r.abort(); } catch {} mic.classList.remove('live'); } }

  // Wake word: listens continuously for "Jarvis ..."
  function startWake() {
    if (!SR || !wakeOn || rec || speaking || busy) return;
    ensureMicMeter();
    rec = new SR(); recMode = 'wake';
    rec.lang = navigator.language || 'en-US'; rec.interimResults = false; rec.continuous = true;
    rec.onresult = e => {
      const text = e.results[e.results.length - 1][0].transcript.trim();
      const m = text.match(/\b(jarvis|sophia)\b[\s,.!?]*(.*)$/i);          // either name wakes her/him up
      if (!m) return;
      stopRec();
      const who = m[1].toLowerCase(); convo = true;
      if (m[2] && m[2].length > 2) send(`${who}, ${m[2]}`);
      else if (who !== assistant) send(who);
      else { chime(880, 1180); startListening(); }
    };
    rec.onend = () => { rec = null; recMode = null; if (wakeOn) setTimeout(startWake, 400); };
    rec.onerror = e => { if (e.error === 'not-allowed') { wakeOn = false; updateToggles(); } };
    try { rec.start(); } catch {}
  }
  function pauseWake() { if (recMode === 'wake') stopRec(); }
  function resumeWake() { if (wakeOn && !rec && !speaking && !busy) setTimeout(startWake, 500); }

  mic.addEventListener('click', () => { if (recMode === 'ptt') { try { rec.stop(); } catch {} } else startListening(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== $('#input')) { e.preventDefault(); $('#input').focus(); }
    if (e.code === 'Space' && e.ctrlKey) { e.preventDefault(); mic.click(); }
    if (e.key === 'Escape') { convo = false; stopSpeaking(); stopRec(); setState('idle'); if (ctrlOn) send('stop control'); }
  });

  // ------------------------------------------------------------------ toggles
  function updateToggles() {
    const set = (id, on) => { const b = $(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
    set('#t-voice', voiceOn); set('#t-wake', wakeOn); set('#t-council', S.councilMode);
  }
  $('#t-fx').addEventListener('click', () => { fxOn = !fxOn; store.set('fx', fxOn); $('#t-fx').classList.toggle('on', fxOn); $('#t-fx').setAttribute('aria-pressed', fxOn); fx('click'); });
  $('#t-fx').classList.toggle('on', fxOn);
  function setHolo(on, announce) {
    holoOn = on; store.set('holo', on);
    const b = $('#t-holo'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    fx('click');
    if (announce) { const m = on ? 'Holographic systems online.' : 'Holograms offline.'; addMsg('sys', 'Jarvis', m); speakText(m); }
  }
  $('#t-holo').addEventListener('click', () => setHolo(!holoOn, false));
  const SCENE_NAMES = { auto: 'Auto core', blackhole: 'Black Hole', sun: 'Sun', plasma: 'Plasma Orb', portal: 'Warp Portal', liquid: 'Liquid Glass', bloom: 'Bloom', reactor: 'Reactor', brain: 'Neural Brain' };
  const SCENE_SHORT = { auto: 'Auto', blackhole: 'Black Hole', sun: 'Sun', plasma: 'Plasma', portal: 'Portal', liquid: 'Liquid', bloom: 'Bloom', reactor: 'Reactor', brain: 'Brain' };
  const HOME_OK = ['blackhole', 'sun', 'plasma', 'portal', 'liquid', 'bloom', 'reactor', 'brain'];
  const RETIRED = { circuit: 'plasma', pulse: 'liquid', stream: 'brain' };    // removed Nov 22 (looked muddy); old choices map here
  function setScene(name, announce) {
    name = RETIRED[name] || name;
    if (!SCENE_NAMES[name]) return;
    sceneName = name; store.set('scene2', name); document.body.dataset.scene = name;
    if (HOME_OK.includes(name)) { homeCore = name; store.set('home', name); }
    const b = $('#t-scene'); decipher(b, '◐ ' + SCENE_SHORT[name], 400); b.classList.toggle('on', true);
    fx('route');
    if (announce) { const m = name === 'auto' ? `Auto core engaged. I'll change shape with what I'm doing; ${SCENE_NAMES[homeCore]} when idle.` : `${SCENE_NAMES[name]} mode.`; addMsg('sys', 'Jarvis', m); speakText(m); }
  }
  $('#t-scene').addEventListener('click', () => { const k = Object.keys(SCENE_NAMES); setScene(k[(k.indexOf(sceneName) + 1) % k.length], false); });
  $('#t-scene').textContent = '◐ ' + (SCENE_SHORT[sceneName] || 'Reactor'); $('#t-scene').classList.toggle('on', true);
  // ---- colour themes (3D scene reads themeName; panels use CSS variables)
  const THEME_UI = {
    amber: ['#ffa83a', '#ffd38a', '255,168,58'], ice: ['#5cc8ff', '#c4ecff', '92,200,255'], violet: ['#c58cff', '#ead2ff', '197,140,255'],
    crimson: ['#ff5a4a', '#ffc2b8', '255,90,74'], emerald: ['#3ee8a6', '#c2ffe4', '62,232,166'], gold: ['#ffcc4d', '#fff0bf', '255,204,77'],
  };
  function setTheme(name, announce) {
    if (!THEME_UI[name]) return;
    themeName = name; store.set('theme', name);
    const [a, hot, rgb] = THEME_UI[name], r = document.documentElement.style;
    r.setProperty('--amber', a); r.setProperty('--amber-hot', hot); r.setProperty('--line', `rgba(${rgb},.22)`);
    $('#t-color').style.setProperty('--sw', a); decipher($('#t-color'), '● ' + name[0].toUpperCase() + name.slice(1), 300);
    fx('click');
    if (announce) { const m = `Colour set to ${name}.`; addMsg('sys', 'Jarvis', m); speakText(m); }
  }
  $('#t-color').addEventListener('click', () => { const k = Object.keys(THEME_UI); setTheme(k[(k.indexOf(themeName) + 1) % k.length], false); });
  setTheme(themeName, false);
  $('#t-holo').classList.toggle('on', holoOn);
  $('#t-voice').addEventListener('click', () => { voiceOn = !voiceOn; store.set('voice', voiceOn); if (!voiceOn) stopSpeaking(); updateToggles(); });
  $('#t-wake').addEventListener('click', () => {
    if (!SR) { addMsg('sys', 'Jarvis', 'Wake word needs Chrome or Edge.'); return; }
    wakeOn = !wakeOn; store.set('wake', wakeOn); updateToggles();         // remembered: Mark talks more than he types
    if (wakeOn) { addMsg('sys', myName(), 'Listening for our names. Say "Jarvis" or "Sophia" followed by your request.'); startWake(); } else if (recMode === 'wake') stopRec();
  });
  $('#t-council').addEventListener('click', () => command({ action: 'council', on: !S.councilMode }).then(updateToggles));

  // mobile panel tabs
  document.querySelectorAll('.mobile-tabs button').forEach(b => b.addEventListener('click', () => {
    const p = document.getElementById(b.dataset.open), open = !p.classList.contains('open');
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('open'));
    document.querySelectorAll('.mobile-tabs button').forEach(x => x.classList.remove('on'));
    if (open) { p.classList.add('open'); b.classList.add('on'); }
  }));

  // ------------------------------------------------------------------ little sounds
  function chime(f1, f2) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const now = ac.currentTime;
      [f1, f2].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.08); g.gain.exponentialRampToValueAtTime(0.06, now + i * 0.08 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.18);
        o.connect(g).connect(ac.destination); o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.2);
      });
    } catch {}
  }

  // Sci-fi interface sounds (synthesised, very quiet). FX toggle turns them off.
  function fx(name) {
    if (!fxOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') return;          // browsers allow sound only after a click/tap
      const now = ac.currentTime;
      const tone = (f, at, dur, vol, type = 'sine', f2) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f, now + at);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + at + dur);
        g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(vol, now + at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
        o.connect(g).connect(ac.destination); o.start(now + at); o.stop(now + at + dur + 0.02);
      };
      if (name === 'tick') tone(2400, 0, 0.03, 0.012, 'square');
      else if (name === 'click') { tone(1200, 0, 0.05, 0.03, 'triangle'); tone(1800, 0.04, 0.05, 0.02, 'triangle'); }
      else if (name === 'msg') { tone(900, 0, 0.08, 0.025); tone(1350, 0.06, 0.1, 0.02); }
      else if (name === 'type') { const n = performance.now(); if (n - lastType < 70) return; lastType = n; tone(3200 + Math.random() * 800, 0, 0.012, 0.006, 'square'); }
      else if (name === 'boot') { tone(180, 0, 0.9, 0.04, 'sawtooth', 720); tone(1440, 0.75, 0.25, 0.02); }
      else if (name === 'route') tone(400, 0, 0.35, 0.035, 'sawtooth', 1600);
    } catch {}
  }
  document.addEventListener('pointerdown', () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {} }, { once: true });

  // "Decipher" text effect: random glyphs settle into the real text.
  function decipher(el, text, ms = 520) {
    if (!el) return;
    text = String(text);
    if (reduceMotion) { el.textContent = text; return; }
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / ms), shown = Math.floor(text.length * k);
      let out = text.slice(0, shown);
      for (let i = shown; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (k < 1) requestAnimationFrame(step); else el.textContent = text;
    };
    requestAnimationFrame(step);
  }

  // Boot sequence: panels assemble, headings decipher.
  function boot() {
    document.body.classList.add('booting');
    document.querySelectorAll('.panel-head > span:first-child, .brand-name').forEach((el, i) => setTimeout(() => decipher(el, el.textContent, 700), 250 + i * 120));
    setTimeout(() => { document.body.classList.remove('booting'); document.body.classList.add('booted'); fx('boot'); }, 1400);
  }

  // ------------------------------------------------------------------ clock + boot
  function tickClock() {
    const d = new Date();
    $('#clock-time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#clock-date').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  addEventListener('resize', resize);
  resize(); tickClock(); setInterval(tickClock, 15e3); boot();
  updateToggles();
  refreshState(); setInterval(() => { if (!busy) refreshState(); }, 12e3);
  requestAnimationFrame(loop);
  window.__jarvis = { send, S };   // handy for testing in the browser console
  // Bridge for the 3D scene (scene3d.js)
  window.JarvisHUD = {
    playStats, getFrame: () => ({ playTool, playOpen, theme: themeName, scene: sceneName, home: homeCore, holo: holoOn, level, uiState, active: S.active, speakingId, flowDir, council: S.council, councilMode: S.councilMode, beams, version: modelsVersion }),
    models: () => S.models,
    onNodeClick: id => switchTo(id),
    fx: name => fx(name),
  };
  brand();
  if (store.get('wake', false) && SR) { wakeOn = true; updateToggles(); setTimeout(startWake, 1500); }   // wake word stays on between visits
  dispatchEvent(new Event('jarvis-ready'));

  // ---- control-room readouts: real data, refreshed a few times a second
  const t0Up = Date.now(), bars = $('#ro-bars');
  if (bars) for (let i = 0; i < 24; i++) bars.appendChild(document.createElement('i'));
  const setGauge = (id, k, txt) => { const c = $(id); if (c) c.style.strokeDashoffset = (163.4 * (1 - Math.max(0, Math.min(1, k)))).toFixed(1); const t = $(id + '-t'); if (t) t.textContent = txt; };
  function updateReadouts() {
    if (!$('#ro-core')) return;
    const sc = sceneName === 'auto' ? `AUTO · ${(SCENE_SHORT[homeCore] || 'CORE').toUpperCase()}` : (SCENE_SHORT[sceneName] || sceneName).toUpperCase();
    $('#ro-core').textContent = sc;
    $('#ro-state').textContent = ({ idle: 'STANDBY', listening: 'LISTENING', thinking: 'ROUTING', speaking: 'TRANSMITTING' })[uiState] || uiState.toUpperCase();
    $('#ro-field').textContent = (level * 9.81).toFixed(2) + ' T';
    const s = Math.floor((Date.now() - t0Up) / 1000); $('#ro-up').textContent = [s / 3600, s / 60 % 60, s % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':');
    bars && [...bars.children].forEach((b, i) => { const v = levelHist[levelHist.length - 24 + i] || 0; b.style.height = (2 + v * 20).toFixed(0) + 'px'; });
    const a = S.models.find(m => m.id === S.active);
    $('#ro-link').textContent = a ? a.label.toUpperCase() : '—';
    $('#ro-via').textContent = a ? a.group.toUpperCase() : '—';
    $('#ro-lat').textContent = a && a.status && a.status.ms ? (a.status.ms / 1000).toFixed(2) + ' s' : '—';
    const inst = S.models.filter(m => m.installed).length, okN = S.models.filter(m => m.status.state === 'ok').length;
    $('#ro-nodes').textContent = `${okN} OK / ${inst}`;
    const hex = $('#ro-hex'); if (hex && Math.random() < 0.3) hex.textContent = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0')).join(' ')).join('\n');
    setGauge('#g-signal', level, Math.round(level * 100));
    setGauge('#g-links', inst ? okN / inst : 0, `${okN}/${inst}`);
  }
  setInterval(updateReadouts, 250);
})();
