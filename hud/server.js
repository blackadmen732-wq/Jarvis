// Jarvis HUD server: talks to the router for you, keeps track of which model
// is active, understands spoken/typed commands, and runs "council" mode where
// several AIs discuss a question in turn. No dependencies: plain Node 18+.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const ROUTER = (process.env.ROUTER_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const ROUTER_TOKEN = process.env.ROUTER_TOKEN || 'jarvis';
const KOKORO = (process.env.KOKORO_URL || 'http://127.0.0.1:8880').replace(/\/$/, '');
const LINA = (process.env.LINA_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
// Edge Bot's public, read-only training summary (the PARALLAX dashboard feed). No key needed.
const EDGEBOT = process.env.EDGEBOT_URL || 'https://mhahkbssltukjhusjsjf.supabase.co/functions/v1/parallax-money?view=training';
// Who may talk to this server: only pages opened from this computer. Add more as HUD_ALLOWED_HOSTS=name:port,...
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`,
  ...String(process.env.HUD_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)]);
const CONFIG_PATH = process.env.HUD_CONFIG || path.join(__dirname, 'models.json');
const PERSONA_PATH = process.env.PERSONA_PATH || path.join(__dirname, '..', 'jarvis', 'jarvis-persona.md');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const RULES_PATH = path.join(DATA_DIR, 'rules.lina');            // Lina rules you confirmed by voice
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- config/state
function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function loadConfig() {
  const c = readJSON(CONFIG_PATH, { models: [] });
  c.models = (c.models || []).filter(m => m && m.id && m.model);
  return c;
}
const config = loadConfig();
const saved = readJSON(STATE_PATH, {});
const state = {
  active: saved.active || config.active || (config.models[0] && config.models[0].id),
  councilMode: !!saved.councilMode,
  council: saved.council || config.council || [],
  extra: saved.extra || [],           // models added by voice ("switch to llama")
};
let pendingRule = null;               // a checked Lina rule waiting for "confirm" 
function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) { console.warn('could not save state:', e.message); }
}
const status = {};                    // id -> {state, ms, error, at}
let localModels = [];                 // names from Ollama
let routerOnline = false, localOnline = false;
let routerCatalog = { at: 0, ids: [] };

function persona() {
  let p = '';
  try { p = fs.readFileSync(PERSONA_PATH, 'utf8'); } catch { p = 'You are Jarvis, a calm, witty personal AI assistant.'; }
  return p.trim();
}

// ---------------------------------------------------------------- model list
function groupFor(modelRef) {
  const p = modelRef.split('/')[0];
  return ({ ollama: 'Local', open_router: 'OpenRouter', nvidia_nim: 'NVIDIA', groq: 'Groq', cerebras: 'Cerebras',
    gemini: 'Google', anthropic: 'Anthropic' })[p] || p;
}
function allModels() {
  const list = config.models.map(m => ({ ...m }));
  const known = new Set(list.map(m => m.model));
  for (const name of localModels) {
    const ref = 'ollama/' + name;
    if (known.has(ref)) continue;
    known.add(ref);
    list.push({ id: 'local:' + name, label: name.split('/').pop().replace(/:latest$/, ''), group: 'Local', model: ref, aliases: [name], auto: true });
  }
  for (const e of state.extra) if (!known.has(e.model)) { known.add(e.model); list.push(e); }
  return list.map(m => {
    const isLocal = m.model.startsWith('ollama/');
    const installed = isLocal ? localModels.includes(m.model.slice(7)) : true;
    return { ...m, local: isLocal, installed, status: status[m.id] || { state: installed ? 'ready' : 'missing' } };
  });
}
const byId = id => allModels().find(m => m.id === id);

async function refreshHealth() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    localModels = (j.models || []).map(m => m.name);
    localOnline = true;
  } catch { localOnline = false; localModels = []; }
  try {
    const r = await fetch(ROUTER + '/v1/models', { signal: AbortSignal.timeout(3000) });
    routerOnline = r.ok;
  } catch { routerOnline = false; }
}
async function routerIds() {
  if (Date.now() - routerCatalog.at < 5 * 60e3 && routerCatalog.ids.length) return routerCatalog.ids;
  try {
    const r = await fetch(ROUTER + '/v1/models?view=messages', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    routerCatalog = { at: Date.now(), ids: (j.data || []).map(m => m.id) };
  } catch { /* keep old */ }
  return routerCatalog.ids;
}

// ---------------------------------------------------------------- commands
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9.:\/ -]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'model', 'a', 'to', 'please', 'jarvis', 'now', 'mode', 'one', 'ai']);

async function resolveModel(query) {
  const q = norm(query).split(' ').filter(w => !STOP.has(w)).join(' ');
  if (!q) return null;
  let best = null, bestScore = 0;
  for (const m of allModels()) {
    const names = [m.id, m.label, ...(m.aliases || [])].map(norm);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (q.includes(n) && n.length > 2) score = Math.max(score, 70 + n.length);
      else if (n.includes(q) && q.length > 2) score = Math.max(score, 60 + q.length);
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (best) return best;
  // Not a favourite: search everything the router knows.
  const words = q.split(' ');
  const hit = (await routerIds()).find(id => words.every(w => id.toLowerCase().includes(w)));
  if (!hit) return null;
  const entry = { id: 'x:' + hit, label: hit.split('/').pop().replace(/:free$/, ' (free)'), group: groupFor(hit), model: hit, aliases: [q] };
  state.extra = [...state.extra.filter(e => e.model !== hit), entry].slice(-12);
  saveState();
  return entry;
}

function parseCommand(text) {
  const raw = String(text || '').trim().replace(/^(hey |ok |okay )?jarvis[\s,:]*/i, '');
  let m;
  if (/^(?:list |show |read )?(?:me )?(?:my |the )?lina rules[.!?]*$/i.test(raw)) return { action: 'lina_list' };
  // Lina: keep the words as spoken/typed (numbers like 0.8 and -0.05 matter), only drop the trigger words
  if ((m = raw.match(/^(?:write |make |create |add )?(?:a |an |the )?lina(?: rule| sigra)?\s*[:,-]?\s*(?:to |that |for |saying )?(.+)$/i)) && m[1].trim())
    return { action: 'lina', text: m[1].trim().replace(/[.!?]+$/, '') };
  const t = norm(text).replace(/^(hey |ok |okay )?jarvis\s*/, '');
  if (/^(confirm|confirmed|save it|yes save( it)?|save the rule|keep it)$/.test(t)) return { action: 'lina_confirm' };
  if (/^(cancel|discard( it)?|never mind|forget it|don t save( it)?)$/.test(t)) return { action: 'lina_cancel' };
  if (/^(list|show|read)( me)?( my| the)? (lina )?rules$/.test(t)) return { action: 'lina_list' };
  if (/^(how (did|are|is) (the |my )?(bots?|brains?|training|edge ?bot)( doing| do| going)?|(bot|brains?|training|edge ?bot|nightly) (report|status|update))$/.test(t)) return { action: 'edgebot' };
  if ((m = t.match(/^(?:switch to |go to |activate |enter |show |show me |open |change to |switch scene to |change scene to )?(?:the )?(auto|automatic|adaptive|black hole|blackhole|singularity|sun|star|solar|circuit|circuit sphere|pulse|pulse sphere|spike|plasma|plasma orb|plasma ball|portal|warp|warp portal|vortex|liquid|liquid glass|glass|neural brain|brain|neural|data stream|stream|data flow|flow|reactor|normal|default|classic)(?: mode| scene| view| core| sphere)$/)) ||
      (m = t.match(/^(?:switch|change|set) (?:the )?scene (?:to )?(auto|black hole|blackhole|sun|circuit|pulse|plasma|portal|liquid|neural brain|brain|neural|data stream|stream|reactor|normal|default)$/)) ||
      (m = t.match(/^(?:make|turn|change)(?: the)? (?:core|center|centre|middle)(?: into| to)?(?: a| the)? (black hole|sun|star|reactor|brain|circuit|plasma|portal|liquid|pulse)$/))) {
    const k = m[1];
    return { action: 'scene', scene: /auto|adaptive/.test(k) ? 'auto' : /circuit/.test(k) ? 'circuit' : /pulse|spike/.test(k) ? 'pulse' : /plasma/.test(k) ? 'plasma' : /portal|warp|vortex/.test(k) ? 'portal' : /liquid|glass/.test(k) ? 'liquid' : /black ?hole|singularity/.test(k) ? 'blackhole' : /sun|star|solar/.test(k) ? 'sun' : /brain|neural/.test(k) ? 'brain' : /stream|flow/.test(k) ? 'stream' : 'reactor' };
  }
  if ((m = t.match(/^(?:change|switch|set|make|turn)(?: the| your| my)? (?:colou?rs?|theme)(?: to| into)? (\w+)$/)) || (m = t.match(/^(?:go |use |make it )?(\w+) (?:colou?rs?|theme)$/))) {
    const c = m[1];
    const theme = /blue|ice|cyan|sky/.test(c) ? 'ice' : /purple|violet|lilac|magenta/.test(c) ? 'violet' : /red|crimson/.test(c) ? 'crimson' : /green|emerald|mint/.test(c) ? 'emerald' : /gold|yellow/.test(c) ? 'gold' : /orange|amber|default|normal|original/.test(c) ? 'amber' : null;
    if (theme) return { action: 'theme', theme };
  }
  if ((m = t.match(/^(?:can you |could you |please )?(?:switch|change|swap|set|use)(?: your| the| my)? voice(?: to| into)? (.+)$/)) ||
      (m = t.match(/^(?:can you |could you |please )?(?:use|switch to|change to|talk with|speak with|give me) (?:a |an |the )?(.+?) voice$/))) return { action: 'voice', query: m[1] };
  if ((m = t.match(/^(?:can you |could you |please )?(?:switch|change|swap|move|go|flip)(?: the)?(?: model)?(?: over)? (?:to|into) (.+)$/)) ||
      (m = t.match(/^(?:please )?use (.+?)(?: model| instead| now)*$/)) ||
      (m = t.match(/^(?:switch|change)(?: the)? model (.+)$/))) return { action: 'switch', query: m[1] };
  if (/^(show|bring|bring back|turn on|activate|enable)( the| my)? (holograms?|holo|holographics?|drones)/.test(t)) return { action: 'holo', on: true };
  if (/^(hide|remove|dismiss|turn off|disable|deactivate)( the| my)? (holograms?|holo|holographics?|drones)/.test(t)) return { action: 'holo', on: false };
  if (/^(start|enable|activate|open|begin|turn on)( the)? council|council (mode )?(on|start)/.test(t)) return { action: 'council', on: true };
  if (/^(stop|end|disable|close|turn off|exit)( the)? council|council (mode )?(off|stop)/.test(t)) return { action: 'council', on: false };
  if (/^(status|system status|report|diagnostics)$|^(which|what) model( are you| is active| are we)/.test(t)) return { action: 'status' };
  if (/^(list|show|what are)( the| my| your)? models|^what models/.test(t)) return { action: 'list' };
  return null;
}

// ---------------------------------------------------------------- talking to models
const VOICE_RULES = 'Your words are spoken aloud by a voice. Plain sentences only: no markdown, lists, code blocks, tables or emojis. Keep it under 80 words unless Mark asks for detail.';

async function* streamModel(entry, system, messages, maxTokens = 700) {
  const res = await fetch(ROUTER + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: 'Bearer ' + ROUTER_TOKEN },
    body: JSON.stringify({ model: entry.model, system, messages, max_tokens: maxTokens, stream: true, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(180e3),
  });
  if (!res.ok || !res.body) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch {}
    throw new Error(msg);
  }
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
      if (d.type === 'error') throw new Error((d.error && d.error.message) || 'model error');
      if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') yield d.delta.text;
    }
  }
}

function cleanError(msg) {
  const s = String(msg || 'error').split('\n')[0];
  if (/429|rate.?limit/i.test(s)) return 'rate limited (free quota used up or busy)';
  if (/401|403|auth|api key/i.test(s)) return 'key missing or not accepted';
  if (/402|credit/i.test(s)) return 'needs credit on that account';
  if (/not found|404/i.test(s)) return 'model not found';
  return s.slice(0, 140);
}

// Streams one model's answer to the browser. Returns the full text ('' on failure).
async function speak(send, entry, system, messages, role, opts = {}) {
  const t0 = Date.now();
  let text = '';
  send({ type: 'start', speaker: entry.id, label: entry.label, group: entry.group, role });
  try {
    for await (const piece of streamModel(entry, system, messages, opts.maxTokens)) {
      text += piece;
      send({ type: 'token', speaker: entry.id, text: piece });
    }
    if (!text.trim()) throw new Error('empty reply');
    status[entry.id] = { state: 'ok', ms: Date.now() - t0, at: Date.now() };
    send({ type: 'end', speaker: entry.id, ms: Date.now() - t0 });
    return text;
  } catch (e) {
    const error = cleanError(e.message);
    status[entry.id] = { state: 'error', error, at: Date.now() };
    send({ type: 'error', speaker: entry.id, label: entry.label, message: error, partial: !!text });
    if (!text && opts.fallback && opts.fallback.id !== entry.id) {
      send({ type: 'fallback', from: entry.id, to: opts.fallback.id, label: opts.fallback.label });
      return speak(send, opts.fallback, system, messages, role, { ...opts, fallback: null });
    }
    return text;
  }
}

// Cut a council reply where the model starts speaking as another member ("Qwen 3.8: ...").
function trimImpersonation(text, others) {
  const t = String(text || '');
  let cut = t.length;
  for (const name of others || []) {
    const re = new RegExp('(^|\\n|\\.\\s)\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i');
    const m = re.exec(t);
    if (m) cut = Math.min(cut, m.index + (m[1] === '. ' || m[1].startsWith('.') ? 1 : 0));
  }
  return t.slice(0, cut).trim();
}

function cleanHistory(history) {
  const out = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-12)) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    const content = String(h.content || '').slice(0, 4000);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function handleChat(body, send) {
  const message = String(body.message || '').trim().slice(0, 4000);
  if (!message) return send({ type: 'done' });
  const cmd = parseCommand(message);
  const say = text => { send({ type: 'start', speaker: 'jarvis', label: 'Jarvis', group: 'System', role: 'system' }); send({ type: 'token', speaker: 'jarvis', text }); send({ type: 'end', speaker: 'jarvis' }); };

  if (cmd && cmd.action === 'switch') {
    const m = await resolveModel(cmd.query);
    if (!m) return say(`I couldn't find a model called ${cmd.query}. Say "list models" to hear the options.`);
    if (m.local && !localModels.includes(m.model.slice(7))) return say(`${m.label} isn't downloaded yet. Run the add-model script first.`);
    state.active = m.id; saveState();
    send({ type: 'command', action: 'switch', id: m.id, label: m.label });
    return say(`Switching to ${m.label}${m.paid ? ', which uses paid credit' : ''}. Routing established.`);
  }
  if (cmd && cmd.action === 'theme') { send({ type: 'command', action: 'theme', theme: cmd.theme }); return; }
  if (cmd && cmd.action === 'scene') { send({ type: 'command', action: 'scene', scene: cmd.scene }); return; }
  if (cmd && cmd.action === 'holo') { send({ type: 'command', action: 'holo', on: cmd.on }); return; }
  if (cmd && cmd.action === 'voice') {
    send({ type: 'command', action: 'voice', query: cmd.query });   // the browser knows which voices exist
    return;
  }
  if (cmd && cmd.action === 'council') {
    state.councilMode = cmd.on; saveState();
    send({ type: 'command', action: 'council', on: cmd.on });
    const names = state.council.map(id => byId(id)).filter(Boolean).map(m => m.label).join(', ');
    return say(cmd.on ? `Council mode engaged. ${names} will discuss each question, then I'll give you the verdict.` : 'Council dismissed. Back to a single model.');
  }
  if (cmd && cmd.action === 'status') {
    const a = byId(state.active);
    const okCount = allModels().filter(m => m.status.state === 'ok').length;
    return say(`Running on ${a ? a.label : 'nothing'}. Router ${routerOnline ? 'online' : 'offline'}, local engine ${localOnline ? 'online with ' + localModels.length + ' models' : 'offline'}. ${okCount} links confirmed working. Council mode is ${state.councilMode ? 'on' : 'off'}.`);
  }
  if (cmd && cmd.action === 'lina') return linaRule(cmd.text, send, say);
  if (cmd && cmd.action === 'lina_confirm') {
    if (!pendingRule) return say('There is no Lina rule waiting. Say "Lina rule" and then what you want.');
    const n = saveRule(pendingRule); const r = pendingRule; pendingRule = null;
    send({ type: 'command', action: 'lina', status: 'saved', rule: r.text });
    return say(`Saved. You now have ${n} Lina rule${n === 1 ? '' : 's'}. ${r.english}`);
  }
  if (cmd && cmd.action === 'lina_cancel') {
    if (!pendingRule) return say('Nothing to cancel.');
    pendingRule = null; return say('Discarded. Nothing was saved.');
  }
  if (cmd && cmd.action === 'lina_list') {
    const rules = readRules();
    if (!rules.length) return say('You have no saved Lina rules yet.');
    return say(rules.slice(-5).map((r, i) => `Rule ${rules.length - Math.min(5, rules.length) + i + 1}: ${r.english}`).join(' '));
  }
  if (cmd && cmd.action === 'edgebot') return say(await edgebotReport());
  if (cmd && cmd.action === 'list') {
    return say('Available: ' + allModels().filter(m => m.installed).map(m => m.label).join(', ') + '.');
  }

  const history = cleanHistory(body.history);
  const active = byId(state.active) || allModels()[0];
  const fallback = byId(config.fallback);

  if (!state.councilMode) {
    const system = `${persona()}\n\n${VOICE_RULES}\nYou are currently running on the ${active.label} model (${active.group}).`;
    await speak(send, active, system, [...history, { role: 'user', content: message }], 'answer', { fallback });
    return;
  }

  // ---- Council: each member speaks in turn and can react to the others.
  const members = state.council.map(id => byId(id)).filter(m => m && m.installed).slice(0, 4);
  const names = members.map(m => m.label);
  send({ type: 'council', members: members.map(m => m.id) });
  const said = [];
  for (const m of members) {
    const others = names.filter(n => n !== m.label);
    const system = `You are ${m.label}, one AI in a council with ${others.join(' and ')}, chaired by Jarvis for Mark. ` +
      `Give only YOUR OWN view, in under 60 words. Never write lines for, or pretend to be, another member. ` +
      `If others already spoke, react to them by name: agree, add something new, or correct them. ${VOICE_RULES}`;
    const prompt = said.length ? `${message}\n\nThe council so far:\n${said.map(s => `${s.label}: ${s.text}`).join('\n')}\n\nNow give your view as ${m.label}.` : message;
    const raw = await speak(send, m, system, [{ role: 'user', content: prompt }], 'member', { maxTokens: 1200, others });
    const text = trimImpersonation(raw, others);
    if (text !== raw.trim()) send({ type: 'replace', speaker: m.id, text });
    if (text.trim()) said.push({ label: m.label, text: text.trim() });
  }
  if (!said.length) return say('No council member could answer. Check the links panel.');
  const system = `${persona()}\n\nYou are chairing a council of AIs. Combine their views into one clear final answer for Mark in under 90 words. Mention who disagreed only if it matters. ${VOICE_RULES}`;
  await speak(send, active, system,
    [{ role: 'user', content: `Question: ${message}\n\nCouncil views:\n${said.map(s => `${s.label}: ${s.text}`).join('\n')}` }],
    'verdict', { fallback });
}

