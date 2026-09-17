import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initializeTheme } from './theme'
import './styles.css'
import './iconMapping.css'
import './page-tabs/postLibraryModalLayout.css'
import './mainWorkspaceLayout.css'
import './theme.css'
import './darkThemeCoverage.css'
import './accounts/accountTableSelection.css'
import './zalo/zaloBatchPanel.css'

const root = document.getElementById('root')

if (!root) throw new Error('Renderer root element was not found')

initializeTheme()

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
