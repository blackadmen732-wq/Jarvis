#!/usr/bin/env python3
"""Jarvis laptop control: lets Jarvis see your screen and drive your real mouse and keyboard.

Runs on YOUR laptop (Linux), not in Docker, because it needs your desktop.
  - looks at the screen (screenshot), asks a vision model what to do next, then does it:
    moves your cursor (visibly), clicks, drags, scrolls, types, presses shortcuts, opens apps
  - no approval step: once you say "take control of my laptop" it acts until the task is done
  - always stoppable: say "stop", press Esc in the HUD, or shove the mouse into the TOP-LEFT corner

Only the Jarvis HUD page (http://localhost:3001) may talk to it; it listens on 127.0.0.1:3002.
Standard library only. Needs xdotool + a screenshot tool (scrot / gnome-screenshot / grim / ImageMagick).
"""
import base64, json, os, re, shutil, subprocess, tempfile, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('CONTROL_PORT', '3002'))
HUD_ORIGINS = {f'http://localhost:{p}' for p in (3001,)} | {f'http://127.0.0.1:{p}' for p in (3001,)}
MAX_STEPS = int(os.environ.get('CONTROL_MAX_STEPS', '30'))
LOG = os.path.expanduser('~/.local/state/jarvis-control.log')


# ---------------------------------------------------------------- settings (from the repo's .env)
def load_env():
    for path in (os.path.join(HERE, '..', '.env'), os.path.join(HERE, '.env')):
        try:
            for line in open(path, encoding='utf-8'):
                m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
                if m and m.group(1) not in os.environ and m.group(2):
                    os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")
        except OSError:
            pass


def pick_model():
    """Which vision model looks at the screen. Override with CONTROL_API_BASE / CONTROL_MODEL / CONTROL_API_KEY."""
    e = os.environ
    if e.get('CONTROL_MODEL'):
        return e.get('CONTROL_API_BASE', 'https://openrouter.ai/api/v1'), e['CONTROL_MODEL'], e.get('CONTROL_API_KEY') or e.get('OPENROUTER_API_KEY', '')
    if e.get('GEMINI_API_KEY'):        # free tier, strong at finding things on screen
        return 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash', e['GEMINI_API_KEY']
    if e.get('OPENROUTER_API_KEY'):    # free vision model (counts toward OpenRouter's 50 free requests a day)
        return 'https://openrouter.ai/api/v1', 'nvidia/nemotron-3.5-super-vl:free', e['OPENROUTER_API_KEY']
    return 'http://localhost:11434/v1', 'huihui_ai/qwen3-vl-abliterated:8b', 'ollama'   # fully local (slow on CPU)


