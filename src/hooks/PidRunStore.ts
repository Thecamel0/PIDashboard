// ═══════════════════════════════════════════════════════════════
//  PID Run Store — Persist recorded runs in localStorage
// ═══════════════════════════════════════════════════════════════

import type { TelemetryPacket, PIDParams } from '../types';
import { computeMetrics } from '../utils/pidAnalysis';
import type { RecordedRun, PidMetrics } from '../utils/pidAnalysis';

const STORAGE_KEY = 'pid_dashboard_recorded_runs';
const MAX_STORED_RUNS = 50;

// Re-export for convenience
export type { RecordedRun, PidMetrics };

/** Serialisable version (telemetry arrays stored compactly) */
interface StoredRun {
  id: number;
  name: string;
  mode: string;
  kp: number;
  ki: number;
  kd: number;
  metrics: PidMetrics;
  /** Compact telemetry: only the fields we need for chart overlay */
  data: {
    t: number[];   // timestamps
    sp: number[];   // setpoint
    v: number[];    // velocity (actual output)
    e: number[];    // error
  };
  recordedAt: number;
}

// ═══════════════════════════════════════════════════════════════
//  Load / Save
// ═══════════════════════════════════════════════════════════════

function loadStored(): StoredRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStored(runs: StoredRun[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch (e) {
    console.warn('[PidRunStore] Failed to save:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
//  Compact / Expand helpers
// ═══════════════════════════════════════════════════════════════

function compactData(data: TelemetryPacket[]): StoredRun['data'] {
  // Downsample if too many points (keep at most 500 for storage)
  const maxPts = 500;
  let sampled = data;
  if (data.length > maxPts) {
    const step = data.length / maxPts;
    sampled = [];
    for (let i = 0; i < maxPts; i++) {
      sampled.push(data[Math.floor(i * step)]);
    }
    // Always include the last point
    sampled.push(data[data.length - 1]);
  }

  return {
    t: sampled.map(p => p.timestamp),
    sp: sampled.map(p => p.setpoint),
    v: sampled.map(p => p.velocity),
    e: sampled.map(p => p.error),
  };
}

function expandData(compact: StoredRun['data']): TelemetryPacket[] {
  return compact.t.map((t, i) => ({
    x: 0, y: 0, z: 0, heading: 0,
    velocity: compact.v[i],
    pidOutput: compact.v[i],
    setpoint: compact.sp[i],
    error: compact.e[i],
    timestamp: t,
    timer: 0,
  }));
}

// ═══════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════

/** Get all recorded runs (expanded to full TelemetryPacket arrays) */
export function getRecordedRuns(): RecordedRun[] {
  const stored = loadStored();
  return stored.map(s => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    kp: s.kp,
    ki: s.ki,
    kd: s.kd,
    metrics: s.metrics,
    data: expandData(s.data),
    recordedAt: s.recordedAt,
  }));
}

/** Record a new run from telemetry data + PID params */
export function recordRun(
  data: TelemetryPacket[],
  params: PIDParams | null,
  runName?: string,
): RecordedRun {
  const metrics = computeMetrics(data);
  const stored = loadStored();
  const runIndex = stored.length + 1;

  const run: StoredRun = {
    id: Date.now(),
    name: runName || `Run ${runIndex}`,
    mode: params?.mode ?? 'path_planning',
    kp: params?.kp ?? 0,
    ki: params?.ki ?? 0,
    kd: params?.kd ?? 0,
    metrics,
    data: compactData(data),
    recordedAt: Date.now(),
  };

  // Prepend (newest first) and limit
  const updated = [run, ...stored].slice(0, MAX_STORED_RUNS);
  saveStored(updated);

  return {
    id: run.id,
    name: run.name,
    mode: run.mode,
    kp: run.kp,
    ki: run.ki,
    kd: run.kd,
    metrics: run.metrics,
    data: expandData(run.data),
    recordedAt: run.recordedAt,
  };
}

/** Delete a run by ID */
export function deleteRun(id: number) {
  const stored = loadStored();
  saveStored(stored.filter(r => r.id !== id));
}

/** Clear all recorded runs */
export function clearAllRuns() {
  saveStored([]);
}
