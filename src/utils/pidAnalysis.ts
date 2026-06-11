// ═══════════════════════════════════════════════════════════════
//  PID Analysis Engine — Control Theory Metrics
//  Computes standard performance metrics from telemetry data
// ═══════════════════════════════════════════════════════════════

import type { TelemetryPacket } from '../types';

/** Computed metrics for a single PID run */
export interface PidMetrics {
  /** Time from 10% to 90% of setpoint (seconds) */
  riseTime: number;
  /** Peak overshoot as a percentage of setpoint */
  overshootPercent: number;
  /** Time until output stays within ±2% of setpoint (seconds) */
  settlingTime: number;
  /** Average absolute error in the last 20% of the run */
  steadyStateError: number;
  /** Integral of Time × Absolute Error — lower is better */
  itaeScore: number;
  /** Peak value reached */
  peakValue: number;
  /** Total run duration in seconds */
  duration: number;
}

/** A single tuning suggestion */
export interface TuningSuggestion {
  parameter: 'Kp' | 'Ki' | 'Kd' | 'General';
  action: 'increase' | 'decrease' | 'keep' | 'info';
  reason: string;
}

/** Full analysis result for recommendation */
export interface AnalysisResult {
  bestRunIndex: number;
  bestRunId: number;
  overallVerdict: string;
  suggestions: TuningSuggestion[];
  rankings: { runId: number; score: number; rank: number }[];
}

// ═══════════════════════════════════════════════════════════════
//  Compute metrics from a telemetry snapshot
// ═══════════════════════════════════════════════════════════════

