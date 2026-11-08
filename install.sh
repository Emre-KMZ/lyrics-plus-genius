#!/bin/bash
# Installs the Lyrics Plus fork, the bridge (started at login by launchd) and prints the Chrome step.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.lyrics-plus-genius.bridge"
APP_DIR="$HOME/.config/spicetify/CustomApps/lyrics-plus"
SUPPORT="$HOME/Library/Application Support/lyrics-plus-genius"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/lyrics-plus-genius-bridge.log"

command -v spicetify >/dev/null || { echo "spicetify not found. Install it first: brew install spicetify-cli"; exit 1; }
NODE="$(command -v node)" || { echo "node not found. Install Node.js 18 or newer."; exit 1; }

echo "1/4 Lyrics Plus fork -> $APP_DIR"
if [ -e "$APP_DIR" ]; then
	BACKUP="$SUPPORT/backups/lyrics-plus-$(date +%Y%m%d-%H%M%S)"
	mkdir -p "$(dirname "$BACKUP")"
	mv "$APP_DIR" "$BACKUP"
	echo "    existing copy moved to $BACKUP"
fi
mkdir -p "$(dirname "$APP_DIR")"
cp -R "$REPO/custom-app/lyrics-plus" "$APP_DIR"

echo "2/4 Bridge -> $SUPPORT/bridge.mjs (starts at login)"
mkdir -p "$SUPPORT" "$(dirname "$PLIST")" "$(dirname "$LOG")"
cp "$REPO/bridge/bridge.mjs" "$SUPPORT/bridge.mjs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NODE</string>
		<string>$SUPPORT/bridge.mjs</string>
	</array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>$LOG</string>
	<key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "3/4 Spicetify"
CONFIG="$(spicetify -c)"
if ! grep -Eq '^custom_apps[[:space:]]*=.*(^|[ =|])lyrics-plus([|[:space:]]|$)' "$CONFIG"; then
	spicetify config custom_apps lyrics-plus
fi
spicetify apply

echo "4/4 Checking the bridge"
for _ in $(seq 1 10); do
	curl -s -m 1 http://127.0.0.1:47123/health >/dev/null && break
	sleep 1
done
curl -s -m 1 http://127.0.0.1:47123/health >/dev/null && echo "    bridge is running" || echo "    bridge did not start; see $LOG"

cat <<EOF

Last step, once, in Chrome:
  1. Open chrome://extensions and turn on "Developer mode" (top right).
  2. Click "Load unpacked" and choose: $REPO/extension
  3. Keep Chrome open while you listen; Genius lyrics come through it.

In Lyrics Plus settings, make sure the Genius provider is on.
After a Spotify update, run: spicetify backup apply
EOF
