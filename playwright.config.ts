import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    workers: 2,
    reporter: [['list'], ['html', {open: 'never'}]],
    use: {
        baseURL: 'http://127.0.0.1:5173',
        trace: 'retain-on-failure',
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
    },
    projects: [
        {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 1000}}},
        {name: 'mobile', use: {...devices['Desktop Chrome'], viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
    ],
    webServer: {command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI},
});
