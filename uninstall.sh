#!/bin/bash
# Removes the bridge and the Lyrics Plus fork; Spicetify falls back to its bundled Lyrics Plus.
set -euo pipefail

LABEL="com.lyrics-plus-genius.bridge"
APP_DIR="$HOME/.config/spicetify/CustomApps/lyrics-plus"
SUPPORT="$HOME/Library/Application Support/lyrics-plus-genius"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST" "$SUPPORT/bridge.mjs"
echo "Bridge stopped and removed."

if [ -e "$APP_DIR" ]; then
	BACKUP="$SUPPORT/backups/lyrics-plus-uninstalled-$(date +%Y%m%d-%H%M%S)"
	mkdir -p "$(dirname "$BACKUP")"
	mv "$APP_DIR" "$BACKUP"
	echo "Lyrics Plus fork moved to $BACKUP"
fi

command -v spicetify >/dev/null && spicetify apply
echo "Done. Remove the \"Genius Bridge for Lyrics Plus\" extension from chrome://extensions yourself."
