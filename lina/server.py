# Copyright (c) 2026 Jahf Mark Aldonza
# SPDX-License-Identifier: AGPL-3.0-only
"""Lina checker for Jarvis OS. A tiny web service (Python standard library only) around the Lina Sigra engine.

The Jarvis HUD sends it text; it answers whether that text is valid Lina, what it means in plain English, and what
a bot would do. It never runs anything else: Lina rules can only pause, watch, ask the owner or run the approved
paper rule, and the locked words (moni, paga, vori, sori, dela, toma, valida) are refused.

    GET  /health                    {"ok": true, "version": "lina-sigra 0.4"}
    GET  /prompt                    the grammar prompt + examples the Lina writer model is given
    POST /check  {"text": "se ..."} {"ok": true, "rules": [{english, action, ...}], "fingerprint": ...} or {"ok": false, "error": ...}
    POST /run    {"text", "state"}  the decision for that desk state

Only reachable inside the Docker network (no port on the host). The engine in ./engine is copied from Edge Bot
(backtest/lina); update it with scripts/update-lina.sh.
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine"))
import lang, train

PORT = int(os.environ.get("PORT", "8090"))
MAX_BODY = 20_000


def check(text):
    try:
        rules = lang.parse(text)
    except lang.LinaError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "version": lang.VERSION, "fingerprint": lang.fingerprint(rules), "warnings": lang.lint(rules),
            "rules": [{"line": r["line"], "text": r["text"], "english": lang.english(r), "action": r["action"],
                       "because": r["because"]} for r in rules]}


def run(text, state):
    try:
        return {"ok": True, **lang.run(text, state if isinstance(state, dict) else {})}
    except lang.LinaError as e:
        return {"ok": False, "error": str(e)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health": return self._send(200, {"ok": True, "version": lang.VERSION})
        if self.path == "/prompt": return self._send(200, {"system": train.SYSTEM, "shots": train.SHOTS})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY: return self._send(413, {"error": "too long"})
        try: body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError: return self._send(400, {"error": "not JSON"})
        text = str(body.get("text", ""))[:MAX_BODY]
        if self.path == "/check": return self._send(200, check(text))
        if self.path == "/run": return self._send(200, run(text, body.get("state")))
        self._send(404, {"error": "not found"})

    def log_message(self, *a): pass


if __name__ == "__main__":
    print(f"Lina checker ({lang.VERSION}) on port {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
