// PidGraphPage.tsx — High-performance, time-precise telemetry canvas chart
import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocketContext } from './context/WebSocketContext';
import type { TelemetryPacket } from './types';
import './index.css';

// ── Chart layout constants ────────────────────────────────────
const PAD_LEFT = 65;
const PAD_RIGHT = 30;
const PAD_TOP = 30;
const PAD_BOTTOM = 48;

// ── Rolling window: 15 seconds of history visible ─────────────
const WINDOW_DURATION = 15000; // 15 seconds in milliseconds

// ── Colours ───────────────────────────────────────────────────
const COLOR_SETPOINT = '#00d4ff';   // cyan  — target
const COLOR_VELOCITY = '#00ff88';   // green — actual
const COLOR_ERROR = '#ff3b5c';   // red   — error
const COLOR_GRID = '#1e2530';
const COLOR_AXIS = '#2e3848';
const COLOR_LABEL = '#7a8799';

export default function PidGraphPage() {
  const navigate = useNavigate();
  const { status, telemetry, historyRef, subscribe } = useWebSocketContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local history ref to store incoming packets without triggering React renders
  const localHistoryRef = useRef<TelemetryPacket[]>([]);
  const rafRef = useRef<number>(0);

  // Smooth Y-axis bounds state refs
  const yMinRef = useRef(-1.0);
  const yMaxRef = useRef(2.5);

  // Local-to-remote clock offset tracking for smooth 60fps graph scrolling
  const smoothedOffsetRef = useRef<number | null>(null);

  // Canvas logical dimensions (updated on resize only)
  const dimsRef = useRef({ w: 0, h: 0, chartW: 0, chartH: 0, dpr: 1 });

  // Sync with current WebSocket history buffer on mount
  useEffect(() => {
    if (historyRef && historyRef.current) {
      localHistoryRef.current = [...historyRef.current];
    }
  }, [historyRef]);

  // Subscribe to WebSocket packet stream for sub-millisecond drawing updates
  useEffect(() => {
    const unsubscribe = subscribe((pkt) => {
      localHistoryRef.current.push(pkt);
      
      // Track clock offset to sync the scrolling window with local Date.now()
      const localNow = Date.now();
      const rawOffset = pkt.timestamp - localNow;
      if (smoothedOffsetRef.current === null) {
        smoothedOffsetRef.current = rawOffset;
      } else {
        // Smoothly adjust the offset to filter out network/scheduling jitter
        const lerpFactor = 0.05;
        smoothedOffsetRef.current = smoothedOffsetRef.current + (rawOffset - smoothedOffsetRef.current) * lerpFactor;
      }
      
      // Keep only packets within the last 20 seconds (WINDOW_DURATION + 5s safety margin)
      const cutoff = pkt.timestamp - 20000;
      while (localHistoryRef.current.length > 0 && localHistoryRef.current[0].timestamp < cutoff) {
        localHistoryRef.current.shift();
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // ── Coordinate helpers ──────────────────────────────────────
  const toX = (timestamp: number, tMax: number, chartW: number) => {
    const tMin = tMax - WINDOW_DURATION;
    const ratio = (timestamp - tMin) / WINDOW_DURATION;
    return PAD_LEFT + ratio * chartW;
  };

  const toY = (val: number, chartH: number, yMin: number, yMax: number) =>
    PAD_TOP + chartH * (1 - (val - yMin) / (yMax - yMin));

  // ── Draw one line through all history points ───────────────
  const drawLine = (
    ctx: CanvasRenderingContext2D,
    data: TelemetryPacket[],
    getValue: (p: TelemetryPacket) => number,
    color: string,
    lineWidth: number,
    chartW: number,
    chartH: number,
    tMax: number,
    yMin: number,
    yMax: number,
    dashed = false,
  ) => {
    if (data.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([5, 5]);

    ctx.beginPath();
    let first = true;
    let prevTimestamp = 0;

    data.forEach((pt) => {
      // Only draw points inside or just bordering the visible range
      if (pt.timestamp >= tMax - WINDOW_DURATION - 2000) {
        const x = toX(pt.timestamp, tMax, chartW);
        const y = toY(getValue(pt), chartH, yMin, yMax);
        
        // Data gap detection: if the gap between successive packets exceeds 500ms,
        // break the line and start a new segment (moveTo) instead of connecting them.
        if (first || (prevTimestamp > 0 && pt.timestamp - prevTimestamp > 500)) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
        prevTimestamp = pt.timestamp;
      }
    });
    ctx.stroke();
    ctx.restore();
  };

  // ── Draw tracking dot at the last point ────────────────────
  const drawDot = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    color: string,
    radius = 4,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  // ── Full frame draw — called by RAF loop ───────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h, chartW, chartH } = dimsRef.current;
    if (w === 0 || h === 0) return;

    const data = localHistoryRef.current;

    // ── No data placeholder ───────────────────────────────
    if (data.length < 2) {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.fillStyle = COLOR_LABEL;
      ctx.font = "18px 'Bebas Neue', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AWAITING TELEMETRY STREAM...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    const lastPacket = data[data.length - 1];

    // Extrapolate time based on local clock and smoothed offset (PLL)
    const localNow = Date.now();
    let tMax = localNow + (smoothedOffsetRef.current ?? (lastPacket.timestamp - localNow));

    // Safety clamp: do not scroll more than 100ms past the last received packet
    // to prevent drifting off if the stream halts, but allow up to 1000ms lag.
    const maxT = lastPacket.timestamp;
    if (tMax > maxT + 100) {
      tMax = maxT + 100;
    } else if (tMax < maxT - 1000) {
      tMax = maxT;
    }

    // ── 1. Calculate dynamic Y limits based on visible points ──
    let minVal = Infinity;
    let maxVal = -Infinity;
    const tMin = tMax - WINDOW_DURATION;

    data.forEach((pt) => {
      if (pt.timestamp >= tMin) {
        minVal = Math.min(minVal, pt.setpoint, pt.velocity, pt.error);
        maxVal = Math.max(maxVal, pt.setpoint, pt.velocity, pt.error);
      }
    });

    // Default bounds fallback if scan is invalid
    if (minVal === Infinity) {
      minVal = -1.0;
      maxVal = 2.5;
    }

    // Add padding cushion (15% above and below)
    const diff = maxVal - minVal;
    const targetMin = minVal - Math.max(diff * 0.15, 0.2);
    const targetMax = maxVal + Math.max(diff * 0.15, 0.2);

    // Apply smooth linear interpolation (lerp) damping (0.15 for twice faster response)
    const lerpFactor = 0.15;
    yMinRef.current = yMinRef.current + (targetMin - yMinRef.current) * lerpFactor;
    yMaxRef.current = yMaxRef.current + (targetMax - yMaxRef.current) * lerpFactor;

    const yMin = yMinRef.current;
    const yMax = yMaxRef.current;

    // ── Clear ──
    ctx.clearRect(0, 0, w, h);

    // ── Grid & Y Ticks ──
    const yRange = yMax - yMin;
    const yStep = yRange / 4;
    const yTicks = [0, 1, 2, 3, 4].map(i => yMin + i * yStep);

    // Horizontal grid lines
    ctx.save();
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    yTicks.forEach(yVal => {
      const y = toY(yVal, chartH, yMin, yMax);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(w - PAD_RIGHT, y);
      ctx.stroke();
    });

    // Vertical grid lines (5 evenly spaced ticks)
    for (let i = 0; i <= 4; i++) {
      const x = PAD_LEFT + (i / 4) * chartW;
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + chartH);
      ctx.stroke();
    }
    ctx.restore();

    // ── Axes ──
    ctx.save();
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, PAD_TOP + chartH);
    ctx.lineTo(w - PAD_RIGHT, PAD_TOP + chartH);
    ctx.stroke();
    ctx.restore();

    // ── Y-axis labels ──
    ctx.save();
    ctx.fillStyle = COLOR_LABEL;
    ctx.font = "11px 'Bebas Neue', monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach(yVal => {
      const y = toY(yVal, chartH, yMin, yMax);
      ctx.fillText(yVal.toFixed(2), PAD_LEFT - 8, y);
      // Tick mark
      ctx.strokeStyle = COLOR_AXIS;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT - 4, y);
      ctx.lineTo(PAD_LEFT, y);
      ctx.stroke();
    });
    ctx.restore();

    // ── Y-axis title ──
    ctx.save();
    ctx.translate(18, PAD_TOP + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = COLOR_LABEL;
    ctx.font = "12px 'Bebas Neue', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('SPEED (m/s)', 0, 0);
    ctx.restore();

    // ── X-axis title ──
    ctx.save();
    ctx.fillStyle = COLOR_LABEL;
    ctx.font = "12px 'Bebas Neue', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`TIME (last ${WINDOW_DURATION / 1000}s)`,
      PAD_LEFT + chartW / 2, PAD_TOP + chartH + 26);
    ctx.restore();

    // ── X-axis time labels ──
    if (data.length >= 2) {
      const minT = tMax - WINDOW_DURATION;
      const maxT = tMax;
      const midT = minT + (maxT - minT) / 2;

      const fmt = (ts: number) => {
        const s = Math.floor(ts / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };

      ctx.save();
      ctx.fillStyle = COLOR_LABEL;
      ctx.font = "11px 'Bebas Neue', monospace";
      ctx.textBaseline = 'top';
      const ty = PAD_TOP + chartH + 8;
      ctx.textAlign = 'left'; ctx.fillText(fmt(minT), PAD_LEFT, ty);
      ctx.textAlign = 'center'; ctx.fillText(fmt(midT), PAD_LEFT + chartW / 2, ty);
      ctx.textAlign = 'right'; ctx.fillText(fmt(maxT), w - PAD_RIGHT, ty);
      ctx.restore();
    }

    // ── Clip to chart area so lines don't bleed into padding ─
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, PAD_TOP, chartW, chartH);
    ctx.clip();

    // Draw setpoint (dashed cyan)
    drawLine(ctx, data, p => p.setpoint, COLOR_SETPOINT, 1.5, chartW, chartH, tMax, yMin, yMax, true);

    // Draw velocity (solid green — the main signal)
    drawLine(ctx, data, p => p.velocity, COLOR_VELOCITY, 2.5, chartW, chartH, tMax, yMin, yMax);

    // Draw error (solid red)
    drawLine(ctx, data, p => p.error, COLOR_ERROR, 1.5, chartW, chartH, tMax, yMin, yMax);

    ctx.restore();   // end clip

    // ── Tracking dots at latest point ────────────────────
    const last = data[data.length - 1];
    const lx = toX(last.timestamp, tMax, chartW);

    drawDot(ctx, lx, toY(last.setpoint, chartH, yMin, yMax), COLOR_SETPOINT, 4);
    drawDot(ctx, lx, toY(last.velocity, chartH, yMin, yMax), COLOR_VELOCITY, 5);
    drawDot(ctx, lx, toY(last.error, chartH, yMin, yMax), COLOR_ERROR, 3);

  }, [subscribe]);

  // ── RAF loop — runs independently of React renders ─────────
  const startLoop = useCallback(() => {
    const loop = () => {
      drawFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [drawFrame]);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Resize handler — updates canvas size + dims ref ────────
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    dimsRef.current = {
      w,
      h,
      chartW: w - PAD_LEFT - PAD_RIGHT,
      chartH: h - PAD_TOP - PAD_BOTTOM,
      dpr,
    };
  }, []);

  // ── Mount / unmount ────────────────────────────────────────
  useEffect(() => {
    handleResize();
    startLoop();

    window.addEventListener('resize', handleResize);
    return () => {
      stopLoop();
      window.removeEventListener('resize', handleResize);
    };
  }, [handleResize, startLoop, stopLoop]);

  return (
    <>
      <header className="header graph-header">
        <button className="graph-header__back" onClick={() => navigate('/')}>
          ← DASHBOARD
        </button>

        <div className="graph-header__title-block">
          <div className="graph-header__title">PID_RESPONSE_GRAPH</div>
          <div className="graph-header__subtitle">
            LIVE SETPOINT VS ACTUAL OUTPUT TRACKING
          </div>
        </div>

        <div className="header__right">
          <div className={`ws-pill ${status === 'connected' ? 'ws-pill--connected' :
              status === 'connecting' ? 'ws-pill--connecting' :
                status === 'simulating' ? 'ws-pill--simulating' : ''
            }`}>
            <span className="ws-pill__dot" />
            {status === 'connected' ? 'ONLINE' :
              status === 'connecting' ? 'CONNECTING' :
                status === 'simulating' ? 'SIMULATING' : 'OFFLINE'}
          </div>
        </div>
      </header>

      <main className="graph-page">
        <div className="graph-page__container">

          {/* Legend bar */}
          <div className="graph-page__chart-bar">
            <div className="graph-page__chart-title">
              PID RESPONSE &amp; ERROR TRACKING
            </div>
            <div className="graph-page__legend">
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-dot"
                  style={{ background: COLOR_SETPOINT }} />
                <span>TARGET&nbsp;
                  <span style={{ color: 'var(--text-hi)', fontFamily: 'monospace' }}>
                    {telemetry.setpoint.toFixed(3)}
                  </span>
                </span>
              </div>
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-dot"
                  style={{ background: COLOR_VELOCITY }} />
                <span>ACTUAL&nbsp;
                  <span style={{ color: COLOR_VELOCITY, fontFamily: 'monospace' }}>
                    {telemetry.velocity.toFixed(3)}
                  </span>
                </span>
              </div>
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-dot"
                  style={{ background: COLOR_ERROR }} />
                <span>ERROR&nbsp;
                  <span style={{ color: COLOR_ERROR, fontFamily: 'monospace' }}>
                    {telemetry.error.toFixed(3)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="graph-page__canvas-wrap" ref={containerRef}>
            <canvas ref={canvasRef} className="graph-page__canvas" />
          </div>

        </div>
      </main>
    </>
  );
}