import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { getFFmpegPath } from './recording-manager';

export interface AudioLevel {
  meanVolume: number;
  maxVolume: number;
  histogramTopDb: number | null;
}

// Thresholds below which AssemblyAI tends to reject audio as "no detectable speech".
// mean_volume in dBFS: typical conversational speech is around -20 to -30; below -40 is risky.
// max_volume in dBFS: peaks should reach -10 or higher; below -20 means the file is very quiet.
export const QUIET_MEAN_DBFS = -35;
export const QUIET_MAX_DBFS = -15;

export function isAudioTooQuiet(level: AudioLevel): boolean {
  return level.meanVolume < QUIET_MEAN_DBFS && level.maxVolume < QUIET_MAX_DBFS;
}

export function analyzeAudioLevel(audioPath: string): Promise<AudioLevel> {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFFmpegPath();
    const args = ['-hide_banner', '-nostats', '-i', audioPath, '-af', 'volumedetect', '-f', 'null', '-'];
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && !stderr.includes('volumedetect')) {
        return reject(new Error(`ffmpeg volumedetect exited with code ${code}: ${stderr.slice(-500)}`));
      }
      const meanMatch = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
      const histMatch = stderr.match(/histogram_0db:\s*(\d+)/);

      if (!meanMatch || !maxMatch) {
        return reject(new Error('Failed to parse volumedetect output'));
      }
      resolve({
        meanVolume: parseFloat(meanMatch[1]),
        maxVolume: parseFloat(maxMatch[1]),
        histogramTopDb: histMatch ? parseInt(histMatch[1], 10) : null,
      });
    });
  });
}

export type NormalizationMethod = 'peak' | 'loudnorm';

export interface NormalizationResult {
  outputPath: string;
  method: NormalizationMethod;
  appliedGainDb?: number;
  beforeLevel: AudioLevel;
  afterLevel: AudioLevel;
}

function getNormalizedPath(audioPath: string): string {
  const dir = path.dirname(audioPath);
  const ext = path.extname(audioPath);
  const base = path.basename(audioPath, ext);
  return path.join(dir, `${base}-normalized${ext}`);
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

async function normalizePeak(audioPath: string, level: AudioLevel): Promise<NormalizationResult> {
  const output = getNormalizedPath(audioPath);
  // Target -1 dBFS peak; gain = target - max_volume. If already loud, this is a no-op (small/neg gain).
  const gainDb = Math.max(0, -1 - level.maxVolume);
  log('info', 'Peak-normalizing audio', { audioPath, gainDb, max: level.maxVolume });

  await runFfmpeg([
    '-y', '-hide_banner', '-nostats',
    '-i', audioPath,
    '-af', `volume=${gainDb.toFixed(2)}dB`,
    '-c:a', 'aac', '-b:a', '128k',
    output,
  ]);

  const after = await analyzeAudioLevel(output);
  return { outputPath: output, method: 'peak', appliedGainDb: gainDb, beforeLevel: level, afterLevel: after };
}

async function normalizeLoudnorm(audioPath: string, level: AudioLevel): Promise<NormalizationResult> {
  const output = getNormalizedPath(audioPath);
  // Two-pass EBU R128 loudness normalization.
  // Targets: I=-16 LUFS (speech podcast), TP=-1.5 dBTP, LRA=11.
  const target = { I: -16, TP: -1.5, LRA: 11 };
  log('info', 'Loudnorm pass 1 (analysis)', { audioPath });

  const pass1Stderr = await runFfmpeg([
    '-hide_banner', '-nostats',
    '-i', audioPath,
    '-af', `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:print_format=json`,
    '-f', 'null', '-',
  ]);

  // ffmpeg writes the JSON block to stderr after the analysis. Extract it.
  const jsonStart = pass1Stderr.lastIndexOf('{');
  const jsonEnd = pass1Stderr.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not parse loudnorm pass-1 JSON');
  }
  const measured = JSON.parse(pass1Stderr.slice(jsonStart, jsonEnd + 1)) as {
    input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string;
  };

  log('info', 'Loudnorm pass 2 (apply)', { measured });

  const filter =
    `loudnorm=I=${target.I}:TP=${target.TP}:LRA=${target.LRA}:` +
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}:linear=true:print_format=summary`;

  await runFfmpeg([
    '-y', '-hide_banner', '-nostats',
    '-i', audioPath,
    '-af', filter,
    '-ar', '48000',
    '-c:a', 'aac', '-b:a', '128k',
    output,
  ]);

  const after = await analyzeAudioLevel(output);
  return { outputPath: output, method: 'loudnorm', beforeLevel: level, afterLevel: after };
}

export async function normalizeAudio(
  audioPath: string,
  method: NormalizationMethod,
  precomputedLevel?: AudioLevel
): Promise<NormalizationResult> {
  if (!fs.existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);
  const level = precomputedLevel ?? await analyzeAudioLevel(audioPath);

  if (method === 'peak') return normalizePeak(audioPath, level);
  return normalizeLoudnorm(audioPath, level);
}
