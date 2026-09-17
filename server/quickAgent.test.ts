// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {runAgent, type AgentConfig} from './agent';
import {requestFixture, briefFixture, clarificationFixture} from '../src/test/fixtures';
import type {AgentRequest} from '../src/shared/agent';

const config: AgentConfig = {openRouterKey: 'private-key', searchKey: 'search-key', model: 'reasoning/model', fastModel: 'fast/model'};
const request: AgentRequest = {...requestFixture, mode: undefined, messages: [{role: 'user', content: 'Should I invest in SpaceX today?'}]};
const results = [
    {title: 'Official disclosure', url: 'https://example.com/disclosure', content: 'Transfer restrictions. '.repeat(100)},
    {title: 'Broker terms', url: 'https://example.org/terms', content: 'No assured secondary market. '.repeat(100)},
];
const envelope = (content: unknown) => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}]}));
const now = () => new Date('2026-09-16T12:00:00Z');
const isModel = (url: unknown) => String(url).includes('openrouter.ai');

function harness(modelOutputs: unknown[] = [briefFixture]) {
    const queue = [...modelOutputs];
    const fetch = vi.fn<typeof globalThis.fetch>(async url => isModel(url)
        ? envelope(queue.shift()) : new Response(JSON.stringify({results})));
    return {fetch, run: (input = request) => runAgent(input, config, new AbortController().signal, {fetch, now})};
}

describe('quick research path', () => {
    it('defaults to two fresh parallel searches and one answer call, without a planner or separate reviewer', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const stages: string[] = [];
        const fetch = vi.fn<typeof globalThis.fetch>(async url => {
            if (isModel(url)) return envelope(briefFixture);
            await gate;
            return new Response(JSON.stringify({results}));
        });
        const pending = runAgent(request, config, new AbortController().signal, {fetch, now, recordTiming: stage => { stages.push(stage); }});
        // Both requests must have started before either search returns.
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(fetch.mock.calls.every(([url]) => String(url).includes('tavily'))).toBe(true);
        release();
        const response = await pending;
        expect(response).toMatchObject({kind: 'decision', verdict: 'no'});
        expect(fetch).toHaveBeenCalledTimes(3);
        const searches = fetch.mock.calls.slice(0, 2).map(([, options]) => JSON.parse(String(options?.body)));
        expect(searches[0]).toMatchObject({search_depth: 'fast', max_results: 3, time_range: 'week'});
        expect(searches[1]).not.toHaveProperty('time_range');
        expect(JSON.stringify(searches)).not.toContain('$10,000');
        const body = JSON.parse(String(fetch.mock.calls[2][1]?.body));
        expect(body).toMatchObject({model: 'fast/model', reasoning: {effort: 'none'}, max_tokens: 1800, provider: {sort: 'latency'}});
        const input = JSON.parse(body.messages[1].content);
        expect(input.evidence.every((source: {content: string}) => source.content.length <= 1000)).toBe(true);
        expect(input.context).toEqual(request.context);
        expect(stages).toEqual(['search', 'answer']);
    });

    it('returns simple clarifications with zero provider calls, even before setup', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        const response = await runAgent({...request, messages: [{role: 'user', content: 'Help me invest.'}],
            context: {capital: '', horizon: '', risk: '', country: ''}}, {...config, openRouterKey: '', searchKey: ''},
        new AbortController().signal, {fetch, now});
        expect(response.kind).toBe('clarification');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('uses a compact planner for follow-ups and keeps a latest-week search even if it is last in the plan', async () => {
        const plan = {kind: 'research', intent: 'decision', task: 'Revisit the original SpaceX question using the clarified horizon.',
            queries: [{query: 'SpaceX official disclosure', recency: 'any'}, {query: 'SpaceX fund fees', recency: 'month'},
                {query: 'SpaceX current developments', recency: 'week'}]};
        const {fetch, run} = harness([plan, briefFixture]);
        const messages = [...request.messages, {role: 'assistant' as const, content: JSON.stringify(clarificationFixture)},
            {role: 'user' as const, content: 'Five years, Canada.'}];
        expect(await run({...request, messages})).toMatchObject({kind: 'decision'});
        const planner = JSON.parse(String(fetch.mock.calls[0][1]?.body));
        expect(planner.max_tokens).toBe(1000);
        expect(JSON.parse(planner.messages[1].content).messages).toEqual(messages);
        const searches = fetch.mock.calls.filter(([url]) => !isModel(url)).map(([, options]) => JSON.parse(String(options?.body)));
        expect(searches).toHaveLength(2);
        expect(searches[0]).toMatchObject({time_range: 'week', query: expect.stringContaining('current developments')});
        expect(fetch.mock.calls.filter(([url]) => isModel(url))).toHaveLength(2);
    });

    it('retains citation and limited-evidence checks in quick mode', async () => {
        const fabricated = {...briefFixture, reasons: [{...briefFixture.reasons[0], sourceIds: ['S99']}]};
        await expect(harness([fabricated, fabricated]).run()).rejects.toMatchObject({code: 'invalid_response'});
        const unsupportedYes = {...briefFixture, verdict: 'yes', evidence: 'limited', confidence: 'low'};
        await expect(harness([unsupportedYes, unsupportedYes]).run()).rejects.toMatchObject({code: 'invalid_response'});
        const oneDomain = {...briefFixture, risks: [{...briefFixture.risks[0], sourceIds: ['S1']}]};
        await expect(harness([oneDomain, oneDomain]).run()).rejects.toMatchObject({code: 'invalid_response'});
    });

    it('never generates a market answer if fresh search fails', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', {status: 503}));
        await expect(runAgent(request, config, new AbortController().signal, {fetch, now})).rejects.toMatchObject({code: 'research_unavailable'});
        expect(fetch.mock.calls.every(([url]) => !isModel(url))).toBe(true);
    });

    it('uses the selected base model when no separate fast model is configured', async () => {
        const {fetch} = harness();
        await runAgent(request, {...config, fastModel: ''}, new AbortController().signal, {fetch, now});
        const body = JSON.parse(String(fetch.mock.calls.find(([url]) => isModel(url))?.[1]?.body));
        expect(body.model).toBe('reasoning/model');
        expect(body.reasoning.effort).toBe('none');
    });
});
