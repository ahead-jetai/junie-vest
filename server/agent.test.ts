// @vitest-environment node
import {describe, it, expect, vi} from 'vitest';
import {runAgent, type AgentConfig} from './agent';
import {briefFixture, clarificationFixture, requestFixture} from '../src/test/fixtures';

const config: AgentConfig = {openRouterKey: 'model-secret', searchKey: 'search-secret', model: 'test/model'};
const plan = {
    kind: 'research', intent: 'decision', task: 'Should a US retail investor buy OrbitalCo today for a five-year horizon?',
    queries: [{query: 'OrbitalCo latest listing status news', recency: 'week'}, {query: 'OrbitalCo fund official fees valuation', recency: 'any'}],
};
const results = [
    {title: 'Fund disclosure', url: 'https://example.com/disclosure', content: 'Transfers are restricted.', published_date: '2026-09-15'},
    {title: 'Broker terms', url: 'https://example.org/terms', content: 'A secondary market is not promised.'},
];
const modelResponse = (content: unknown) => new Response(JSON.stringify({choices: [{message: {content: typeof content === 'string' ? content : JSON.stringify(content)}}]}));

function harness(models: unknown[], searchResults = results, reviews = [{approved: true, issues: [] as string[]}]) {
    const queue = [...models];
    const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
        if (url === 'https://api.tavily.com/search') return new Response(JSON.stringify({results: searchResults}));
        if (String(options?.body).includes('You are the quality reviewer')) return modelResponse(reviews.length > 1 ? reviews.shift() : reviews[0]);
        return modelResponse(queue.shift());
    });
    const run = () => runAgent(requestFixture, config, new AbortController().signal, {fetch: fetchMock, now: () => new Date('2026-09-16T12:00:00Z')});
    return {fetchMock, run};
}

