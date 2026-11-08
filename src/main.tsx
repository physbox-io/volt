import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { setSuiteParameterPusher } from '@physbox-io/ui'
import { syncCloudParameters } from './utils/apiClient'

setSuiteParameterPusher((p) => void syncCloudParameters('global', p))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
