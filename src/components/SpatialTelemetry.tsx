import type { TelemetryPacket, WsStatus } from '../types';

interface SpatialTelemetryProps {
  telemetry: TelemetryPacket;
  status: WsStatus;
}

export default function SpatialTelemetry({ telemetry, status }: SpatialTelemetryProps) {
  const isOnline = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="centre-top">
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-icon">↗</span>
          CURRENT COORDINATES
        </span>
        <span className="panel__status">
          {isOnline ? '● POLLING / ONLINE' : isConnecting ? '● CONNECTING...' : '● POLLING / OFFLINE'}
        </span>
      </div>

      <div className="telemetry-grid">
        {[
          { axis: 'X-AXIS', val: telemetry.x.toFixed(3), unit: 'm' },
          { axis: 'Y-AXIS', val: telemetry.y.toFixed(3), unit: 'm' },
          { axis: 'Z-AXIS', val: telemetry.z.toFixed(3), unit: 'm' },
          { axis: 'ANGLE', val: telemetry.heading.toFixed(3), unit: '°' },
        ].map(({ axis, val, unit }) => (
          <div className="telem-cell" key={axis}>
            <div className="telem-cell__axis">{axis}</div>
            <div className="telem-cell__value">
              {val}
              <span className="telem-cell__unit">{unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