describe('investment harness', () => {
    it('asks bounded clarification questions without inventing market claims or searching', async () => {
        const {run, fetchMock} = harness([clarificationFixture]);
        expect(await run()).toEqual(clarificationFixture);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('always researches substantive answers and attaches only actual cited sources', async () => {
        const {run, fetchMock} = harness([plan, briefFixture]);
        const response = await run();
        expect(response.kind).toBe('decision');
        if (response.kind === 'clarification') throw new Error('Expected a brief');
        expect(response.verdict).toBe('no');
        expect(response.sources).toHaveLength(2);
        expect(response.researchedAt).toBe('2026-09-16T12:00:00.000Z');
        expect(response.sources[1].publishedAt).toBeNull();
        const searches = fetchMock.mock.calls.filter(([url]) => url === 'https://api.tavily.com/search');
        expect(searches).toHaveLength(2);
        expect(JSON.parse(String(searches[0][1]?.body))).toMatchObject({time_range: 'week', include_answer: false});
        expect(JSON.parse(String(searches[1][1]?.body))).not.toHaveProperty('time_range');
        expect(searches.every(([, options]) => String(options?.body).includes('2026-09-16'))).toBe(true);
        const modelCalls = fetchMock.mock.calls.filter(([url]) => url === 'https://openrouter.ai/api/v1/chat/completions');
        const synthesis = JSON.parse(String(modelCalls[1][1]?.body));
        expect(JSON.parse(synthesis.messages[1].content)).toMatchObject({context: requestFixture.context, evidence: expect.any(Array)});
        expect(JSON.stringify(response)).not.toContain('secret');
    });

    it('keeps the original question and clarification answers in model context', async () => {
        const {fetchMock} = harness([plan, briefFixture]);
        const messages = [{role: 'user' as const, content: 'Help me invest in OrbitalCo.'},
            {role: 'assistant' as const, content: JSON.stringify(clarificationFixture)},
            {role: 'user' as const, content: 'Five years, United States.'}];
        await runAgent({...requestFixture, messages}, config, new AbortController().signal, {fetch: fetchMock, now: () => new Date()});
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(JSON.parse(body.messages[1].content).messages).toEqual(messages);
    });

    it('does not synthesize when search fails or returns no usable sources', async () => {
        const empty = harness([plan, briefFixture], []);
        await expect(empty.run()).rejects.toMatchObject({code: 'research_empty'});
        expect(empty.fetchMock.mock.calls.filter(([url]) => String(url).includes('openrouter'))).toHaveLength(1);
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(modelResponse(plan)).mockResolvedValue(new Response('', {status: 503}));
        await expect(runAgent(requestFixture, config, new AbortController().signal, {fetch: fetchMock, now: () => new Date()}))
            .rejects.toMatchObject({code: 'research_unavailable'});
    });

    it('repairs an unsupported citation once and never attaches invented source URLs', async () => {
        const bad = {...briefFixture, reasons: [{title: 'Invented source', detail: 'Claim', sourceIds: ['S99']}]};
        const {run, fetchMock} = harness([plan, bad, briefFixture]);
        const response = await run();
        expect(response.kind).toBe('decision');
        const repair = JSON.parse(String(fetchMock.mock.calls.at(-2)?.[1]?.body));
        expect(repair.messages.at(-1).content).toContain('Use only IDs from the retrieved evidence');
        const repeated = harness([plan, bad, bad]);
        await expect(repeated.run()).rejects.toMatchObject({code: 'invalid_response'});
        expect(repeated.fetchMock).toHaveBeenCalledTimes(5);
    });

    it('rejects a yes with limited evidence and a sufficient call based on one domain', async () => {
        const unjustified = {...briefFixture, verdict: 'yes', evidence: 'limited', confidence: 'low'};
        await expect(harness([plan, unjustified, unjustified]).run()).rejects.toMatchObject({code: 'invalid_response'});
        const singleDomain = {...briefFixture, risks: [{...briefFixture.risks[0], sourceIds: ['S1']}]};
        await expect(harness([plan, singleDomain, singleDomain]).run()).rejects.toMatchObject({code: 'invalid_response'});
        const limitedNo = {...singleDomain, evidence: 'limited', confidence: 'low'};
        expect(await harness([plan, limitedNo]).run()).toMatchObject({verdict: 'no', confidence: 'low'});
    });

    it('rejects analysis in place of a requested yes/no decision', async () => {
        const evasive = {...briefFixture, kind: 'analysis', verdict: null};
        await expect(harness([plan, evasive, evasive]).run()).rejects.toMatchObject({code: 'invalid_response'});
    });

    it('reviews citation support and relevance, repairs once, and fails closed if quality still fails', async () => {
        const rejected = {approved: false, issues: ['The valuation claim is not supported by S1.']};
        const repaired = harness([plan, briefFixture, {...briefFixture, confidence: 'low', evidence: 'limited'}], results,
            [rejected, {approved: true, issues: []}]);
        expect(await repaired.run()).toMatchObject({evidence: 'limited', confidence: 'low'});
        const retryInput = JSON.parse(String(repaired.fetchMock.mock.calls.at(-2)?.[1]?.body));
        expect(JSON.parse(retryInput.messages[1].content).requiredCorrections).toEqual(rejected.issues);
        await expect(harness([plan, briefFixture, briefFixture], results, [rejected]).run())
            .rejects.toMatchObject({code: 'evidence_check_failed'});
    });

    it('repairs malformed plans, requires a recent query, and filters unsafe/duplicate source URLs', async () => {
        const badPlan = {...plan, queries: plan.queries.map(query => ({...query, recency: 'any'}))};
        const {run} = harness([badPlan, plan, briefFixture], [...results,
            {...results[0], url: 'javascript:alert(1)'}, {...results[0], url: 'https://example.com/disclosure?utm_source=test#part'},
        ]);
        expect(await run()).toMatchObject({sources: expect.arrayContaining([expect.objectContaining({url: 'https://example.com/disclosure'})])});
        const malformed = harness(['not json', clarificationFixture]);
        expect(await malformed.run()).toEqual(clarificationFixture);
    });

    it('validates request size, role and server configuration before making provider calls', async () => {
        const {fetchMock} = harness([]);
        const deps = {fetch: fetchMock, now: () => new Date()};
        const signal = new AbortController().signal;
        await expect(runAgent({...requestFixture, messages: [{role: 'assistant', content: 'hello'}]}, config, signal, deps)).rejects.toMatchObject({status: 400});
        await expect(runAgent({...requestFixture, messages: [{role: 'user', content: 'x'.repeat(16001)}]}, config, signal, deps)).rejects.toMatchObject({status: 400});
        await expect(runAgent(requestFixture, {...config, searchKey: ''}, signal, deps)).rejects.toMatchObject({status: 503});
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
