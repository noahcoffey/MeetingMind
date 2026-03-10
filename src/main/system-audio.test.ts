import { hasVirtualAudioDevice, getBlackHoleSetupGuide, AudioDevice } from './system-audio';

// We can't easily test listSystemAudioDevices (spawns ffmpeg), but we can
// test the parsing logic indirectly via hasVirtualAudioDevice and the guide.

describe('hasVirtualAudioDevice', () => {
  test('returns true when a BlackHole device is present', () => {
    const devices: AudioDevice[] = [
      { index: 0, name: 'MacBook Pro Microphone', isVirtual: false },
      { index: 1, name: 'BlackHole 2ch', isVirtual: true },
    ];
    expect(hasVirtualAudioDevice(devices)).toBe(true);
  });

  test('returns true when a Loopback device is present', () => {
    const devices: AudioDevice[] = [
      { index: 0, name: 'Built-in Mic', isVirtual: false },
      { index: 1, name: 'Loopback Audio', isVirtual: true },
    ];
    expect(hasVirtualAudioDevice(devices)).toBe(true);
  });

  test('returns true when a Soundflower device is present', () => {
    const devices: AudioDevice[] = [
      { index: 0, name: 'Soundflower (2ch)', isVirtual: true },
    ];
    expect(hasVirtualAudioDevice(devices)).toBe(true);
  });

  test('returns false when no virtual devices present', () => {
    const devices: AudioDevice[] = [
      { index: 0, name: 'MacBook Pro Microphone', isVirtual: false },
      { index: 1, name: 'External USB Mic', isVirtual: false },
    ];
    expect(hasVirtualAudioDevice(devices)).toBe(false);
  });

  test('returns false for empty device list', () => {
    expect(hasVirtualAudioDevice([])).toBe(false);
  });

  test('handles multiple virtual devices', () => {
    const devices: AudioDevice[] = [
      { index: 0, name: 'BlackHole 2ch', isVirtual: true },
      { index: 1, name: 'Loopback Audio', isVirtual: true },
    ];
    expect(hasVirtualAudioDevice(devices)).toBe(true);
  });
});

describe('getBlackHoleSetupGuide', () => {
  test('returns a non-empty string', () => {
    const guide = getBlackHoleSetupGuide();
    expect(guide.length).toBeGreaterThan(100);
  });

  test('includes brew install command', () => {
    const guide = getBlackHoleSetupGuide();
    expect(guide).toContain('brew install blackhole');
  });

  test('mentions Audio MIDI Setup', () => {
    const guide = getBlackHoleSetupGuide();
    expect(guide).toContain('Audio MIDI Setup');
  });

  test('mentions Multi-Output Device', () => {
    const guide = getBlackHoleSetupGuide();
    expect(guide).toContain('Multi-Output Device');
  });
});
