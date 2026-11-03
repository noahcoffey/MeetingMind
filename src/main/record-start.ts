import { log } from './logger';

// Starting a recording from outside the Record page — the global hotkey, the
// tray menu, the Stream Deck key. The page has to do the actual starting: the
// staged meeting, title, notebook and both chosen devices all live there, and
// it is what shows the timer and meter and later hands the recording to the
// pipeline. Starting in main directly recorded the default mic only, with no
// system audio or meeting attached, while the window still said "Ready to
// Record".

export interface RecordStartDeps {
  showWindow: () => void;
  sendToRenderer: (channel: string, data?: unknown) => void;
}

let deps: RecordStartDeps | null = null;

export function setRecordStartDeps(d: RecordStartDeps): void {
  deps = d;
}

/** Bring up the Record page with the current meeting staged, then press its Record button. */
export function requestRecordingStart(source: string): void {
  if (!deps) {
    log('warn', 'Recording start requested before the window was ready', { source });
    return;
  }
  log('info', 'Starting recording from the Record page', { source });
  deps.showWindow();
  deps.sendToRenderer('control:navigate-record', { selectNext: true });
  // Let the staged meeting settle before pressing Record: a start that races
  // the staging records an untitled meeting, which is worse than a start that
  // takes half a second.
  setTimeout(() => deps?.sendToRenderer('control:start-recording'), 500);
}
