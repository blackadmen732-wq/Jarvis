# Jarvis OS: notes for Claude

Owner: Mark. Keep his design and decisions; change only what he asks. Explain changes in simple steps: what changed, which files, how to check.

## What this is
A self-hosted AI hub assembled from open source, not custom app code:
- `docker-compose.yml`: Open WebUI (hub, port 3000) + Ollama (own models).
- Cloud providers are OpenAI-compatible connections: OpenRouter, Gemini, z.ai. Keys come from `.env` (first start only; afterwards from Admin → Settings → Connections).
- `scripts/add-model.sh`: pull / import / list / remove Ollama models.
- `theme/custom.css`: dark navy + cyan look, mounted into Open WebUI at /app/build/static/custom.css. Do not replace Open WebUI logos (license).
- `router/Dockerfile`: free-claude-code (FCC, AGPL-3.0) from PyPI, pinned by `FCC_VERSION`. Port 8082 on 127.0.0.1 only. Reads model choices + keys from `.env` (`MODEL`, `MODEL_HAIKU`, `MODEL_FALLBACKS`, `REASONING_*`). Local models need reasoning `off` or they think for minutes on CPU.
- Do NOT add 9router or anything that pools subscription logins / rotates accounts (ToS + ban risk). Mark asked for free; keep to official free tiers, local models, or paid APIs.
- `hud/`: Jarvis HUD (port 3001, 127.0.0.1 only). `server.js` = dependency-free Node server: streams from the router's `/v1/messages` with `thinking: disabled` (keeps local + Kimi fast), parses voice/text commands (switch, council on/off, status, list), runs council rounds, falls back to `fallback` model. `public/hud.js` = state, panels, chat stream, voice (Web Speech API + Voice Studio), FX sounds, decipher/boot effects, 2D canvas fallback. `public/scene3d.js` = three.js 0.170.0 scene (vendored in `public/vendor`, import map in index.html) reading `window.JarvisHUD.getFrame()` each frame. Test in headless Chromium with `--use-gl=angle --use-angle=swiftshader` (slow, ~5 fps, fine for screenshots). Mark asked to REMOVE the jellyfish (not Jarvis-like); `public/holo.js` replaced them (gear-ring machine, wireframe drones + scan beams, radar sweep). `scenes.js` = scene registry + brain + stream; `blackhole.js` = ray-marched lensing black hole rendered at reduced res into a HalfFloat target, drawn as background quad, plus orbiting planets; `sun.js` = sun core. Themes (THEMES in scene3d.js + THEME_UI in hud.js) drive all colours. Live link: warm themes = solar-flare tube looping round the active node, cool themes = Line2 plasma lightning. Deep Space scene was removed (weak). `cores.js` = extra core faces (circuit, pulse, portal, plasma, liquid); scene 'auto' (default) maps uiState -> face (idle=home core, listening=pulse, thinking=portal, speaking=plasma, council=liquid); hud.js stores `scene2` + `home` in localStorage. Studio voices: `voice` service = Kokoro-FastAPI `kokoro-fastapi-cpu:v0.10.0`; HUD server proxies `/api/voices` + `/api/tts` (Kokoro ids like `bm_george`: 1st letter accent, 2nd f/m). Favourites in `hud/models.json`. Keep the look: amber core, red routes, blue nodes, glass panels with amber corner brackets.
- Router's non-streaming `/v1/chat/completions` hits a "Decimal is not JSON serializable" bug for Groq/Cerebras/Ollama in FCC 6.19.46; use streaming `/v1/messages` instead.
- `lina/`: Lina Sigra checker service (Python stdlib, no host port; HUD reaches it at `LINA_URL`). `engine/` is copied from Edge Bot `backtest/lina` (lang.py 0.4, lina_sigra.py, lexicon, train.py for the writer prompt); refresh with `scripts/update-lina.sh`. HUD: "Lina rule: ..." -> `lina_writer` model (models.json) writes one line with Lina's own grammar prompt (`/prompt`), `/check` decides, one retry with the error, then "confirm" appends to `DATA_DIR/rules.lina`. The writer's raw line is shown, never spoken (role `lina`). "How did the bots do" reads Edge Bot's public `parallax-money?view=training` (`EDGEBOT_URL`).
- HUD security gate (`allowed()` in server.js): Host must be localhost/127.0.0.1/[::1]:PORT (or `HUD_ALLOWED_HOSTS`), a foreign or `null` Origin is refused, POSTs must be `application/json`. Blocks cross-site "simple" POSTs and DNS rebinding. Keep it.
- `scripts/lite.sh`: Chromebook mode, `docker compose up -d --no-deps ollama router lina hud`.
- Open WebUI is bound to 127.0.0.1:3000 (it used to be open to the whole Wi-Fi, where the first sign-up becomes admin). Ollama is pinned (0.40.17); open-webui `main` and uv `latest` are still unpinned.
- `jarvis/`: persona prompt and config for the isair/jarvis desktop voice assistant, which talks to the hub at `http://localhost:3000/api` using model id `jarvis`.

## Rules
- Never commit `.env`, real API keys or model files.
- isair/jarvis is non-commercial licensed. Flag this if Mark wants to sell anything built on it.
- Verify changes by running `docker compose up -d` and calling the hub API, not by guessing.

## Definition of done
A task is finished only when all of these are true:
1. The stack starts cleanly: `docker compose config -q` passes and `docker compose up -d` shows both containers running.
2. The thing you changed was actually exercised (a chat request, a script run, a screenshot of the UI), and you report the real output.
3. No new services, dependencies or providers were added without telling Mark first.
4. README steps still match what the app really does; update them in the same change.
5. You explain: what changed, which files, how Mark can check it.
If unsure about anything, stop and ask one question instead of guessing.
