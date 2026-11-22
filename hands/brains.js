// Subscription brains (Mark's request, Nov 22 2026): use HIS OWN Claude and ChatGPT accounts the official way.
// Claude Pro/Max and ChatGPT Plus can't be plugged into other apps, but Anthropic's Claude Code and OpenAI's Codex
// are their own command-line apps and log in with those subscriptions. Jarvis Hands runs them on this computer:
//   claude -p "<task>"            (Claude Code, logged in with `claude` once)
//   codex exec "<task>"           (Codex, logged in with `codex login` once)
// No account sharing, no rotating logins: one person, his own apps, on his own computer.
'use strict';
const { spawn, execFileSync } = require('child_process');

const ENGINES = {
  claude: {
    label: 'Claude (your account, Claude Code)', bin: process.env.BRAIN_CLAUDE_BIN || 'claude',
    args: (prompt, system) => [
      '-p', prompt, '--output-format', 'text',
      '--permission-mode', process.env.BRAIN_CLAUDE_MODE || 'acceptEdits',
      '--allowedTools', ...(process.env.BRAIN_CLAUDE_TOOLS || 'Bash Read Write Edit Glob Grep WebFetch WebSearch').split(/\s+/),
      ...(system ? ['--append-system-prompt', system] : []),
    ],
    setup: 'Install Claude Code (curl -fsSL https://claude.ai/install.sh | bash), run `claude` once and log in with your Claude account.',
  },
  codex: {
    label: 'ChatGPT (your account, Codex)', bin: process.env.BRAIN_CODEX_BIN || 'codex',
    args: (prompt, system) => [...(process.env.BRAIN_CODEX_ARGS || 'exec --skip-git-repo-check --full-auto').split(/\s+/),
      system ? `${system}\n\n${prompt}` : prompt],
    setup: 'Install Codex (npm install -g @openai/codex), then run `codex login` and sign in with your ChatGPT account.',
  },
};

function installed(engine) {
  const e = ENGINES[engine]; if (!e) return false;
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [e.bin], { stdio: 'ignore' }); return true; } catch { return false; }
}
function list() { return Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, { label: e.label, installed: installed(k), setup: e.setup }])); }

/** Run one task with the person's own subscription app. Resolves { ok, text, code, ms } (never throws). */
function think(engine, prompt, { system = '', cwd, timeoutMs = Number(process.env.BRAIN_TIMEOUT_MS || 600e3) } = {}) {
  return new Promise(resolve => {
    const e = ENGINES[engine];
    if (!e) return resolve({ ok: false, text: `unknown brain "${engine}"` });
    if (!installed(engine)) return resolve({ ok: false, text: `${e.label} isn't installed on this computer. ${e.setup}` });
    const t0 = Date.now(); let out = '', err = '';
    const child = spawn(e.bin, e.args(String(prompt).slice(0, 20000), String(system).slice(0, 6000)),
      { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });   // arguments, never a shell string
    const timer = setTimeout(() => { child.kill('SIGTERM'); err += '\n(stopped: took too long)'; }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 200000) out = out.slice(-200000); });
    child.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', x => { clearTimeout(timer); resolve({ ok: false, text: x.message, ms: Date.now() - t0 }); });
    child.on('close', code => {
      clearTimeout(timer);
      const text = out.trim() || err.trim();
      const loggedOut = /log ?in|not logged|authenticat|unauthori[sz]ed|api key/i.test(err) && !out.trim();
      resolve({ ok: code === 0 && !!out.trim(), code, ms: Date.now() - t0,
        text: loggedOut ? `${e.label} needs you to log in first. ${e.setup}` : text.slice(-8000) });
    });
  });
}

module.exports = { ENGINES, installed, list, think };
