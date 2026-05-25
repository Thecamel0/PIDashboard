import { useState } from 'react';
import type { PIDParams } from '../types';

interface PIDSlidersProps {
  onApply: (params: PIDParams) => void;
}

interface CustomPreset {
  name: string;
  mode: 'path_planning' | 'imu_locking';
  kp: number;
  ki: number;
  kd: number;
  ts?: number;
  sat?: number;
  ke?: number;
  ku?: number;
  kn?: number;
}

export default function PIDSliders({ onApply }: PIDSlidersProps) {
  // Mode selection state
  const [activeTab, setActiveTab] = useState<'path_planning' | 'imu_locking'>('path_planning');

  // Path Planning parameters
  const [kpPP, setKpPP] = useState(1.20);
  const [kiPP, setKiPP] = useState(0.05);
  const [kdPP, setKdPP] = useState(0.10);

  // IMU Locking parameters
  const [kpIMU, setKpIMU] = useState(2.00);
  const [kiIMU, setKiIMU] = useState(0.10);
  const [kdIMU, setKdIMU] = useState(0.20);
  const [tsIMU, setTsIMU] = useState(0.010);
  const [satIMU, setSatIMU] = useState(10.00);
  const [keIMU, setKeIMU] = useState(1.00);
  const [kuIMU, setKuIMU] = useState(2.00);
  const [knIMU, setKnIMU] = useState(0.50);

  // Custom Presets State
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => {
    try {
      const stored = localStorage.getItem('pid_dashboard_presets');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [selectedPreset, setSelectedPreset] = useState('load');
  const [newPresetName, setNewPresetName] = useState('');

  // Handle preset dropdown change
  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedPreset(val);

    if (activeTab === 'path_planning') {
      if (val === 'aggressive') {
        setKpPP(1.50);
        setKiPP(0.08);
        setKdPP(0.20);
      } else if (val === 'conservative') {
        setKpPP(0.80);
        setKiPP(0.02);
        setKdPP(0.05);
      } else {
        // Look up custom preset
        const custom = customPresets.find((p) => p.name === val && p.mode === 'path_planning');
        if (custom) {
          setKpPP(custom.kp);
          setKiPP(custom.ki);
          setKdPP(custom.kd);
        }
      }
    } else {
      if (val === 'aggressive') {
        setKpIMU(3.00);
        setKiIMU(0.20);
        setKdIMU(0.40);
        setTsIMU(0.005);
        setSatIMU(20.00);
        setKeIMU(2.00);
        setKuIMU(4.00);
        setKnIMU(1.00);
      } else if (val === 'conservative') {
        setKpIMU(1.00);
        setKiIMU(0.05);
        setKdIMU(0.10);
        setTsIMU(0.020);
        setSatIMU(5.00);
        setKeIMU(0.50);
        setKuIMU(1.00);
        setKnIMU(0.20);
      } else {
        const custom = customPresets.find((p) => p.name === val && p.mode === 'imu_locking');
        if (custom) {
          setKpIMU(custom.kp);
          setKiIMU(custom.ki);
          setKdIMU(custom.kd);
          setTsIMU(custom.ts ?? 0.010);
          setSatIMU(custom.sat ?? 10.00);
          setKeIMU(custom.ke ?? 1.00);
          setKuIMU(custom.ku ?? 2.00);
          setKnIMU(custom.kn ?? 0.50);
        }
      }
    }
  };

  // Reset inputs
  const handleResetParams = () => {
    if (activeTab === 'path_planning') {
      setKpPP(1.20);
      setKiPP(0.05);
      setKdPP(0.10);
    } else {
      setKpIMU(2.00);
      setKiIMU(0.10);
      setKdIMU(0.20);
      setTsIMU(0.010);
      setSatIMU(10.00);
      setKeIMU(1.00);
      setKuIMU(2.00);
      setKnIMU(0.50);
    }
    setSelectedPreset('load');
  };

  // Save preset to localStorage
  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;

    // Remove duplicates of same name + mode
    const filtered = customPresets.filter(
      (p) => !(p.name.toLowerCase() === name.toLowerCase() && p.mode === activeTab)
    );
    
    const newPreset: CustomPreset = {
      name,
      mode: activeTab,
      kp: activeTab === 'path_planning' ? kpPP : kpIMU,
      ki: activeTab === 'path_planning' ? kiPP : kiIMU,
      kd: activeTab === 'path_planning' ? kdPP : kdIMU,
      ts: activeTab === 'imu_locking' ? tsIMU : undefined,
      sat: activeTab === 'imu_locking' ? satIMU : undefined,
      ke: activeTab === 'imu_locking' ? keIMU : undefined,
      ku: activeTab === 'imu_locking' ? kuIMU : undefined,
      kn: activeTab === 'imu_locking' ? knIMU : undefined,
    };

    const updated = [...filtered, newPreset];
    setCustomPresets(updated);
    localStorage.setItem('pid_dashboard_presets', JSON.stringify(updated));
    setNewPresetName('');
    setSelectedPreset(name);
  };

  // Delete currently selected custom preset
  const handleDeletePreset = () => {
    const updated = customPresets.filter(
      (p) => !(p.name === selectedPreset && p.mode === activeTab)
    );
    setCustomPresets(updated);
    localStorage.setItem('pid_dashboard_presets', JSON.stringify(updated));
    setSelectedPreset('load');
  };

  const handleApply = () => {
    if (activeTab === 'path_planning') {
      onApply({
        mode: 'path_planning',
        kp: kpPP,
        ki: kiPP,
        kd: kdPP,
      });
    } else {
      onApply({
        mode: 'imu_locking',
        kp: kpIMU,
        ki: kiIMU,
        kd: kdIMU,
        ts: tsIMU,
        sat: satIMU,
        ke: keIMU,
        ku: kuIMU,
        kn: knIMU,
      });
    }
  };

  // Filter custom presets for dropdown based on active mode
  const filteredPresets = customPresets.filter((p) => p.mode === activeTab);
  const isCustomSelected = filteredPresets.some((p) => p.name === selectedPreset);

  return (
    <div className="panel panel-left">
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-icon">≡</span>
          CONTROLLER PARAMS
        </span>
        <div className="panel__header-actions">
          <select 
            className="preset-select" 
            value={selectedPreset} 
            onChange={handlePresetChange}
          >
            <option value="load" disabled>Load Preset</option>
            <option value="aggressive">Aggressive</option>
            <option value="conservative">Conservative</option>
            {filteredPresets.length > 0 && (
              <optgroup label="Custom Presets">
                {filteredPresets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {isCustomSelected && (
            <button 
              className="icon-btn icon-btn--danger" 
              title="Delete Preset" 
              onClick={handleDeletePreset}
              style={{ color: 'var(--red)' }}
            >
              🗑️
            </button>
          )}
          <button className="icon-btn" title="Reset" onClick={handleResetParams}>↺</button>
        </div>
      </div>

      {/* Mode selection tabs */}
      <div className="mode-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
        <button
          className={`mode-tab-btn ${activeTab === 'path_planning' ? 'mode-tab-btn--active' : ''}`}
          onClick={() => {
            setActiveTab('path_planning');
            setSelectedPreset('load');
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            background: activeTab === 'path_planning' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
            color: activeTab === 'path_planning' ? 'var(--cyan)' : 'var(--text-mid)',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 'bold',
            letterSpacing: '0.08em',
            transition: 'all 0.2s ease',
            borderBottom: activeTab === 'path_planning' ? '2px solid var(--cyan)' : '2px solid transparent'
          }}
        >
          PATH PLANNING PID
        </button>
        <button
          className={`mode-tab-btn ${activeTab === 'imu_locking' ? 'mode-tab-btn--active' : ''}`}
          onClick={() => {
            setActiveTab('imu_locking');
            setSelectedPreset('load');
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            background: activeTab === 'imu_locking' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
            color: activeTab === 'imu_locking' ? 'var(--cyan)' : 'var(--text-mid)',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 'bold',
            letterSpacing: '0.08em',
            transition: 'all 0.2s ease',
            borderBottom: activeTab === 'imu_locking' ? '2px solid var(--cyan)' : '2px solid transparent'
          }}
        >
          IMU LOCKING
        </button>
      </div>

      <div className="panel__body">
        <div className="pid-sub">
          {activeTab === 'path_planning' ? 'Path planning feedback values' : 'IMU locking & attitude control gains'}
        </div>

        {/* Save Preset Form */}
        <div className="save-preset-row">
          <input
            type="text"
            className="save-preset-input"
            placeholder="New preset name..."
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
          />
          <button
            className="save-preset-btn"
            onClick={handleSavePreset}
            disabled={!newPresetName.trim()}
          >
            💾 SAVE
          </button>
        </div>

        <div className="pid-sliders-container">
          {activeTab === 'path_planning' ? (
            <>
              {/* Kp Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Kp [PROP]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    className="pid-slider-range"
                    value={kpPP}
                    onChange={(e) => setKpPP(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kpPP}
                    onChange={(e) => setKpPP(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Ki Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Ki [INT]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.005"
                    className="pid-slider-range"
                    value={kiPP}
                    onChange={(e) => setKiPP(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kiPP}
                    onChange={(e) => setKiPP(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Kd Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Kd [DERIV]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.005"
                    className="pid-slider-range"
                    value={kdPP}
                    onChange={(e) => setKdPP(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kdPP}
                    onChange={(e) => setKdPP(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* IMU Kp Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Kp [PROP]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    className="pid-slider-range"
                    value={kpIMU}
                    onChange={(e) => setKpIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kpIMU}
                    onChange={(e) => setKpIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Ki Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Ki [INT]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.005"
                    className="pid-slider-range"
                    value={kiIMU}
                    onChange={(e) => setKiIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kiIMU}
                    onChange={(e) => setKiIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Kd Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Kd [DERIV]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.005"
                    className="pid-slider-range"
                    value={kdIMU}
                    onChange={(e) => setKdIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={kdIMU}
                    onChange={(e) => setKdIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Ts Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Ts [SAMPLE TIME]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0.001"
                    max="0.2"
                    step="0.001"
                    className="pid-slider-range"
                    value={tsIMU}
                    onChange={(e) => setTsIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.001"
                    className="pid-slider-num-input"
                    value={tsIMU}
                    onChange={(e) => setTsIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Sat Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Sat [LIMIT]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    className="pid-slider-range"
                    value={satIMU}
                    onChange={(e) => setSatIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.1"
                    className="pid-slider-num-input"
                    value={satIMU}
                    onChange={(e) => setSatIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Ke Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Ke [ESTIMATOR]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    className="pid-slider-range"
                    value={keIMU}
                    onChange={(e) => setKeIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="pid-slider-num-input"
                    value={keIMU}
                    onChange={(e) => setKeIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Ku Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Ku [ULTIMATE]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    className="pid-slider-range"
                    value={kuIMU}
                    onChange={(e) => setKuIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="pid-slider-num-input"
                    value={kuIMU}
                    onChange={(e) => setKuIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* IMU Kn Slider */}
              <div className="pid-slider-group">
                <div className="pid-slider-header">
                  <span className="pid-field__label">Kn [NOISE]</span>
                </div>
                <div className="pid-slider-controls">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.01"
                    className="pid-slider-range"
                    value={knIMU}
                    onChange={(e) => setKnIMU(parseFloat(e.target.value))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="pid-slider-num-input"
                    value={knIMU}
                    onChange={(e) => setKnIMU(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <button className="apply-btn" onClick={handleApply}>APPLY PARAMETERS</button>
      </div>
    </div>
  );
}
