// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest';
import {runAgent, type AgentConfig} from './agent';
import {DEFAULT_MODEL_TIMEOUT_MS} from '../src/shared/timeouts';
import {clarificationFixture, requestFixture} from '../src/test/fixtures';

const config: AgentConfig = {
    openRouterKey: 'test-key', searchKey: 'test-search-key', model: 'deepseek/deepseek-v4-flash-20260731',
};
const completion = JSON.stringify({choices: [{message: {content: JSON.stringify(clarificationFixture)}, finish_reason: 'stop'}]});
const encoder = new TextEncoder();
const deps = (fetchMock: typeof fetch) => ({fetch: fetchMock, now: () => new Date('2026-09-16T22:52:56Z')});
afterEach(() => vi.useRealTimers());

// Real response-body streams reproduce the failure: headers can arrive quickly while
// OpenRouter keeps the body open during reasoning. Advancing timers avoids slow tests.
function delayedBody(delayMs: number) {
    return vi.fn<typeof fetch>(async (_url, options) => {
        const signal = options?.signal;
        return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('  ')); // JSON keepalive whitespace
                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', abort);
                    controller.enqueue(encoder.encode(completion));
                    controller.close();
                }, delayMs);
                const abort = () => { clearTimeout(timer); controller.error(signal?.reason); };
                signal?.addEventListener('abort', abort, {once: true});
            },
        }), {headers: {'Content-Type': 'application/json'}});
    });
}

function sseResponse(events: unknown[], done = true) {
    const text = ': keepalive\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
        + (done ? 'data: [DONE]\r\n\r\n' : '');
    const bytes = encoder.encode(text);
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            // Split transport chunks inside UTF-8 characters and event delimiters.
            for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
            controller.close();
        },
    }), {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}});
}

describe('reasoning provider compatibility', () => {
    it('allows a JSON response body to finish after the old 45-second cutoff', async () => {
        vi.useFakeTimers();
        const fetchMock = delayedBody(70_000);
        const pending = runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock));
        const checked = expect(pending).resolves.toEqual(clarificationFixture);
        await vi.advanceTimersByTimeAsync(45_000);
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(25_000);
        await checked;
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body).toMatchObject({model: config.model, stream: false, max_tokens: 12000, reasoning: {effort: 'low'}});
    });

    it('labels a deadline during body reading as a timeout, not unreadable JSON', async () => {
        vi.useFakeTimers();
        const fetchMock = delayedBody(DEFAULT_MODEL_TIMEOUT_MS + 1000);
        const checked = expect(runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock)))
            .rejects.toMatchObject({status: 504, code: 'model_timeout'});
        await vi.advanceTimersByTimeAsync(DEFAULT_MODEL_TIMEOUT_MS);
        await checked;
        expect(fetchMock).toHaveBeenCalledTimes(1); // No automatic paid retry of an aborted generation.
    });

    it('also labels a timeout before headers and honors a configured deadline', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {once: true});
        }));
        const checked = expect(runAgent(requestFixture, {...config, modelTimeoutMs: 1000}, new AbortController().signal, deps(fetchMock)))
            .rejects.toMatchObject({status: 504, code: 'model_timeout'});
        await vi.advanceTimersByTimeAsync(1000);
        await checked;
    });

    it('preserves user cancellation while reading the body', async () => {
        vi.useFakeTimers();
        const fetchMock = delayedBody(70_000);
        const controller = new AbortController();
        const stopped = new Error('user stopped the request');
        const checked = expect(runAgent(requestFixture, config, controller.signal, deps(fetchMock))).rejects.toBe(stopped);
        await vi.advanceTimersByTimeAsync(100);
        controller.abort(stopped);
        await checked;
    });

    it('assembles unexpected SSE answer deltas without exposing reasoning or keepalives', async () => {
        const json = JSON.stringify(clarificationFixture);
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([
            {choices: [{index: 0, delta: {reasoning: 'Synthetic private reasoning that must not appear in the answer.'}, finish_reason: null}]},
            {choices: [{index: 0, delta: {content: json.slice(0, 40)}, finish_reason: null}]},
            {choices: [{index: 0, delta: {content: json.slice(40)}, finish_reason: 'stop'}]},
            {choices: [], usage: {completion_tokens: 2444}},
        ]));
        expect(await runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock))).toEqual(clarificationFixture);
    });

    it('rejects interrupted SSE even if the partial content happens to be valid JSON', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([
            {choices: [{delta: {content: JSON.stringify(clarificationFixture)}, finish_reason: null}]},
        ], false));
        await expect(runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock)))
            .rejects.toMatchObject({code: 'model_incomplete'});
    });

    it.each(['json', 'sse'])('reports exhausted reasoning/output budget in %s without a format-repair loop', async format => {
        const choice = {message: {content: null, reasoning: 'Synthetic reasoning only'}, delta: {reasoning: 'Synthetic reasoning only'}, finish_reason: 'length'};
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(format === 'sse'
            ? sseResponse([{choices: [choice]}]) : new Response(JSON.stringify({choices: [choice]})));
        await expect(runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock)))
            .rejects.toMatchObject({code: 'model_output_limit'});
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['json', 'sse'])('redacts provider errors returned with HTTP 200 in %s', async format => {
        const error = {error: {code: 500, message: 'private upstream details and test-key'}};
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(format === 'sse' ? sseResponse([error]) : new Response(JSON.stringify(error)));
        const pending = runAgent(requestFixture, config, new AbortController().signal, deps(fetchMock));
        await expect(pending).rejects.toMatchObject({code: 'model_provider_error'});
        await expect(pending).rejects.not.toThrow('private upstream');
    });

    it('keeps malformed JSON distinct from a timeout, and diagnoses a missing final answer', async () => {
        const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'));
        await expect(runAgent(requestFixture, config, new AbortController().signal, deps(invalid))).rejects.toMatchObject({code: 'model_invalid'});
        const empty = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({choices: [{message: {content: null}, finish_reason: 'stop'}]})));
        await expect(runAgent(requestFixture, config, new AbortController().signal, deps(empty))).rejects.toMatchObject({code: 'model_empty_response'});
    });

    it('can retain provider-default reasoning and override the completion budget', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(completion));
        await runAgent(requestFixture, {...config, reasoningEffort: 'provider', maxCompletionTokens: 16000}, new AbortController().signal, deps(fetchMock));
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body).not.toHaveProperty('reasoning');
        expect(body.max_tokens).toBe(16000);
    });
});
