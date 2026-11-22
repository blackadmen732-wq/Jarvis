#!/usr/bin/env bash
# Add a model to Jarvis OS. It appears in the hub's model dropdown right away.
#
#   Download a known model:        ./scripts/add-model.sh pull llama3.2
#   Download from Hugging Face:    ./scripts/add-model.sh pull hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF
#   Use your own .gguf file:       put it in ./models, then
#                                  ./scripts/add-model.sh import my-model my-file.gguf
#   Uncensored (abliterated):      ./scripts/add-model.sh uncensored [small|medium|large]
#   Recommended uncensored set:    ./scripts/add-model.sh pack essential   (or: big, all)
#   See what's installed:          ./scripts/add-model.sh list
#   Remove a model:                ./scripts/add-model.sh remove my-model
set -euo pipefail

C="${OLLAMA_CONTAINER:-jarvis-ollama}"
cmd="${1:-}"
TTY=$([ -t 0 ] && echo -it || echo -i)   # interactive progress bar only in a real terminal
cd "$(dirname "$0")/.."   # run from the project folder so ./models is found

case "$cmd" in
  pull)
    [ -n "${2:-}" ] || { echo "Usage: $0 pull <model-name>"; exit 1; }
    docker exec $TTY "$C" ollama pull "$2"
    ;;
  import)
    name="${2:-}"; file="${3:-}"
    [ -n "$name" ] && [ -n "$file" ] || { echo "Usage: $0 import <new-name> <file.gguf in ./models>"; exit 1; }
    [ -f "models/$file" ] || { echo "Not found: models/$file"; exit 1; }
    docker exec "$C" sh -c "printf 'FROM /models/%s\n' '$file' > /tmp/Modelfile && ollama create '$name' -f /tmp/Modelfile"
    echo "Done. Pick \"$name\" in the model dropdown."
    ;;
  uncensored)
    # "Abliterated" = open model with its refusal behaviour removed.
    case "${2:-medium}" in
      small)  tag="huihui_ai/qwen3.5-abliterated:2b"  ;;  # ~2 GB, any laptop
      medium) tag="huihui_ai/qwen3.5-abliterated:9b"  ;;  # ~7 GB, needs 16 GB RAM
      large)  tag="huihui_ai/qwen3.5-abliterated:27b" ;;  # ~17 GB, needs a big GPU or 32 GB+ RAM
      *) echo "Usage: $0 uncensored [small|medium|large]"; exit 1 ;;
    esac
    docker exec $TTY "$C" ollama pull "$tag"
    echo "Done. Pick \"$tag\" in the model dropdown."
    ;;
  pack)
    # Recommended uncensored set. Only one model is loaded into memory at a time.
    #   essential (~24 GB disk, 16 GB RAM laptop)  |  big (~28 GB more, needs 32 GB+ RAM)
    essential="huihui_ai/qwen2.5-abliterate:7b huihui_ai/qwen3.5-abliterated:9b huihui_ai/qwen2.5-coder-abliterate:7b huihui_ai/qwen3-vl-abliterated:8b huihui_ai/qwen3.5-abliterated:2b nomic-embed-text"
    big="huihui_ai/qwen3-coder-abliterated:30b huihui_ai/qwen2.5-abliterate:14b"
    case "${2:-essential}" in
      essential) list="$essential" ;;
      big)       list="$big" ;;
      all)       list="$essential $big" ;;
      *) echo "Usage: $0 pack [essential|big|all]"; exit 1 ;;
    esac
    for m in $list; do echo "==> $m"; docker exec $TTY "$C" ollama pull "$m"; done
    echo "Done. They appear in the HUD's Neural Links panel and the hub's model dropdown."
    ;;
  list)
    docker exec "$C" ollama list
    ;;
  remove)
    [ -n "${2:-}" ] || { echo "Usage: $0 remove <model-name>"; exit 1; }
    docker exec "$C" ollama rm "$2"
    ;;
  *)
    sed -n '2,13p' "$0"; exit 1
    ;;
esac
