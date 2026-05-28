import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { log } from './logger';
import { getRecording, getFFmpegPath } from './recording-manager';
import { getSetting } from './store';
import { isWhisperXReady, getVenvPython } from './whisperx-setup';
import { analyzeAudioLevel, isAudioTooQuiet, normalizeAudio, AudioLevel } from './audio-normalizer';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const POLL_INTERVAL = 10000;

// --- API key helpers ---

async function getApiKey(service: string): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', service);
  if (!key) throw new Error(`${service} API key not configured. Go to Settings to add your API key.`);
  return key;
}

// Like getApiKey but returns '' instead of throwing when the key is absent.
// Used for the HuggingFace token, which is optional (no token = single-speaker).
async function getApiKeyOptional(service: string): Promise<string> {
  try {
    const keytar = require('keytar');
    return (await keytar.getPassword('MeetingMind', service)) || '';
  } catch {
    return '';
  }
}

// --- Shared helpers ---

async function retryFetch(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) return response;
      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const delay = RETRY_DELAYS[attempt] || 4000;
      log('warn', `API call failed, retrying in ${delay}ms`, err);
      sendProgress('retrying', `Retrying (${attempt + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('All retries exhausted');
}

function sendProgress(status: string, message: string, progress?: number): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('transcription:progress', { status, message, progress });
  }
}

// Cost rates per hour for each provider
const COST_RATES: Record<string, { perHour: number; label: string }> = {
  'assemblyai': { perHour: 0.17, label: 'AssemblyAI Universal-3-Pro + Speaker Diarization' },
  'openai-whisper': { perHour: 0.36, label: 'OpenAI Whisper ($0.006/min)' },
  'deepgram': { perHour: 0.258, label: 'Deepgram Nova-2 + Diarization' },
  'whisperx-local': { perHour: 0, label: 'WhisperX Local (free)' },
};

// --- Provider: AssemblyAI ---

async function transcribeWithAssemblyAI(audioPath: string, recordingDuration: number): Promise<{ transcript: any; audioDurationSec: number }> {
  const apiKey = await getApiKey('assemblyai');

  sendProgress('uploading', 'Uploading audio to AssemblyAI...');

  const audioData = fs.readFileSync(audioPath);
  const uploadResponse = await retryFetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioData,
  });

  if (!uploadResponse.ok) {
    const errBody = await uploadResponse.text().catch(() => '');
    throw new Error(`AssemblyAI upload failed (HTTP ${uploadResponse.status}): ${errBody || 'Check your API key in Settings'}`);
  }

  const { upload_url } = await uploadResponse.json() as { upload_url: string };
  log('info', 'Audio uploaded to AssemblyAI', { upload_url });

  sendProgress('processing', 'Transcription started, processing...');

  const transcriptResponse = await retryFetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: ['universal-3-pro', 'universal-2'],
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      speech_threshold: 0.2,
    }),
  });

  if (!transcriptResponse.ok) {
    const errBody = await transcriptResponse.text().catch(() => '');
    throw new Error(`AssemblyAI transcription request failed (HTTP ${transcriptResponse.status}): ${errBody || 'Unknown error'}`);
  }

  const { id: transcriptId } = await transcriptResponse.json() as { id: string };
  log('info', 'Transcription created', { transcriptId });

  // Poll for completion
  while (true) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const statusResponse = await retryFetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      method: 'GET',
      headers: { authorization: apiKey },
    });

    const result = await statusResponse.json() as any;

    if (result.status === 'completed') {
      const audioDurationSec = result.audio_duration || recordingDuration;
      return { transcript: result, audioDurationSec };
    } else if (result.status === 'error') {
      throw new Error(`Transcription error: ${result.error}`);
    } else {
      sendProgress('processing', `Processing... (${result.status})`);
    }
  }
}

// --- Provider: OpenAI Whisper ---

async function transcribeWithWhisper(audioPath: string, recordingDuration: number): Promise<{ transcript: any; audioDurationSec: number }> {
  const apiKey = await getApiKey('openai');

  sendProgress('uploading', 'Uploading audio to OpenAI Whisper...');

  // Whisper API accepts file uploads via multipart/form-data
  const audioData = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);

  // Build multipart form data manually for Node fetch
  const boundary = '----MeetingMind' + Date.now();
  const ext = path.extname(audioPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const parts: Buffer[] = [];

  // model field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
  ));

  // response_format field — verbose_json gives timestamps and segments
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
  ));

  // timestamp_granularities field — segment level for seek support
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n`
  ));

  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(audioData);
  parts.push(Buffer.from('\r\n'));

  // end boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  sendProgress('processing', 'Transcribing with OpenAI Whisper...');

  const response = await retryFetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${errText}`);
  }

  const result = await response.json() as any;
  const audioDurationSec = result.duration || recordingDuration;

  // Normalize to our transcript format with utterances
  // Whisper doesn't do speaker diarization — all segments are "Speaker 1"
  const transcript: any = {
    text: result.text,
    audio_duration: audioDurationSec,
    utterances: (result.segments || []).map((seg: any) => ({
      speaker: 'Speaker 1',
      text: seg.text.trim(),
      start: Math.round(seg.start * 1000),
      end: Math.round(seg.end * 1000),
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.9,
    })),
    provider: 'openai-whisper',
  };

  return { transcript, audioDurationSec };
}

// --- Provider: Deepgram ---

async function transcribeWithDeepgram(audioPath: string, recordingDuration: number): Promise<{ transcript: any; audioDurationSec: number }> {
  const apiKey = await getApiKey('deepgram');

  sendProgress('uploading', 'Uploading audio to Deepgram...');

  const audioData = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  sendProgress('processing', 'Transcribing with Deepgram...');

  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
    utterances: 'true',
  });

  const response = await retryFetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: audioData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${errText}`);
  }

  const result = await response.json() as any;
  const audioDurationSec = result.metadata?.duration || recordingDuration;

  // Normalize Deepgram response to our transcript format
  const dgUtterances = result.results?.utterances || [];
  const transcript: any = {
    text: result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
    audio_duration: audioDurationSec,
    utterances: dgUtterances.map((u: any) => ({
      speaker: `Speaker ${u.speaker + 1}`,
      text: u.transcript.trim(),
      start: Math.round(u.start * 1000),
      end: Math.round(u.end * 1000),
      confidence: u.confidence || 0.9,
    })),
    provider: 'deepgram',
  };

  return { transcript, audioDurationSec };
}

