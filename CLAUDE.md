# CLAUDE.md

Guidance for working in this repo.

## Overview

MeetingMind is a macOS Electron + React + TypeScript app: record meetings, transcribe (AssemblyAI / OpenAI Whisper / Deepgram / WhisperX Local), and generate notes with Claude.

- **Main process**: `src/main/` — compiled with `tsconfig.main.json` to `dist/main/`
- **Renderer**: `src/renderer/` — bundled with webpack to `dist/renderer/`
- **Preload**: `src/main/preload.ts` — exposes `window.meetingMind` via contextBridge. The renderer-side type is hand-maintained in `src/renderer/types.d.ts` (`MeetingMindAPI`) — update it when adding preload methods, or the renderer build fails.

## Commands

```bash
npm run build        # build:main + build:renderer
npm run build:main   # tsc -p tsconfig.main.json
npm run build:renderer
npm start            # build main + launch electron
npm test             # jest
```

API keys live in the macOS Keychain via keytar (service `MeetingMind`), not in electron-store.

## Bundled Python interpreter (WhisperX Local)

WhisperX Local runs transcription/diarization on-device through Python. To avoid requiring users to install Python, a hermetic [python-build-standalone](https://github.com/astral-sh/python-build-standalone) CPython 3.11 is bundled inside the app — the same pattern as the bundled `ffmpeg`.

**Key files**
- `src/main/whisperx.ts` — `getPythonPath()` resolves the interpreter. Packaged: `process.resourcesPath/bin/python-macos-<arch>/bin/python3`. Dev: `bin/python-macos-<arch>/bin/python3` if present, else system `python3`. Arch dir is chosen via `process.arch` (`arm64` vs `x64`).
- `scripts/download-python.sh` — downloads the interpreter into `bin/python-macos-<arch>/` (gitignored). **Must be run before packaging** (`bash scripts/download-python.sh all`).
- `scripts/transcribe_whisperx.py` — the runner Node spawns: transcribe → align → optional pyannote diarization → normalized JSON. Emits newline-delimited JSON progress on stdout.
- `src/main/whisperx-setup.ts` — first-run setup: creates a venv at `~/Library/Application Support/MeetingMind/whisperx-env/` and pip-installs whisperx/torch/pyannote (too large to bundle in the installer). Survives app updates. Self-heals a stale venv by comparing its Python version to the bundled interpreter's.
- `src/main/transcription.ts` — `transcribeWithWhisperX()` spawns the runner with the venv Python and `PYTHONUNBUFFERED=1`.

**`package.json` / build**
- `mac.extraResources` bundles `bin/python-macos-arm64`, `bin/python-macos-x64`, and `scripts/transcribe_whisperx.py`.
- `build/entitlements.mac.plist` needs `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory` for PyTorch.

**Diarization gotchas (hard-won)**
- pyannote.audio 4.x renamed the auth kwarg `use_auth_token` → `token`. Passing the wrong one throws and silently falls back to single-speaker.
- whisperx 3.8.x / pyannote 4.x load `pyannote/speaker-diarization-community-1` (the old `speaker-diarization-3.1` / `segmentation-3.0` names are superseded). The user must accept the **community-1** license on HuggingFace with the account their token belongs to.
- Diarization is gated behind a HuggingFace token stored in keytar under service name `huggingface`; empty token = single speaker (graceful fallback, no crash).

**Hardware acceleration (per pipeline stage)**
- **Transcription** runs through CTranslate2, which only supports CPU and CUDA — *no Apple MPS*. On Apple Silicon it uses CPU + `int8`, but `pick_device_and_compute_type()` returns CUDA float16 when an NVIDIA GPU is present. `cpu_threads()` passes `os.cpu_count()` as `load_model(threads=...)`; WhisperX otherwise defaults to only 4 threads.
- **Alignment** and **diarization** are plain PyTorch, so they *can* use Apple's GPU. `pick_torch_device()` returns `"mps"` on Apple Silicon (else the transcription device). Both stages try MPS first and retry on CPU if a Metal op is unsupported — alignment then keeps unaligned segments as a last resort, diarization falls back to single-speaker.
