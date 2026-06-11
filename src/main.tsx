import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import PidGraphPage from './PidGraphPage.tsx'
import AiTuningPage from './AiTuningPage.tsx'
import { WebSocketProvider } from './context/WebSocketContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebSocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/pid-graph" element={<PidGraphPage />} />
          <Route path="/ai-tuning" element={<AiTuningPage />} />
        </Routes>
      </BrowserRouter>
    </WebSocketProvider>
  </StrictMode>,
)
