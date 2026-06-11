// ═══════════════════════════════════════════════════════════════
//  AI PID Tuning Advisor — Compare runs & suggest optimal values
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocketContext } from './context/WebSocketContext';
import { getRecordedRuns, deleteRun, clearAllRuns } from './hooks/PidRunStore';
import { analyzeRuns } from './utils/pidAnalysis';
import type { RecordedRun, AnalysisResult } from './utils/pidAnalysis';
import './index.css';

// ── Chart colours for overlaying runs ─────────────────────────
const RUN_COLORS = [
  '#00d4ff', // cyan
  '#00ff88', // green
  '#ff3b5c', // red
  '#ffb020', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

// ── Canvas layout ─────────────────────────────────────────────
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 24;
const PAD_B = 40;

export default function AiTuningPage() {
  const navigate = useNavigate();
  const { status } = useWebSocketContext();

  const [runs, setRuns] = useState<RecordedRun[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'itae' | 'overshoot' | 'settling'>('date');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Load runs ──────────────────────────────────────────────
  const refreshRuns = useCallback(() => {
    const loaded = getRecordedRuns();
    setRuns(loaded);
    setAnalysis(analyzeRuns(loaded));
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  // ── Sort runs ──────────────────────────────────────────────
  const sortedRuns = [...runs].sort((a, b) => {
    switch (sortBy) {
      case 'itae': return a.metrics.itaeScore - b.metrics.itaeScore;
      case 'overshoot': return a.metrics.overshootPercent - b.metrics.overshootPercent;
      case 'settling': return a.metrics.settlingTime - b.metrics.settlingTime;
      default: return b.recordedAt - a.recordedAt; // newest first
    }
  });

  // ── Toggle selection ───────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id); // max 8 runs
      return next;
    });
  };

  // ── Select All / Deselect All ─────────────────────────────
  const selectAll = () => {
    const ids = runs.slice(0, 8).map(r => r.id);
    setSelectedIds(new Set(ids));
  };

  const deselectAll = () => setSelectedIds(new Set());

  // ── Delete run ─────────────────────────────────────────────
  const handleDelete = (id: number) => {
    deleteRun(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refreshRuns();
  };

  // ── Clear all ──────────────────────────────────────────────
  const handleClearAll = () => {
    if (runs.length === 0) return;
    clearAllRuns();
    setSelectedIds(new Set());
    refreshRuns();
  };

  // ── Draw comparison chart ──────────────────────────────────
  useEffect(() => {
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
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const chartW = w - PAD_L - PAD_R;
    const chartH = h - PAD_T - PAD_B;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Get selected runs
    const selectedRuns = runs.filter(r => selectedIds.has(r.id));

    if (selectedRuns.length === 0) {
      ctx.fillStyle = '#7a8799';
      ctx.font = "16px 'Bebas Neue', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        runs.length === 0
          ? 'NO RECORDED RUNS YET — RUN THE SIMULATOR OR CONNECT TO STM32'
          : 'SELECT RUNS FROM THE TABLE BELOW TO COMPARE',
        w / 2, h / 2,
      );
      return;
    }

    // ── Compute global Y bounds across all selected runs ──
    let yMin = Infinity;
    let yMax = -Infinity;
    let maxDuration = 0;

    selectedRuns.forEach(run => {
      const startT = run.data[0]?.timestamp ?? 0;
      run.data.forEach(pt => {
        yMin = Math.min(yMin, pt.setpoint, pt.velocity, pt.error);
        yMax = Math.max(yMax, pt.setpoint, pt.velocity, pt.error);
      });
      const dur = ((run.data[run.data.length - 1]?.timestamp ?? 0) - startT) / 1000;
      if (dur > maxDuration) maxDuration = dur;
    });

    if (yMin === Infinity) { yMin = -0.5; yMax = 2.0; }
    const yPad = (yMax - yMin) * 0.15 || 0.5;
    yMin -= yPad;
    yMax += yPad;
    if (maxDuration <= 0) maxDuration = 5;

    // ── Grid ─────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#1e2530';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    // Horizontal
    for (let i = 0; i <= 4; i++) {
      const yy = PAD_T + (i / 4) * chartH;
      ctx.beginPath(); ctx.moveTo(PAD_L, yy); ctx.lineTo(w - PAD_R, yy); ctx.stroke();
    }
    // Vertical
    for (let i = 0; i <= 4; i++) {
      const xx = PAD_L + (i / 4) * chartW;
      ctx.beginPath(); ctx.moveTo(xx, PAD_T); ctx.lineTo(xx, PAD_T + chartH); ctx.stroke();
    }
    ctx.restore();

    // ── Axes ─────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#2e3848';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T);
    ctx.lineTo(PAD_L, PAD_T + chartH);
    ctx.lineTo(w - PAD_R, PAD_T + chartH);
    ctx.stroke();
    ctx.restore();

    // ── Y labels ─────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = '#7a8799';
    ctx.font = "10px 'Bebas Neue', monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const val = yMax - (i / 4) * (yMax - yMin);
      const yy = PAD_T + (i / 4) * chartH;
      ctx.fillText(val.toFixed(2), PAD_L - 6, yy);
    }
    ctx.restore();

    // ── X labels ─────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = '#7a8799';
    ctx.font = "10px 'Bebas Neue', monospace";
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const sec = (i / 4) * maxDuration;
      const xx = PAD_L + (i / 4) * chartW;
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillText(`${sec.toFixed(1)}s`, xx, PAD_T + chartH + 6);
    }
    ctx.textAlign = 'center';
    ctx.font = "11px 'Bebas Neue', sans-serif";
    ctx.fillText('TIME (seconds from start)', w / 2, PAD_T + chartH + 22);
    ctx.restore();

    // ── Clip ─────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, PAD_T, chartW, chartH);
    ctx.clip();

    // ── Draw setpoint reference (from first selected run) ──
    const refRun = selectedRuns[0];
    const refStart = refRun.data[0]?.timestamp ?? 0;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let first = true;
    refRun.data.forEach(pt => {
      const relT = (pt.timestamp - refStart) / 1000;
      const xx = PAD_L + (relT / maxDuration) * chartW;
      const yy = PAD_T + chartH * (1 - (pt.setpoint - yMin) / (yMax - yMin));
      if (first) { ctx.moveTo(xx, yy); first = false; } else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    ctx.restore();

    // ── Draw each selected run's velocity curve ──────────
    selectedRuns.forEach((run, idx) => {
      const color = RUN_COLORS[idx % RUN_COLORS.length];
      const startT = run.data[0]?.timestamp ?? 0;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      let isFirst = true;
      run.data.forEach(pt => {
        const relT = (pt.timestamp - startT) / 1000;
        const xx = PAD_L + (relT / maxDuration) * chartW;
        const yy = PAD_T + chartH * (1 - (pt.velocity - yMin) / (yMax - yMin));
        if (isFirst) { ctx.moveTo(xx, yy); isFirst = false; } else ctx.lineTo(xx, yy);
      });
      ctx.stroke();

      // End dot
      const lastPt = run.data[run.data.length - 1];
      if (lastPt) {
        const lx = PAD_L + (((lastPt.timestamp - startT) / 1000) / maxDuration) * chartW;
        const ly = PAD_T + chartH * (1 - (lastPt.velocity - yMin) / (yMax - yMin));
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    });

    ctx.restore(); // end clip

  }, [runs, selectedIds]);

  // ── Resize handler ─────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      // Trigger re-draw by updating state
      setSelectedIds(prev => new Set(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Helpers ────────────────────────────────────────────────
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const getRunColor = (runId: number) => {
    const selected = runs.filter(r => selectedIds.has(r.id));
    const idx = selected.findIndex(r => r.id === runId);
    return idx >= 0 ? RUN_COLORS[idx % RUN_COLORS.length] : undefined;
  };

  return (
    <>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="header graph-header">
        <button className="graph-header__back" onClick={() => navigate('/')}>
          ← Dashboard
        </button>

        <div className="graph-header__title-block">
          <div className="graph-header__title">AI TUNING</div>
        </div>

        <div className="header__right">
          <button className="header__nav-btn" onClick={() => navigate('/pid-graph')}>PID GRAPH</button>
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

      {/* ── Main Content ─────────────────────────────────────── */}
      <main className="ai-tuning-page">

        {/* ── AI Recommendation Card ─────────────────────────── */}
        {analysis && (
          <div className="ai-card">
            <div className="ai-card__header">
              <span className="ai-card__icon">🧠</span>
              <span className="ai-card__title">AI TUNING ANALYSIS</span>
              <span className="ai-card__badge">{runs.length} run{runs.length !== 1 ? 's' : ''} analyzed</span>
            </div>

            <div className="ai-card__verdict">
              {analysis.overallVerdict.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>

            <div className="ai-card__suggestions">
              {analysis.suggestions.map((s, i) => (
                <div key={i} className={`ai-suggestion ai-suggestion--${s.action}`}>
                  <span className="ai-suggestion__badge">
                    {s.action === 'increase' ? '▲' : s.action === 'decrease' ? '▼' : s.action === 'keep' ? '✓' : 'ℹ'}
                    {' '}{s.parameter}
                  </span>
                  <span className="ai-suggestion__text">{s.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {runs.length === 0 && (
          <div className="ai-card ai-card--empty">
            <div className="ai-card__header">
              <span className="ai-card__icon">📊</span>
              <span className="ai-card__title">NO RUNS RECORDED YET</span>
            </div>
            <div className="ai-card__verdict">
              <p>To start analyzing, enable the <strong>Simulator</strong> or connect to your STM32, then:</p>
              <p>1. Set PID parameters (Kp, Ki, Kd) and click <strong>APPLY PARAMETERS</strong></p>
              <p>2. Send a <strong>ROBOT MOVEMENT</strong> command with target coordinates</p>
              <p>3. Wait for the robot to reach the target — the run will be recorded automatically</p>
              <p>4. Repeat with different PID values to compare!</p>
            </div>
          </div>
        )}

        {/* ── Comparison Chart ────────────────────────────────── */}
        <div className="ai-chart-section">
          <div className="ai-chart-section__header">
            <span className="ai-chart-section__title">📈 RESPONSE CURVE COMPARISON</span>
            <div className="ai-chart-section__actions">
              <button className="ai-btn ai-btn--sm" onClick={selectAll} disabled={runs.length === 0}>
                Select All
              </button>
              <button className="ai-btn ai-btn--sm" onClick={deselectAll} disabled={selectedIds.size === 0}>
                Deselect All
              </button>
            </div>
          </div>

          {/* Legend for selected runs */}
          {selectedIds.size > 0 && (
            <div className="ai-chart-legend">
              {runs.filter(r => selectedIds.has(r.id)).map((run, idx) => (
                <div key={run.id} className="ai-chart-legend__item">
                  <span
                    className="ai-chart-legend__swatch"
                    style={{ background: RUN_COLORS[idx % RUN_COLORS.length] }}
                  />
                  <span className="ai-chart-legend__name">{run.name}</span>
                  <span className="ai-chart-legend__params">
                    Kp={run.kp.toFixed(2)} Ki={run.ki.toFixed(2)} Kd={run.kd.toFixed(2)}
                  </span>
                </div>
              ))}
              <div className="ai-chart-legend__item ai-chart-legend__item--ref">
                <span className="ai-chart-legend__swatch ai-chart-legend__swatch--dashed" />
                <span className="ai-chart-legend__name" style={{ color: 'rgba(255,255,255,0.4)' }}>Setpoint</span>
              </div>
            </div>
          )}

          <div className="ai-chart-wrap" ref={containerRef}>
            <canvas ref={canvasRef} className="ai-chart-canvas" />
          </div>
        </div>

        {/* ── Runs Table ──────────────────────────────────────── */}
        <div className="ai-table-section">
          <div className="ai-table-section__header">
            <span className="ai-table-section__title">📋 RECORDED RUNS</span>
            <div className="ai-table-section__actions">
              <select
                className="ai-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="date">Sort by Date</option>
                <option value="itae">Sort by ITAE Score</option>
                <option value="overshoot">Sort by Overshoot</option>
                <option value="settling">Sort by Settling Time</option>
              </select>
              <button className="ai-btn ai-btn--danger" onClick={handleClearAll} disabled={runs.length === 0}>
                🗑️ Clear All
              </button>
            </div>
          </div>

          {sortedRuns.length > 0 ? (
            <div className="ai-table-wrap">
              <table className="ai-table">
                <thead>
                  <tr>
                    <th className="ai-table__th ai-table__th--check">Compare</th>
                    <th className="ai-table__th">Rank</th>
                    <th className="ai-table__th">Name</th>
                    <th className="ai-table__th">Kp</th>
                    <th className="ai-table__th">Ki</th>
                    <th className="ai-table__th">Kd</th>
                    <th className="ai-table__th">Rise Time</th>
                    <th className="ai-table__th">Overshoot</th>
                    <th className="ai-table__th">Settling</th>
                    <th className="ai-table__th">SS Error</th>
                    <th className="ai-table__th">ITAE</th>
                    <th className="ai-table__th">Duration</th>
                    <th className="ai-table__th">Date</th>
                    <th className="ai-table__th ai-table__th--actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map((run) => {
                    const rank = analysis?.rankings.find(r => r.runId === run.id)?.rank;
                    const isBest = analysis?.bestRunId === run.id;
                    const isSelected = selectedIds.has(run.id);
                    const runColor = getRunColor(run.id);

                    return (
                      <tr
                        key={run.id}
                        className={`ai-table__row ${isBest ? 'ai-table__row--best' : ''} ${isSelected ? 'ai-table__row--selected' : ''}`}
                      >
                        <td className="ai-table__td ai-table__td--check">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(run.id)}
                            className="ai-checkbox"
                          />
                          {runColor && (
                            <span className="ai-table__color-dot" style={{ background: runColor }} />
                          )}
                        </td>
                        <td className="ai-table__td ai-table__td--rank">
                          {isBest ? '🏆' : `#${rank ?? '—'}`}
                        </td>
                        <td className="ai-table__td ai-table__td--name">{run.name}</td>
                        <td className="ai-table__td ai-table__td--num">{run.kp.toFixed(2)}</td>
                        <td className="ai-table__td ai-table__td--num">{run.ki.toFixed(3)}</td>
                        <td className="ai-table__td ai-table__td--num">{run.kd.toFixed(2)}</td>
                        <td className="ai-table__td ai-table__td--num">{run.metrics.riseTime.toFixed(3)}s</td>
                        <td className={`ai-table__td ai-table__td--num ${run.metrics.overshootPercent > 15 ? 'ai-table__td--warn' : ''}`}>
                          {run.metrics.overshootPercent.toFixed(1)}%
                        </td>
                        <td className="ai-table__td ai-table__td--num">{run.metrics.settlingTime.toFixed(2)}s</td>
                        <td className="ai-table__td ai-table__td--num">{run.metrics.steadyStateError.toFixed(4)}</td>
                        <td className={`ai-table__td ai-table__td--num ${isBest ? 'ai-table__td--best-itae' : ''}`}>
                          {run.metrics.itaeScore.toFixed(3)}
                        </td>
                        <td className="ai-table__td ai-table__td--num">{run.metrics.duration.toFixed(1)}s</td>
                        <td className="ai-table__td ai-table__td--date">{formatDate(run.recordedAt)}</td>
                        <td className="ai-table__td ai-table__td--actions">
                          <button className="ai-btn ai-btn--xs ai-btn--danger" onClick={() => handleDelete(run.id)} title="Delete run">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="ai-table-empty">
              No runs recorded yet. Apply PID parameters and trigger robot movement to record runs.
            </div>
          )}
        </div>
      </main>
    </>
  );
}
