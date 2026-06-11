interface VelocityGaugeProps {
  value?: number;
  max?: number;
}

export default function VelocityGauge({ value = 0.00, max = 3 }: VelocityGaugeProps) {
  const R = 80;
  const cx = 100;
  const cy = 100;
  const startAngle = -220;
  const endAngle = 40;
  const totalArc = endAngle - startAngle; // 260°

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (from: number, to: number, r: number) => {
    const s = { x: cx + r * Math.cos(toRad(from)), y: cy + r * Math.sin(toRad(from)) };
    const e = { x: cx + r * Math.cos(toRad(to)), y: cy + r * Math.sin(toRad(to)) };
    const large = to - from > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const pct = Math.min(Math.max(value / max, 0), 1);
  const filledEnd = startAngle + totalArc * pct;

  return (
    <div className="velocity-section">
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-icon">◎</span>
          VELOCITY
        </span>
      </div>

      <div className="gauge-wrap">
        <svg viewBox="0 0 200 200" width="180" height="180">
          {/* Track */}
          <path
            d={arcPath(startAngle, endAngle, R)}
            fill="none"
            stroke="#1e2530"
            strokeWidth="10"
            strokeLinecap="butt"
          />
          {/* Fill with premium cyan glow */}
          <path
            d={arcPath(startAngle, filledEnd, R)}
            fill="none"
            stroke="#00d4ff"
            strokeWidth="10"
            strokeLinecap="butt"
            style={{ filter: 'drop-shadow(0 0 6px #00d4ff)' }}
          />
          {/* Value Display */}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            fill="#e8edf5"
            fontFamily="'Bebas Neue', sans-serif"
            fontSize="32"
          >
            {value.toFixed(2)}
          </text>
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            fill="#7a8799"
            fontFamily="'Bebas Neue', sans-serif"
            fontSize="11"
            letterSpacing="3"
          >
            M/S
          </text>
        </svg>
      </div>
    </div>
  );
}
