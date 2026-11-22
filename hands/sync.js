// Jarvis sync: keeps Jarvis's data in Mark's Supabase (the jarvis-sync function in the Edge Bot repo, its own
// "jarvis" schema) so it follows him to any computer. Used by the HUD server (settings, Lina rules, voice choices)
// and by Jarvis Hands (agents and their runs). Off unless JARVIS_SYNC_TOKEN is set. API keys are never sent.
// Each item is a small document with a time; the newest copy wins, here and in Supabase. No dependencies.
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://mhahkbssltukjhusjsjf.supabase.co/functions/v1/jarvis-sync';

// The token from the environment, or from Jarvis's .env next to this folder (Hands runs outside Docker).
function findToken() {
  if (process.env.JARVIS_SYNC_TOKEN) return process.env.JARVIS_SYNC_TOKEN.trim();
  for (const f of [path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')]) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^JARVIS_SYNC_TOKEN=(.*)$/m);
      if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return '';
}

function create({ url = process.env.JARVIS_SYNC_URL || DEFAULT_URL, token = findToken(), log = () => {} } = {}) {
  const on = token.length >= 24;
  const status = { on, last_ok: null, last_error: on ? null : 'off: no JARVIS_SYNC_TOKEN' };
  const items = new Map(), runs = new Map();
  let timer = null;

  async function call(method, query = '', body) {
    const r = await fetch(url + query, { method, signal: AbortSignal.timeout(15000),
      headers: { 'x-jarvis-sync': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  }
  const ok = () => { status.last_ok = new Date().toISOString(); status.last_error = null; };
  const fail = e => { status.last_error = String(e.message || e).slice(0, 160); log('sync: ' + status.last_error); };

  /** { key: { value, updated_at } } for the keys asked; {} when off or unreachable (Jarvis keeps working). */
  async function pull(keys) {
    if (!on) return {};
    try { const j = await call('GET', '?keys=' + encodeURIComponent(keys.join(','))); ok(); return j.items || {}; } catch (e) { fail(e); return {}; }
  }
  async function pullRuns(agent, limit = 10) {
    if (!on) return [];
    try { const j = await call('GET', `?runs=${encodeURIComponent(agent)}&limit=${limit}`); ok(); return (j.runs || []).map(r => r.data); } catch (e) { fail(e); return []; }
  }
  /** Queue a change; sent a few seconds later (several changes go together). Failures are retried a minute later. */
  function push(key, value, updated_at = new Date().toISOString()) {
    if (!on) return; items.set(key, { key, value, updated_at }); schedule(3000);
  }
  function pushRun(id, agent, data) { if (!on) return; runs.set(id, { id, agent, data }); schedule(3000); }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(flush, ms); if (timer.unref) timer.unref(); }
  async function flush() {
    if (!on || (!items.size && !runs.size)) return;
    const body = { items: [...items.values()], runs: [...runs.values()] }; items.clear(); runs.clear();
    try { await call('POST', '', body); ok(); }
    catch (e) { fail(e); for (const it of body.items) if (!items.has(it.key)) items.set(it.key, it); for (const r of body.runs) runs.set(r.id, r); schedule(60000); }
  }
  return { on, status, pull, pullRuns, push, pushRun, flush };
}

/** True when the remote copy is newer than the local time (ISO string or ms). */
const newer = (remote, local) => !!remote && Date.parse(remote.updated_at) > (typeof local === 'number' ? local : Date.parse(local || 0) || 0);

module.exports = { create, newer, findToken };