// --- Provider: WhisperX Local (on-device) ---

function getWhisperXRunnerScript(): string {
  // Packaged: bundled via extraResources; Dev: from the repo's scripts/ dir.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts', 'transcribe_whisperx.py');
  }
  return path.join(app.getAppPath(), 'scripts', 'transcribe_whisperx.py');
}

async function transcribeWithWhisperX(audioPath: string, recordingDuration: number): Promise<{ transcript: any; audioDurationSec: number }> {
  if (!isWhisperXReady()) {
    throw new Error('WhisperX is not set up. Go to Settings → Recording & Transcription and click "Set Up WhisperX".');
  }

  const venvPython = getVenvPython();
  const runnerScript = getWhisperXRunnerScript();
  const model = getSetting('whisperxModel') || 'large-v3-turbo';
  const language = getSetting('whisperxLanguage') || '';
  const hfToken = await getApiKeyOptional('huggingface');

  const modelCacheDir = path.join(app.getPath('userData'), 'whisperx-models');
  fs.mkdirSync(modelCacheDir, { recursive: true });

  const outputPath = path.join(os.tmpdir(), `whisperx-${Date.now()}.json`);

  const cmdArgs = [
    runnerScript,
    '--audio', audioPath,
    '--model', model,
    '--hf-token', hfToken,
    '--output', outputPath,
    '--model-cache-dir', modelCacheDir,
  ];
  if (language) cmdArgs.push('--language', language);

  sendProgress('processing', 'Starting on-device transcription...', 5);

  // whisperx.load_audio() shells out to `ffmpeg` and only finds it via $PATH.
  // A packaged app's PATH doesn't include the bundled ffmpeg dir — and may not
  // include Homebrew either — so prepend it here.
  const ffmpegDir = path.dirname(getFFmpegPath());
  const childPath = `${ffmpegDir}${path.delimiter}${process.env.PATH || ''}`;

  return new Promise((resolve, reject) => {
    const proc = spawn(venvPython, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PATH: childPath },
    });

    let stdoutBuffer = '';
    let stderrTail = '';
    let errorMessage: string | null = null;

    proc.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      // Process complete NDJSON lines; keep any trailing partial line buffered.
      let nl: number;
      while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') {
            sendProgress('processing', msg.message || 'Transcribing...', msg.progress);
          } else if (msg.type === 'error') {
            errorMessage = msg.message || 'WhisperX error';
          }
          // 'done' is handled on close once the file is flushed.
        } catch {
          // Non-JSON output — ignore (could be library logging on stdout).
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderrTail = (stderrTail + data.toString()).slice(-500);
    });

    proc.on('error', (err) => reject(new Error(`Failed to start WhisperX: ${err.message}`)));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(errorMessage || `WhisperX exited with code ${code}. ${stderrTail}`.trim()));
      }
      if (errorMessage) return reject(new Error(errorMessage));

      try {
        const raw = fs.readFileSync(outputPath, 'utf-8');
        const result = JSON.parse(raw);
        if (!Array.isArray(result.utterances)) {
          throw new Error('WhisperX output missing utterances');
        }
        const audioDurationSec = result.audio_duration || recordingDuration;
        const transcript: any = {
          text: result.text || '',
          audio_duration: audioDurationSec,
          utterances: result.utterances,
          provider: 'whisperx-local',
          model: result.model || model,
        };
        try { fs.unlinkSync(outputPath); } catch {}
        resolve({ transcript, audioDurationSec });
      } catch (err: any) {
        reject(new Error(`Failed to read WhisperX output: ${err.message}`));
      }
    });
  });
}