// ---------------------------------------------------------------- Lina (Lina Sigra checker, ../lina)
async function lina(pathname, body) {
  const r = await fetch(LINA + pathname, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) } : { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Lina checker HTTP ' + r.status);
  return r.json();
}
const firstLine = t => (String(t || '').split('\n').map(l => l.trim().replace(/^`+|`+$/g, '').trim()).find(Boolean) || '');

// English (or Lina) -> one checked Lina rule. The writer model only writes text; the Lina engine decides if it is valid.
async function linaRule(request, send, say) {
  let line = /^se\s/i.test(request) ? request : '', check = null, tries = 0;
  try {
    if (line) check = await lina('/check', { text: line });
    else {
      const prompt = await lina('/prompt');
      const writer = byId(config.lina_writer) || byId(state.active) || allModels()[0];
      const shots = prompt.shots.flatMap(([q, a]) => [{ role: 'user', content: q }, { role: 'assistant', content: a }]);
      let messages = [...shots, { role: 'user', content: request }];
      while (tries < 2) {                                  // one retry, with the engine's reason, if the first try is invalid
        tries++;
        const text = await speak(send, writer, prompt.system, messages, 'lina', { maxTokens: 120, fallback: byId(config.fallback) });
        line = firstLine(text);
        if (!line) break;
        check = await lina('/check', { text: line });
        if (check.ok) break;
        messages = [...messages, { role: 'assistant', content: line }, { role: 'user', content: `Lina rejected that: ${check.error}. Write the corrected rule only.` }];
      }
    }
  } catch (e) {
    return say(`The Lina checker isn't answering (${cleanError(e.message)}). Run docker compose up -d lina.`);
  }
  if (!line || !check) return say("I couldn't get a Lina rule out of that. Try saying it more simply.");
  if (!check.ok) { send({ type: 'command', action: 'lina', status: 'invalid', rule: line, error: check.error }); return say(`Lina rejected ${line}. ${check.error}`); }
  if (check.rules.length !== 1) return say('Please give me one rule at a time.');
  pendingRule = { text: check.rules[0].text, english: check.rules[0].english, fingerprint: check.fingerprint };
  send({ type: 'command', action: 'lina', status: 'valid', rule: pendingRule.text, english: pendingRule.english });
  say(`Valid Lina: ${pendingRule.text}. That means: ${pendingRule.english} Say confirm to save it, or cancel.`);
}

