import { spawn } from 'child_process';
import { log } from './logger';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AudioDevice {
  index: number;
  name: string;
  isVirtual: boolean;
}

const VIRTUAL_DEVICE_KEYWORDS = ['blackhole', 'loopback', 'soundflower', 'virtual'];

function getFFmpegPath(): string {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'ffmpeg');
  }
  const bundled = path.join(app.getAppPath(), 'bin', 'ffmpeg');
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg';
}

export async function listSystemAudioDevices(): Promise<AudioDevice[]> {
  const ffmpegPath = getFFmpegPath();

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-f', 'avfoundation',
      '-list_devices', 'true',
      '-i', '',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', () => {
      const devices: AudioDevice[] = [];
      const lines = stderr.split('\n');

      let inAudioSection = false;
      for (const line of lines) {
        if (line.includes('AVFoundation audio devices:')) {
          inAudioSection = true;
          continue;
        }
        // Stop if we hit a new section header (video devices come before audio)
        if (inAudioSection && line.includes('AVFoundation') && !line.includes('audio devices:') && line.includes(':')) {
          // Check if this is a non-device header line
          if (line.includes('video devices:')) {
            break;
          }
        }

        if (inAudioSection) {
          const match = line.match(/\[(\d+)\] (.+)/);
          if (match) {
            const index = parseInt(match[1], 10);
            const name = match[2].trim();
            const nameLower = name.toLowerCase();
            const isVirtual = VIRTUAL_DEVICE_KEYWORDS.some(kw => nameLower.includes(kw));
            devices.push({ index, name, isVirtual });
          }
        }
      }

      log('info', `Found ${devices.length} system audio devices`, { devices });
      resolve(devices);
    });

    proc.on('error', (err) => {
      log('error', 'Failed to list system audio devices', err);
      resolve([]);
    });
  });
}

export function hasVirtualAudioDevice(devices: AudioDevice[]): boolean {
  return devices.some(d => d.isVirtual);
}

export function getBlackHoleSetupGuide(): string {
  return `To capture system audio, you need a virtual audio device like BlackHole.

1. Install BlackHole via Homebrew:
   brew install blackhole-2ch

2. Open Audio MIDI Setup (search in Spotlight):
   - Click the "+" button at the bottom left
   - Select "Create Multi-Output Device"
   - Check both your speakers/headphones AND "BlackHole 2ch"
   - Make sure "BlackHole 2ch" is listed (drift correction can be enabled for it)

3. Set the Multi-Output Device as your system audio output:
   - Go to System Settings > Sound > Output
   - Select the "Multi-Output Device" you just created
   - This routes audio to both your speakers and BlackHole simultaneously

4. In MeetingMind, select "BlackHole 2ch" as the system audio input.
   This allows MeetingMind to capture system audio alongside your microphone.`;
}
