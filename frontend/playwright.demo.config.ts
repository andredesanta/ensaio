import { defineConfig } from '@playwright/test'

import smokeConfig from './playwright.config'

export default defineConfig({
    ...smokeConfig,
    outputDir: 'demo-output',
    reporter: 'list',
    retries: 0,
    use: {
        ...smokeConfig.use,
        launchOptions: {
            slowMo: 450,
        },
        video: {
            mode: 'on',
            size: { width: 1280, height: 720 },
        },
        viewport: { width: 1280, height: 720 },
    },
})
