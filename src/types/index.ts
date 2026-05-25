// ── Types: shape of all data flowing in/out of the ESP32 WebSocket ──

/** Live telemetry streamed from the ESP32 */
export interface TelemetryPacket {
  /** X-axis position in metres */
  x: number;
  /** Y-axis position in metres */
  y: number;
  /** Z-axis position in metres */
  z: number;
  /** Heading / angle in degrees */
  heading: number;
  /** Current velocity in m/s */
  velocity: number;
  /** PID output (process variable) — used for graphing */
  pidOutput: number;
  /** Current setpoint the PID is tracking */
  setpoint: number;
  /** PID error (setpoint − pidOutput) */
  error: number;
  /** Millisecond timestamp from the ESP32 */
  timestamp: number;
  /** Elapsed run time in seconds sent from STM32 (optional — older firmware may omit) */
  timer: number;
}

export interface PathPlanningPIDParams {
  mode: 'path_planning';
  kp: number;
  ki: number;
  kd: number;
}

export interface IMULockingParams {
  mode: 'imu_locking';
  kp: number;
  ki: number;
  kd: number;
  ts: number;
  sat: number;
  ke: number;
  ku: number;
  kn: number;
}

/** PID gain parameters sent to the ESP32 */
export type PIDParams = PathPlanningPIDParams | IMULockingParams;

/** Target coordinates for robot movement */
export interface MoveCommand {
  x: number;
  y: number;
  z: number;
}

/** A-B performance run record */
export interface RunRecord {
  id: number;
  name: string;
  params: string;
  time: string;
}

/**
 * Commands the dashboard can send to the ESP32.
 * Each command is a JSON message with a `type` discriminator.
 */
export type OutgoingMessage =
  | { type: 'SET_PID'; payload: PIDParams }
  | { type: 'MOVE'; payload: MoveCommand }
  | { type: 'STOP' }
  | { type: 'PING' };

/**
 * Messages the ESP32 can send back to the dashboard.
 * Note: TELEMETRY uses Omit so older firmware that omits 'timer' is still valid.
 */
export type IncomingMessage =
  | { type: 'TELEMETRY'; payload: Omit<TelemetryPacket, 'timer'> & { timer?: number } }
  | { type: 'ACK'; command: string }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG' };

/** WebSocket connection status */
export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'simulating';
