import React from 'react';

interface DevicePickersProps {
  /** avfoundation devices from main. Both pickers store the device *name*. */
  systemAudioDevices: any[];
  selectedDevice: string;
  onSelectedDeviceChange: (value: string) => void;
  selectedSystemDevice: string;
  onSelectedSystemDeviceChange: (value: string) => void;
}

/** Microphone and system-audio pickers. */
export default function DevicePickers({ systemAudioDevices, selectedDevice, onSelectedDeviceChange, selectedSystemDevice, onSelectedSystemDeviceChange }: DevicePickersProps) {
  const hasSystemDevices = systemAudioDevices.length > 0;

  return (
    <div className={`rp-devices ${!hasSystemDevices ? 'single-col' : ''}`}>
      <div className="rp-device-group">
        <label>Microphone</label>
        <select
          value={selectedDevice}
          onChange={e => onSelectedDeviceChange(e.target.value)}
        >
          <option value="default">Default Microphone</option>
          {systemAudioDevices.map((d: any) => (
            <option key={d.index} value={d.name}>
              {d.name}{d.isVirtual ? ' (virtual)' : ''}
            </option>
          ))}
        </select>
      </div>

      {hasSystemDevices && (
        <div className="rp-device-group">
          <label>System Audio</label>
          <select
            value={selectedSystemDevice}
            onChange={e => onSelectedSystemDeviceChange(e.target.value)}
          >
            <option value="">None — mic only</option>
            {systemAudioDevices.map(d => (
              <option key={d.index} value={d.name}>
                {d.name}{d.isVirtual ? ' (virtual)' : ''}
              </option>
            ))}
          </select>
          {!selectedSystemDevice && (
            <div style={{
              fontSize: 12,
              color: 'var(--accent-yellow)',
              marginTop: 4,
              lineHeight: 1.4,
            }}>
              System audio not selected — only your microphone will be recorded.
              Zoom/Teams/Meet participants won't be captured.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
