import { useState } from 'react';
import type { WsStatus } from '../types';

interface RobotMovementProps {
  status: WsStatus;
  onGo: (coords: { x: number; y: number; z: number }) => void;
}

export default function RobotMovement({ status, onGo }: RobotMovementProps) {
  const [moveX, setMoveX] = useState('0.00');
  const [moveY, setMoveY] = useState('0.00');
  const [moveZ, setMoveZ] = useState('0.00');

  const handleGo = () => {
    onGo({
      x: parseFloat(moveX) || 0,
      y: parseFloat(moveY) || 0,
      z: parseFloat(moveZ) || 0,
    });
  };

  return (
    <div className="centre-bottom">
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-icon">⊕</span>
          ROBOT MOVEMENT
        </span>
        <span className="panel__status">
          {status === 'connected' ? '● ONLINE' : '● IDLE'}
        </span>
      </div>

      <div className="panel__body">
        <div className="setpoint-label" style={{ marginBottom: 12 }}>TARGET COORDINATES</div>
        <div className="movement-grid">
          {[
            { ax: 'X-AXIS', val: moveX, setVal: setMoveX },
            { ax: 'Y-AXIS', val: moveY, setVal: setMoveY },
<<<<<<< HEAD
            { ax: 'ROBOT ANGLE', val: moveZ, setVal: setMoveZ },
=======
            { ax: 'Z-AXIS', val: moveZ, setVal: setMoveZ },
>>>>>>> 5ea0336a4e09bfea1a19d0109a68806128562ad4
          ].map(({ ax, val, setVal }) => (
            <div className="move-field" key={ax}>
              <label className="move-field__label">{ax}</label>
              <input
                className="move-field__input"
                value={val}
                onChange={(e) => setVal(e.target.value)}
              />
            </div>
          ))}
        </div>
        <button className="go-btn" onClick={handleGo}>GO</button>
      </div>
    </div>
  );
}
