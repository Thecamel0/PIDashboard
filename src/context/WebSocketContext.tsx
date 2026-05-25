import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { UseWebSocketReturn } from '../hooks/useWebSocket';

const WebSocketContext = createContext<UseWebSocketReturn | undefined>(undefined);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ws = useWebSocket();
  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};
