# MeetingMind

A macOS desktop app for recording meetings, transcribing with AssemblyAI, and generating structured notes with Claude AI.

![MeetingMind Recordings View](docs/screenshot.png)

## Features

- **Audio Recording** — Chunked recording via ffmpeg with pause/resume, cancel & discard, and disk space monitoring
- **System Audio Capture** — Record both microphone and system audio using virtual audio devices (BlackHole, Loopback)
- **AI Transcription** — Upload and transcribe recordings with AssemblyAI (speaker diarization included)
- **AI Meeting Notes** — Generate structured notes via Claude Code CLI (subscription) or Anthropic API (pay-per-call)
- **Transcript Viewer** — Speaker-colored segments with click-to-seek audio sync and inline speaker renaming
- **Full-Text Search** — Search across titles, tags, notes, and transcripts with ranked results
- **Tags & AI Categorization** — Manual tagging plus automatic AI-suggested tags after notes generation
- **Export Options** — Copy to clipboard, export as PDF, or email notes to meeting attendees
- **Meeting Analytics** — Dashboard with weekly trends, per-day stats, top tags, and AI-generated trend insights
- **Calendar Integration** — Google Calendar, Microsoft 365, and ICS feed support for meeting context
- **Obsidian Integration** — Save notes directly to your Obsidian vault
- **Global Hotkeys** — Start/stop recording from anywhere with customizable keyboard shortcuts
- **Menu Bar Tray** — Quick access controls without switching windows
- **Crash Recovery** — Automatic manifest checkpointing and disk space monitoring

## Tech Stack

- **Electron** + **React** + **TypeScript**
- **ffmpeg** (avfoundation) for audio capture and processing
- **AssemblyAI** for transcription
- **Claude AI** for notes generation and auto-tagging
- **electron-store** for settings persistence
- **keytar** for secure API key storage in macOS Keychain

## Getting Started

### Prerequisites

- Node.js 18+
- ffmpeg installed (`brew install ffmpeg`)
- An [AssemblyAI API key](https://assemblyai.com)
- Either [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (recommended) or an [Anthropic API key](https://console.anthropic.com)

### Install & Run

```bash
git clone https://github.com/noahcoffey/MeetingMind.git
cd MeetingMind
npm install
npm start
```

The app will guide you through setup on first launch.

### Development

```bash
# Build main process + renderer
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch

# Package as .dmg
npm run package:dmg
```

## Project Structure

```
src/
├── main/                    # Electron main process
│   ├── main.ts              # App entry, window, tray, protocol handler
│   ├── ipc.ts               # IPC handler registration
│   ├── preload.ts           # Context bridge API
│   ├── recording-manager.ts # Chunked audio recording via ffmpeg
│   ├── transcription.ts     # AssemblyAI upload & polling
│   ├── notes-generator.ts   # Claude CLI/API notes generation
│   ├── search.ts            # Full-text search engine
│   ├── analytics.ts         # Meeting statistics & trend analysis
│   ├── tagger.ts            # AI auto-tagging & manual tags
│   ├── export.ts            # Clipboard, PDF, email export
│   ├── calendar.ts          # Google, Microsoft, ICS calendar
│   ├── system-audio.ts      # Virtual audio device detection
│   ├── tray.ts              # Menu bar tray & context menu
│   ├── store.ts             # Settings persistence
│   └── logger.ts            # File logging
└── renderer/                # React frontend
    ├── App.tsx              # Root layout with sidebar navigation
    ├── pages/
    │   ├── RecordPage.tsx       # Recording UI with device picker
    │   ├── RecordingsPage.tsx   # Library list + detail panel
    │   ├── AnalyticsPage.tsx    # Stats dashboard
    │   └── SettingsPage.tsx     # Configuration
    ├── components/
    │   ├── AudioPlayer.tsx      # Playback controls
    │   ├── TranscriptViewer.tsx # Speaker-colored transcript
    │   ├── SearchBar.tsx        # Debounced search with results
    │   ├── TagEditor.tsx        # Tag pills with autocomplete
    │   ├── ExportMenu.tsx       # Export action dropdown
    │   └── Sidebar.tsx          # Navigation sidebar
    └── hooks/
        └── useAudioPlayer.ts   # Shared audio playback hook
```

## Notes Provider

MeetingMind supports two modes for AI features (notes generation, auto-tagging, trend insights):

- **CLI Mode** (default) — Uses your Claude Code CLI subscription. No per-call costs.
- **API Mode** — Uses the Anthropic API with your own API key. Pay-per-token.

Switch between modes in Settings.

## License

MIT
