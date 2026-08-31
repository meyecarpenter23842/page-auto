import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installRecordRowPaintSelection } from './recordRowPaintSelection'
import { initializeTheme } from './theme'
import './styles.css'
import './iconMapping.css'
import './page-tabs/postLibraryModalLayout.css'
import './mainWorkspaceLayout.css'
import './recordRowPaintSelection.css'
import './theme.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

initializeTheme()
installRecordRowPaintSelection()

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
