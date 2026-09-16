// @vitest-environment node
import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createApiHandler, configFromEnv} from './http';
import {AgentError} from './agent';
import {clarificationFixture, requestFixture} from '../src/test/fixtures';

const servers: Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
        server.closeAllConnections(); server.close(() => resolve());
    })));
});
async function start(agent = vi.fn().mockResolvedValue(clarificationFixture)) {
    const handler = createApiHandler({openRouterKey: 'private-model-key', searchKey: 'private-search-key', model: 'test/model'}, {agent});
    const server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404).end(); }); });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    return {url: `http://127.0.0.1:${address.port}`, agent};
}
const post = (url: string, body: string = JSON.stringify(requestFixture), headers = {}) => fetch(`${url}/api/chat`, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body,
});

describe('server API boundary', () => {
    it('serves health without leaking credentials and ignores legacy browser key names', async () => {
        const {url} = await start();
        const health = await fetch(`${url}/api/health`);
        expect(await health.json()).toEqual({configured: true});
        expect(health.headers.get('cache-control')).toBe('no-store');
        expect(configFromEnv({VITE_OPENROUTER_API_KEY: 'unsafe'}).openRouterKey).toBe('');
        const response = await post(url);
        expect(await response.json()).toEqual(clarificationFixture);
    });

    it('rejects malformed, oversized, cross-origin, and non-JSON requests before invoking the agent', async () => {
        const {url, agent} = await start();
        expect((await post(url, '{bad')).status).toBe(400);
        expect((await post(url, JSON.stringify({text: 'x'.repeat(100001)}))).status).toBe(413);
        expect((await post(url, undefined, {Origin: 'https://elsewhere.example'})).status).toBe(403);
        expect((await post(url, undefined, {'Content-Type': 'text/plain'})).status).toBe(415);
        expect((await fetch(`${url}/api/chat`)).status).toBe(405);
        expect(agent).not.toHaveBeenCalled();
    });

    it('returns known failures but redacts unexpected upstream errors', async () => {
        const agent = vi.fn().mockRejectedValueOnce(new AgentError(502, 'research_unavailable', 'Current research is unavailable.'))
            .mockRejectedValueOnce(new Error('secret api key: never reveal this'));
        const {url} = await start(agent);
        const known = await post(url);
        expect(known.status).toBe(502);
        expect(await known.json()).toMatchObject({code: 'research_unavailable'});
        const unexpected = await post(url);
        expect(unexpected.status).toBe(500);
        expect(await unexpected.text()).not.toContain('secret');
    });

    it('limits paid requests without trusting forwarded IP headers', async () => {
        const {url, agent} = await start();
        for (let i = 0; i < 12; i++) expect((await post(url)).status).toBe(200);
        const limited = await post(url, undefined, {'X-Forwarded-For': '198.51.100.7'});
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
        expect(agent).toHaveBeenCalledTimes(12);
    });

    it('propagates browser cancellation to the agent', async () => {
        let signal: AbortSignal | undefined;
        let started: () => void = () => {};
        const ready = new Promise<void>(resolve => { started = resolve; });
        const agent = vi.fn((_request, _config, abort: AbortSignal) => new Promise((resolve, reject) => {
            signal = abort;
            abort.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
            started();
            void resolve;
        }));
        const {url} = await start(agent);
        const controller = new AbortController();
        const pending = fetch(`${url}/api/chat`, {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestFixture), signal: controller.signal}).catch(() => null);
        await ready;
        controller.abort();
        await pending;
        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    });
});
