# Jarvis OS

Your own AI hub. Switch between **free models**, **paid models** and **your own models** from one dropdown, and talk to all of them through **Jarvis**, a voice assistant on your desktop.

```
 You (voice)            You (browser / phone)          You (coding)
     │                          │                           │
 ┌───▼──────┐  API key  ┌───────▼───────────────────┐  ┌────▼──────────────┐
 │ Jarvis   │ ────────► │ Hub (Open WebUI) :3000    │  │ Claude Code, Codex│
 │ desktop  │           │ model dropdown, agents    │  │ Cline, Aider...   │
 └──────────┘           └──┬─────────┬─────────┬────┘  └────┬──────────────┘
                           │         │         │      ┌─────▼──────────────┐
                           │         │         │      │ Router :8082 (FCC) │
                           │         │         │      │ + auto-fallback    │
                           │         │         │      └──┬──────────┬──────┘
                       OpenRouter  Gemini/GLM  Ollama ◄──┘   free clouds
                     (free + paid)  (cloud)  (your own +    (NVIDIA, Groq,
                                              uncensored)    OpenRouter...)
```

| Part | What it is | Project |
|---|---|---|
| Hub | Chat app with a model dropdown, agents, file uploads, voice | [open-webui/open-webui](https://github.com/open-webui/open-webui) |
| Your own models | Runs downloaded or uploaded models on your machine | [ollama/ollama](https://github.com/ollama/ollama) |
| Jarvis | Always-listening desktop voice assistant (Mac, Windows, Linux) | [isair/jarvis](https://github.com/isair/jarvis) |
| Router | Lets Claude Code & other coding agents use free, local and uncensored models, with automatic fallback | [Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code) |
| **Jarvis HUD** | Holographic voice interface: talk to Jarvis, see live routes to every model, switch models by voice, run an AI council | Built for this project (`hud/`) on [three.js](https://github.com/mrdoob/three.js) + [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) |

![Jarvis HUD in council mode](docs/hud-council.jpg)

---

## 1. Start the hub (10 minutes)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

1. Open a terminal in this folder.
2. Make your settings file:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in:
   - `WEBUI_SECRET_KEY`: any long random text (or run `openssl rand -hex 32`).
   - `OPENROUTER_API_KEY`: from https://openrouter.ai/keys. This one key gives you the free models **and** Claude, GPT, DeepSeek and more.
   - `GEMINI_API_KEY` and `ZAI_API_KEY`: optional, leave empty if you don't have them.
4. Start it:
   ```bash
   docker compose up -d
   ```
   That starts only the light parts: the Jarvis HUD (**http://localhost:3001**), the router, the Lina checker and the local-model engine. **Only what you use runs.** The hub below and the studio voices stay off until you turn them on, so a small laptop doesn't heat up for nothing:
   ```bash
   docker compose --profile hub --profile voices up -d
   ```
   To keep them on for good, put `COMPOSE_PROFILES=hub,voices` in `.env`. Local models leave memory 2 minutes after their last answer (`OLLAMA_KEEP_ALIVE`).
5. With the hub on, open **http://localhost:3000** and create your account. The first account becomes the admin.
   The hub only accepts connections from this computer. To use it from your phone on the same Wi-Fi, make your admin account first, then change `"127.0.0.1:3000:8080"` to `"3000:8080"` in `docker-compose.yml` and run `docker compose up -d`.

**Check it works:** click the model dropdown at the top. You should see a long list of models. Pick one ending in `:free` and say hi.

### Make Jarvis an app (no terminal after this)

Run this **once**:
```bash
./scripts/install-app.sh
```
A **Jarvis** app appears in your app launcher (on a Chromebook: in the **Linux apps** folder). Right-click it → **Pin to shelf**. From then on, click the icon: it starts Jarvis and Jarvis Hands in the background if they aren't running, waits until Jarvis is ready, and opens it, already connected to Hands (no pairing code to type). If anything goes wrong, the details are in `~/.jarvis-hands/launch.log`. To remove the icon: `./scripts/install-app.sh remove`.

Want it in its own window instead of a browser tab? In Chrome, click the **Install** icon in the address bar (or **⋮ → Cast, save and share → Install page as app**).

## 2. Switch models

![The hub with the model dropdown filtered to free models](docs/hub-screenshot.png)

- **In a chat:** use the model dropdown in the message box. You can switch mid-conversation.
- **Not sure which free model?** Pick **Free Models Router**. It automatically picks a free model that's available right now (free models are sometimes busy).
- **Claude:** search the dropdown for `claude`: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2 and older versions. These come through OpenRouter and are **pay-per-use**: add credit at https://openrouter.ai/settings/credits first. (A Claude Pro/Max subscription can't be used inside other apps; it only works in Claude's own apps.)
- **Compare models:** click **+** next to the dropdown to ask two models the same question side by side.
- **Free models:** search the dropdown for `:free`.
- **Hide models you don't use:** Admin Panel → Settings → Models.
- **Add or change providers later:** Admin Panel → Settings → Connections. Any "OpenAI-compatible" service works (Groq, Together, DeepSeek, your RunPod server...).

## 3. Add your own models

Your own models run in Ollama on your computer. They are free and private, but they use your RAM/GPU. A model of 3–8B fits most laptops.

```bash
# Download a ready-made model
./scripts/add-model.sh pull llama3.2

# Download any GGUF model from Hugging Face
./scripts/add-model.sh pull hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF

# Use your own .gguf file: copy it into the models/ folder first
./scripts/add-model.sh import my-model my-file.gguf

# See / remove
./scripts/add-model.sh list
./scripts/add-model.sh remove my-model
```

Refresh the hub and the model is in the dropdown.

**Shortcut:** type a model name in the dropdown search (for example `llama3.2`) and click **Download "llama3.2"**. No terminal needed.

### Uncensored ("abliterated") models

An abliterated model is an open model with its refusal behaviour removed. It runs only on your computer: nothing is sent to a cloud company.

```bash
./scripts/add-model.sh uncensored small    # ~2 GB, any laptop
./scripts/add-model.sh uncensored medium   # ~7 GB, needs 16 GB RAM (best balance)
./scripts/add-model.sh uncensored large    # ~17 GB, big GPU or 32 GB+ RAM
```

These models "think" before answering, which is slow without a GPU. Make a fast version:

1. **Workspace → Models → +**. Name: `Uncensored`.
2. Base model: the `huihui_ai/qwen3.5-abliterated` one you downloaded.
3. **Advanced Params → Think → Off**. Save.

Now pick **Uncensored** in the dropdown; it replies in seconds.

> You're responsible for what you do with an uncensored model. It will also confidently make things up, so double-check anything important.

### Recommended uncensored set (one command)

```bash
./scripts/add-model.sh pack essential    # ~24 GB disk, for a 16 GB RAM laptop
./scripts/add-model.sh pack big          # adds two bigger ones (~28 GB more, needs 32 GB+ RAM)
```

| In the HUD | Model | Size | Good for |
|---|---|---|---|
| **Qwen 7B Uncensored** | `huihui_ai/qwen2.5-abliterate:7b` | 4.7 GB | All-rounder; reliable at following instructions and using tools. Jarvis's backup when a cloud model fails. |
| **Uncensored 9B** | `huihui_ai/qwen3.5-abliterated:9b` | 6.6 GB | Smartest everyday model in the set |
| **Coder 7B Uncensored** | `huihui_ai/qwen2.5-coder-abliterate:7b` | 4.7 GB | Writing and fixing code |
| **Vision 8B Uncensored** | `huihui_ai/qwen3-vl-abliterated:8b` | 6.1 GB | Looks at images and your screen (for laptop control) |
| **Fast 2B Uncensored** | `huihui_ai/qwen3.5-abliterated:2b` | 1.9 GB | Instant replies |
| (memory) | `nomic-embed-text` | 0.3 GB | Lets the hub search your documents |
| *big:* Coder 30B | `huihui_ai/qwen3-coder-abliterated:30b` | 18.6 GB | Much stronger coding |
| *big:* Qwen 14B | `huihui_ai/qwen2.5-abliterate:14b` | 9.0 GB | Stronger all-rounder |

Only one model is loaded into memory at a time, so the 16 GB set is fine on a 16 GB laptop.

**Have an NVIDIA GPU?** In `docker-compose.yml`, remove the `#` from the 6 GPU lines under `ollama`, then run `docker compose up -d` again.

## 4. The Jarvis look

The hub ships with a dark navy + cyan theme ([`theme/custom.css`](theme/custom.css)). Turn it on with **Settings → General → Theme → Dark**.

![Jarvis OS theme](docs/hub-theme.png)

- **Change the accent colour:** edit the two `--jarvis-accent` lines at the top of `theme/custom.css`, then run `docker compose restart open-webui` and refresh the page.
- **Back to the default look:** delete the `custom.css` line in `docker-compose.yml` and run `docker compose up -d`.

## 5. Create the "Jarvis" personality

> The HUD has its own personality switch: **Grok mode** (the default, [`jarvis/jarvis-persona-grok.md`](jarvis/jarvis-persona-grok.md): witty, blunt, answers the questions other assistants dodge, no lectures) and **serious mode** ([`jarvis/jarvis-persona.md`](jarvis/jarvis-persona.md)). Say *"Grok mode"* or *"serious mode"*. Edit either file to change how Jarvis talks, then `docker compose restart hud`. The steps below set up the personality for the hub and the desktop app.

This makes a model called **jarvis** that every app (including the voice assistant) can use.

1. In the hub: **Workspace → Models → +**.
2. Name: `Jarvis`. Model ID: `jarvis`.
3. Base model: pick any model (a free one is fine to start, switch any time).
4. System prompt: paste everything from [`jarvis/jarvis-persona.md`](jarvis/jarvis-persona.md).
5. Save.

To change which brain Jarvis uses later, just change the base model here. Nothing else needs to change.

## 6. Install the Jarvis voice assistant

1. Download Jarvis for your computer: https://github.com/isair/jarvis/releases
2. In the hub: **Settings → Account → API Keys → Create new key**. Copy it.
3. Open Jarvis. In the setup wizard choose **OpenAI-compatible server** and enter:
   - Server URL: `http://localhost:3000/api`
   - API key: the key you just copied
   - Model: `jarvis`
4. Press **Connect**, allow the microphone, and say: *"Jarvis, what can you do?"*

(Advanced: the same settings can go in `~/.config/jarvis/config.json`. See [`jarvis/config.example.json`](jarvis/config.example.json).)

> **License note:** Jarvis (isair/jarvis) is free for **personal, non-commercial use only**. Selling it or using it in a paid product needs a commercial license from its author. Open WebUI and Ollama have their own licenses; check them before you build a product on top.

## 7. Claude Code with free, local and uncensored models (the router)

The router starts with everything else (`docker compose up -d`). It pretends to be Claude's server, so Claude Code (and Codex, Cline, Aider...) works as usual but the answers come from the models **you** choose.

**Set it up (in `.env`):**

| Setting | What it does | Default |
|---|---|---|
| `MODEL` | The main model Claude Code uses (its "Opus"/"Sonnet") | `open_router/openrouter/free`: picks any free OpenRouter model |
| `MODEL_HAIKU` | Small background jobs | Your local uncensored model, so free requests aren't wasted |
| `MODEL_FALLBACKS` | Tried in order when the main model is busy or out of free requests | Your local model, which never runs out |

Model names are `provider/model`, for example `nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b`, `groq/llama-3.3-70b-versatile` or `ollama/huihui_ai/qwen3.5-abliterated:9b`. Full list of 61 providers: [provider catalog](https://github.com/Alishahryar1/free-claude-code#choose-a-provider).

After changing `.env`, run `docker compose up -d router`.

**Use it with Claude Code** (install Claude Code first: https://code.claude.com):

macOS / Linux:
```bash
ANTHROPIC_BASE_URL=http://localhost:8082 ANTHROPIC_AUTH_TOKEN=jarvis claude
```

Windows PowerShell:
```powershell
$env:ANTHROPIC_BASE_URL="http://localhost:8082"; $env:ANTHROPIC_AUTH_TOKEN="jarvis"; claude
```

This only affects that one terminal window. Open a normal terminal and `claude` uses your real Claude subscription again.

**Check it works:** inside Claude Code type `/model`. You should see the router's models. Ask it to "create hello.py that prints hi"; it should write the file.

### How "free" and "unlimited" it really is

| Option | Cost | Limit | Uncensored? |
|---|---|---|---|
| Your own models (Ollama) | Free | **No limit**, only your computer's speed | ✅ abliterated models |
| OpenRouter `:free` models | Free | 50 requests/day (1,000/day after buying $10 credit once), 20/min | ❌ |
| NVIDIA NIM, Groq, Cerebras, Gemini free tiers | Free with sign-up | Each has its own daily/minute limits, which change often | ❌ |
| OpenRouter Dolphin Venice / Cydonia 24B | Very cheap pay-per-use (about $0.20–0.90 per million tokens) | Your credit | ✅ |
| Featherless.ai "Chat" plan | $25/month | Unlimited tokens, 40,000+ open models incl. abliterated | ✅ |
| Your own GPU server on RunPod | Pay per hour while it runs | No limit | ✅ any model |

**Good to know:**
- One small Claude Code task used about **6 free requests** in testing, so 50/day is roughly 6–8 small tasks. Add more free keys (NVIDIA, Groq, Cerebras) or put your local model first if you need more.
- Free and local models are much weaker at coding than real Claude. Great for simple tasks and experiments; for big projects use real Claude.
- Uncensored models have no safety filter and still make things up. You're responsible for how you use them.

## 8. Jarvis HUD: the holographic voice interface

It starts with everything else. Open **http://localhost:3001** in **Chrome or Edge** (voice input needs one of those; typing works in any browser).

![Jarvis HUD 3D on desktop and phone](docs/hud-3d.jpg)

**What you see:**
- **A 3D reactor** (three.js with real glow): ~22,000 particles on gyroscope orbits, a wave-field floor, and rotating HUD rings. Amber when idle, blue while listening, spinning fast while routing, pulsing when Jarvis speaks. **Drag to rotate 360°, scroll to zoom**, it slowly turns by itself when you let go. (Older computers without WebGL automatically get the flat 2D version; you can force it with `http://localhost:3001/?2d`.)
- **Blue nodes** are your models. **Red routes** connect them to the core; the active route glows and shows energy moving along it. A red error node means that link failed (the reason shows in the left panel).
- **Neural Links** (left): every model, its status and speed. Click one, or a node, to route to it. Click ◆ to give it a council seat (max 4).
- **Comms Log** (right): the conversation, including who said what.

**Talking to it:**
- **Voice first:** the dock is just the mic. Tap it (or press Ctrl+Space), speak, and it sends when you stop. To type instead, press the ⌨ button or simply start typing anywhere; the box closes again when it's empty.
- Turn on **Wake word** and just say *"Jarvis, …"* or *"Sophia, …"* any time (the tab must stay open). It stays on next time you open the HUD.
- **Voice** on/off controls whether Jarvis speaks replies out loud.
- **Voices ▾** opens the **Voice Studio**:
  - **Studio voices** (top): 55 natural voices (30 female, 25 male; American, British, Spanish, French, Italian, Hindi, Japanese, Portuguese, Mandarin), made on your computer by the free Kokoro engine (the `voice` service). Sorted best-quality first. With these, the reactor pulses to the *real* sound of the voice. Hear 4 of them: [`docs/voice-samples.mp3`](docs/voice-samples.mp3). Play with all of them at http://localhost:8880/web.
  - **System voices** (below): the voices built into your computer and browser.
  - Female / Male / Natural filters, speed and pitch sliders, and a Test button. Your choice is remembered.
  - Or just say it: *"Jarvis, use a female voice"*, *"switch voice to Emma"*, *"British male voice"*.
- **FX** turns the sci-fi interface sounds on/off (soft ticks, blips and a route "whoosh").
- **◐ Scene** changes the core. The default is **Auto**: the core changes shape with what Jarvis is doing, so anyone watching can tell:

  | Jarvis is… | Core becomes |
  |---|---|
  | idle | your **home core** (Black Hole unless you pick another) |
  | listening to you | **Liquid Glass**: a shimmering glass blob |
  | thinking / routing | **Warp Portal**: data streaks rushing into a glowing ring |
  | speaking | **Plasma Orb**: bright heart with electric veins |
  | council speaking | **Neural Brain**: many minds at work |

  You can also lock any core: **Bloom** (thousands of shimmering fibres forming slowly turning petals), **Black Hole** (real light-bending, glowing accretion disk, planets orbiting, your models circle it like satellites), **Sun** (boiling surface, bright limb, looping prominences), **Plasma**, **Portal**, **Liquid**, **Reactor**, **Neural Brain**. (Circuit, Pulse and Data Stream were removed because they looked muddy; saying their names picks the closest core that's left.) Say *"black hole mode"*, *"plasma core"*, *"make the core a sun"*, or *"auto mode"* to go back. The last core you lock becomes the idle core in Auto.
- **● Colour** cycles the theme: Amber, Ice (blue), Violet, Crimson, Emerald, Gold. Everything follows: core, disk, sun, panels. Or say *"change colour to blue"*.
- **The live connection to your active model:**
  - warm colours (Amber, Gold, Crimson): a **solar flare** rises from the core, arcs out and loops around the model you're using. Switch models and a new flare grows toward the new one.
  - cool colours (Ice, Violet, Emerald): crackling **plasma lightning** from the core to the model.
  - the Neural Links panel marks it **⚡ linked** with a moving plasma bar.
  - the Comms Log shows a **LINK TRANSFER** card: FROM model → TO model, provider, LOCAL/CLOUD and FREE/PAID tags, the exact model ID, then **LINKED · latency** after its first reply.
- **The backdrop is the real Milky Way** (ESO's panorama photo), colour-graded into deep blues and violets, with three layers of twinkling stars, soft nebula colour and a big **ringed planet**. **Move your mouse** and the layers shift at different depths. In Black Hole mode the sky dims (space around a black hole is dark) and the hole draws its matter, shadow and photon rings on top without warping the sky.
- **The black hole:** a big, thick disk of glowing gas swirling inward (inner gas orbits faster), soft hot gas above and below it, relativistic beaming (the side coming at you is brighter), a sharp photon ring, and three planets on their own tilted orbits. Anything that passes behind the hole really disappears behind it. If your computer is slow, it lowers its own resolution automatically to stay smooth.
- **Play with the black hole** (the **✦ Play** button, in Auto or Black Hole mode):
  - pick **Light**, **Gas**, **Star** or **Planet**, then click anywhere in space to throw it in:
    - **Light** fires a beam of light rays that bend around the hole. Some loop round it, the rest fall in (same physics as the picture).
    - **Gas** is a cloud that spirals in, heats from red to white-hot and feeds the disk.
    - **Star** and **Planet** dive in and get stretched into a long stream by the tides before they fall in.
  - **grab anything that orbits** (the planets, the wireframe drones, or something you threw), drag it and let go: it flies off with your swipe. A new planet or drone forms a few seconds later.
  - feeding it makes the disk flare, fires **jets** from the poles, and makes the hole slightly heavier and bigger (MASS in the bar). **Clear** resets everything.
  - **View**: *Wide* (see everything), *Close* (fly in near the disk), *Follow* (ride along with the last thing you threw). Drag to turn and scroll to zoom at any time.
  - **Plasma** slider: from a thin disk to a dense, blazing one.
  - while Play is open, the black hole stays on screen even when Jarvis talks.
- **Gravity:** every model orbits the core on its own path (faint orbit lines); closer ones move faster, like real planets. The linked model's orbit glows.
- **Control-room readouts** around the core show live data: core form and state, the linked model and provider, latency, how many links work, uptime, and Signal / Links gauges.
- **Holo** shows/hides the holographic layer: gear-toothed machine rings turning around the core, wireframe drones orbiting (grab one and throw it into the black hole), and a radar sweep on the floor (when the floor shows). Say *"hide the holograms"* / *"show the holograms"*.

![Black hole with a solar flare to the active model](docs/hud-blackhole.jpg)
![Blue theme: plasma lightning](docs/hud-blackhole-blue.jpg)

**Voice or typed commands:**

| Say | What happens |
|---|---|
| "Jarvis, switch to Groq" / "use the uncensored model" / "switch to Kimi" | Routes to that model (any name or nickname in `hud/models.json`, or any model the router knows) |
| "Start the council" / "council off" | Council mode on/off |
| "Grok mode" / "rebel mode" (default) · "serious mode" | Jarvis's personality: witty, blunt, no lectures · or the calm, polite butler |
| "Switch to Grok" / "use Grok 4.3" | The real Grok (xAI) through OpenRouter: **paid**, add credit at openrouter.ai first |
| "Status" | Which model is active, what's online |
| "List models" | Reads out your models |
| "Use a female voice" / "switch voice to George" | Changes Jarvis's voice |
| "Auto mode" / "black hole mode" / "sun mode" / "bloom mode" / "plasma core" / "neural brain mode" | Change the core |
| "Change colour to blue" / "purple theme" | Change the colour theme |
| "Hide the holograms" / "show the holograms" | Holographic layer on/off |
| "Throw a star in" / "send light" / "feed it gas" / "drop a planet" / "clear the black hole" | Play with the black hole |
| "Take control of my laptop" / "take control and open my downloads folder" | Jarvis drives your laptop (section 9) |
| "Stop" / "release control" (or Esc) | Take your laptop back |
| "Switch to Qwen 7B" / "use the coder" / "use vision" | Your local uncensored models |
| "Lina rule: if we lose 3 in a row, stop until I restart" | Writes it in Lina, checks it, tells you what it means (see section 9) |
| "Confirm" / "cancel" | Save or discard the Lina rule Jarvis just checked |
| "List my Lina rules" | Reads your saved rules |
| "How did the bots do?" / "bot report" | Last night's Edge Bot training results (read-only, paper money) |
| "Computer, how much disk space do I have?" / "run git status" / "open youtube" | Jarvis Hands: runs ONE step on your computer and explains the result (see section 11) |
| "Create an agent called scout that …" / "ask scout to …" / "list my agents" | Your team of agents (see section 12) |
| Anything else | Answered by the active model (or the council) |

**Council mode (AIs talking to each other):** the council members answer one after another. Each sees what the others said and agrees, adds or disagrees by name. Then Jarvis (your active model) gives the final verdict, which is the part spoken out loud. Default council: Nemotron Ultra + GPT-OSS (Groq) + Qwen (Cerebras); a full round takes about 4 seconds. Each round uses one request per member + one for the verdict.

**Your favourite models** live in [`hud/models.json`](hud/models.json): name, provider/model, and the nicknames you can say. Models you download into Ollama appear automatically. After editing, run `docker compose restart hud`.

**If a model doesn't answer**, Jarvis automatically hands over to your local uncensored model (`"fallback"` in `models.json`), so there's always an answer.

![Jarvis HUD on a phone](docs/hud-phone.jpg)

**Safety:** the HUD only answers pages opened on this computer (`localhost:3001` or `127.0.0.1:3001`). Other websites you visit can't use it to switch models or spend your credit. To open it under another name, add it as `HUD_ALLOWED_HOSTS=name:3001` under `hud` → `environment` in `docker-compose.yml`.

> **Privacy note:** Chrome and Edge send your *speech audio* to Google/Microsoft to turn it into text. The words Jarvis speaks back are made on your computer. If you want 100% offline voice, use the Jarvis desktop app (section 6) with your local model.

### Sophia and Jarvis: two assistants

Jarvis has a partner: **Sophia**. Same Grok-style personality ([`jarvis/sophia-persona.md`](jarvis/sophia-persona.md)), her own female voice, and her own model.
- Say **"Sophia"** (or *"Sophia, what's the weather like on Mars?"*) and she answers; the header turns to **S.O.P.H.I.A**. Say **"Jarvis"** to switch back. *"Talk to Sophia"* and *"switch to Jarvis"* work too, and with the wake word on, both names wake the HUD.
- Each one **remembers her/his own model and voice**: switch Sophia to Grok and Jarvis to a local model, and each keeps it. Pick her voice in **Voices ▾** while she's active (default: Kokoro's `af_heart` with studio voices on, otherwise your computer's first female voice).
- "Serious mode" works for both.

### Eco mode: no overheating

The HUD works like a game's graphics settings. On a Chromebook, or any computer with 4 GB of RAM or 4 cores, it picks **eco** by itself: 30 frames a second, lighter glow, no film grain, the smaller sky picture. Everywhere it caps the frame rate, drops to a trickle after 20 seconds of nothing happening, stops completely when the tab is hidden, and lowers its resolution while frames run late. Hidden cores use no graphics power at all.
- Say *"eco mode"* / *"battery mode"*, *"high quality"*, or *"auto quality"* (the page reloads in about 5 seconds). Or open `http://localhost:3001/?eco`.

## 9. Lina: rules for your bots, by voice

Lina Sigra is a small language for bot rules. Every rule is checked word by word, and it can only make a bot *more careful*: pause, stop, watch, ask you, or run the approved paper rule at full, half or quarter size. Money words (`moni`, `paga` pay, `vori` buy, `sori` sell, `dela` give, `toma` take, `valida` approve) are always refused.

1. Say (or type): *"Jarvis, Lina rule: if risk is above 0.8, pause for 10 days."*
2. The **Lina writer** model writes `se risk es alta 0.8: na va pausa 10 dia`. If the checker rejects its first try, it gets one more try with the reason.
3. Jarvis tells you what the checked rule means in plain English.
4. Say **"confirm"** to save it (or **"cancel"**). Saved rules are in `rules.lina` inside the HUD's data volume, with the English meaning and a fingerprint.

You can also type Lina directly: *"Lina se fila de tri mala: na va halta"* (three losses in a row: stop until you restart).

- **Which model writes Lina:** `"lina_writer"` in `hud/models.json` (default: GPT-OSS on Groq). When the trained Lina model is ready, it goes here.
- **The checker** is the `lina` service: the same Lina engine as Edge Bot, with no port on your computer. Update it with `./scripts/update-lina.sh <path to your edge-bot folder>`.
- **Edge Bot report:** *"How did the bots do?"* reads the public, read-only training summary. No key needed.

## 10. Lite mode (Chromebook, 4–8 GB RAM)

```bash
./scripts/lite.sh          # HUD + router + Lina + local engine, no hub and no studio voices
./scripts/lite.sh small    # same, and download the 2 GB uncensored model (8 GB RAM)
./scripts/lite.sh stop
```
Open **http://localhost:3001/?2d** for the lighter 2D HUD. You need at least one free cloud key in `.env` (Groq is fast). On a Chromebook, turn on Linux first (Settings → About ChromeOS → Developers) and give it at least 20 GB of disk.

## 11. Jarvis Hands: let Jarvis use your computer

Jarvis lives in Docker, which can't reach your computer. **Jarvis Hands** is a small helper you run on the computer itself (it needs [Node.js](https://nodejs.org) 18 or newer, nothing else).

1. In this folder, start it (leave the window open):
   ```bash
   node hands/hands.js
   ```
   Commands start in `~/jarvis-workspace`. To work in another folder: `node hands/hands.js ~/projects`.
2. It prints a pairing code. In the HUD, type: `hands code <the code>`.
3. Ask: *"Computer, how much disk space do I have?"*, *"run git status"*, *"open youtube"*.
4. Jarvis works out the command, runs it straight away, shows you the exact command and its real output, and tells you what it means.

**Your rules:** Jarvis runs what it decides, with no built-in blocks. To stop it running certain commands, add your own lines to `LOCKED` at the top of `hands/hands.js`, for example `[/\bsudo\b/i, 'admin rights'],`. Then restart Hands and run `docker compose up -d --build hud`. Commands on your list are refused on your computer and in the HUD.

**What stays on:**
- **The connection:** Hands listens on 127.0.0.1, only accepts the HUD page and needs the pairing code, so other websites you visit can't send commands to your computer.
- **The log:** everything is recorded in `~/.jarvis-hands/log.jsonl`.
- **The off switch:** Ctrl+C in the Hands window, or type `hands disconnect` in the HUD.

---

## 9. Laptop control: Jarvis uses your mouse and keyboard

Say **"Jarvis, take control of my laptop"** and Jarvis drives your real desktop. It looks at the screen, moves your cursor (you can watch it glide), clicks, double-clicks, drags, scrolls, types, presses shortcuts and opens apps, websites and folders. **There is no approval step**: while control is on, everything you say is an order for the laptop.

- **One-shot:** *"take control and open my downloads folder"*, *"take control and search YouTube for lofi music"*.
- **While in control:** just say the task (*"open Firefox and check the weather"*), or give quick moves with no AI needed: *"scroll down"*, *"type hello world"*, *"press ctrl plus t"*, *"click"*, *"double click"*, *"right click"*.
- **Taking it back** (always works): say **"stop"** / **"release control"**, press **Esc** in the HUD, click **Stop** on the red **CONTROL ACTIVE** banner, or **push your mouse into the top-left corner** of the screen.
- The red banner shows each step and what Jarvis is thinking. When it finishes, it says what it did.

**Install (once, on the laptop itself; Linux):**

```bash
control/install.sh
```

This installs the tools (xdotool, scrot, ImageMagick), starts the helper and makes it start at every login. The helper listens only on `127.0.0.1:3002` and only accepts requests from the HUD page. It runs on your laptop, not in Docker, because it needs your desktop. Remove it with `control/install.sh remove`.

**Which AI looks at the screen:** Gemini Flash if `GEMINI_API_KEY` is in `.env` (free tier, best at finding buttons), otherwise a free OpenRouter vision model (each step is one of your 50 free requests a day), otherwise your local `qwen3-vl-abliterated` (private, but slow on a CPU). To choose one yourself, set `CONTROL_MODEL` (plus `CONTROL_API_BASE` and `CONTROL_API_KEY`) in `.env`.

> **Use an Xorg session.** Wayland (the default on new Ubuntu) blocks apps from moving the mouse or taking screenshots. On the login screen click the gear icon and choose **"Ubuntu on Xorg"**.
>
> **On a Chromebook:** Linux runs in its own box there, so laptop control only sees and drives **Linux apps** (the terminal, Linux Firefox, files in the Linux folder), not ChromeOS or the Chrome browser itself. Jarvis Hands (section 11) works the same way: commands run inside Linux. To let Jarvis use a browser on a Chromebook, install Firefox inside Linux (`sudo apt install firefox-esr`) and ask Jarvis to use that.
>
> **Be careful what you ask.** With control on, Jarvis can do anything you can: delete files, send messages, run commands. A log of every step is kept in `~/.local/state/jarvis-control.log`.

## 12. Agents: your own team of bots

Like Grok Bot's team: each agent has **one job**, works on **your computer** (inside Jarvis Hands) in **its own folder**, and can run on a **routine**. Jarvis is the chief of staff: you talk to Jarvis, Jarvis hands out the work.

| Say | What happens |
|---|---|
| "Create an agent called scout that checks my disk space and cleans old downloads every day at 9am" | Hires *scout*: its job, plus a routine (also "every 30 minutes", "every 2 hours", "every morning", "every evening") |
| "Ask scout to check how much space is left" | Scout works on it by itself, step by step: runs a command, reads the result, decides the next step, up to 12 steps. Each step shows in the Comms Log; Jarvis says the result |
| "List my agents" / "who is on my team" | The team, their routines and what each did last |
| "What did scout do" / "scout report" | The last run: task, every command, the result |
| "Fire scout" | Removes the agent (its folder stays) |

- **Needs Jarvis Hands running** (section 11). Agents keep running their routines while Hands is on, even with the HUD closed; when you open the HUD, Jarvis tells you which routines finished.
- **Brain:** an agent thinks with the model that was active when you hired it (switch models first to choose). Local models are free and private; cloud ones are faster.
- **Where things live:** each agent's folder is `~/jarvis-workspace/agents/<name>`, its runs are saved in `~/.jarvis-hands/runs/`, the team in `~/.jarvis-hands/agents.json`.
- **Your rules** (the `LOCKED` list in `hands/hands.js`) apply to every command an agent runs. Steps per run: `AGENT_MAX_STEPS` (default 12).
- **Not yet:** app connectors (Gmail, Slack). The video's Grok Bot clone uses Composio for those; that would need a Composio key.

---

## Everyday commands

```bash
docker compose up -d        # start
docker compose down         # stop (chats + models are kept)
docker compose pull && docker compose up -d   # update to newest versions
docker compose logs -f open-webui             # see what's going on
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Dropdown shows no cloud models | Check the key in Admin Panel → Settings → Connections, click the refresh/verify icon. Keys in `.env` are only read on the **first** start. |
| A `:free` model says "rate limited" | Free models have daily limits. Pick another free model or add a few dollars of OpenRouter credit. |
| Own model is slow | Use a smaller model (1–4B), or enable the GPU lines. |
| Jarvis can't connect | Make sure the hub is running (open http://localhost:3000) and the API key and model name `jarvis` are correct. |
| Claude Code says "API key is not set" | That provider's key is empty in `.env`. Add it, then `docker compose up -d router`. |
| Claude Code with a local model is very slow | Make sure `REASONING_HAIKU=off` (and `"reasoning":"off"` in fallbacks). Thinking mode on a laptop can take minutes. |
| See what the router is doing | `docker compose logs -f router` |
| HUD mic does nothing | Use Chrome or Edge, open it as `http://localhost:3001` (not an IP address), and allow the microphone in the address bar. |
| HUD shows "Router offline" | `docker compose ps` and `docker compose logs router`. Usually a mistake in `.env`. |
| A node turns red with "key missing" | Add that provider's key to `.env`, then `docker compose up -d router`. |

---

## Credits

- Milky Way panorama: ESO/S. Brunier, [CC BY 4.0](https://www.eso.org/public/images/eso0932a/) (`hud/public/assets/`)
- [three.js](https://github.com/mrdoob/three.js) (MIT) and [postprocessing](https://github.com/pmndrs/postprocessing) (zlib), stored in `hud/public/vendor/`
- Studio voices: [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) (Apache-2.0); router: [free-claude-code](https://github.com/Alishahryar1/free-claude-code) (AGPL-3.0)
