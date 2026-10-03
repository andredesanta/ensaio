import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        // Product source lives outside frontend/, so resolve its bare imports
        // from this shell's single dependency installation.
        dedupe: ['kea', 'kea-forms', 'kea-loaders', 'kea-router', 'react', 'react-dom'],
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            '/api': 'http://127.0.0.1:8000',
        },
    },
})