export function computeMetrics(data: TelemetryPacket[]): PidMetrics {
  if (data.length < 3) {
    return {
      riseTime: 0,
      overshootPercent: 0,
      settlingTime: 0,
      steadyStateError: 0,
      itaeScore: 0,
      peakValue: 0,
      duration: 0,
    };
  }

  const startTime = data[0].timestamp;
  const endTime = data[data.length - 1].timestamp;
  const duration = (endTime - startTime) / 1000; // seconds

  // Use the average setpoint across the run (should be relatively constant)
  const avgSetpoint = data.reduce((sum, p) => sum + p.setpoint, 0) / data.length;
  const setpoint = avgSetpoint || 1.0; // fallback

  // ── Rise Time: 10% → 90% of setpoint ──────────────────
  const thresh10 = setpoint * 0.1;
  const thresh90 = setpoint * 0.9;
  let time10 = -1;
  let time90 = -1;

  for (const pt of data) {
    if (time10 < 0 && pt.velocity >= thresh10) {
      time10 = (pt.timestamp - startTime) / 1000;
    }
    if (time90 < 0 && pt.velocity >= thresh90) {
      time90 = (pt.timestamp - startTime) / 1000;
    }
    if (time10 >= 0 && time90 >= 0) break;
  }

  const riseTime = (time10 >= 0 && time90 >= 0) ? Math.max(0, time90 - time10) : duration;

  // ── Peak Value & Overshoot ─────────────────────────────
  let peakValue = -Infinity;
  for (const pt of data) {
    if (pt.velocity > peakValue) {
      peakValue = pt.velocity;
    }
  }

  const overshootPercent = setpoint > 0
    ? Math.max(0, ((peakValue - setpoint) / setpoint) * 100)
    : 0;

  // ── Settling Time: last time output exits ±2% band ─────
  const band = Math.abs(setpoint) * 0.02 || 0.02; // 2% tolerance
  let settlingTime = duration;

  // Walk backwards from end to find the last time the signal was outside the band
  for (let i = data.length - 1; i >= 0; i--) {
    if (Math.abs(data[i].velocity - setpoint) > band) {
      settlingTime = (data[i].timestamp - startTime) / 1000;
      break;
    }
  }

  // ── Steady-State Error ─────────────────────────────────
  // Average absolute error in the last 20% of the run
  const tailStart = Math.floor(data.length * 0.8);
  const tailData = data.slice(tailStart);
  const steadyStateError = tailData.length > 0
    ? tailData.reduce((sum, p) => sum + Math.abs(p.velocity - setpoint), 0) / tailData.length
    : 0;

  // ── ITAE Score ─────────────────────────────────────────
  // Integral of Time × |Error| — discretised with trapezoidal rule
  let itaeScore = 0;
  for (let i = 1; i < data.length; i++) {
    const dt = (data[i].timestamp - data[i - 1].timestamp) / 1000; // seconds
    const t = (data[i].timestamp - startTime) / 1000;
    const absError = Math.abs(data[i].velocity - setpoint);
    itaeScore += t * absError * dt;
  }

  return {
    riseTime: Math.round(riseTime * 1000) / 1000,
    overshootPercent: Math.round(overshootPercent * 10) / 10,
    settlingTime: Math.round(settlingTime * 1000) / 1000,
    steadyStateError: Math.round(steadyStateError * 10000) / 10000,
    itaeScore: Math.round(itaeScore * 1000) / 1000,
    peakValue: Math.round(peakValue * 1000) / 1000,
    duration: Math.round(duration * 1000) / 1000,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Generate tuning recommendations from multiple runs
// ═══════════════════════════════════════════════════════════════

export interface RecordedRun {
  id: number;
  name: string;
  mode: string;
  kp: number;
  ki: number;
  kd: number;
  metrics: PidMetrics;
  data: TelemetryPacket[];
  recordedAt: number;
}

export function analyzeRuns(runs: RecordedRun[]): AnalysisResult | null {
  if (runs.length === 0) return null;

  // ── Score each run using weighted ITAE + penalty system ──
  // Lower score = better
  const scored = runs.map((run, index) => {
    const m = run.metrics;

    // Composite score: weighted sum of normalised metrics
    // ITAE is the primary metric; others add penalties
    let score = m.itaeScore;

    // Penalize high overshoot (control systems typically want < 10%)
    if (m.overshootPercent > 20) score += m.overshootPercent * 0.5;
    else if (m.overshootPercent > 10) score += m.overshootPercent * 0.2;

    // Penalize high steady-state error
    score += m.steadyStateError * 10;

    // Penalize very long settling times
    score += m.settlingTime * 0.3;

    return { runId: run.id, score, index };
  });

  // Sort by score (ascending = best first)
  scored.sort((a, b) => a.score - b.score);

  // Assign ranks
  const rankings = scored.map((s, rank) => ({
    runId: s.runId,
    score: Math.round(s.score * 1000) / 1000,
    rank: rank + 1,
  }));

  const bestIdx = scored[0].index;
  const bestRun = runs[bestIdx];
  const bestMetrics = bestRun.metrics;

  // ── Generate suggestions ──────────────────────────────
  const suggestions: TuningSuggestion[] = [];

  // Overshoot analysis
  if (bestMetrics.overshootPercent > 15) {
    suggestions.push({
      parameter: 'Kd',
      action: 'increase',
      reason: `Overshoot is ${bestMetrics.overshootPercent.toFixed(1)}% (>15%). Increasing Kd adds damping to reduce the peak overshoot.`,
    });
    suggestions.push({
      parameter: 'Kp',
      action: 'decrease',
      reason: `High overshoot often means Kp is too aggressive. Try reducing it by 10-20%.`,
    });
  } else if (bestMetrics.overshootPercent < 2) {
    suggestions.push({
      parameter: 'Kp',
      action: 'increase',
      reason: `Overshoot is very low (${bestMetrics.overshootPercent.toFixed(1)}%). The system may be overdamped. Increasing Kp could improve response speed.`,
    });
  } else {
    suggestions.push({
      parameter: 'General',
      action: 'keep',
      reason: `Overshoot is ${bestMetrics.overshootPercent.toFixed(1)}% — within a healthy range (2-15%).`,
    });
  }

  // Rise time analysis
  if (bestMetrics.riseTime > 2.0) {
    suggestions.push({
      parameter: 'Kp',
      action: 'increase',
      reason: `Rise time is ${bestMetrics.riseTime.toFixed(2)}s — fairly slow. Increasing Kp will make the system respond faster.`,
    });
  } else if (bestMetrics.riseTime < 0.3) {
    suggestions.push({
      parameter: 'Kp',
      action: 'decrease',
      reason: `Rise time is very fast (${bestMetrics.riseTime.toFixed(2)}s). This can cause instability. Consider reducing Kp slightly.`,
    });
  }

  // Steady-state error analysis
  if (bestMetrics.steadyStateError > 0.05) {
    suggestions.push({
      parameter: 'Ki',
      action: 'increase',
      reason: `Steady-state error is ${bestMetrics.steadyStateError.toFixed(4)} — the system isn't reaching the target precisely. Increasing Ki helps eliminate persistent error.`,
    });
  } else if (bestMetrics.steadyStateError > 0.02) {
    suggestions.push({
      parameter: 'Ki',
      action: 'increase',
      reason: `Steady-state error is moderate (${bestMetrics.steadyStateError.toFixed(4)}). A small Ki increase may help.`,
    });
  }

  // Settling time analysis
  if (bestMetrics.settlingTime > 3.0) {
    suggestions.push({
      parameter: 'Kd',
      action: 'increase',
      reason: `Settling time is ${bestMetrics.settlingTime.toFixed(2)}s — the system oscillates for a long time. More Kd (derivative) dampens oscillation.`,
    });
  }

  // Compare runs if we have multiple
  if (runs.length >= 2) {
    const worst = runs[scored[scored.length - 1].index];
    const bestKp = bestRun.kp;
    const worstKp = worst.kp;

    if (bestKp !== worstKp) {
      const direction = bestKp > worstKp ? 'higher' : 'lower';
      suggestions.push({
        parameter: 'General',
        action: 'info',
        reason: `Comparing your runs: ${direction} Kp values performed better. Best: Kp=${bestKp.toFixed(2)}, Worst: Kp=${worstKp.toFixed(2)}.`,
      });
    }
  }

  // Build overall verdict
  let verdict = `🏆 Best run: "${bestRun.name}" (Kp=${bestRun.kp.toFixed(2)}, Ki=${bestRun.ki.toFixed(2)}, Kd=${bestRun.kd.toFixed(2)})`;
  verdict += ` — ITAE: ${bestMetrics.itaeScore.toFixed(3)}`;
  verdict += `, Rise: ${bestMetrics.riseTime.toFixed(2)}s`;
  verdict += `, Overshoot: ${bestMetrics.overshootPercent.toFixed(1)}%`;
  verdict += `, Settling: ${bestMetrics.settlingTime.toFixed(2)}s`;

  if (bestMetrics.overshootPercent <= 15 && bestMetrics.settlingTime <= 2.0 && bestMetrics.steadyStateError <= 0.02) {
    verdict += `\n\n✅ This is an excellent tune! The response is fast, well-damped, and accurate.`;
  } else if (bestMetrics.overshootPercent <= 25 && bestMetrics.settlingTime <= 4.0) {
    verdict += `\n\n⚠️ Good but can be improved. See the suggestions below.`;
  } else {
    verdict += `\n\n🔧 This tune needs work. Review the suggestions below for specific adjustments.`;
  }

  return {
    bestRunIndex: bestIdx,
    bestRunId: bestRun.id,
    overallVerdict: verdict,
    suggestions,
    rankings,
  };
}
