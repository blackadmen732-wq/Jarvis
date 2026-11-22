// Jarvis agents: a team of bots that work on THIS computer, each with its own job and its own folder, like the
// Grok Bot setup (Mark's request, Nov 22 2026). Loaded by hands/hands.js, so agents live where the work happens.
//
//   - an agent = a name, a job description (role), the model it thinks with, and optionally a routine
//     (every N minutes, or every day at a time) with the task it does each time
//   - a run = up to MAX_STEPS steps: the model picks ONE action (run a command, open a page, or finish), sees the
//     result, and picks the next. Commands start in the agent's own folder: ~/jarvis-workspace/agents/<name>
//   - Jarvis (the HUD) is the chief of staff: "create an agent...", "ask <agent> to ...", "what did <agent> do"
//   - routines keep running while Hands is running, even with the HUD closed; every run is saved
// Mark's own rules (LOCKED in hands.js) are checked on every command.
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 12);
const ROUTER = (process.env.ROUTER_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
const ROUTER_TOKEN = process.env.ROUTER_TOKEN || 'jarvis';

function create({ home, workdir, run, openUrl, lockedReason, log, sync = null }) {
  const FILE = path.join(home, 'agents.json');
  const RUNS = path.join(home, 'runs');
  fs.mkdirSync(RUNS, { recursive: true });
  const running = new Map();                                        // agent id -> run id

  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
  const save = (list, { quiet = false } = {}) => {
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
    if (sync && !quiet) sync.push('hands.agents', list);              // the team follows Mark to any computer
  };
  // on start: if Supabase has a newer copy of the team (another computer changed it), use that one
  if (sync && sync.on) sync.pull(['hands.agents']).then(items => {
    const r = items['hands.agents']; let mtime = 0; try { mtime = fs.statSync(FILE).mtimeMs; } catch {}
    const { newer } = require('./sync.js');
    if (r && Array.isArray(r.value) && newer(r, mtime)) {
      save(r.value, { quiet: true });
      for (const a of r.value) fs.mkdirSync(folder(a), { recursive: true });
      log({ action: 'sync', note: `team loaded from Supabase (${r.value.length} agents)` });
    } else if (!r && load().length) sync.push('hands.agents', load());   // first time: upload what's here
  });
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const folder = a => path.join(workdir, 'agents', a.id);

  function upsert(input) {
    const name = String(input.name || '').trim().slice(0, 40);
    const id = slug(name);
    if (!id) throw new Error('an agent needs a name');
    const list = load(); const old = list.find(a => a.id === id) || {};
    const every = input.every_minutes == null ? old.every_minutes : Number(input.every_minutes) || null;
    const a = { ...old, id, name, role: String(input.role || old.role || '').slice(0, 2000),
      task: String(input.task || old.task || '').slice(0, 2000), model: String(input.model || old.model || 'open_router/openrouter/free'),
      every_minutes: every && every >= 1 ? Math.round(every) : null,
      at: /^\d{1,2}:\d{2}$/.test(String(input.at || '')) ? input.at : (input.at === null ? null : old.at || null),
      enabled: input.enabled == null ? old.enabled !== false : !!input.enabled, created: old.created || new Date().toISOString(),
      engine: ['claude', 'codex'].includes(input.engine) ? input.engine : (input.engine === 'router' ? 'router' : old.engine || 'router') };
    fs.mkdirSync(folder(a), { recursive: true });
    save([...list.filter(x => x.id !== id), a]);
    return a;
  }
  function remove(id) { const list = load(); save(list.filter(a => a.id !== slug(id))); return list.length !== load().length; }
  function find(name) {
    const q = slug(name), list = load();
    return list.find(a => a.id === q) || list.find(a => a.id.startsWith(q) || q.startsWith(a.id)) || null;
  }

  async function think(model, system, messages) {
    const res = await fetch(ROUTER + '/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(180e3),
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: 'Bearer ' + ROUTER_TOKEN },
      body: JSON.stringify({ model, system, messages, max_tokens: 700, stream: true, thinking: { type: 'disabled' } }),
    });
    if (!res.ok || !res.body) throw new Error('router HTTP ' + res.status);
    const dec = new TextDecoder(); let buf = '', text = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
        if (d.type === 'error') throw new Error((d.error && d.error.message) || 'model error');
        if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') text += d.delta.text;
      }
    }
    return text;
  }
  const plan = t => { const m = String(t || '').match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

  function system(a) {
    return `You are ${a.name}, one of Mark's agents. Jarvis is your chief of staff. Your job: ${a.role || 'help Mark'}\n` +
      `You work on Mark's computer (${process.platform}); commands start in your own folder ${folder(a)}. ` +
      `Keep notes and files there. Work step by step. Reply with JSON only, one action per reply:\n` +
      `{"action":"run","command":"<one shell command>","why":"..."}\n{"action":"open","url":"https://...","why":"..."}\n` +
      `{"action":"done","summary":"<what you did and found, for Mark, under 60 words>"}\n` +
      `You get each command's output back. Finish with "done" as soon as the task is complete (at most ${MAX_STEPS} steps).`;
  }

  async function runAgent(a, task, why = 'asked') {
    if (running.has(a.id)) return { already: running.get(a.id) };
    const id = `${a.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const rec = { id, agent: a.id, name: a.name, task: task || a.task || a.role, why, started: new Date().toISOString(), steps: [], status: 'running' };
    const file = path.join(RUNS, id + '.json'); const put = () => fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    running.set(a.id, id); put();
    (async () => {
      const messages = [{ role: 'user', content: `Task: ${rec.task}` }];
      if (a.engine === 'claude' || a.engine === 'codex') {           // the brain is Mark's own Claude Code / Codex: it plans
        const r = await require('./brains.js').think(a.engine, `Task: ${rec.task}`, {   // and works on its own, in this folder
          system: `You are ${a.name}, one of Mark's agents (Jarvis is your chief of staff). Your job: ${a.role || 'help Mark'}. ` +
                  `Work in this folder. End with a short summary for Mark (under 60 words).`, cwd: folder(a) });
        rec.steps.push({ action: 'brain', engine: a.engine, result: String(r.text || '').slice(-3000) });
        rec.status = r.ok ? 'done' : 'error'; rec.summary = String(r.text || '').trim().split('\n').filter(Boolean).slice(-4).join(' ').slice(-600);
        rec.finished = new Date().toISOString(); put(); running.delete(a.id); if (sync) sync.pushRun(rec.id, a.id, rec);
        const list = load(); const x = list.find(y => y.id === a.id);
        if (x) { x.last_run = rec.id; x.last_status = rec.status; x.last_summary = rec.summary; x.last_at = rec.finished; save(list); }
        return;
      }
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const reply = await think(a.model, system(a), messages);
          const p = plan(reply);
          messages.push({ role: 'assistant', content: reply.slice(0, 2000) });
          if (!p || !['run', 'open', 'done'].includes(p.action)) {
            messages.push({ role: 'user', content: 'Reply with ONE JSON action only (run, open or done).' }); rec.steps.push({ action: 'unclear', reply: reply.slice(0, 300) }); put(); continue;
          }
          if (p.action === 'done') { rec.summary = String(p.summary || '').slice(0, 1000); rec.status = 'done'; break; }
          let result;
          if (p.action === 'open') {
            try { result = `opened ${openUrl(String(p.url))}`; } catch (e) { result = 'error: ' + e.message; }
            rec.steps.push({ action: 'open', url: String(p.url), why: p.why, result });
          } else {
            const command = String(p.command || '').slice(0, 2000), locked = lockedReason(command);
            if (locked) result = `refused by Mark's rules: ${locked}`;
            else {
              const r = await run(command, folder(a));
              result = `exit ${r.code}\n${r.stdout}${r.stderr ? '\n' + r.stderr : ''}`.slice(0, 6000);
              log({ action: 'agent', agent: a.id, command, code: r.code, ms: r.ms });
            }
            rec.steps.push({ action: 'run', command, why: p.why, result: result.slice(0, 3000) });
          }
          put();
          messages.push({ role: 'user', content: `Result:\n${result}` });
        }
        if (rec.status === 'running') { rec.status = 'stopped'; rec.summary = rec.summary || `Stopped after ${MAX_STEPS} steps without finishing.`; }
      } catch (e) { rec.status = 'error'; rec.summary = 'Error: ' + e.message; }
      rec.finished = new Date().toISOString(); put(); running.delete(a.id);
      if (sync) sync.pushRun(rec.id, a.id, rec);
      const list = load(); const x = list.find(y => y.id === a.id);
      if (x) { x.last_run = rec.id; x.last_status = rec.status; x.last_summary = rec.summary; x.last_at = rec.finished; save(list); }
    })();
    return { run: id };
  }

  function getRun(id) { try { return JSON.parse(fs.readFileSync(path.join(RUNS, path.basename(String(id)) + '.json'), 'utf8')); } catch { return null; } }
  function recentRuns(agentId, n = 5) {
    return fs.readdirSync(RUNS).filter(f => !agentId || f.startsWith(agentId + '-')).sort().slice(-n).map(f => getRun(f.replace(/\.json$/, ''))).filter(Boolean);
  }

  // routines: check every 30 s; "every N minutes" or "every day at HH:MM" (local time)
  function due(a, now) {
    if (!a.enabled || running.has(a.id)) return false;
    const last = a.last_at ? new Date(a.last_at).getTime() : 0;
    if (a.every_minutes) return now - last >= a.every_minutes * 60e3;
    if (a.at) {
      const [h, m] = a.at.split(':').map(Number); const today = new Date(now); today.setHours(h, m, 0, 0);
      return now >= today.getTime() && last < today.getTime();
    }
    return false;
  }
  setInterval(() => { const now = Date.now(); for (const a of load()) if (due(a, now)) runAgent(a, a.task || a.role, 'routine'); }, 30e3).unref();

  return { load, upsert, remove, find, runAgent, getRun, recentRuns, running, due };
}
module.exports = { create };