function readRules() {
  let src = '';
  try { src = fs.readFileSync(RULES_PATH, 'utf8'); } catch { return []; }
  const out = []; let english = '';
  for (const l of src.split('\n')) {
    if (l.startsWith('# means: ')) english = l.slice(9);
    else if (l.trim() && !l.startsWith('#')) { out.push({ text: l.trim(), english }); english = ''; }
  }
  return out;
}
function saveRule(r) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(RULES_PATH, `# saved ${new Date().toISOString()} (fingerprint ${String(r.fingerprint).slice(0, 16)})\n# means: ${r.english}\n${r.text}\n`);
  return readRules().length;
}

// ---------------------------------------------------------------- Edge Bot by voice (read-only)
async function edgebotReport() {
  try {
    const r = await fetch(EDGEBOT, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); const n = j.latest; const t = j.totals || {};
    if (!n) return 'Edge Bot has no nightly results yet.';
    const day = new Date(n.at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const best = [...(n.markets || [])].sort((a, b) => (b.best_level || 0) - (a.best_level || 0))[0];
    const grads = (n.markets || []).reduce((s, m) => s + (m.graduates || 0), 0);
    return `Last training night was ${day}. ${n.markets.length} markets, best was ${best.name} at level ${best.best_level} of 8. ` +
      `${grads ? grads + ' bots graduated that night' : 'No bot graduated that night'}. All time: ${(t.bots_tested || 0).toLocaleString('en-US')} bots tested, ` +
      `${t.graduates || 0} graduates, ${t.proven || 0} proven. ${n.alarm_ok ? 'No alarms.' : 'The safety alarm went off, check the report.'} Paper money only.`;
  } catch (e) { return `I couldn't reach Edge Bot (${cleanError(e.message)}).`; }
}

// ---------------------------------------------------------------- studio voices (Kokoro)
const ACCENTS = { a: 'American', b: 'British', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Portuguese', z: 'Mandarin' };
let voiceCache = { at: 0, list: [] };
async function studioVoices() {
  if (Date.now() - voiceCache.at < 60e3 && voiceCache.list.length) return { online: true, voices: voiceCache.list };
  try {
    const r = await fetch(KOKORO + '/v1/audio/voices', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const raw = (j.voices || j || []).map(v => typeof v === 'string' ? { id: v } : { id: v.id || v.name, grade: v.overall_grade });
    const rank = g => g ? 'ABCDF'.indexOf(g[0]) * 3 + (g[1] === '+' ? 0 : g[1] === '-' ? 2 : 1) : 99;
    const list = raw.filter(v => v.id && /^[a-z][fm]_[a-z]+$/.test(v.id)).map(v => ({
      id: v.id, name: v.id.slice(3).replace(/^\w/, c => c.toUpperCase()),
      accent: ACCENTS[v.id[0]] || v.id[0], gender: v.id[1] === 'f' ? 'female' : 'male', grade: v.grade || '',
    })).sort((x, y) => rank(x.grade) - rank(y.grade) || x.id.localeCompare(y.id));
    voiceCache = { at: Date.now(), list };
    return { online: true, voices: list };
  } catch { return { online: false, voices: [] }; }
}
async function studioSpeech(body, res) {
  const text = String(body.text || '').slice(0, 1200).trim();
  const voice = String(body.voice || 'bm_george').replace(/[^a-z0-9_+()., ]/gi, '').slice(0, 80);
  const speed = Math.min(1.6, Math.max(0.6, Number(body.speed) || 1));
  if (!text) { res.writeHead(400); return res.end(); }
  try {
    const r = await fetch(KOKORO + '/v1/audio/speech', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'kokoro', input: text, voice, response_format: 'mp3', speed }),
      signal: AbortSignal.timeout(60e3),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'content-length': buf.length });
    res.end(buf);
  } catch (e) {
    json(res, 502, { error: 'voice engine unavailable: ' + e.message });
  }
}

