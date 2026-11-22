#!/usr/bin/env bash
# Copy the newest Lina Sigra engine from your Edge Bot checkout into Jarvis, then rebuild the checker.
#   ./scripts/update-lina.sh ../-edge-bot.
set -euo pipefail
src="${1:?Usage: $0 <path to your edge-bot folder>}/backtest/lina"
cd "$(dirname "$0")/.."
for f in lang.py lina_sigra.py lina_eldoria_lexicon.json train.py; do cp "$src/$f" lina/engine/; done
grep -m1 '^VERSION' lina/engine/lang.py
docker compose up -d --build lina
