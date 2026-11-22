#!/usr/bin/env node
// Jarvis Hands: lets the Jarvis HUD run terminal commands and open web pages on THIS computer. Mark's request,
// Nov 22 2026. Runs outside Docker (Docker can't reach your computer), with no dependencies: plain Node 18+.
//
//   node hands/hands.js                  work folder ~/jarvis-workspace
//   node hands/hands.js ~/projects       work folder of your choice (commands start there)
//
// Jarvis runs what it decides straight away. Mark sets his own safety rules: add them to LOCKED below.
// Connection: only this computer (127.0.0.1), only the HUD page as Origin, and the pairing code, so other websites
// you visit can't send commands here. Everything is logged to ~/.jarvis-hands/log.jsonl.
// Stop it any time with Ctrl+C. While it isn't running, Jarvis can't touch your computer.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

const PORT = Number(process.env.HANDS_PORT || 3002);
const HUD_ORIGINS = new Set((process.env.HUD_ORIGINS || 'http://localhost:3001,http://127.0.0.1:3001').split(',').map(s => s.trim()));
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const HOME = path.join(os.homedir(), '.jarvis-hands');
const WORKDIR = path.resolve(process.argv[2] || path.join(os.homedir(), 'jarvis-workspace'));
const TIMEOUT_MS = 60e3, MAX_OUT = 8000, VERSION = '1.0';

let TOKEN = '';                       // set by start(); nothing is created when the HUD only loads the locked list
function start() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.mkdirSync(WORKDIR, { recursive: true });
  const file = path.join(HOME, 'token');
  try { TOKEN = fs.readFileSync(file, 'utf8').trim(); } catch {}
  if (!/^[a-f0-9]{12}$/.test(TOKEN)) { TOKEN = crypto.randomBytes(6).toString('hex'); fs.writeFileSync(file, TOKEN, { mode: 0o600 }); }
}

// YOUR RULES: commands Jarvis must never run. Empty on purpose: add your own lines, for example
//   [/\bsudo\b/i, 'admin rights'],
//   [/\brm\s+-rf\s+(\/|~)/i, 'deleting my whole disk or home folder'],
// The HUD checks this same list before it runs anything (restart Hands and rebuild the HUD after changing it).
const LOCKED = [
];
function lockedReason(cmd) { for (const [re, why] of LOCKED) if (re.test(cmd)) return why; return null; }

function log(entry) {
  try { fs.appendFileSync(path.join(HOME, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}
const clip = s => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n… (${s.length - MAX_OUT} more characters)` : s);

function run(command) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh');
    exec(command, { cwd: WORKDIR, timeout: TIMEOUT_MS, maxBuffer: 4e6, shell, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (err.killed ? 'timeout' : (typeof err.code === 'number' ? err.code : 1)) : 0;
      resolve({ code, stdout: clip(String(stdout || '')), stderr: clip(String(stderr || '')), ms: Date.now() - t0 });
    });
  });
}

function openUrl(url) {
  const u = new URL(url);                                  // throws on nonsense
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https pages can be opened');
  const [cmd, args] = process.platform === 'darwin' ? ['open', [u.href]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u.href]] : ['xdg-open', [u.href]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  return u.href;
}

function readBody(req) {
  return new Promise(resolve => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 2e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = HUD_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors }); res.end(JSON.stringify(obj)); };
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(403, { error: 'unknown host' });
  if (!HUD_ORIGINS.has(origin)) return send(403, { error: 'only the Jarvis HUD page may use Jarvis Hands' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type, x-jarvis-token',
      'access-control-max-age': '600', 'access-control-allow-private-network': 'true' });
    return res.end();
  }
  const given = Buffer.from(String(req.headers['x-jarvis-token'] || '')), want = Buffer.from(TOKEN);
  if (!TOKEN || given.length !== want.length || !crypto.timingSafeEqual(given, want)) return send(401, { error: 'wrong pairing code' });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/info')
    return send(200, { ok: true, version: VERSION, os: `${os.type()} ${os.release()} (${process.platform})`, shell: process.platform === 'win32' ? 'PowerShell' : path.basename(process.env.SHELL || 'sh'), cwd: WORKDIR });
  if (req.method !== 'POST' || !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(400, { error: 'JSON POST only' });
  const b = await readBody(req);
  if (url.pathname === '/run') {
    const command = String(b.command || '').trim().slice(0, 2000);
    if (!command) return send(400, { error: 'no command' });
    const why = lockedReason(command);
    if (why) { log({ action: 'run', command, refused: why }); return send(403, { error: `locked: ${why}` }); }
    const r = await run(command); log({ action: 'run', command, code: r.code, ms: r.ms });
    return send(200, { ok: true, command, cwd: WORKDIR, ...r });
  }
  if (url.pathname === '/open') {
    try { const href = openUrl(String(b.url || '')); log({ action: 'open', url: href }); return send(200, { ok: true, url: href }); }
    catch (e) { return send(400, { error: e.message }); }
  }
  send(404, { error: 'not found' });
});

if (require.main === module) {
  start();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Jarvis Hands is on (http://127.0.0.1:${PORT}). Work folder: ${WORKDIR}`);
    console.log(`  Pairing code: ${TOKEN}`);
    console.log(`  In the HUD, type:  hands code ${TOKEN}`);
    console.log('  Jarvis shows every command and runs it only after you say "confirm". Ctrl+C turns Hands off.\n');
  });
}
module.exports = { lockedReason, LOCKED };
