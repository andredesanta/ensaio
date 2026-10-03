import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    retries: process.env.CI === 'true' ? 2 : 0,
    reporter: process.env.CI === 'true' ? 'github' : 'list',
    use: {
        baseURL: 'http://127.0.0.1:5173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ...devices['Desktop Chrome'],
    },
    webServer: {
        command: 'corepack pnpm dev --host 127.0.0.1',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: process.env.CI !== 'true',
        timeout: 30_000,
    },
})
