import { resolvePreferredMic } from './preferred-mic';

const devices = [
  { name: 'MacBook Pro Microphone' },
  { name: 'Shure MV7+' },
  { name: 'ZoomAudioDevice' },
];

describe('resolvePreferredMic', () => {
  test('uses the saved mic when it is plugged in', () => {
    expect(resolvePreferredMic('Shure MV7+', devices)).toBe('Shure MV7+');
  });

  test('falls back to the system default while the saved mic is unplugged', () => {
    expect(resolvePreferredMic('Shure MV7+', [{ name: 'MacBook Pro Microphone' }])).toBe('default');
  });

  test('no preference means the system default', () => {
    expect(resolvePreferredMic('default', devices)).toBe('default');
    expect(resolvePreferredMic('', devices)).toBe('default');
    expect(resolvePreferredMic(undefined, devices)).toBe('default');
  });

  test('matches a browser label saved by older onboarding', () => {
    expect(resolvePreferredMic('Shure MV7+ (14ed:1019)', devices)).toBe('Shure MV7+');
  });

  test('ignores a browser device id hash saved by older onboarding', () => {
    expect(resolvePreferredMic('3f5a9c0e1b2d4e6f8a7b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f', devices)).toBe('default');
  });
});
