#!/usr/bin/env bash
# What the Jarvis app icon runs (installed by scripts/install-app.sh). No terminal needed:
#   1. starts Jarvis's background parts (Docker) if they aren't running yet
#   2. starts Jarvis Hands (terminal + agents) if it isn't running yet
#   3. waits until the HUD answers, then opens it, already paired with Hands
# Everything it does is logged in ~/.jarvis-hands/launch.log.
cd "$(dirname "$0")/.." || exit 1
mkdir -p "$HOME/.jarvis-hands"
LOG="$HOME/.jarvis-hands/launch.log"
exec >>"$LOG" 2>&1
echo "=== $(date) opening Jarvis"

notify() { command -v notify-send >/dev/null && notify-send "Jarvis" "$1"; echo "$1"; }

# automatic update from GitHub: follows main only (finished work, never half-done branches)
if git fetch -q origin main 2>/dev/null; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ] && git merge-base --is-ancestor HEAD origin/main && [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    git checkout -q main 2>/dev/null || git checkout -q -b main origin/main   # this branch was merged: move to main
    BRANCH=main; SWITCHED=1
  fi
  if [ -n "${SWITCHED:-}" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    notify "Updating Jarvis... this can take a minute."
    docker compose up -d --build && pkill -f "hands/hands.js"
  elif [ "$BRANCH" = "main" ] && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    if git merge-base --is-ancestor HEAD origin/main && [ -z "$(git status --porcelain --untracked-files=no)" ]; then
      notify "Updating Jarvis... this can take a minute."
      git pull -q --ff-only origin main && docker compose up -d --build && pkill -f "hands/hands.js"   # Hands restarts below
    else
      echo "Not updating: you have your own changes here. Your files are left as they are."
    fi
  fi
else
  echo "No internet or GitHub unreachable: starting the version that's already here."
fi

if ! curl -fs -o /dev/null http://localhost:3001/; then
  notify "Starting Jarvis... the first start can take a minute."
  docker compose up -d || notify "Jarvis couldn't start Docker. See ~/.jarvis-hands/launch.log"
fi

if ! pgrep -f "hands/hands.js" >/dev/null; then
  nohup node hands/hands.js >>"$HOME/.jarvis-hands/hands.log" 2>&1 &
fi

for i in $(seq 1 90); do curl -fs -o /dev/null http://localhost:3001/ && break; sleep 1; done
for i in $(seq 1 10); do [ -s "$HOME/.jarvis-hands/token" ] && break; sleep 0.5; done

URL="http://localhost:3001/"
[ -s "$HOME/.jarvis-hands/token" ] && URL="${URL}#hands=$(cat "$HOME/.jarvis-hands/token")"
xdg-open "$URL" 2>/dev/null || sensible-browser "$URL" 2>/dev/null || echo "open $URL in your browser"
