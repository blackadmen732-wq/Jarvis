#!/usr/bin/env bash
# Install Jarvis laptop control on this Linux laptop (run it ON the laptop, not in Docker).
# - installs xdotool (mouse + keyboard), scrot (screenshots), ImageMagick (shrinks screenshots), notify-send
# - starts the helper now and on every login (autostart entry)
# Usage: control/install.sh          install + start
#        control/install.sh remove   stop + remove autostart
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AUTOSTART="$HOME/.config/autostart/jarvis-control.desktop"

if [ "${1:-}" = "remove" ]; then
  pkill -f "$HERE/jarvis_control.py" || true
  rm -f "$AUTOSTART"
  echo "Jarvis laptop control removed."
  exit 0
fi

echo "== Installing tools (asks for your password once) =="
if command -v apt-get >/dev/null; then sudo apt-get install -y xdotool scrot imagemagick libnotify-bin python3
elif command -v dnf >/dev/null; then sudo dnf install -y xdotool scrot ImageMagick libnotify python3
elif command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm xdotool scrot imagemagick libnotify python
else echo "Install xdotool, scrot and imagemagick with your package manager, then run this again."; exit 1; fi

if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  echo
  echo "!! You are on a Wayland session. Wayland blocks apps from moving the mouse and taking screenshots."
  echo "!! For full control: log out, click the gear icon on the login screen, choose 'Ubuntu on Xorg' (or 'GNOME on Xorg'), log in."
  echo
fi

mkdir -p "$(dirname "$AUTOSTART")"
cat > "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Jarvis laptop control
Comment=Lets Jarvis see the screen and use the mouse and keyboard (stop: Esc in the HUD, say stop, or mouse to top-left corner)
Exec=python3 $HERE/jarvis_control.py
X-GNOME-Autostart-enabled=true
NoDisplay=false
EOF

pkill -f "$HERE/jarvis_control.py" || true
mkdir -p "$HOME/.local/state"
nohup python3 "$HERE/jarvis_control.py" >"$HOME/.local/state/jarvis-control.out" 2>&1 &
sleep 1
if curl -s http://127.0.0.1:3002/status >/dev/null; then
  echo "Jarvis laptop control is running on 127.0.0.1:3002 and will start at every login."
  echo "In the HUD say: \"Jarvis, take control of my laptop\"."
else
  echo "It did not start. See $HOME/.local/state/jarvis-control.out"
fi
