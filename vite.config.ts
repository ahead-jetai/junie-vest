import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
import {loadEnv, type Plugin} from 'vite'
import {configFromEnv, createApiHandler} from './server/http'

function researchApi(mode: string): Plugin {
    const config = {...loadEnv(mode, process.cwd(), ''), ...process.env};
    return {
        name: 'junievest-research-api',
        configureServer(server) {
            server.middlewares.use(createApiHandler(configFromEnv(config), {publicOrigin: config.PUBLIC_ORIGIN}));
        },
        configurePreviewServer(server) {
            server.middlewares.use(createApiHandler(configFromEnv(config), {publicOrigin: config.PUBLIC_ORIGIN}));
        },
    };
}

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
    plugins: [react(), researchApi(mode)],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        exclude: ['node_modules/**', 'dist/**', 'dist-server/**', 'e2e/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            exclude: [
                'node_modules/',
                'src/test/',
                '**/*.d.ts',
                '**/*.config.*',
                'dist/',
                'coverage/',
                '**/*.test.*',
                '**/*.spec.*'
            ],
            include: [
                'src/**/*.{ts,tsx}'
            ],
            thresholds: {
                global: {
                    branches: 80,
                    functions: 80,
                    lines: 80,
                    statements: 80
                }
            }
        }
    },
}))
