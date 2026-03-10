import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { getRecording } from './recording-manager';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const POLL_INTERVAL = 10000;

async function getAssemblyAIKey(): Promise<string> {
  const keytar = require('keytar');
  const key = await keytar.getPassword('MeetingMind', 'assemblyai');
  if (!key) throw new Error('AssemblyAI API key not configured');
  return key;
}

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

export async function startTranscription(recordingId: string): Promise<{ success: boolean; error?: string }> {
  const recording = getRecording(recordingId);
  if (!recording) return { success: false, error: 'Recording not found' };

  const audioPath = recording.audioPath;
  if (!fs.existsSync(audioPath)) return { success: false, error: 'Audio file not found' };

  try {
    const apiKey = await getAssemblyAIKey();

    // Update status
    updateRecordingStatus(recordingId, 'transcribing');
    sendProgress('uploading', 'Uploading audio to AssemblyAI...');

    // Step 1: Upload audio file
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
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    const { upload_url } = await uploadResponse.json() as { upload_url: string };
    log('info', 'Audio uploaded to AssemblyAI', { upload_url });

    // Step 2: Create transcription
    sendProgress('processing', 'Transcription started, processing...');

    const transcriptResponse = await retryFetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        punctuate: true,
        format_text: true,
        speech_threshold: 0.2,
      }),
    });

    if (!transcriptResponse.ok) {
      throw new Error(`Transcription request failed: ${transcriptResponse.status}`);
    }

    const { id: transcriptId } = await transcriptResponse.json() as { id: string };
    log('info', 'Transcription created', { transcriptId });

    // Step 3: Poll for completion
    let completed = false;
    while (!completed) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const statusResponse = await retryFetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        method: 'GET',
        headers: { authorization: apiKey },
      });

      const result = await statusResponse.json() as any;

      if (result.status === 'completed') {
        completed = true;

        // Save transcript
        const outputDir = path.dirname(recording.audioPath);
        fs.writeFileSync(
          path.join(outputDir, 'transcript.json'),
          JSON.stringify(result, null, 2)
        );

        updateRecordingStatus(recordingId, 'transcribed');
        sendProgress('complete', 'Transcription complete!');
        log('info', 'Transcription completed', { transcriptId });

      } else if (result.status === 'error') {
        throw new Error(`Transcription error: ${result.error}`);
      } else {
        sendProgress('processing', `Processing... (${result.status})`);
      }
    }

    return { success: true };
  } catch (err: any) {
    log('error', 'Transcription failed', err);
    updateRecordingStatus(recordingId, 'recorded');
    sendProgress('error', `Transcription failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function updateRecordingStatus(recordingId: string, status: string): void {
  const { getSetting } = require('./store');
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