// --- Main entry point ---

function isLikelyAudioLevelError(err: any): boolean {
  const msg = (err?.message || String(err)).toLowerCase();
  return (
    msg.includes('audio_too_short_or_quiet') ||
    msg.includes('does not contain') ||
    msg.includes('no speech') ||
    msg.includes('detectable speech') ||
    msg.includes('too quiet') ||
    msg.includes('silent') ||
    msg.includes('audio is too')
  );
}

async function runTranscription(provider: string, audioPath: string, recordingDuration: number) {
  switch (provider) {
    case 'openai-whisper':
      return transcribeWithWhisper(audioPath, recordingDuration);
    case 'deepgram':
      return transcribeWithDeepgram(audioPath, recordingDuration);
    case 'whisperx-local':
      return transcribeWithWhisperX(audioPath, recordingDuration);
    case 'assemblyai':
    default:
      return transcribeWithAssemblyAI(audioPath, recordingDuration);
  }
}

export async function startTranscription(
  recordingId: string,
  opts: { forceNormalize?: boolean } = {}
): Promise<{ success: boolean; error?: string; normalized?: boolean }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const originalPath = recording.audioPath;
  if (!fs.existsSync(originalPath)) return { success: false, error: 'Audio file not found' };

  const provider = getSetting('transcriptionProvider') || 'assemblyai';
  const autoNormalize = getSetting('autoNormalizeQuietAudio');
  const method = getSetting('normalizationMethod') || 'loudnorm';

  let audioPath = originalPath;
  let didNormalize = false;
  let level: AudioLevel | null = null;

  try {
    updateRecordingStatus(recordingId, 'transcribing');

    // --- Pre-flight: analyze audio level ---
    try {
      sendProgress('analyzing', 'Analyzing audio level...');
      level = await analyzeAudioLevel(originalPath);
      log('info', 'Audio level analyzed', { recordingId, ...level });
      saveAudioLevelToManifest(recordingId, level);
    } catch (err: any) {
      log('warn', 'Audio level analysis failed; proceeding without it', { error: err.message });
    }

    const shouldNormalize = opts.forceNormalize || (autoNormalize && level && isAudioTooQuiet(level));
    if (shouldNormalize) {
      sendProgress('normalizing', `Audio is quiet — normalizing (${method})...`);
      try {
        const result = await normalizeAudio(originalPath, method, level || undefined);
        audioPath = result.outputPath;
        didNormalize = true;
        log('info', 'Audio normalized for transcription', {
          recordingId,
          method: result.method,
          before: result.beforeLevel,
          after: result.afterLevel,
          appliedGainDb: result.appliedGainDb,
        });
        saveNormalizationToManifest(recordingId, result);
      } catch (err: any) {
        log('warn', 'Normalization failed; falling back to original audio', { error: err.message });
        sendProgress('processing', 'Normalization failed; trying original audio...');
      }
    }

    let result: { transcript: any; audioDurationSec: number };
    try {
      result = await runTranscription(provider, audioPath, recording.duration || 0);
    } catch (err: any) {
      // Auto-retry once with normalization if the failure looks audio-level related
      // and we haven't already normalized.
      if (!didNormalize && autoNormalize && isLikelyAudioLevelError(err)) {
        log('warn', 'Transcription failed with likely audio-level error; normalizing and retrying', { error: err.message });
        sendProgress('normalizing', `Audio rejected — normalizing (${method}) and retrying...`);
        const normResult = await normalizeAudio(originalPath, method, level || undefined);
        audioPath = normResult.outputPath;
        didNormalize = true;
        saveNormalizationToManifest(recordingId, normResult);
        result = await runTranscription(provider, audioPath, recording.duration || 0);
      } else {
        throw err;
      }
    }

    // Save transcript
    const outputDir = path.dirname(recording.audioPath);
    fs.writeFileSync(
      path.join(outputDir, 'transcript.json'),
      JSON.stringify(result.transcript, null, 2)
    );

    // Save transcription cost estimate
    const rate = COST_RATES[provider] || COST_RATES['assemblyai'];
    const audioDurationHours = result.audioDurationSec / 3600;
    const estimatedCost = audioDurationHours * rate.perHour;
    saveTranscriptionCost(recordingId, {
      provider,
      audioDurationSeconds: result.audioDurationSec,
      audioDurationHours,
      costPerHour: rate.perHour,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      timestamp: new Date().toISOString(),
    });

    updateRecordingStatus(recordingId, 'transcribed');
    sendProgress('complete', didNormalize ? 'Transcription complete (audio was normalized)!' : 'Transcription complete!');
    log('info', 'Transcription completed', { recordingId, provider, normalized: didNormalize, estimatedCost: `$${estimatedCost.toFixed(4)}` });

    return { success: true, normalized: didNormalize };
  } catch (err: any) {
    log('error', 'Transcription failed', err);
    updateRecordingStatus(recordingId, 'recorded');
    const providerLabel = { 'assemblyai': 'AssemblyAI', 'openai-whisper': 'OpenAI Whisper', 'deepgram': 'Deepgram', 'whisperx-local': 'WhisperX Local' }[provider] || provider;
    let errorMsg = `[${providerLabel}] ${err.message}`;
    if (isLikelyAudioLevelError(err) && !didNormalize) {
      errorMsg += ' — Try "Normalize and retry" to boost the audio level.';
    }
    saveTranscriptionError(recordingId, { message: err.message, likelyAudioLevel: isLikelyAudioLevelError(err) });
    sendProgress('error', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// --- Helpers ---

function saveTranscriptionCost(recordingId: string, cost: {
  provider: string;
  audioDurationSeconds: number;
  audioDurationHours: number;
  costPerHour: number;
  estimatedCost: number;
  timestamp: string;
}): void {
  const outputDir = getSetting('recordingOutputFolder') || path.join(require('os').homedir(), 'Documents', 'MeetingMind', 'recordings');
  const manifestPath = path.join(outputDir, recordingId, 'manifest.json');

  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.transcriptionCost = cost;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (err: any) {
      log('warn', 'Failed to save transcription cost', { recordingId, error: err.message });
    }
  }
}

function updateManifest(recordingId: string, mutate: (manifest: any) => void): void {
  const outputDir = getSetting('recordingOutputFolder') || path.join(require('os').homedir(), 'Documents', 'MeetingMind', 'recordings');
  const manifestPath = path.join(outputDir, recordingId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    mutate(manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err: any) {
    log('warn', 'Failed to update manifest', { recordingId, error: err.message });
  }
}

function saveAudioLevelToManifest(recordingId: string, level: AudioLevel): void {
  updateManifest(recordingId, (m) => { m.audioLevel = { ...level, analyzedAt: new Date().toISOString() }; });
}

function saveNormalizationToManifest(recordingId: string, result: { method: string; appliedGainDb?: number; outputPath: string; beforeLevel: AudioLevel; afterLevel: AudioLevel }): void {
  updateManifest(recordingId, (m) => {
    m.audioNormalization = {
      method: result.method,
      appliedGainDb: result.appliedGainDb,
      outputPath: result.outputPath,
      beforeLevel: result.beforeLevel,
      afterLevel: result.afterLevel,
      normalizedAt: new Date().toISOString(),
    };
  });
}

function saveTranscriptionError(recordingId: string, error: { message: string; likelyAudioLevel: boolean }): void {
  updateManifest(recordingId, (m) => { m.lastTranscriptionError = { ...error, timestamp: new Date().toISOString() }; });
}

function updateRecordingStatus(recordingId: string, status: string): void {
  const outputDir = getSetting('recordingOutputFolder') || require('path').join(require('os').homedir(), 'Documents', 'MeetingMind', 'recordings');
  const manifestPath = path.join(outputDir, recordingId, 'manifest.json');

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.status = status;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}

export function getTranscriptionStatus(recordingId: string): { status: string; progress?: number } {
  const recording = getRecording(recordingId);
  if (!recording) return { status: 'unknown' };
  return { status: recording.status };
}
