import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { TelemetryPacket } from '../types';

interface TelemetryChartProps {
  history: TelemetryPacket[];
}

export default function TelemetryChart({ history }: TelemetryChartProps) {
  // Use a rolling 60-point buffer
  const bufferData = history.slice(-60);

  // Map the time labels to friendly min:sec or just seconds offset
  const chartData = bufferData.map((d) => {
    const totalSeconds = Math.floor(d.timestamp / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;

    return {
      timeLabel,
      Target: d.setpoint,
      Actual: d.pidOutput,
      Error: d.error,
    };
  });

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '300px', background: 'var(--bg-card)', padding: '16px' }}>
      {chartData.length === 0 ? (
        <div style={{ display: 'flex', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', color: 'var(--text-mid)', fontFamily: 'var(--mono)', fontSize: '14px' }}>
          AWAITING TELEMETRY STREAM FOR LIVE GRAPH...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2530" />
            <XAxis
              dataKey="timeLabel"
              stroke="#7a8799"
              fontFamily="var(--mono)"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              stroke="#7a8799"
              fontFamily="var(--mono)"
              fontSize={10}
              domain={[0, 'auto']}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--bg-panel)',
                borderColor: 'var(--border)',
                fontFamily: 'var(--mono)',
                fontSize: '11px',
                color: 'var(--text-hi)',
              }}
            />
            <Legend
              wrapperStyle={{
                fontFamily: 'var(--mono)',
                fontSize: '10px',
                letterSpacing: '0.1em',
                paddingTop: '10px',
              }}
            />
            <Line
              type="monotone"
              dataKey="Target"
              stroke="#7a8799"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="Actual"
              stroke="#00ff88"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6, style: { filter: 'drop-shadow(0 0 6px #00ff88)' } }}
            />
            <Line
              type="monotone"
              dataKey="Error"
              stroke="#ff3b5c"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
