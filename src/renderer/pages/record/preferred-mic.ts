// Which mic the Record page starts on. The saved preference (`defaultInputDevice`)
// is an avfoundation device *name*; it's used only while that device is plugged in,
// otherwise recording falls back to the system default without forgetting the
// preference, so the external mic is picked again the next time it's connected.
//
// Older onboarding saved a browser device label, which can carry a USB id suffix
// ("Blue Yeti (046d:0ab1)"), so a device whose name the preference contains also counts.
export function resolvePreferredMic(preferred: string | undefined | null, devices: { name: string }[]): string {
  if (!preferred || preferred === 'default') return 'default';
  const exact = devices.find(d => d.name === preferred);
  if (exact) return exact.name;
  const loose = devices.find(d => d.name && preferred.includes(d.name));
  return loose ? loose.name : 'default';
}
