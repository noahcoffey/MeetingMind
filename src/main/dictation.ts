import { log } from './logger';
import { getSetting } from './store';

// AssemblyAI Dictation API (experiment).
//
// Unlike the batch transcription pipeline this is request/response: one clip
// (raw 16-bit PCM or WAV, at most 120 s) goes up in a multipart POST and a
// cleaned-up rewrite comes back, typically in under a second. "Live" dictation
// is therefore built on the renderer side by cutting the microphone into
// utterances on silence and sending each one here as soon as it ends.
//
// Docs: https://www.assemblyai.com/docs/dictation

const DICTATION_URL = 'https://dictation.assemblyai.com/v1/transcribe/live';
const MAX_KEYTERMS = 100;

export interface DictationOptions {
  sampleRate: number;
  channels: number;
  // Free-text context for the recognizer ("dictated notes for a software project").
  sttPrompt?: string;
  // Extra terms to bias spelling toward, merged with the custom vocabulary from Settings.
  keyterms?: string[];
  // Replaces the default cleanup (drop fillers, resolve self-corrections, punctuate).
  llmInstruction?: string;
  languageCodes?: string[];
}

export interface DictationResult {
  // Verbatim transcript, always present.
  text: string;
  // Cleaned rewrite, or null when the rewrite failed/timed out (HTTP 200 either way).
  cleaned: string | null;
  llmError: string | null;
  confidence: number;
  audioDurationMs: number;
  requestTimeMs: number;
  // Wall-clock round trip as seen from this process, including upload.
  roundTripMs: number;
}

async function getApiKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'assemblyai');
  if (!key) throw new Error('AssemblyAI API key not configured. Go to Settings to add your API key.');
  return key;
}

export function buildKeyterms(extra: string[] | undefined): string[] {
  const vocab = (getSetting('customVocabulary') || []) as Array<{ term: string }>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [...vocab.map(v => v.term), ...(extra || [])]) {
    const t = (term || '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

export async function dictate(pcm: Uint8Array, opts: DictationOptions): Promise<DictationResult> {
  const apiKey = await getApiKey();

  const config: Record<string, unknown> = {
    sample_rate: opts.sampleRate,
    channels: opts.channels,
  };
  const keyterms = buildKeyterms(opts.keyterms);
  if (keyterms.length) config.keyterms_prompt = keyterms;
  if (opts.sttPrompt) config.stt_prompt = opts.sttPrompt.slice(0, 6000);
  if (opts.llmInstruction) config.llm_instruction = opts.llmInstruction.slice(0, 2048);
  if (opts.languageCodes?.length) config.language_codes = opts.languageCodes;

  // The API requires the config part before the audio part; FormData preserves
  // insertion order.
  const form = new FormData();
  form.append('config', new Blob([JSON.stringify(config)], { type: 'application/json' }));
  form.append('audio', new Blob([new Uint8Array(pcm)], { type: 'audio/pcm' }), 'utterance.pcm');

  const started = Date.now();
  const res = await fetch(DICTATION_URL, {
    method: 'POST',
    headers: { Authorization: apiKey },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const roundTripMs = Date.now() - started;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log('error', 'Dictation request failed', { status: res.status, body: body.slice(0, 500) });
    throw new Error(`Dictation failed (HTTP ${res.status}): ${body.slice(0, 200) || res.statusText}`);
  }

  const json = await res.json() as Record<string, any>;
  const result: DictationResult = {
    text: json.text || '',
    cleaned: json.llm_response ?? null,
    llmError: json.llm_error ?? null,
    confidence: json.confidence ?? 0,
    audioDurationMs: json.audio_duration_ms ?? 0,
    requestTimeMs: Math.round(json.request_time_ms ?? 0),
    roundTripMs,
  };
  log('info', 'Dictation utterance transcribed', {
    audioMs: result.audioDurationMs,
    serverMs: result.requestTimeMs,
    roundTripMs,
    llmError: result.llmError,
    keyterms: keyterms.length,
  });
  return result;
}
