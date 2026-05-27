#!/usr/bin/env bash
#
# download-python.sh — fetch a hermetic CPython interpreter for bundling.
#
# WhisperX is a Python library; to run it without requiring the user to install
# Python we bundle a python-build-standalone CPython 3.11 inside the app (one per
# Mac arch), exactly the way ffmpeg is bundled. This script downloads the correct
# `install_only` tarball and unpacks it into bin/python-macos-<arch>/.
#
# Usage:
#   scripts/download-python.sh            # download for the host arch
#   scripts/download-python.sh arm64      # force a specific arch (arm64|x64)
#   scripts/download-python.sh all        # download both arches (for universal builds)
#
# The bin/python-macos-* directories are gitignored. Run this before packaging
# (e.g. before `npm run package:dmg`).

set -euo pipefail

# Pinned python-build-standalone release. Update RELEASE_TAG / PY_VERSION together.
RELEASE_TAG="20250409"
PY_VERSION="3.11.12"
BASE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${REPO_ROOT}/bin"

download_arch() {
  local arch="$1"          # arm64 | x64
  local triple
  case "$arch" in
    arm64) triple="aarch64-apple-darwin" ;;
    x64)   triple="x86_64-apple-darwin" ;;
    *) echo "Unknown arch: $arch (expected arm64 or x64)" >&2; return 1 ;;
  esac

  local dest="${BIN_DIR}/python-macos-${arch}"
  local tarball="cpython-${PY_VERSION}+${RELEASE_TAG}-${triple}-install_only.tar.gz"
  local url="${BASE_URL}/${tarball}"

  if [ -x "${dest}/bin/python3" ]; then
    echo "✓ python-macos-${arch} already present (${dest}/bin/python3)"
    return 0
  fi

  echo "↓ Downloading ${tarball}"
  local tmp
  tmp="$(mktemp -d)"
  curl -fL --retry 3 -o "${tmp}/python.tar.gz" "${url}"

  echo "→ Extracting to ${dest}"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  # The archive contains a top-level "python/" directory; strip it.
  tar -xzf "${tmp}/python.tar.gz" -C "${dest}" --strip-components=1
  rm -rf "${tmp}"

  # Sanity check
  "${dest}/bin/python3" --version
  echo "✓ python-macos-${arch} ready"
}

main() {
  local target="${1:-}"
  if [ -z "$target" ]; then
    case "$(uname -m)" in
      arm64) target="arm64" ;;
      x86_64) target="x64" ;;
      *) echo "Unsupported host arch: $(uname -m)" >&2; exit 1 ;;
    esac
  fi

  mkdir -p "${BIN_DIR}"

  if [ "$target" = "all" ]; then
    download_arch arm64
    download_arch x64
  else
    download_arch "$target"
  fi
}

main "$@"
