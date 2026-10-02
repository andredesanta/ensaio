import { resetContext } from 'kea'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'

// Kea keeps feature state. React only renders it. resetContext() builds the
// store once, before any component mounts. M3 will pass kea-router and
// kea-loaders in `plugins`.
resetContext({
    plugins: [],
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
