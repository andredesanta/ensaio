import { resetContext } from 'kea'
import { formsPlugin } from 'kea-forms'
import { loadersPlugin } from 'kea-loaders'
import { routerPlugin } from 'kea-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'

resetContext({
    plugins: [loadersPlugin(), formsPlugin(), routerPlugin()],
})

const rootElement = document.getElementById('root')
if (rootElement === null) {
    throw new Error('Root element #root is missing from index.html')
}

createRoot(rootElement).render(
    <StrictMode>
        <App />
    </StrictMode>
)
