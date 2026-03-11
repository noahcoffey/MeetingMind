#!/bin/bash
# Patches the local Electron.app for development:
# - Renames Electron.app to MeetingMind.app so dock shows correct name
# - Sets bundle display name and identifier
# - Replaces default icon with custom app icon
#
# This runs automatically via postinstall after npm install.

DIST_DIR="node_modules/electron/dist"
ELECTRON_APP="$DIST_DIR/Electron.app"
MEETING_APP="$DIST_DIR/MeetingMind.app"
ICON_SRC="build/icon.icns"

# Rename the .app bundle if not already renamed
if [ -d "$ELECTRON_APP" ]; then
  mv "$ELECTRON_APP" "$MEETING_APP"
  # Update the path reference so the electron npm package can find the binary
  echo -n "MeetingMind.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
fi

PLIST="$MEETING_APP/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  echo "Electron app bundle not found, skipping dev patch"
  exit 0
fi

# Patch bundle metadata
plutil -replace CFBundleDisplayName -string "MeetingMind" "$PLIST" 2>/dev/null
plutil -replace CFBundleName -string "MeetingMind" "$PLIST" 2>/dev/null
plutil -replace CFBundleIdentifier -string "com.meetingmind.app" "$PLIST" 2>/dev/null

# Patch icon
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$MEETING_APP/Contents/Resources/electron.icns"
fi

echo "Patched Electron for dev (MeetingMind.app, custom icon)"
