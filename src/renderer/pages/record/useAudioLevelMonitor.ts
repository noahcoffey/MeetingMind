import { useState, useEffect, useRef } from 'react';
import { micAudioConstraint } from './mic-constraint';
import { drawWaveform } from './waveform';

/**
 * The live level meter and waveform shown while recording. It listens on the
 * Web Audio side only — `devices` are Web Audio inputs, matched to the
 * avfoundation `selectedDevice` name by `micAudioConstraint`; the recording
 * itself never goes through here.
 */
export function useAudioLevelMonitor(isRecording: boolean, selectedDevice: string, devices: MediaDeviceInfo[]) {
  const [audioLevel, setAudioLevel] = useState(0);

  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformHistoryRef = useRef<number[]>([]);
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    const container = waveformContainerRef.current;
    const canvas = waveformCanvasRef.current;
    if (!container || !canvas) return;

    const sync = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(container.clientWidth * dpr);
      if (canvas.width !== w) canvas.width = w;
    };
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(container);
    return () => observer.disconnect();
  });

  async function startAudioLevelMonitor() {
    try {
      const constraints: MediaStreamConstraints = { audio: micAudioConstraint(selectedDevice, devices) };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      function tick() {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setAudioLevel(avg);

        const history = waveformHistoryRef.current;
        history.push(avg);
        const canvas = waveformCanvasRef.current;
        if (canvas) {
          const maxSamples = Math.floor(canvas.width / 3);
          if (history.length > maxSamples) {
            history.splice(0, history.length - maxSamples);
          }
          drawWaveform(canvas, history);
        }

        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (err) {
      console.error('Failed to start audio level monitor', err);
    }
  }

  function stopAudioLevelMonitor() {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    analyserRef.current = null;
    setAudioLevel(0);
    waveformHistoryRef.current = [];
  }

  return {
    audioLevel,
    waveformCanvasRef,
    waveformContainerRef,
    startAudioLevelMonitor,
    stopAudioLevelMonitor,
  };
}
