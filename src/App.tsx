// App.tsx — Fully Componentized Layout with live WebSocket integration and local robot simulation
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocketContext } from './context/WebSocketContext';
import PIDSliders from './components/PIDSliders';
import SpatialTelemetry from './components/SpatialTelemetry';
import VelocityGauge from './components/VelocityGauge';
import LapTimer from './components/LapTimer';
import RobotMovement from './components/RobotMovement';
import type { PIDParams } from './types';
import './index.css';

export default function App() {
  const navigate = useNavigate();
  const [appliedParams, setAppliedParams] = useState<PIDParams | null>(null);
  const { 
    status, 
    telemetry, 
    sendCommand, 
    connect, 
    disconnect, 
    connectedIp,
    simulatorEnabled,
    setSimulatorEnabled
  } = useWebSocketContext();

  // ESP IP Input state
  const [ipInput, setIpInput] = useState('');
  const [copied, setCopied] = useState(false);

  // Sync state if already connected
  useEffect(() => {
    if (connectedIp) {
      setIpInput(connectedIp);
    }
  }, [connectedIp]);

  // Connect handler
  const handleConnectKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cleanIp = ipInput.trim();
      if (cleanIp) {
        connect(cleanIp);
      }
    }
  };

  // Disconnect / Toggle
  const handleConnectionToggle = () => {
    if (status === 'connected' || status === 'connecting' || status === 'simulating') {
      disconnect();
    } else {
      const cleanIp = ipInput.trim();
      if (cleanIp) {
        connect(cleanIp);
      } else {
        setSimulatorEnabled(true);
      }
    }
  };

  // Copy WS Address to clipboard
  const handleCopyAddress = () => {
    const cleanIp = ipInput.trim();
    if (!cleanIp) return;
    const wsUrl = `ws://${cleanIp}:81/ws`;
    navigator.clipboard.writeText(wsUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      {/* ── HEADER ── */}
      <header className="header">
        <div className="header__brand">
          <div className="header__brand-title">RBC PID TUNING DASHBOARD</div>
        </div>

        <div className="header__center">
          <div className="esp-connect">
            <label className="esp-connect__label">ESP IP</label>
            <input
              className="esp-connect__input"
              type="text"
              placeholder="192.168.x.x"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              onKeyDown={handleConnectKeyDown}
            />
            {ipInput.trim() && (
              <button 
                className={`copy-btn ${copied ? 'copy-btn--success' : ''}`}
                onClick={handleCopyAddress}
                title="Copy WS Address"
              >
                {copied ? '✓ COPIED' : '📋 COPY WS'}
              </button>
            )}
          </div>
        </div>

        <div className="header__right">
          <button className="header__nav-btn" onClick={() => navigate('/pid-graph')}>▐▐ PID GRAPH</button>

          {/* Simulator Toggle Button */}
          <button 
            className={`sim-toggle-btn ${simulatorEnabled ? 'sim-toggle-btn--active' : ''}`}
            onClick={() => setSimulatorEnabled(!simulatorEnabled)}
            title="Toggle Simulator Mode"
          >
            <span className="sim-toggle-btn__dot" />
            {simulatorEnabled ? 'SIMULATOR ON' : 'SIMULATOR OFF'}
          </button>
          
          <button 
            className={`ws-pill-btn ws-pill ${
              status === 'connected' 
                ? 'ws-pill--connected' 
                : status === 'connecting' 
                ? 'ws-pill--connecting' 
                : status === 'simulating'
                ? 'ws-pill--simulating'
                : ''
            }`}
            onClick={handleConnectionToggle}
          >
            <span className="ws-pill__dot" />
            {status === 'connected' 
              ? 'WS ONLINE' 
              : status === 'connecting' 
              ? 'WS CONNECTING' 
              : status === 'simulating'
              ? 'SIMULATING'
              : 'WS OFFLINE'}
          </button>
        </div>
      </header>

      {/* ── MAIN GRID ── */}
      <main className="dashboard">

        {/* ════ LEFT — CONTROLLER PARAMS ════ */}
        <PIDSliders
          onApply={(params) => {
            setAppliedParams(params);
            sendCommand({ type: 'SET_PID', payload: params });
          }}
        />

        {/* ════ CENTRE — TELEMETRY + MOVEMENT ════ */}
        <div className="panel-centre">
          <SpatialTelemetry telemetry={telemetry} status={status} />
          <RobotMovement
            status={status}
            onGo={(coords) => sendCommand({ type: 'MOVE', payload: coords })}
          />
        </div>

        {/* ════ RIGHT — VELOCITY + TIMER ════ */}
        <div className="panel panel-right">
          <VelocityGauge value={telemetry.velocity} />
          <LapTimer status={status} telemetry={telemetry} appliedParams={appliedParams} />
        </div>

      </main>
    </>
  );
}