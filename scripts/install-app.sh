#!/usr/bin/env bash
# Run ONCE. Puts a "Jarvis" app in your app launcher (on a Chromebook: the Linux apps folder; pin it to the shelf).
# After that you never need the terminal: click Jarvis, and it starts everything and opens.
#   ./scripts/install-app.sh            add the Jarvis app
#   ./scripts/install-app.sh remove     take it away again
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$HOME/.local/share/applications"
FILE="$APPS/jarvis-os.desktop"
if [ "${1:-}" = "remove" ]; then rm -f "$FILE"; echo "Jarvis app removed (Jarvis itself is still installed)."; exit 0; fi
chmod +x "$DIR/scripts/jarvis-launch.sh"
mkdir -p "$APPS"
cat > "$FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Jarvis
Comment=Jarvis and Sophia, your voice assistants
Exec=$DIR/scripts/jarvis-launch.sh
Icon=$DIR/hud/public/assets/icon-512.png
Terminal=false
Categories=Utility;
StartupNotify=false
DESKTOP
chmod +x "$FILE"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Done. Open your app launcher, find Jarvis (on a Chromebook: in the Linux apps folder), and right-click it -> Pin to shelf."
