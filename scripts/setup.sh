#!/usr/bin/env bash
# One command does everything (Mark: "I don't want to do all of that"):
#   bash scripts/setup.sh
# 1. updates Jarvis to the newest version from GitHub (main)
# 2. installs Node.js if it's missing (Jarvis Hands needs it to use your computer)
# 3. rebuilds and starts Jarvis
# 4. adds the Jarvis app icon (Linux apps folder)
# 5. starts Jarvis Hands and opens Jarvis, already connected to your computer
# Safe to run again any time. Your .env (keys) is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
say() { printf '\n\033[1;33m>> %s\033[0m\n' "$1"; }

say "1/5 Getting the newest Jarvis from GitHub"
git fetch -q origin main
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "You changed some Jarvis files here, so I'm not updating them. (Your keys in .env are separate and safe.)"
else
  git checkout -q -B main origin/main
fi

say "2/5 Checking Node.js (Jarvis Hands needs version 18 or newer)"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || true)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Installing Node.js (it may ask for your password)..."
  sudo apt-get update -q && sudo apt-get install -y -q nodejs
fi
node -v

say "3/5 Building and starting Jarvis (the first time takes a few minutes)"
[ -f .env ] || cp .env.example .env
docker compose up -d --build

say "4/5 Adding the Jarvis app icon"
bash scripts/install-app.sh

say "5/5 Starting Jarvis Hands and opening Jarvis"
pkill -f "hands/hands.js" 2>/dev/null || true          # restart Hands so it runs the new version
bash scripts/jarvis-launch.sh &
sleep 2
echo
echo "Done. Jarvis opens in Chrome in a moment."
echo "Next: press KEYS in Jarvis and paste your keys (OpenRouter, Groq, Gemini, NVIDIA, ElevenLabs)."
echo "From now on, just click the Jarvis icon in your Linux apps folder."
