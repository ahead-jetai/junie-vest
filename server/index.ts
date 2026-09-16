import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {configFromEnv, createApiHandler} from './http.ts';
import {CLIENT_TIMEOUT_MS} from '../src/shared/timeouts.ts';

const config = configFromEnv(process.env);
const api = createApiHandler(config, {publicOrigin: process.env.PUBLIC_ORIGIN});
const root = resolve('dist');
const mime: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
    void api(req, res, () => {
        void (async () => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, {Allow: 'GET, HEAD'}).end();
                return;
            }
            try {
                const path = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
                const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
                if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
                const data = await readFile(file);
                res.writeHead(200, {
                    'Content-Type': mime[extname(file)] || 'application/octet-stream',
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
                });
                res.end(req.method === 'HEAD' ? undefined : data);
            } catch { res.writeHead(404).end('Not found'); }
        })();
    });
});
server.requestTimeout = CLIENT_TIMEOUT_MS;
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
    console.info(`JunieVest listening on port ${process.env.PORT || 3000}. Research ${config.openRouterKey && config.searchKey && config.model ? 'connected' : 'not configured'}.`);
});
