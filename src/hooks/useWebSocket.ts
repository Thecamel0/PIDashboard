import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  TelemetryPacket,
  OutgoingMessage,
  IncomingMessage,
  WsStatus,
} from '../types';

// ── Default telemetry (zero state) ──
const INITIAL_TELEMETRY: TelemetryPacket = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  velocity: 0,
  pidOutput: 0,
  setpoint: 0,
  error: 0,
  timestamp: 0,
  timer: 0,
};

/** Maximum telemetry history entries kept for graphing */
const MAX_HISTORY = 2000;

/** Seconds between reconnect attempts */
const RECONNECT_INTERVAL = 3000;

/** Seconds between keep-alive pings */
const PING_INTERVAL = 5000;

export interface UseWebSocketReturn {
  /** Current connection status */
  status: WsStatus;
  /** Latest telemetry snapshot */
  telemetry: TelemetryPacket;
  /** Rolling telemetry history ref (for zero-latency graphing) */
  historyRef: React.RefObject<TelemetryPacket[]>;
  /** Subscribe to new telemetry packets with zero React render overhead */
  subscribe: (callback: (pkt: TelemetryPacket) => void) => () => void;
  /** Send a typed command to the ESP32 */
  sendCommand: (msg: OutgoingMessage) => void;
  /** Manually open a connection to the given IP */
  connect: (ip: string) => void;
  /** Manually close the connection */
  disconnect: () => void;
  /** The IP currently connected (or last attempted) */
  connectedIp: string;
  /** Simulator mode state */
  simulatorEnabled: boolean;
  setSimulatorEnabled: (enabled: boolean) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [simulatorEnabled, setSimulatorEnabledState] = useState(() => {
    return localStorage.getItem('pid_simulator_enabled') === 'true';
  });

  const [status, setStatus] = useState<WsStatus>(() => {
    return localStorage.getItem('pid_simulator_enabled') === 'true' ? 'simulating' : 'disconnected';
  });

  const [telemetry, setTelemetry] = useState<TelemetryPacket>(INITIAL_TELEMETRY);
  const historyRef = useRef<TelemetryPacket[]>([]);
  const subscribersRef = useRef<((pkt: TelemetryPacket) => void)[]>([]);
  const [connectedIp, setConnectedIp] = useState(() => {
    return localStorage.getItem('pid_last_connected_ip') || '';
  });

  // Performance throttling refs for telemetry state updates
  const lastStateUpdateRef = useRef<number>(0);
  const latestTelemetryRef = useRef<TelemetryPacket>(INITIAL_TELEMETRY);
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs survive re-renders; keep the socket + timers here
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ipRef = useRef('');
  const manualClose = useRef(false);

  // Sync ipRef with connectedIp state
  useEffect(() => {
    ipRef.current = connectedIp;
  }, [connectedIp]);

  // Simulation loop refs to preserve state
  const simPosRef = useRef({ x: 1.2, y: 0.8, z: 0.0 });
  const simTargetRef = useRef({ x: 1.2, y: 0.8, z: 0.0 });
  const simHeadingRef = useRef(45.0);
  const simVelocityRef = useRef(0.0);
  
  // PID state variables
  const simPidParamsRef = useRef({ kp: 1.2, ki: 0.05, kd: 0.1, setpoint: 1.0 });
  const simPidPrevErrorRef = useRef(0);
  const simPidIntegralRef = useRef(0);
  const simActualOutputRef = useRef(0.0);

  // Simulated performance timer
  const simTimerRef = useRef(0.0);
  const simTimerRunningRef = useRef(false);

  // Subscribe function
  const subscribe = useCallback((callback: (pkt: TelemetryPacket) => void) => {
    subscribersRef.current.push(callback);
    return () => {
      subscribersRef.current = subscribersRef.current.filter((cb) => cb !== callback);
    };
  }, []);

