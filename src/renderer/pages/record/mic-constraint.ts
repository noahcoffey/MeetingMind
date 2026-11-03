// The mic dropdown stores an avfoundation device *name* — the stable identifier
// ffmpeg records from (indices reshuffle when virtual devices load). The live
// waveform uses Web Audio getUserMedia, which needs a Web Audio deviceId, so map
// the selected device to its Web Audio counterpart by matching name to label.
// If no match is found, fall back to the default mic so the meter still shows
// something (the recording itself still uses the correct device name).
export function micAudioConstraint(selectedDevice: string, devices: MediaDeviceInfo[]): MediaStreamConstraints['audio'] {
  if (selectedDevice === 'default') return true;
  const match = devices.find(
    d => d.label && (d.label === selectedDevice || d.label.includes(selectedDevice) || selectedDevice.includes(d.label))
  );
  if (match?.deviceId) return { deviceId: { exact: match.deviceId } };
  return true;
}
