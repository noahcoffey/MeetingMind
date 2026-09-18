import React, { useEffect, useRef, useState } from 'react';
import type { DictationResult } from '../types';

// Live dictation experiment on top of the AssemblyAI Dictation API.
//
// The API is request/response (one clip of at most 120 s per call), so "live"
// here means: listen to the mic, cut it into utterances whenever the speaker
// pauses, and post each utterance the moment it ends. Results land in order
// even when a later utterance returns first.

const SAMPLE_RATE = 16000;
const BLOCK_SIZE = 4096;                 // ScriptProcessor buffer (256 ms at 16 kHz)
const SPEECH_RMS = 0.015;                // above this a block counts as speech
const SILENCE_MS = 900;                  // this much quiet after speech ends an utterance
const PRE_ROLL_BLOCKS = 2;               // keep a little audio from before speech onset
const MIN_UTTERANCE_MS = 350;            // shorter than this is a breath, not a request
const MAX_UTTERANCE_MS = 60_000;         // hard cut well under the API's 120 s limit
const CONTEXT_TAIL_CHARS = 600;          // recent transcript passed back as recognizer context

type Status = 'idle' | 'listening' | 'speaking' | 'error';

interface Utterance {
  id: number;
  state: 'pending' | 'done' | 'error';
  audioMs: number;
  sentAt: number;
  result?: DictationResult;
  error?: string;
}

function rms(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.sqrt(sum / block.length);
}

