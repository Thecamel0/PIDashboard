import { useState, useEffect, useRef } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { recordRun } from '../hooks/PidRunStore';
import type { WsStatus, TelemetryPacket, PIDParams } from '../types';

interface LapTimerProps {
  status: WsStatus;
  telemetry: TelemetryPacket;
  appliedParams: PIDParams | null;
}

interface RunItem {
  id: number;
  name: string;
  params: string;
  time: number; // in seconds
}

export default function LapTimer({ status, telemetry, appliedParams }: LapTimerProps) {
  const { getHistorySnapshot } = useWebSocketContext();

  const [runs, setRuns] = useState<RunItem[]>(() => {
    try {
      const stored = localStorage.getItem('pid_dashboard_runs');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Save runs to local storage
  useEffect(() => {
    localStorage.setItem('pid_dashboard_runs', JSON.stringify(runs));
  }, [runs]);

  const timerVal = telemetry.timer ?? 0;
  const isOnline = status === 'connected' || status === 'simulating';

  const lastTimerRef = useRef(0);
  const peakTimerRef = useRef(0);
  const isRunActiveRef = useRef(false);
  const lastActiveTimeRef = useRef(0);

  // Auto-detect runs based on STM32 timer ticks
  useEffect(() => {
    if (!isOnline) {
      isRunActiveRef.current = false;
      peakTimerRef.current = 0;
      return;
    }

    // 1. Reset detection: timer goes back to exactly 0
    if (timerVal === 0) {
      if (isRunActiveRef.current && peakTimerRef.current > 0.1) {
        saveRun(peakTimerRef.current);
      }
      isRunActiveRef.current = false;
      peakTimerRef.current = 0;
    } else {
      // timerVal > 0
      if (timerVal > lastTimerRef.current) {
        // Timer is increasing: run is active
        isRunActiveRef.current = true;
        peakTimerRef.current = Math.max(peakTimerRef.current, timerVal);
        lastActiveTimeRef.current = Date.now();
      } else if (timerVal === lastTimerRef.current) {
        // Timer is stationary: check if it has been finished for 1s
        if (isRunActiveRef.current) {
          const idleDuration = Date.now() - lastActiveTimeRef.current;
          if (idleDuration > 1000) {
            saveRun(peakTimerRef.current);
            isRunActiveRef.current = false;
            peakTimerRef.current = 0;
          }
        }
      } else if (timerVal < lastTimerRef.current - 0.05) {
        // Timer decreased without hitting exactly 0 (e.g. STM32 new run trigger)
        if (isRunActiveRef.current && peakTimerRef.current > 0.1) {
          saveRun(peakTimerRef.current);
        }
        // Start tracking next run immediately
        peakTimerRef.current = timerVal;
        isRunActiveRef.current = true;
        lastActiveTimeRef.current = Date.now();
      }
    }

    lastTimerRef.current = timerVal;
  }, [timerVal, isOnline]);

  const saveRun = (runTime: number) => {
    let paramStr = 'Active parameters';
    if (appliedParams) {
      if (appliedParams.mode === 'path_planning') {
        paramStr = `PP: Kp=${appliedParams.kp.toFixed(2)} Ki=${appliedParams.ki.toFixed(2)} Kd=${appliedParams.kd.toFixed(2)}`;
      } else {
        paramStr = `IMU: Kp=${appliedParams.kp.toFixed(2)} Ki=${appliedParams.ki.toFixed(2)} Kd=${appliedParams.kd.toFixed(2)} Ts=${appliedParams.ts.toFixed(3)} Sat=${appliedParams.sat.toFixed(1)}`;
      }
    }

    setRuns((prev) => {
      const newRun: RunItem = {
        id: Date.now(),
        name: `Run ${prev.length + 1}`,
        params: paramStr,
        time: runTime,
      };
      
      // Auto-record the run telemetry for AI analysis
      recordRun(getHistorySnapshot(), appliedParams, newRun.name);
      
      return [newRun, ...prev];
    });
  };

  const handleClearRuns = () => {
    setRuns([]);
  };

  // Recalculate stats dynamically based on the runs array
  const times = runs.map((r) => r.time);
  const bestTime = times.length > 0 ? Math.min(...times) : 0;
  const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  return (
    <div className="timer-section">
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-icon">◷</span>
          Timer
        </span>
        <div className="panel__header-actions">
          <button 
            onClick={handleClearRuns} 
            className="clear-runs-btn"
            style={{ 
              background: 'transparent', 
              color: 'var(--red)', 
              border: '1px solid var(--border)', 
              fontFamily: 'var(--mono)', 
              fontSize: '10px', 
              padding: '2px 8px', 
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            Clear List
          </button>
        </div>
      </div>

      <div className="timer-display">
        <div className="timer-value">
          {timerVal.toFixed(3)}
          <span className="timer-unit">s</span>
        </div>
        <div className="timer-state">
          <span style={{ color: isRunActiveRef.current ? 'var(--green)' : 'var(--amber)' }}>●</span>
          {isRunActiveRef.current ? 'RECORDING RUN PERFORMANCE (LIVE)' : 'WAITING FOR STM32 TRIGGER'}
        </div>
      </div>

      <div className="timer-stats" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="stat-cell">
          <div className="stat-cell__label">✦ BEST RUN</div>
          <div className="stat-cell__value">{bestTime > 0 ? `${bestTime.toFixed(3)}s` : '—'}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">AVERAGE RUN</div>
          <div className="stat-cell__value">{avgTime > 0 ? `${avgTime.toFixed(3)}s` : '—'}</div>
        </div>
      </div>

      <div className="run-list">
        {runs.map((run) => (
          <div className="run-item" key={run.id}>
            <div className="run-item__info">
              <div className="run-item__name">{run.name}</div>
              <div className="run-item__params">{run.params}</div>
            </div>
            <div className="run-item__time">{run.time.toFixed(3)}s</div>
          </div>
        ))}
      </div>
    </div>
  );
}