  // ── Cleanup helpers ──
  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
  }, []);

  // ── Close existing socket ──
  const closeSocket = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, [clearTimers]);

  // ── Open a WebSocket to the given IP ──
  const openSocket = useCallback(
    (ip: string) => {
      closeSocket();
      manualClose.current = false;
      setConnectedIp(ip);
      localStorage.setItem('pid_last_connected_ip', ip);
      setStatus('connecting');

      const url = `ws://${ip}:81/ws`;
      console.log(`[WS] Connecting to ${url}…`);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected ✓');
        setStatus('connected');

        // Start keep-alive pings
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const msg: IncomingMessage = JSON.parse(event.data as string);

          switch (msg.type) {
            case 'TELEMETRY': {
              // Normalize — real STM32 firmware may not send 'timer' yet,
              // so default missing numeric fields to 0 to prevent crashes.
              const raw = msg.payload as Record<string, unknown>;
              const pkt: TelemetryPacket = {
                x: Number(raw.x ?? 0),
                y: Number(raw.y ?? 0),
                z: Number(raw.z ?? 0),
                heading: Number(raw.heading ?? 0),
                velocity: Number(raw.velocity ?? 0),
                pidOutput: Number(raw.pidOutput ?? 0),
                setpoint: Number(raw.setpoint ?? 0),
                error: Number(raw.error ?? 0),
                timestamp: Number(raw.timestamp ?? Date.now()),
                timer: Number(raw.timer ?? 0),
              };

              // 1. Immediately store in history
              historyRef.current.push(pkt);
              if (historyRef.current.length > MAX_HISTORY) {
                historyRef.current.shift();
              }

              // 2. Notify subscribers (e.g. PidGraphPage) instantly with zero rendering delay
              subscribersRef.current.forEach((cb) => cb(pkt));

              // 3. Throttle React state update for general UI elements
              const now = Date.now();
              latestTelemetryRef.current = pkt;
              if (now - lastStateUpdateRef.current >= 50) { // 50ms throttle (~20 FPS)
                setTelemetry(pkt);
                lastStateUpdateRef.current = now;
              } else {
                if (throttleTimeoutRef.current) {
                  clearTimeout(throttleTimeoutRef.current);
                }
                throttleTimeoutRef.current = setTimeout(() => {
                  setTelemetry(latestTelemetryRef.current);
                  lastStateUpdateRef.current = Date.now();
                }, 50);
              }
              break;
            }
            case 'ACK':
              console.log(`[WS] ACK for: ${msg.command}`);
              break;
            case 'ERROR':
              console.warn(`[WS] ESP error: ${msg.message}`);
              break;
            case 'PONG':
              // keep-alive acknowledged
              break;
            default:
              console.log('[WS] Unknown message:', msg);
          }
        } catch {
          console.warn('[WS] Non-JSON message:', event.data);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] Error', err);
        setStatus('error');
      };

      ws.onclose = () => {
        console.log('[WS] Connection closed');
        clearTimers();
        wsRef.current = null;

        if (!manualClose.current && !simulatorEnabled) {
          // Auto-reconnect
          setStatus('connecting');
          reconnectTimer.current = setTimeout(() => {
            console.log('[WS] Reconnecting…');
            openSocket(ipRef.current);
          }, RECONNECT_INTERVAL);
        } else if (simulatorEnabled) {
          setStatus('simulating');
        } else {
          setStatus('disconnected');
        }
      };
    },
    [closeSocket, clearTimers, simulatorEnabled],
  );

  // ── Public API ──
  const connect = useCallback(
    (ip: string) => {
      setSimulatorEnabledState(false);
      localStorage.setItem('pid_simulator_enabled', 'false');
      openSocket(ip);
    },
    [openSocket],
  );

  const disconnect = useCallback(() => {
    manualClose.current = true;
    closeSocket();
    setStatus('disconnected');
    setConnectedIp('');
  }, [closeSocket]);

  const setSimulatorEnabled = useCallback((enabled: boolean) => {
    setSimulatorEnabledState(enabled);
    localStorage.setItem('pid_simulator_enabled', enabled ? 'true' : 'false');
    if (enabled) {
      manualClose.current = true;
      closeSocket();
      setStatus('simulating');
    } else {
      setStatus('disconnected');
    }
  }, [closeSocket]);

  const sendCommand = useCallback((msg: OutgoingMessage) => {
    if (simulatorEnabled) {
      console.log('[SIM] Intercepted command:', msg);
      if (msg.type === 'SET_PID') {
        const payload = msg.payload;
        simPidParamsRef.current = {
          kp: payload.kp,
          ki: payload.ki,
          kd: payload.kd,
          setpoint: 1.0, // Default setpoint for simulation physics
        };
        simPidIntegralRef.current = 0;
        simPidPrevErrorRef.current = 0;
      } else if (msg.type === 'MOVE') {
        const payload = msg.payload;
        simTargetRef.current = {
          x: payload.x,
          y: payload.y,
          z: payload.z,
        };
        simTimerRef.current = 0.0;
        simTimerRunningRef.current = true;
      } else if (msg.type === 'STOP') {
        simTargetRef.current = { ...simPosRef.current };
        simPidParamsRef.current.setpoint = 0;
        simTimerRunningRef.current = false;
      }
      return;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
<<<<<<< HEAD
      let txt = '';
      if (msg.type === 'SET_PID') {
        const p = msg.payload;
        if (p.mode === 'path_planning') {
          txt = `PID TUNING, KP:${p.kp}, KI:${p.ki}, KD:${p.kd}`;
        } else {
          txt = `IMU LOCKING, KP:${p.kp}, KI:${p.ki}, KD:${p.kd}, TS:${p.ts}, SAT:${p.sat}, KE:${p.ke}, KU:${p.ku}, KN:${p.kn}`;
        }
      } else if (msg.type === 'MOVE') {
        txt = `ROBOT MOVEMENT, STATE:GO, X:${msg.payload.x.toFixed(2)}, Y:${msg.payload.y.toFixed(2)}, Angle:${msg.payload.z.toFixed(2)}`;
      } else if (msg.type === 'STOP') {
        txt = `ROBOT MOVEMENT, STATE:STOP`;
      } else if (msg.type === 'PING') {
        txt = `PING`;
      }

      ws.send(txt);
      console.log('[WS] Sent plain text command:', txt);
=======
      ws.send(JSON.stringify(msg));
      console.log('[WS] Sent:', msg.type);
>>>>>>> 5ea0336a4e09bfea1a19d0109a68806128562ad4
    } else {
      console.warn('[WS] Cannot send — not connected');
    }
  }, [simulatorEnabled]);

  // ── Browser Reconnect on Online Event ──
  useEffect(() => {
    const handleOnline = () => {
      if (ipRef.current && !manualClose.current && !simulatorEnabled && status !== 'connected') {
        console.log('[WS] Browser back online, reconnecting...');
        openSocket(ipRef.current);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [openSocket, status, simulatorEnabled]);

  // ── Simulator physics interval ──
  useEffect(() => {
    if (!simulatorEnabled) return;

    setStatus('simulating');
    clearTimers();

    const interval = setInterval(() => {
      // 1. Calculate simulated PID
      const kp = simPidParamsRef.current.kp;
      const ki = simPidParamsRef.current.ki;
      const kd = simPidParamsRef.current.kd;
      const setpoint = simPidParamsRef.current.setpoint;

      const currentVal = simActualOutputRef.current;
      const error = setpoint - currentVal;

      const dt = 0.02; // 20ms physics tick

      // Integral (with anti-windup clamping)
      simPidIntegralRef.current = Math.max(-5, Math.min(5, simPidIntegralRef.current + error * dt));

      // Derivative
      const derivative = (error - simPidPrevErrorRef.current) / dt;
      simPidPrevErrorRef.current = error;

      // PID formula
      const pidOutput = kp * error + ki * simPidIntegralRef.current + kd * derivative;

      // Physics low-pass filter: actual output slowly tracks the pidOutput drive
      const nextVal = currentVal + (pidOutput - currentVal) * 0.15;
      simActualOutputRef.current = Math.max(0, Math.min(2.5, nextVal));

      // Velocity tracks the actual output
      simVelocityRef.current = simActualOutputRef.current;

      // 2. Robot Movement Simulation towards Target
      const target = simTargetRef.current;
      const currentPos = simPosRef.current;

      const dx = target.x - currentPos.x;
      const dy = target.y - currentPos.y;
      const dz = target.z - currentPos.z;

      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 0.02) {
        const speed = simVelocityRef.current; // speed in meters per second
        const moveStep = speed * dt;

        if (moveStep >= dist) {
          simPosRef.current = { ...target };
          simTimerRunningRef.current = false;
        } else {
          simPosRef.current = {
            x: currentPos.x + (dx / dist) * moveStep,
            y: currentPos.y + (dy / dist) * moveStep,
            z: currentPos.z + (dz / dist) * moveStep,
          };
        }

        // Update heading towards target
        const targetHeadingRad = Math.atan2(dy, dx);
        let targetHeadingDeg = (targetHeadingRad * 180) / Math.PI;
        if (targetHeadingDeg < 0) targetHeadingDeg += 360;

        let diff = targetHeadingDeg - simHeadingRef.current;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        simHeadingRef.current = (simHeadingRef.current + diff * 0.2 + 360) % 360;
      } else {
        simTimerRunningRef.current = false;
      }

      // Accumulate simulator timer
      if (simTimerRunningRef.current) {
        simTimerRef.current += dt;
      }

      // Create telemetry packet
      const packet: TelemetryPacket = {
        x: Number(simPosRef.current.x.toFixed(3)),
        y: Number(simPosRef.current.y.toFixed(3)),
        z: Number(simPosRef.current.z.toFixed(3)),
        heading: Number(simHeadingRef.current.toFixed(1)),
        velocity: Number(simVelocityRef.current.toFixed(3)),
        pidOutput: Number(simActualOutputRef.current.toFixed(3)),
        setpoint: Number(setpoint.toFixed(3)),
        error: Number(error.toFixed(3)),
        timestamp: Date.now(),
        timer: Number(simTimerRef.current.toFixed(3)),
      };

      // Push to history buffer & notify subscribers immediately (50Hz)
      historyRef.current.push(packet);
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current.shift();
      }
      subscribersRef.current.forEach((cb) => cb(packet));

      // Throttle React state update to 50ms for performance
      const now = Date.now();
      latestTelemetryRef.current = packet;
      if (now - lastStateUpdateRef.current >= 50) {
        setTelemetry(packet);
        lastStateUpdateRef.current = now;
      } else {
        if (throttleTimeoutRef.current) {
          clearTimeout(throttleTimeoutRef.current);
        }
        throttleTimeoutRef.current = setTimeout(() => {
          setTelemetry(latestTelemetryRef.current);
          lastStateUpdateRef.current = Date.now();
        }, 50);
      }

    }, 20);

    return () => {
      clearInterval(interval);
    };
  }, [simulatorEnabled, clearTimers]);

  // ── Teardown on unmount ──
  useEffect(() => {
    return () => {
      manualClose.current = true;
      closeSocket();
    };
  }, [closeSocket]);

  return {
    status,
    telemetry,
    historyRef,
    subscribe,
    sendCommand,
    connect,
    disconnect,
    connectedIp,
    simulatorEnabled,
    setSimulatorEnabled,
  };
}
