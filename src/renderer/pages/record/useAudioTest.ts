import { useState, useRef } from 'react';
import { micAudioConstraint } from './mic-constraint';

/**
 * The "Test Audio" check on the idle page: four seconds of listening on the
 * mic (Web Audio, matched from the avfoundation name) and an ffmpeg probe of
 * the selected system-audio device. Lives at page level so the results
 * survive a recording in between.
 */
export function useAudioTest(selectedDevice: string, devices: MediaDeviceInfo[], selectedSystemDevice: string) {
  const [audioTestRunning, setAudioTestRunning] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState<number | null>(null);
  const [sysTestLevel, setSysTestLevel] = useState<number | null>(null);
  const [micTestResult, setMicTestResult] = useState<'pass' | 'fail' | null>(null);
  const [sysTestResult, setSysTestResult] = useState<'pass' | 'fail' | 'skip' | null>(null);
  const micTestIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestPeakRef = useRef<number>(0);

  async function handleTestAudio() {
    if (audioTestRunning) return;
    setAudioTestRunning(true);
    setMicTestLevel(null);
    setSysTestLevel(null);
    setMicTestResult(null);
    setSysTestResult(null);
    micTestPeakRef.current = 0;

    // Test mic via Web Audio API
    try {
      const constraints: MediaStreamConstraints = { audio: micAudioConstraint(selectedDevice, devices) };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micTestStreamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      micTestIntervalRef.current = setInterval(() => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setMicTestLevel(avg);
        if (avg > micTestPeakRef.current) micTestPeakRef.current = avg;
      }, 100);

      // Run for 4 seconds
      setTimeout(() => {
        if (micTestIntervalRef.current) clearInterval(micTestIntervalRef.current);
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        micTestStreamRef.current = null;
        setMicTestResult(micTestPeakRef.current > 0.02 ? 'pass' : 'fail');
        setMicTestLevel(null);
      }, 4000);
    } catch {
      setMicTestResult('fail');
    }

    // Test system audio via ffmpeg (if selected)
    if (selectedSystemDevice) {
      try {
        const result = await (window.meetingMind as any).testSystemAudio(selectedSystemDevice);
        if (result.success) {
          setSysTestLevel(result.peakLevel);
          setSysTestResult(result.peakLevel > 0.02 ? 'pass' : 'fail');
        } else {
          setSysTestResult('fail');
        }
      } catch {
        setSysTestResult('fail');
      }
    } else {
      setSysTestResult('skip');
    }

    // Wait for mic test to finish before clearing running state
    setTimeout(() => {
      setAudioTestRunning(false);
    }, 4200);
  }

  return {
    audioTestRunning,
    micTestLevel,
    sysTestLevel,
    micTestResult,
    sysTestResult,
    handleTestAudio,
  };
}