# ---------------------------------------------------------------- the desktop: screen, mouse, keyboard
class Desktop:
    def __init__(self):
        self.wayland = os.environ.get('XDG_SESSION_TYPE') == 'wayland'
        self.xdotool = shutil.which('xdotool')
        self.ydotool = shutil.which('ydotool')

    def problem(self):
        if not self.xdotool and not self.ydotool:
            return 'xdotool is not installed (run control/install.sh)'
        if not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
            return 'no desktop session found (DISPLAY is not set)'
        if not self.screenshot_tool():
            return 'no screenshot tool found (install scrot)'
        return None

    def _x(self, *args, check=False):
        return subprocess.run(['xdotool', *map(str, args)], capture_output=True, text=True, timeout=10, check=check).stdout

    def size(self):
        try:
            w, h = self._x('getdisplaygeometry').split()
            return int(w), int(h)
        except Exception:
            return 1920, 1080

    def mouse(self):
        try:
            d = dict(l.split('=') for l in self._x('getmouselocation', '--shell').split())
            return int(d['X']), int(d['Y'])
        except Exception:
            return -1, -1

    def screenshot_tool(self):
        for t in ('scrot', 'gnome-screenshot', 'grim', 'spectacle', 'import'):
            if shutil.which(t):
                return t
        return None

    def screenshot(self):
        path = os.path.join(tempfile.gettempdir(), 'jarvis-screen.png')
        tool = self.screenshot_tool()
        cmd = {'scrot': ['scrot', '-o', '-p', path], 'gnome-screenshot': ['gnome-screenshot', '-p', '-f', path], 'grim': ['grim', path],
               'spectacle': ['spectacle', '-b', '-n', '-o', path], 'import': ['import', '-window', 'root', path]}[tool]
        subprocess.run(cmd, capture_output=True, timeout=15)
        out = path
        if shutil.which('convert'):       # smaller + faster to send: max 1366 px wide JPEG
            out = path.replace('.png', '.jpg')
            subprocess.run(['convert', path, '-resize', '1366x>', '-quality', '82', out], capture_output=True, timeout=15)
        with open(out, 'rb') as f:
            data = f.read()
        return base64.b64encode(data).decode(), 'image/jpeg' if out.endswith('.jpg') else 'image/png'

    # visible cursor glide, so you can watch where Jarvis is going
    def move(self, x, y, glide=0.35):
        x0, y0 = self.mouse()
        steps = 14 if x0 >= 0 else 1
        for i in range(1, steps + 1):
            k = i / steps
            k = k * k * (3 - 2 * k)
            self._x('mousemove', round(x0 + (x - x0) * k), round(y0 + (y - y0) * k))
            time.sleep(glide / steps)

    def click(self, x, y, button=1, count=1):
        self.move(x, y)
        self._x('click', '--repeat', count, '--delay', 90, button)

    def drag(self, x, y, x2, y2):
        self.move(x, y); self._x('mousedown', 1); time.sleep(0.1)
        self.move(x2, y2, glide=0.6); time.sleep(0.1); self._x('mouseup', 1)

    def scroll(self, direction, amount=3, x=None, y=None):
        if x is not None:
            self.move(x, y)
        btn = {'up': 4, 'down': 5, 'left': 6, 'right': 7}.get(direction, 5)
        self._x('click', '--repeat', max(1, min(25, int(amount))), '--delay', 40, btn)

    def type(self, text):
        self._x('type', '--delay', 14, '--', text)

    def key(self, keys):
        # accept "ctrl+l", "Return", "enter", "super", "alt+tab" ...
        alias = {'enter': 'Return', 'return': 'Return', 'esc': 'Escape', 'escape': 'Escape', 'tab': 'Tab', 'backspace': 'BackSpace',
                 'delete': 'Delete', 'space': 'space', 'win': 'super', 'cmd': 'super', 'meta': 'super', 'pageup': 'Prior', 'pagedown': 'Next',
                 'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right', 'home': 'Home', 'end': 'End'}
        combo = '+'.join(alias.get(p.strip().lower(), p.strip()) for p in str(keys).split('+'))
        self._x('key', '--clearmodifiers', combo)

    def run(self, command):
        # start apps / commands detached; report early output if it finishes quickly
        p = subprocess.Popen(command, shell=True, start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            out, _ = p.communicate(timeout=2.5)
            return f'exit {p.returncode}: {(out or "").strip()[-400:]}'
        except subprocess.TimeoutExpired:
            return 'started (still running)'

    def notify(self, title, body=''):
        if shutil.which('notify-send'):
            subprocess.run(['notify-send', '-a', 'Jarvis', '-u', 'low', title, body], capture_output=True)


# ---------------------------------------------------------------- the brain: one step at a time
SYSTEM = """You are Jarvis, controlling Mark's Linux laptop with his permission. You see a screenshot of the
whole screen and do the task with the mouse and keyboard, one action per reply.

Reply with ONE JSON object and nothing else:
{"thought": "<one short sentence about what you see and why>", "action": "<name>", ...parameters}

Coordinates x and y are 0-1000 relative to the screenshot: 0,0 is top-left, 1000,1000 is bottom-right.
Aim for the CENTRE of the button, link, icon or text field.

Possible replies (exactly one per turn):
  {"thought": "...", "action": "click", "x": 512, "y": 300}
  {"thought": "...", "action": "double_click", "x": 512, "y": 300}
  {"thought": "...", "action": "right_click", "x": 512, "y": 300}
  {"thought": "...", "action": "move", "x": 512, "y": 300}
  {"thought": "...", "action": "drag", "x": 100, "y": 200, "x2": 600, "y2": 200}
  {"thought": "...", "action": "scroll", "direction": "down", "amount": 5}
  {"thought": "...", "action": "type", "text": "hello"}
  {"thought": "...", "action": "key", "keys": "Return"}          (or "ctrl+l", "ctrl+t", "alt+tab", "super", "ctrl+c")
  {"thought": "...", "action": "run", "command": "xdg-open https://example.com"}   (shell: open apps, files, URLs)
  {"thought": "...", "action": "wait", "seconds": 2}
  {"thought": "...", "action": "done", "summary": "one sentence for Mark"}   (finished, or impossible: say why)

Tips: use run to open apps or websites (faster than hunting icons). After typing in a search or address bar press Return.
Check the screenshot to see if your last action worked before moving on. Never repeat the same failing action more than twice."""


def ask_model(goal, history, image_b64, mime, step):
    base, model, key = pick_model()
    hist = '\n'.join(f'{i + 1}. {h}' for i, h in enumerate(history[-10:])) or 'none yet'
    body = {
        'model': model, 'temperature': 0.2, 'max_tokens': 600,
        'messages': [
            {'role': 'system', 'content': SYSTEM},
            {'role': 'user', 'content': [
                {'type': 'text', 'text': f'Task: {goal}\nStep {step} of at most {MAX_STEPS}.\nActions so far:\n{hist}\nWhat is the next action?'},
                {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{image_b64}'}},
            ]},
        ],
    }
    req = urllib.request.Request(base.rstrip('/') + '/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    text = data['choices'][0]['message'].get('content') or ''
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.S)
    start = text.find('{')
    if start < 0:
        raise ValueError(f'model did not answer with an action: {text[:160]!r}')
    act, _ = json.JSONDecoder().raw_decode(text[start:])          # first object only, ignore anything after it
    act['action'] = re.sub(r'[^a-z_]', '', str(act.get('action', '')).lower().split(' ')[0].split('{')[0])
    return act, model


class Controller:
    def __init__(self):
        self.desk = Desktop()
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        self.thread = None
        self.state = {'active': False, 'goal': '', 'step': 0, 'thought': '', 'action': '', 'done': '', 'error': '', 'model': '', 'log': []}

    def log(self, line):
        self.state['log'] = (self.state['log'] + [line])[-40:]
        try:
            os.makedirs(os.path.dirname(LOG), exist_ok=True)
            with open(LOG, 'a', encoding='utf-8') as f:
                f.write(time.strftime('%H:%M:%S ') + line + '\n')
        except OSError:
            pass

    def status(self):
        s = dict(self.state); s['problem'] = self.desk.problem(); s['model'] = s['model'] or pick_model()[1]
        return s

    def start(self, goal):
        self.stop()
        if self.thread:
            self.thread.join(timeout=5)
        self.stop_flag.clear()
        self.state.update(active=True, goal=goal, step=0, thought='Looking at the screen…', action='', done='', error='')
        self.log(f'TASK: {goal}')
        self.desk.notify('Jarvis has control', 'Say "stop", press Esc in the HUD, or push the mouse into the top-left corner.')
        self.thread = threading.Thread(target=self._run, args=(goal,), daemon=True)
        self.thread.start()

    def stop(self, why='stopped'):
        if self.state['active']:
            self.stop_flag.set()
            self.state.update(active=False, done=self.state['done'] or why)
            self.log(f'STOP: {why}')

    def failsafe(self):
        x, y = self.desk.mouse()
        return 0 <= x <= 3 and 0 <= y <= 3

    def _run(self, goal):
        history = []
        try:
            for step in range(1, MAX_STEPS + 1):
                if self.stop_flag.is_set():
                    return
                if self.failsafe():
                    return self.stop('Stopped: mouse moved to the top-left corner.')
                self.state['step'] = step
                img, mime = self.desk.screenshot()
                act, model = ask_model(goal, history, img, mime, step)
                self.state['model'] = model
                if self.stop_flag.is_set():
                    return
                self.state.update(thought=str(act.get('thought', ''))[:200], action=str(act.get('action', '')))
                result = self.do(act)
                history.append(f"{act.get('action')} {json.dumps({k: v for k, v in act.items() if k not in ('thought', 'action')})} -> {result}")
                self.log(f'{step}: {act.get("thought", "")} | {history[-1]}')
                if act.get('action') == 'done':
                    self.state.update(active=False, done=str(act.get('summary') or 'Done.'))
                    self.desk.notify('Jarvis: task finished', self.state['done'])
                    return
                time.sleep(0.6)       # let the screen settle
            self.state.update(active=False, done=f'I stopped after {MAX_STEPS} steps without finishing.')
        except Exception as e:     # noqa: BLE001 - report every failure to the HUD
            msg = str(e)
            if isinstance(e, urllib.error.HTTPError):
                msg = f'vision model error {e.code}: {e.read().decode(errors="ignore")[:200]}'
            self.state.update(active=False, error=msg, done='')
            self.log(f'ERROR: {msg}')

    def do(self, a):
        """Run one action. Coordinates arrive as 0-1000 of the screen."""
        d, W, H = self.desk, *self.desk.size()
        px = lambda k: round(max(0, min(1000, float(a.get(k, 500)))) / 1000 * (W - 1))
        py = lambda k: round(max(0, min(1000, float(a.get(k, 500)))) / 1000 * (H - 1))
        name = str(a.get('action', '')).lower()
        if name == 'click': d.click(px('x'), py('y'))
        elif name == 'double_click': d.click(px('x'), py('y'), count=2)
        elif name == 'right_click': d.click(px('x'), py('y'), button=3)
        elif name == 'move': d.move(px('x'), py('y'))
        elif name == 'drag': d.drag(px('x'), py('y'), px('x2'), py('y2'))
        elif name == 'scroll': d.scroll(a.get('direction', 'down'), a.get('amount', 3), *((px('x'), py('y')) if 'x' in a else (None, None)))
        elif name == 'type': d.type(str(a.get('text', '')))
        elif name == 'key': d.key(a.get('keys', 'Return'))
        elif name == 'run': return d.run(str(a.get('command', '')))
        elif name == 'wait': time.sleep(max(0.2, min(10, float(a.get('seconds', 1)))))
        elif name == 'click_here': d._x('click', 1)
        elif name == 'double_click_here': d._x('click', '--repeat', 2, '--delay', 90, 1)
        elif name == 'right_click_here': d._x('click', 3)
        elif name == 'done': return 'finished'
        else: return f'unknown action {name}'
        return 'ok'


CTRL = Controller()


# ---------------------------------------------------------------- tiny HTTP API for the HUD
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _allowed(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        if host not in ('127.0.0.1', 'localhost'):          # blocks DNS-rebinding tricks
            return False
        origin = self.headers.get('Origin')
        return origin is None or origin in HUD_ORIGINS      # only the HUD page (or local tools like curl)

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        origin = self.headers.get('Origin')
        if origin in HUD_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._allowed():
            return self._send(403, {'error': 'forbidden'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin'))
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Jarvis')
        self.end_headers()

    def do_GET(self):
        if not self._allowed():
            return self._send(403, {'error': 'forbidden'})
        if self.path.startswith('/status'):
            return self._send(200, CTRL.status())
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not self._allowed() or self.headers.get('X-Jarvis') != '1':
            return self._send(403, {'error': 'forbidden'})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length') or 0), 100000)) or b'{}')
        except ValueError:
            return self._send(400, {'error': 'bad json'})
        if self.path == '/task':
            goal = str(body.get('goal', '')).strip()[:1000]
            if not goal:
                return self._send(400, {'error': 'no goal'})
            problem = CTRL.desk.problem()
            if problem:
                return self._send(503, {'error': problem})
            CTRL.start(goal)
            return self._send(200, CTRL.status())
        if self.path == '/stop':
            CTRL.stop('Stopped. You have control again.')
            return self._send(200, CTRL.status())
        if self.path == '/do':                 # one direct action, e.g. {"action":"scroll","direction":"down"}
            try:
                return self._send(200, {'result': CTRL.do(body)})
            except Exception as e:     # noqa: BLE001
                return self._send(500, {'error': str(e)})
        self._send(404, {'error': 'not found'})


if __name__ == '__main__':
    load_env()
    p = CTRL.desk.problem()
    print(f'Jarvis laptop control on http://127.0.0.1:{PORT}  model: {pick_model()[1]}' + (f'  WARNING: {p}' if p else ''), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