function toInt16(blocks: Float32Array[]): Uint8Array {
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.length; i++) {
      const s = Math.max(-1, Math.min(1, b[i]));
      out[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return new Uint8Array(out.buffer);
}

export default function DictatePage() {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [showVerbatim, setShowVerbatim] = useState(false);
  const [level, setLevel] = useState(0);
  const [sttPrompt, setSttPrompt] = useState('Dictated notes and messages for a software project.');
  const [llmInstruction, setLlmInstruction] = useState('');
  const [useContext, setUseContext] = useState(true);
  const [copied, setCopied] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextIdRef = useRef(1);
  const transcriptRef = useRef('');
  const optionsRef = useRef({ sttPrompt, llmInstruction, useContext });
  optionsRef.current = { sttPrompt, llmInstruction, useContext };

  // Segmenter state lives in a ref: the audio callback fires ~4×/s and must not
  // re-render or see stale closures.
  const segRef = useRef({
    inSpeech: false,
    blocks: [] as Float32Array[],
    preRoll: [] as Float32Array[],
    silentMs: 0,
    speechMs: 0,
  });

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then(list => setDevices(list.filter(d => d.kind === 'audioinput')))
      .catch(() => {});
    return () => { stopListening(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a plain-text copy of everything finished so far, for the clipboard and
  // for feeding recent context back into the recognizer.
  useEffect(() => {
    transcriptRef.current = utterances
      .filter(u => u.state === 'done' && u.result)
      .map(u => u.result!.cleaned ?? u.result!.text)
      .join(' ');
  }, [utterances]);

  async function startListening() {
    setErrorMsg('');
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Asking for 16 kHz makes Chromium resample for us, so the processor
      // hands over exactly what the API wants.
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(BLOCK_SIZE, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => handleBlock(e.inputBuffer.getChannelData(0));
      source.connect(processor);
      // ScriptProcessor only runs while connected to the graph output.
      processor.connect(ctx.destination);

      segRef.current = { inSpeech: false, blocks: [], preRoll: [], silentMs: 0, speechMs: 0 };
      setStatus('listening');
    } catch (err) {
      setErrorMsg(`Could not open microphone: ${(err as Error).message}`);
      setStatus('error');
    }
  }

  function stopListening() {
    const seg = segRef.current;
    if (seg.inSpeech && seg.speechMs >= MIN_UTTERANCE_MS) flushUtterance();
    seg.inSpeech = false;
    seg.blocks = [];
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
    setStatus('idle');
  }

  function handleBlock(input: Float32Array) {
    const block = new Float32Array(input); // the buffer is reused by the engine
    const blockMs = (block.length / SAMPLE_RATE) * 1000;
    const energy = rms(block);
    setLevel(Math.min(1, energy * 8));
    const seg = segRef.current;

    if (!seg.inSpeech) {
      seg.preRoll.push(block);
      if (seg.preRoll.length > PRE_ROLL_BLOCKS) seg.preRoll.shift();
      if (energy >= SPEECH_RMS) {
        seg.inSpeech = true;
        seg.blocks = [...seg.preRoll];
        seg.preRoll = [];
        seg.silentMs = 0;
        seg.speechMs = blockMs;
        setStatus('speaking');
      }
      return;
    }

    seg.blocks.push(block);
    seg.speechMs += blockMs;
    seg.silentMs = energy >= SPEECH_RMS ? 0 : seg.silentMs + blockMs;

    if (seg.silentMs >= SILENCE_MS || seg.speechMs >= MAX_UTTERANCE_MS) {
      const voicedMs = seg.speechMs - seg.silentMs;
      if (voicedMs >= MIN_UTTERANCE_MS) flushUtterance();
      seg.inSpeech = false;
      seg.blocks = [];
      seg.silentMs = 0;
      seg.speechMs = 0;
      setStatus('listening');
    }
  }

  function flushUtterance() {
    const seg = segRef.current;
    const pcm = toInt16(seg.blocks);
    const audioMs = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);
    const id = nextIdRef.current++;
    setUtterances(prev => [...prev, { id, state: 'pending', audioMs, sentAt: Date.now() }]);

    const { sttPrompt, llmInstruction, useContext } = optionsRef.current;
    const context = useContext ? transcriptRef.current.slice(-CONTEXT_TAIL_CHARS) : '';
    const prompt = [sttPrompt.trim(), context ? `Previous dictation: ${context}` : '']
      .filter(Boolean).join('\n');

    window.meetingMind.dictate(pcm, {
      sampleRate: SAMPLE_RATE,
      channels: 1,
      sttPrompt: prompt || undefined,
      llmInstruction: llmInstruction.trim() || undefined,
    }).then(res => {
      setUtterances(prev => prev.map(u => u.id !== id ? u : (
        res.success && res.result
          ? { ...u, state: 'done', result: res.result }
          : { ...u, state: 'error', error: res.error || 'Unknown error' }
      )));
    });
  }

  function textOf(u: Utterance): string {
    if (!u.result) return '';
    if (showVerbatim) return u.result.text;
    return u.result.cleaned ?? u.result.text;
  }

  async function copyAll() {
    const text = utterances.filter(u => u.state === 'done').map(textOf).join(' ');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const done = utterances.filter(u => u.state === 'done' && u.result);
  const totalAudioMs = done.reduce((n, u) => n + u.result!.audioDurationMs, 0);
  const avgRoundTrip = done.length ? Math.round(done.reduce((n, u) => n + u.result!.roundTripMs, 0) / done.length) : 0;
  const rewriteFailures = done.filter(u => u.result!.llmError).length;
  const listening = status === 'listening' || status === 'speaking';

  return (
    <>
      <div className="page-header">
        <h1>Dictate <span className="dictate-badge">experiment</span></h1>
        <div style={{ display: 'flex', gap: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="btn btn-secondary" onClick={copyAll} disabled={!done.length}>
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button className="btn btn-ghost" onClick={() => setUtterances([])} disabled={!utterances.length}>
            Clear
          </button>
        </div>
      </div>

      <div className="page-content dictate-page">
        <div className="card dictate-controls">
          <div className="dictate-controls-row">
            {listening ? (
              <button className="btn btn-danger" onClick={stopListening}>Stop</button>
            ) : (
              <button className="btn btn-primary" onClick={startListening}>Start dictating</button>
            )}
            <select
              className="form-input"
              value={deviceId}
              onChange={e => setDeviceId(e.target.value)}
              disabled={listening}
              style={{ maxWidth: 260 }}
            >
              <option value="default">Default microphone</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
              ))}
            </select>
            <div className={`dictate-status dictate-status-${status}`}>
              <span className="dictate-dot" />
              {status === 'idle' && 'Not listening'}
              {status === 'listening' && 'Listening — pause to send'}
              {status === 'speaking' && 'Hearing you…'}
              {status === 'error' && 'Error'}
            </div>
            <div className="dictate-meter"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
          </div>
          {errorMsg && <div className="dictate-error">{errorMsg}</div>}

          <details className="dictate-advanced">
            <summary>Tuning</summary>
            <div className="form-group">
              <label className="form-label">Context for the recognizer (stt_prompt)</label>
              <input className="form-input" value={sttPrompt} onChange={e => setSttPrompt(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Rewrite instruction (llm_instruction, blank = default cleanup)</label>
              <input
                className="form-input"
                placeholder="e.g. Format as bullet points"
                value={llmInstruction}
                onChange={e => setLlmInstruction(e.target.value)}
              />
            </div>
            <label className="dictate-check">
              <input type="checkbox" checked={useContext} onChange={e => setUseContext(e.target.checked)} />
              Pass recent dictation back as context for the next utterance
            </label>
            <label className="dictate-check">
              <input type="checkbox" checked={showVerbatim} onChange={e => setShowVerbatim(e.target.checked)} />
              Show verbatim transcript instead of the cleaned rewrite
            </label>
            <p className="dictate-hint">
              Custom vocabulary from Settings is sent as key terms with every utterance.
            </p>
          </details>
        </div>

        <div className="card dictate-output">
          {utterances.length === 0 ? (
            <p className="dictate-empty">
              Press Start, talk, and pause for about a second. Each pause sends what you said and the
              cleaned text appears here.
            </p>
          ) : (
            <p className="dictate-text">
              {utterances.map(u => (
                <span key={u.id} className={`dictate-utt dictate-utt-${u.state}`} title={
                  u.result
                    ? `${(u.result.audioDurationMs / 1000).toFixed(1)}s audio · ${u.result.roundTripMs}ms round trip · ${u.result.requestTimeMs}ms server` +
                      (u.result.llmError ? ` · rewrite ${u.result.llmError}, showing verbatim` : '')
                    : u.error || `${(u.audioMs / 1000).toFixed(1)}s audio, waiting…`
                }>
                  {u.state === 'pending' && <span className="dictate-pending">…</span>}
                  {u.state === 'error' && <span className="dictate-utt-error">[failed: {u.error}]</span>}
                  {u.state === 'done' && textOf(u)}
                  {' '}
                </span>
              ))}
            </p>
          )}
        </div>

        {done.length > 0 && (
          <div className="dictate-stats">
            <span>{done.length} utterance{done.length === 1 ? '' : 's'}</span>
            <span>{(totalAudioMs / 1000).toFixed(1)} s of audio</span>
            <span>avg {avgRoundTrip} ms round trip</span>
            {rewriteFailures > 0 && <span>{rewriteFailures} rewrite fallback{rewriteFailures === 1 ? '' : 's'}</span>}
          </div>
        )}
      </div>
    </>
  );
}
