import type {IncomingMessage, ServerResponse} from 'node:http';
import {AgentError, runAgent, type AgentConfig} from './agent.ts';
import type {AgentRequest} from '../src/shared/agent.ts';
import {AGENT_TIMEOUT_MS, DEFAULT_MODEL_TIMEOUT_MS} from '../src/shared/timeouts.ts';

function integerSetting(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
    if (!env[name]?.trim()) return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
}

export function configFromEnv(env: Record<string, string | undefined>): AgentConfig {
    const effort = env.OPENROUTER_REASONING_EFFORT?.trim() || 'low';
    if (effort !== 'low' && effort !== 'medium' && effort !== 'high' && effort !== 'provider') {
        throw new Error('OPENROUTER_REASONING_EFFORT must be low, medium, high, or provider.');
    }
    return {
        openRouterKey: env.OPENROUTER_API_KEY || '',
        searchKey: env.TAVILY_API_KEY || '',
        model: env.OPENROUTER_MODEL || '',
        modelTimeoutMs: integerSetting(env, 'OPENROUTER_TIMEOUT_MS', DEFAULT_MODEL_TIMEOUT_MS, 1000, 300000),
        maxCompletionTokens: integerSetting(env, 'OPENROUTER_MAX_TOKENS', 12000, 1000, 32000),
        reasoningEffort: effort,
    };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        const cleanup = () => {
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('error', onError);
            req.off('aborted', onAbort);
        };
        const onError = () => { cleanup(); reject(new AgentError(400, 'invalid_request', 'The request was interrupted. Please retry.')); };
        const onAbort = () => onError();
        const onData = (chunk: Buffer) => {
            size += chunk.length;
            if (size > 100000) {
                cleanup();
                req.resume();
                reject(new AgentError(413, 'request_too_large', 'This conversation is too long. Start a new brief.'));
            } else chunks.push(chunk);
        };
        const onEnd = () => {
            cleanup();
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new AgentError(400, 'invalid_request', 'The message could not be read. Please retry.')); }
        };
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAbort);
    });
}

export function createApiHandler(config: AgentConfig, options: {
    publicOrigin?: string;
    agent?: typeof runAgent;
} = {}) {
    const clients = new Map<string, {count: number; active: number; resetAt: number}>();
    return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = req.url?.split('?')[0];
        if (!path?.startsWith('/api/')) return next();
        if (path === '/api/health' && req.method === 'GET') {
            return sendJson(res, 200, {configured: Boolean(config.openRouterKey && config.searchKey && config.model)});
        }
        if (path !== '/api/chat') return sendJson(res, 404, {error: 'Unknown endpoint.', code: 'not_found'});
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {error: 'Use POST for chat requests.', code: 'method_not_allowed'});
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
            return sendJson(res, 415, {error: 'Send JSON messages.', code: 'unsupported_media_type'});
        }
        if (req.headers.origin) {
            let allowed = false;
            try {
                const origin = new URL(req.headers.origin);
                allowed = options.publicOrigin ? origin.origin === options.publicOrigin : origin.host === req.headers.host;
            } catch { /* Invalid origin is rejected. */ }
            if (!allowed) return sendJson(res, 403, {error: 'This origin is not allowed.', code: 'forbidden'});
        }
        const now = Date.now();
        for (const [key, client] of clients) {
            if (client.resetAt <= now && client.active === 0) clients.delete(key);
        }
        // Deliberately do not trust client-supplied X-Forwarded-For headers.
        const key = req.socket.remoteAddress || 'local';
        const client = clients.get(key) || {count: 0, active: 0, resetAt: now + 60000};
        if (client.resetAt <= now) { client.count = 0; client.resetAt = now + 60000; }
        if (client.count >= 12 || client.active >= 2 || clients.size >= 10000 && !clients.has(key)) {
            res.setHeader('Retry-After', '60');
            return sendJson(res, 429, {error: 'The desk is busy. Please retry in a minute.', code: 'rate_limited'});
        }
        client.count++;
        client.active++;
        clients.set(key, client);
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            sendJson(res, 504, {error: 'Research took too long. Please retry.', code: 'timeout'});
        }, AGENT_TIMEOUT_MS);
        const onClose = () => controller.abort();
        res.on('close', onClose);
        try {
            const request = await readJson(req);
            if (controller.signal.aborted) return;
            const response = await (options.agent || runAgent)(request as AgentRequest, config, controller.signal);
            sendJson(res, 200, response);
        } catch (error) {
            if (!controller.signal.aborted) {
                const known = error instanceof AgentError;
                sendJson(res, known ? error.status : 500, {
                    error: known ? error.message : 'The research desk hit a problem. Please retry.',
                    code: known ? error.code : 'internal_error',
                });
            }
        } finally {
            clearTimeout(timeout);
            res.off('close', onClose);
            client.active--;
        }
    };
}
