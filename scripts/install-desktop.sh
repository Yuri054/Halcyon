#!/usr/bin/env bash
# Adds Halcyon to your application menu (per-user, no root needed).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
# Point at the Electron binary itself: the npm wrapper needs `node` on PATH,
# which a desktop session does not have when Node comes from nvm.
BIN="$DIR/node_modules/electron/dist/electron"
if [ ! -x "$BIN" ]; then
  echo "Electron is not installed yet. Run 'npm install' in $DIR first." >&2
  exit 1
fi
mkdir -p "$APPS"
cat > "$APPS/halcyon.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Halcyon
Comment=Console-style game launcher
Exec="$BIN" "$DIR"
Path=$DIR
Icon=input-gaming
Terminal=false
Categories=Game;
StartupWMClass=Halcyon
DESKTOP
echo "Installed $APPS/halcyon.desktop"