// ---------------------------------------------------------------- http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function publicState() {
  return {
    active: state.active, councilMode: state.councilMode, council: state.council, fallback: config.fallback,
    router: { online: routerOnline, url: ROUTER }, local: { online: localOnline, models: localModels },
    models: allModels(),
  };
}

// Only pages opened on this computer may use the HUD. Without this, any website you visit could quietly switch you to a
// paid model or start chats with your keys (a "simple" cross-site POST), or read answers through DNS rebinding.
function allowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return 'unknown host';
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '').toLowerCase())) return 'cross-site request';
  if (origin === 'null') return 'cross-site request';
  if (req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'JSON only';
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const blocked = allowed(req);
  if (blocked) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('blocked: ' + blocked); }
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      await refreshHealth();
      return json(res, 200, publicState());
    }
    if (url.pathname === '/api/voices' && req.method === 'GET') return json(res, 200, await studioVoices());
    if (url.pathname === '/api/tts' && req.method === 'POST') return studioSpeech(await readBody(req), res);
    if (url.pathname === '/api/command' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.action === 'switch' && byId(b.id)) state.active = b.id;
      else if (b.action === 'council') state.councilMode = !!b.on;
      else if (b.action === 'councilMembers' && Array.isArray(b.ids)) state.council = b.ids.filter(id => byId(id)).slice(0, 4);
      else return json(res, 400, { error: 'unknown command' });
      saveState();
      return json(res, 200, publicState());
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const b = await readBody(req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      try { await handleChat(b, send); } catch (e) { send({ type: 'error', speaker: 'jarvis', message: cleanError(e.message) }); }
      send({ type: 'done' });
      return res.end();
    }
    // static files
    let file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

refreshHealth().finally(() => server.listen(PORT, () => {
  console.log(`Jarvis HUD on http://localhost:${PORT}  (router ${ROUTER}, ollama ${OLLAMA})`);
}));

module.exports = { parseCommand, norm, allowed, firstLine };
