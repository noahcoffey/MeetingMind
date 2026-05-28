#!/usr/bin/env bash
#
# download-ffmpeg.sh — fetch a self-contained static ffmpeg for bundling.
#
# The app bundles ffmpeg (see mac.extraResources) so a packaged build works on
# machines without Homebrew. We use the static macOS builds from
# https://ffmpeg.martin-riedl.de/ — they link only system libraries, so the app
# is portable (unlike a copied Homebrew ffmpeg, which drags in /opt/homebrew dylibs).
#
# Usage:
#   scripts/download-ffmpeg.sh          # host arch into bin/ffmpeg
#   scripts/download-ffmpeg.sh arm64    # force arch (arm64|amd64)
#
# bin/ffmpeg is gitignored. Run before packaging (build:app / package:dmg do this).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${REPO_ROOT}/bin"
DEST="${BIN_DIR}/ffmpeg"

main() {
  local arch="${1:-}"
  if [ -z "$arch" ]; then
    case "$(uname -m)" in
      arm64) arch="arm64" ;;
      x86_64) arch="amd64" ;;
      *) echo "Unsupported host arch: $(uname -m)" >&2; exit 1 ;;
    esac
  fi

  if [ -x "$DEST" ]; then
    echo "✓ bin/ffmpeg already present"
    exit 0
  fi

  mkdir -p "$BIN_DIR"
  local url="https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/ffmpeg.zip"
  local tmp
  tmp="$(mktemp -d)"

  echo "↓ Downloading static ffmpeg (${arch})"
  curl -fL --retry 3 -o "${tmp}/ffmpeg.zip" "$url"
  unzip -o "${tmp}/ffmpeg.zip" -d "$tmp" >/dev/null
  mv "${tmp}/ffmpeg" "$DEST"
  chmod +x "$DEST"
  rm -rf "$tmp"

  "$DEST" -version | head -1
  echo "✓ bin/ffmpeg ready"
}

main "$@"
