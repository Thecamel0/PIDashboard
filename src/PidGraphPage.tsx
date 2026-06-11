// PidGraphPage.tsx — High-performance, time-precise telemetry canvas chart
import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocketContext } from './context/WebSocketContext';
import type { TelemetryPacket } from './types';
import './index.css';

// ── Chart layout constants ────────────────────────────────────
const PAD_LEFT   = 65;
const PAD_RIGHT  = 30;
const PAD_TOP    = 30;
const PAD_BOTTOM = 48;

// ── Window duration limits ─────────────────────────────────────
const DEFAULT_WINDOW = 15_000; // ms
const MIN_WINDOW     =  2_000;
const MAX_WINDOW     = 60_000;

// ── Pan step (keyboard arrows) ────────────────────────────────
const PAN_STEP_MS = 2_000;

// ── Colours ───────────────────────────────────────────────────
const COLOR_SETPOINT = '#00d4ff';
const COLOR_VELOCITY = '#00ff88';
const COLOR_ERROR    = '#ff3b5c';
const COLOR_GRID     = '#1e2530';
const COLOR_AXIS     = '#2e3848';
const COLOR_LABEL    = '#7a8799';

export default function PidGraphPage() {
  const navigate = useNavigate();
  const { status, telemetry, historyRef, subscribe } = useWebSocketContext();

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Data ──────────────────────────────────────────────────
  const localHistoryRef = useRef<TelemetryPacket[]>([]);
  const rafRef          = useRef<number>(0);

  // ── Y-axis smooth bounds ──────────────────────────────────
  const yMinRef = useRef(-1.0);
  const yMaxRef = useRef(2.5);

  // ── Clock offset (PLL) ────────────────────────────────────
  const smoothedOffsetRef = useRef<number | null>(null);

  // ── Canvas dimensions ─────────────────────────────────────
  const dimsRef = useRef({ w: 0, h: 0, chartW: 0, chartH: 0, dpr: 1 });

  // ── Zoom state ────────────────────────────────────────────
  const windowDurRef = useRef<number>(DEFAULT_WINDOW);
  const [windowDur, setWindowDur] = useState<number>(DEFAULT_WINDOW);

  // ── Pause / Pan state ─────────────────────────────────────
  // panOffsetRef: how many ms we've scrolled from live edge (negative = into the past)
  const panOffsetRef  = useRef<number>(0);
  const pausedAtRef   = useRef<number | null>(null); // tMax when paused
  const [isPaused, setIsPaused] = useState(false);
  const [panOffset, setPanOffset] = useState(0);

  // ── Drag state (mouse pan) ────────────────────────────────
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const isDraggingRef = useRef(false);

  // ── Save flash ────────────────────────────────────────────
  const [saveFlash, setSaveFlash] = useState(false);

  // ─────────────────────────────────────────────────────────
  //  Seed from global history on mount
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (historyRef?.current) {
      localHistoryRef.current = [...historyRef.current];
    }
  }, [historyRef]);

  // ─────────────────────────────────────────────────────────
  //  Subscribe to live packets
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribe((pkt) => {
      localHistoryRef.current.push(pkt);

      // PLL offset
      const localNow = Date.now();
      const raw = pkt.timestamp - localNow;
      smoothedOffsetRef.current =
        smoothedOffsetRef.current === null
          ? raw
          : smoothedOffsetRef.current + (raw - smoothedOffsetRef.current) * 0.05;

      // Trim old data (keep up to 70 s when live, up to 5 minutes when paused)
      const isCurrentlyPaused = pausedAtRef.current !== null;
      const maxAge = isCurrentlyPaused ? 300_000 : (MAX_WINDOW + 10_000);
      const cutoff = pkt.timestamp - maxAge;
      while (localHistoryRef.current.length > 0 && localHistoryRef.current[0].timestamp < cutoff) {
        localHistoryRef.current.shift();
      }
    });
    return unsub;
  }, [subscribe]);

  // ─────────────────────────────────────────────────────────
  //  Zoom helpers
  // ─────────────────────────────────────────────────────────
  const applyZoom = useCallback((ms: number) => {
    const clamped = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, ms));
    windowDurRef.current = clamped;
    setWindowDur(clamped);
  }, []);

  // ─────────────────────────────────────────────────────────
  //  Pause / Resume
  // ─────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (!isPaused) {
      // Freeze at the current tMax
      const data = localHistoryRef.current;
      if (data.length > 0) {
        const lastPkt = data[data.length - 1];
        const localNow = Date.now();
        let tMax = localNow + (smoothedOffsetRef.current ?? (lastPkt.timestamp - localNow));
        const maxT = lastPkt.timestamp;
        if (tMax > maxT + 100) tMax = maxT + 100;
        pausedAtRef.current = tMax;
      } else {
        pausedAtRef.current = Date.now();
      }
      panOffsetRef.current = 0;
      setPanOffset(0);
      setIsPaused(true);
    } else {
      pausedAtRef.current = null;
      panOffsetRef.current = 0;
      setPanOffset(0);
      setIsPaused(false);
    }
  }, [isPaused]);

  // ─────────────────────────────────────────────────────────
  //  Pan helpers (used by buttons + drag)
  // ─────────────────────────────────────────────────────────
  const panBy = useCallback((deltaMs: number) => {
    // When live, first pause then pan
    if (!isPaused) {
      const data = localHistoryRef.current;
      if (data.length > 0) {
        const lastPkt = data[data.length - 1];
        const localNow = Date.now();
        let tMax = localNow + (smoothedOffsetRef.current ?? (lastPkt.timestamp - localNow));
        const maxT = lastPkt.timestamp;
        if (tMax > maxT + 100) tMax = maxT + 100;
        pausedAtRef.current = tMax;
      } else {
        pausedAtRef.current = Date.now();
      }
      setIsPaused(true);
    }

    const data = localHistoryRef.current;
    if (data.length === 0) return;

    const oldestTs = data[0].timestamp;
    const frozenTMax = pausedAtRef.current ?? Date.now();

    // Clamp: can't pan right of the live edge, can't pan left past oldest data
    const newOffset = panOffsetRef.current + deltaMs; // positive delta = forward, negative = backward
    const minOffset = oldestTs - frozenTMax + windowDurRef.current; // don't go past oldest visible
    const maxOffset = 0; // don't go into the future
    const clampedOffset = Math.max(minOffset, Math.min(maxOffset, newOffset));
    panOffsetRef.current = clampedOffset;
    setPanOffset(clampedOffset);
  }, [isPaused]);

  // ─────────────────────────────────────────────────────────
  //  Mouse wheel → zoom
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(windowDurRef.current * (e.deltaY > 0 ? 1.15 : 0.85));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  // ─────────────────────────────────────────────────────────
  //  Mouse drag → pan
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = false;
      dragRef.current = { startX: e.clientX, startOffset: panOffsetRef.current };
      el.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      if (Math.abs(dx) > 4) isDraggingRef.current = true;
      if (!isDraggingRef.current) return;

      const { chartW } = dimsRef.current;
      if (chartW === 0) return;

      // dx pixels → ms (positive dx = dragged right = look further back)
      const deltaPx = dx;
      const deltaMs = (deltaPx / chartW) * windowDurRef.current;

      // Apply: panning right means we shift tMax back (negative pan)
      const frozenTMax = pausedAtRef.current;

      // Pause first if needed
      if (!frozenTMax) {
        const data = localHistoryRef.current;
        if (data.length > 0) {
          const lastPkt = data[data.length - 1];
          const localNow = Date.now();
          let tMax = localNow + (smoothedOffsetRef.current ?? (lastPkt.timestamp - localNow));
          const maxT = lastPkt.timestamp;
          if (tMax > maxT + 100) tMax = maxT + 100;
          pausedAtRef.current = tMax;
        } else {
          pausedAtRef.current = Date.now();
        }
        setIsPaused(true);
      }

      const data = localHistoryRef.current;
      const frozenT = pausedAtRef.current ?? Date.now();
      const oldestTs = data.length > 0 ? data[0].timestamp : frozenT - MAX_WINDOW;
      const newOffset = dragRef.current.startOffset - deltaMs; // sign corrected: dragging right subtracts (moves back in time)
      const minOffset = oldestTs - frozenT + windowDurRef.current;
      const clampedOffset = Math.max(minOffset, Math.min(0, newOffset));
      panOffsetRef.current = clampedOffset;
      setPanOffset(clampedOffset);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      el.style.cursor = 'grab';
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  //  Keyboard arrows → pan
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  panBy(-PAN_STEP_MS); // shift view left (into past)
      if (e.key === 'ArrowRight') panBy(PAN_STEP_MS);  // shift view right (toward live)
      if (e.key === ' ') { e.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panBy, togglePause]);

  // ─────────────────────────────────────────────────────────
  //  Save as PNG
  // ─────────────────────────────────────────────────────────
  const saveGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tmp = document.createElement('canvas');
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;

    tctx.drawImage(canvas, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    tctx.save();
    tctx.scale(dpr, dpr);
    tctx.fillStyle = 'rgba(0,212,255,0.55)';
    tctx.font = "11px 'Bebas Neue', monospace";
    tctx.textAlign = 'right';
    tctx.textBaseline = 'bottom';
    const now = new Date();
    tctx.fillText(
      `PID GRAPH  •  ${now.toLocaleDateString()} ${now.toLocaleTimeString()}  •  WINDOW ${(windowDurRef.current / 1000).toFixed(1)}s`,
      tmp.width / dpr - PAD_RIGHT,
      tmp.height / dpr - 4,
    );
    tctx.restore();

    const url = tmp.toDataURL('image/png');
    const a   = document.createElement('a');
    a.download = `pid_graph_${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.href = url;
    a.click();

    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1200);
  }, []);

  // ─────────────────────────────────────────────────────────
  //  Coordinate helpers
  // ─────────────────────────────────────────────────────────
  const toX = (ts: number, tMax: number, chartW: number, winDur: number) => {
    return PAD_LEFT + ((ts - (tMax - winDur)) / winDur) * chartW;
  };

  const toY = (val: number, chartH: number, yMin: number, yMax: number) =>
    PAD_TOP + chartH * (1 - (val - yMin) / (yMax - yMin));

  // ─────────────────────────────────────────────────────────
  //  Draw a signal line
  // ─────────────────────────────────────────────────────────
  const drawLine = (
    ctx: CanvasRenderingContext2D,
    data: TelemetryPacket[],
    getValue: (p: TelemetryPacket) => number,
    color: string,
    lineWidth: number,
    chartW: number, chartH: number,
    tMax: number, yMin: number, yMax: number,
    winDur: number,
    dashed = false,
  ) => {
    if (data.length < 2) return;
    ctx.save();
    ctx.strokeStyle  = color;
    ctx.lineWidth    = lineWidth;
    ctx.lineJoin     = 'round';
    if (dashed) ctx.setLineDash([5, 5]);

    ctx.beginPath();
    let first = true;
    let prevTs = 0;

    data.forEach((pt) => {
      if (pt.timestamp >= tMax - winDur - 2000) {
        const x = toX(pt.timestamp, tMax, chartW, winDur);
        const y = toY(getValue(pt), chartH, yMin, yMax);
        if (first || (prevTs > 0 && pt.timestamp - prevTs > 500)) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
        prevTs = pt.timestamp;
      }
    });
    ctx.stroke();
    ctx.restore();
  };

  // ─────────────────────────────────────────────────────────
  //  Draw tracking dot
  // ─────────────────────────────────────────────────────────
  const drawDot = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    color: string, radius = 4,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  // ─────────────────────────────────────────────────────────
  //  Main draw frame (RAF)
  // ─────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h, chartW, chartH } = dimsRef.current;
    if (w === 0 || h === 0) return;

    const data   = localHistoryRef.current;
    const winDur = windowDurRef.current;

    // No-data placeholder
    if (data.length < 2) {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.fillStyle    = COLOR_LABEL;
      ctx.font         = "18px 'Bebas Neue', sans-serif";
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AWAITING TELEMETRY STREAM...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    const lastPkt = data[data.length - 1];

    // ── Compute tMax ──────────────────────────────────────
    let tMax: number;
    if (pausedAtRef.current !== null) {
      // Paused or panned: frozen live edge + pan offset
      tMax = pausedAtRef.current + panOffsetRef.current;
    } else {
      const localNow = Date.now();
      tMax = localNow + (smoothedOffsetRef.current ?? (lastPkt.timestamp - localNow));
      const maxT = lastPkt.timestamp;
      if (tMax > maxT + 100) tMax = maxT + 100;
      else if (tMax < maxT - 1000) tMax = maxT;
    }

    // ── Dynamic Y limits ─────────────────────────────────
    let minVal = Infinity;
    let maxVal = -Infinity;
    data.forEach((pt) => {
      if (pt.timestamp >= tMax - winDur && pt.timestamp <= tMax) {
        minVal = Math.min(minVal, pt.setpoint, pt.velocity, pt.error);
        maxVal = Math.max(maxVal, pt.setpoint, pt.velocity, pt.error);
      }
    });
    if (minVal === Infinity) { minVal = -1.0; maxVal = 2.5; }

    const diff      = maxVal - minVal;
    const targetMin = minVal - Math.max(diff * 0.15, 0.2);
    const targetMax = maxVal + Math.max(diff * 0.15, 0.2);

    yMinRef.current += (targetMin - yMinRef.current) * 0.15;
    yMaxRef.current += (targetMax - yMaxRef.current) * 0.15;

    const yMin = yMinRef.current;
    const yMax = yMaxRef.current;

    // ── Clear ─────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);

    // ── Paused tint overlay ───────────────────────────────
    if (pausedAtRef.current !== null) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,176,32,0.04)';
      ctx.fillRect(PAD_LEFT, PAD_TOP, chartW, chartH);
      ctx.restore();
    }

    // ── Grid ──────────────────────────────────────────────
    const yRange = yMax - yMin;
    const yStep  = yRange / 4;
    const yTicks = [0, 1, 2, 3, 4].map(i => yMin + i * yStep);

    ctx.save();
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    yTicks.forEach(yVal => {
      const y = toY(yVal, chartH, yMin, yMax);
      ctx.beginPath(); ctx.moveTo(PAD_LEFT, y); ctx.lineTo(w - PAD_RIGHT, y); ctx.stroke();
    });
    for (let i = 0; i <= 4; i++) {
      const x = PAD_LEFT + (i / 4) * chartW;
      ctx.beginPath(); ctx.moveTo(x, PAD_TOP); ctx.lineTo(x, PAD_TOP + chartH); ctx.stroke();
    }
    ctx.restore();

    // ── Axes ─────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP);
    ctx.lineTo(PAD_LEFT, PAD_TOP + chartH);
    ctx.lineTo(w - PAD_RIGHT, PAD_TOP + chartH);
    ctx.stroke();
    ctx.restore();

    // ── Y labels ─────────────────────────────────────────
    ctx.save();
    ctx.fillStyle    = COLOR_LABEL;
    ctx.font         = "11px 'Bebas Neue', monospace";
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach(yVal => {
      const y = toY(yVal, chartH, yMin, yMax);
      ctx.fillText(yVal.toFixed(2), PAD_LEFT - 8, y);
      ctx.strokeStyle = COLOR_AXIS;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(PAD_LEFT - 4, y); ctx.lineTo(PAD_LEFT, y); ctx.stroke();
    });
    ctx.restore();

    // ── Y axis title ─────────────────────────────────────
    ctx.save();
    ctx.translate(18, PAD_TOP + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle    = COLOR_LABEL;
    ctx.font         = "12px 'Bebas Neue', sans-serif";
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('SPEED (m/s)', 0, 0);
    ctx.restore();

    // ── X axis title ─────────────────────────────────────
    ctx.save();
    ctx.fillStyle    = COLOR_LABEL;
    ctx.font         = "12px 'Bebas Neue', sans-serif";
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `TIME (${(winDur / 1000).toFixed(1)}s window)`,
      PAD_LEFT + chartW / 2, PAD_TOP + chartH + 26,
    );
    ctx.restore();

    // ── X tick labels ────────────────────────────────────
    const fmt = (ts: number) => {
      const s = Math.floor(ts / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const tLeft  = tMax - winDur;
    const tMid   = tLeft + winDur / 2;
    const ty     = PAD_TOP + chartH + 8;

    ctx.save();
    ctx.fillStyle    = COLOR_LABEL;
    ctx.font         = "11px 'Bebas Neue', monospace";
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';  ctx.fillText(fmt(tLeft), PAD_LEFT, ty);
    ctx.textAlign = 'center'; ctx.fillText(fmt(tMid), PAD_LEFT + chartW / 2, ty);
    ctx.textAlign = 'right'; ctx.fillText(fmt(tMax), w - PAD_RIGHT, ty);
    ctx.restore();

    // ── Clip & draw signals ───────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, PAD_TOP, chartW, chartH);
    ctx.clip();

    drawLine(ctx, data, p => p.setpoint, COLOR_SETPOINT, 1.5, chartW, chartH, tMax, yMin, yMax, winDur, true);
    drawLine(ctx, data, p => p.velocity, COLOR_VELOCITY, 2.5, chartW, chartH, tMax, yMin, yMax, winDur);
    drawLine(ctx, data, p => p.error,    COLOR_ERROR,    1.5, chartW, chartH, tMax, yMin, yMax, winDur);

    ctx.restore();

    // ── Tracking dots at latest visible point ─────────────
    let lastVisiblePkt: TelemetryPacket | null = null;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].timestamp <= tMax) {
        lastVisiblePkt = data[i];
        break;
      }
    }
    if (lastVisiblePkt) {
      const lx = toX(lastVisiblePkt.timestamp, tMax, chartW, winDur);
      if (lx >= PAD_LEFT && lx <= PAD_LEFT + chartW) {
        drawDot(ctx, lx, toY(lastVisiblePkt.setpoint, chartH, yMin, yMax), COLOR_SETPOINT, 4);
        drawDot(ctx, lx, toY(lastVisiblePkt.velocity, chartH, yMin, yMax), COLOR_VELOCITY, 5);
        drawDot(ctx, lx, toY(lastVisiblePkt.error,    chartH, yMin, yMax), COLOR_ERROR,    3);
      }
    }

    // ── PAUSED badge ──────────────────────────────────────
    if (pausedAtRef.current !== null) {
      ctx.save();
      const bx = PAD_LEFT + chartW - 4;
      const by = PAD_TOP + 4;
      ctx.font         = "bold 10px 'Bebas Neue', monospace";
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = 'rgba(255,176,32,0.9)';
      ctx.fillText('⏸ PAUSED', bx, by);
      ctx.restore();
    }
  }, [subscribe]);

  // ── RAF loop ─────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const loop = () => { drawFrame(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
  }, [drawFrame]);

  const stopLoop = useCallback(() => { cancelAnimationFrame(rafRef.current); }, []);

  // ── Resize handler ───────────────────────────────────────
  const handleResize = useCallback(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const w    = rect.width;
    const h    = rect.height;

    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    dimsRef.current = { w, h, chartW: w - PAD_LEFT - PAD_RIGHT, chartH: h - PAD_TOP - PAD_BOTTOM, dpr };
  }, []);

  // ── Mount / unmount ──────────────────────────────────────
  useEffect(() => {
    handleResize();
    startLoop();
    window.addEventListener('resize', handleResize);
    return () => { stopLoop(); window.removeEventListener('resize', handleResize); };
  }, [handleResize, startLoop, stopLoop]);

  // ── Zoom label & bar ─────────────────────────────────────
  const zoomLabel = `${(windowDur / 1000).toFixed(1)}s`;
  const zoomBarPct = Math.round(
    ((Math.log(DEFAULT_WINDOW) - Math.log(windowDur)) /
     (Math.log(DEFAULT_WINDOW) - Math.log(MIN_WINDOW))) * 100,
  );

  // Jump back to live
  const jumpToLive = useCallback(() => {
    pausedAtRef.current  = null;
    panOffsetRef.current = 0;
    setPanOffset(0);
    setIsPaused(false);
  }, []);

  // ── Legend values calculation (freeze on pause) ──────────
  let displayPacket = telemetry;
  if (isPaused && localHistoryRef.current.length > 0) {
    const tMax = (pausedAtRef.current ?? Date.now()) + panOffsetRef.current;
    let bestPkt = localHistoryRef.current[0];
    for (let i = localHistoryRef.current.length - 1; i >= 0; i--) {
      if (localHistoryRef.current[i].timestamp <= tMax) {
        bestPkt = localHistoryRef.current[i];
        break;
      }
    }
    displayPacket = bestPkt;
  }

  return (
    <>
      {/* ── Header ───────────────────────────────────────── */}
      <header className="header graph-header">
        <button className="graph-header__back" onClick={() => navigate('/')}>
          ← Dashboard
        </button>

        <div className="graph-header__title-block">
          <div className="graph-header__title">PID Response Graph</div>
          <div className="graph-header__subtitle">Live Setpoint vs Actual Output</div>
        </div>

        <div className="header__right">
          <div className={`ws-pill ${
            status === 'connected'  ? 'ws-pill--connected'  :
            status === 'connecting' ? 'ws-pill--connecting' :
            status === 'simulating' ? 'ws-pill--simulating' : ''
          }`}>
            <span className="ws-pill__dot" />
            {status === 'connected'  ? 'Online' :
             status === 'connecting' ? 'Connecting' :
             status === 'simulating' ? 'Simulating' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="graph-page">
        <div className="graph-page__container">

          {/* ── Signal legend ──────────────────────────────── */}
          <div className="graph-page__legend-bar">
            <span className="graph-page__legend-title">Signals</span>
            <div className="graph-page__legend">
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-swatch" style={{ background: COLOR_SETPOINT }} />
                <span className="graph-page__legend-name">Target</span>
                <span className="graph-page__legend-val" style={{ color: COLOR_SETPOINT }}>
                  {displayPacket.setpoint.toFixed(3)}
                </span>
              </div>
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-swatch" style={{ background: COLOR_VELOCITY }} />
                <span className="graph-page__legend-name">Actual</span>
                <span className="graph-page__legend-val" style={{ color: COLOR_VELOCITY }}>
                  {displayPacket.velocity.toFixed(3)}
                </span>
              </div>
              <div className="graph-page__legend-item">
                <span className="graph-page__legend-swatch" style={{ background: COLOR_ERROR }} />
                <span className="graph-page__legend-name">Error</span>
                <span className="graph-page__legend-val" style={{ color: COLOR_ERROR }}>
                  {displayPacket.error.toFixed(3)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Toolbar ────────────────────────────────────── */}
          <div className="graph-toolbar">

            {/* — Group: Playback — */}
            <div className="graph-toolbar__group">
              <span className="graph-toolbar__group-label">Playback</span>
              <div className="graph-toolbar__group-body">
                <button
                  id="graph-pause-btn"
                  className={`gtb-btn gtb-btn--primary${isPaused ? ' gtb-btn--active' : ''}`}
                  onClick={togglePause}
                  title="Pause / Resume live scrolling (Space)"
                >
                  {isPaused ? (
                    <><span className="gtb-btn__icon">▶</span> Resume</>
                  ) : (
                    <><span className="gtb-btn__icon">⏸</span> Pause</>
                  )}
                </button>
                {(isPaused || panOffset < 0) && (
                  <button
                    id="graph-live-btn"
                    className="gtb-btn gtb-btn--live"
                    onClick={jumpToLive}
                    title="Jump to live edge"
                  >
                    <span className="gtb-btn__live-dot" />
                    Go Live
                  </button>
                )}
              </div>
            </div>

            <div className="graph-toolbar__divider" />

            {/* — Group: Pan — */}
            <div className="graph-toolbar__group">
              <span className="graph-toolbar__group-label">Pan  <span className="graph-toolbar__key-hint">← →</span></span>
              <div className="graph-toolbar__group-body">
                <button
                  id="graph-pan-left"
                  className="gtb-btn gtb-btn--icon"
                  onClick={() => panBy(-PAN_STEP_MS)}
                  title="Scroll view backward 2 seconds (←)"
                >
                  ◀ Back
                </button>
                <button
                  id="graph-pan-right"
                  className="gtb-btn gtb-btn--icon"
                  onClick={() => panBy(PAN_STEP_MS)}
                  title="Scroll view forward 2 seconds (→)"
                  disabled={!isPaused && panOffset >= 0}
                >
                  Fwd ▶
                </button>
              </div>
            </div>

            <div className="graph-toolbar__divider" />

            {/* — Group: Zoom — */}
            <div className="graph-toolbar__group">
              <span className="graph-toolbar__group-label">Zoom  <span className="graph-toolbar__key-hint">scroll</span></span>
              <div className="graph-toolbar__group-body graph-toolbar__zoom-body">
                <button
                  id="graph-zoom-out"
                  className="gtb-btn gtb-btn--icon gtb-btn--square"
                  onClick={() => applyZoom(windowDurRef.current / 0.6)}
                  title="Zoom out — show more time"
                  disabled={windowDur >= MAX_WINDOW}
                >
                  −
                </button>

                <div className="graph-toolbar__zoom-track">
                  <div className="graph-toolbar__zoom-label">{zoomLabel}</div>
                  <div className="graph-toolbar__zoom-bar">
                    <div
                      className="graph-toolbar__zoom-fill"
                      style={{ width: `${Math.max(0, Math.min(100, zoomBarPct))}%` }}
                    />
                  </div>
                </div>

                <button
                  id="graph-zoom-in"
                  className="gtb-btn gtb-btn--icon gtb-btn--square"
                  onClick={() => applyZoom(windowDurRef.current * 0.6)}
                  title="Zoom in — show less time"
                  disabled={windowDur <= MIN_WINDOW}
                >
                  ＋
                </button>

                <button
                  id="graph-zoom-reset"
                  className="gtb-btn gtb-btn--ghost"
                  onClick={() => applyZoom(DEFAULT_WINDOW)}
                  title="Reset zoom to 15 s"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="graph-toolbar__divider" />

            {/* — Group: Export — */}
            <div className="graph-toolbar__group graph-toolbar__group--right">
              <span className="graph-toolbar__group-label">Export</span>
              <div className="graph-toolbar__group-body">
                <button
                  id="graph-save-btn"
                  className={`gtb-btn gtb-btn--save${saveFlash ? ' gtb-btn--save-ok' : ''}`}
                  onClick={saveGraph}
                  title="Save current frame as PNG"
                >
                  {saveFlash
                    ? <><span className="gtb-btn__icon">✓</span> Saved!</>
                    : <><span className="gtb-btn__icon">↓</span> Save PNG</>}
                </button>
              </div>
            </div>

          </div>

          {/* ── Canvas ─────────────────────────────────────── */}
          <div className="graph-page__canvas-wrap" ref={containerRef}>
            <canvas ref={canvasRef} className="graph-page__canvas" />
          </div>

        </div>
      </main>
    </>
  );
}