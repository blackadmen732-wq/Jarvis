#!/usr/bin/env bash
# Jarvis OS "lite": for a Chromebook or any 4-8 GB RAM computer.
# Starts only the HUD, the router, the Lina checker and the local-model engine. Skips the hub (Open WebUI) and the
# studio voices (Kokoro), which together need ~3 GB of RAM. Jarvis then uses free cloud models (Groq, NVIDIA,
# OpenRouter keys in .env) and the browser's own voices. Open http://localhost:3001/?2d for the lighter 2D HUD.
#
#   ./scripts/lite.sh            start lite
#   ./scripts/lite.sh small      start lite AND download the small 2 GB uncensored model (needs 8 GB RAM)
#   ./scripts/lite.sh stop       stop everything
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Make your settings first:  cp .env.example .env   (then add at least one free key, e.g. GROQ_API_KEY)"; exit 1; }
if [ "${1:-}" = "stop" ]; then docker compose down; exit 0; fi
docker compose up -d --no-deps ollama router lina hud
if [ "${1:-}" = "small" ]; then ./scripts/add-model.sh pull huihui_ai/qwen3.5-abliterated:2b; fi
echo "Jarvis lite is running: http://localhost:3001  (2D version: http://localhost:3001/?2d)"
