import {z} from 'zod';
import {
    briefSchema, clarificationSchema, requestSchema, responseSchema, safeUrl,
    type AgentRequest, type AgentResponse, type Source,
} from '../src/shared/agent.ts';
import {analystPrompt, plannerPrompt, reviewPrompt} from './prompts.ts';
import {DEFAULT_MODEL_TIMEOUT_MS, SEARCH_TIMEOUT_MS} from '../src/shared/timeouts.ts';

export class AgentError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export interface AgentConfig {
    openRouterKey: string;
    searchKey: string;
    model: string;
    modelTimeoutMs?: number;
    maxCompletionTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'provider';
}
export interface Dependencies {
    fetch: typeof fetch;
    now: () => Date;
}

const researchPlanSchema = z.object({
    kind: z.literal('research'),
    intent: z.enum(['decision', 'analysis']),
    task: z.string().trim().min(1).max(4000),
    queries: z.array(z.object({
        query: z.string().trim().min(3).max(400),
        recency: z.enum(['week', 'month', 'any']),
    })).min(2).max(3),
}).refine(value => value.queries.some(query => query.recency === 'week'), 'Include a current-week lookup.')
    .refine(value => new Set(value.queries.map(query => query.query.toLowerCase())).size === value.queries.length,
        'Searches must be complementary, not duplicates.');
const planSchema = z.union([clarificationSchema, researchPlanSchema]);
const reviewSchema = z.object({approved: z.boolean(), issues: z.array(z.string().min(1).max(600)).max(5)})
    .refine(value => value.approved === (value.issues.length === 0), 'Approval must agree with the issues list.');
const searchResponseSchema = z.object({
    results: z.array(z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        published_date: z.string().nullish(),
    })).max(50),
});
type Evidence = Source & {content: string};
const streamFrameSchema = z.object({
    error: z.unknown().optional(),
    choices: z.array(z.object({
        index: z.number().optional(),
        delta: z.object({content: z.string().nullable().optional()}).optional(),
        finish_reason: z.string().nullable().optional(),
    })).optional(),
});

async function readProviderResponse(response: Response, service: 'model' | 'research'): Promise<unknown> {
    if (service !== 'model' || !response.headers.get('content-type')?.includes('text/event-stream')) {
        return response.json();
    }
    // Request JSON explicitly, but tolerate providers that still return SSE. Only final
    // answer deltas are assembled; private reasoning never becomes an assistant answer.
    const text = await response.text();
    if (text.length > 16_000_000) throw new AgentError(502, 'model_invalid', 'The model returned an oversized response. Please retry.');
    let content = '';
    let finishReason: string | null = null;
    for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue; // SSE comments/keepalives are not JSON.
        if (data.trim() === '[DONE]') break;
        const frame = streamFrameSchema.safeParse(JSON.parse(data));
        if (!frame.success) throw new AgentError(502, 'model_invalid', 'The model returned an unreadable stream. Please retry.');
        if (frame.data.error) return {error: true};
        for (const choice of frame.data.choices || []) {
            if ((choice.index ?? 0) !== 0) continue;
            content += choice.delta?.content || '';
            finishReason = choice.finish_reason || finishReason;
        }
    }
    if (!finishReason) throw new AgentError(502, 'model_incomplete', 'The model connection ended before its answer was complete. Please retry.');
    return {choices: [{message: {content}, finish_reason: finishReason}]};
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal,
    deps: Dependencies, service: 'model' | 'research', timeoutMs = SEARCH_TIMEOUT_MS): Promise<unknown> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    try {
        const response = await deps.fetch(url, {
            method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
            body: JSON.stringify(body), signal: AbortSignal.any([signal, deadline.signal]),
        });
        if (!response.ok) throw new AgentError(502, `${service}_unavailable`, service === 'research'
            ? 'Current research is unavailable. No investment call was made. Please retry.'
            : 'The research desk could not complete this brief. Please retry.');
        // The deadline covers both receiving headers and reading the complete body.
        return await readProviderResponse(response, service);
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (deadline.signal.aborted) throw new AgentError(504, `${service}_timeout`, service === 'model'
            ? 'The model did not finish its answer in time. Please retry or narrow your question.'
            : 'Current research took too long. No investment call was made. Please retry.');
        if (error instanceof AgentError) throw error;
        if (error instanceof SyntaxError) throw new AgentError(502, `${service}_invalid`, 'The research desk returned an unreadable response. Please retry.');
        // Provider bodies can contain secrets and private prompts; never return or log them.
        throw new AgentError(502, `${service}_unavailable`, service === 'research'
            ? 'Current research is unavailable. No investment call was made. Please retry.'
            : 'The research desk could not complete this brief. Please retry.');
    } finally {
        clearTimeout(timer);
        deadline.abort(); // Also stop an unread error body rather than leaving a connection open.
    }
}

async function modelJson<T>(prompt: string, input: unknown, schema: z.ZodType<T>, config: AgentConfig,
    signal: AbortSignal, deps: Dependencies): Promise<T> {
    const messages = [
        {role: 'system', content: prompt},
        {role: 'user', content: JSON.stringify(input)},
    ];
    // One bounded repair, including semantic validation errors; no unbounded agent loops.
    for (let attempt = 0; attempt < 2; attempt++) {
        const effort = config.reasoningEffort ?? 'low';
        const raw = await postJson('https://openrouter.ai/api/v1/chat/completions', {
            model: config.model, messages, temperature: 0.3, stream: false,
            // Reasoning models share this budget between reasoning and final answer tokens.
            max_tokens: config.maxCompletionTokens ?? 12000,
            ...(effort === 'provider' ? {} : {reasoning: {effort}}),
            response_format: {type: 'json_object'},
        }, {Authorization: `Bearer ${config.openRouterKey}`, 'X-Title': 'JunieVest Research Desk', Accept: 'application/json'},
        signal, deps, 'model', config.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS);
        if (typeof raw === 'object' && raw !== null && 'error' in raw && raw.error) {
            throw new AgentError(502, 'model_provider_error', 'The model provider could not finish this response. Please retry.');
        }
        const envelope = z.object({choices: z.array(z.object({
            message: z.object({content: z.string().max(24000).nullish()}),
            finish_reason: z.string().nullish(),
        })).min(1)}).safeParse(raw);
        if (!envelope.success) throw new AgentError(502, 'invalid_response', 'The research desk returned an incomplete brief. Please retry.');
        if (envelope.data.choices[0].finish_reason === 'length') {
            throw new AgentError(502, 'model_output_limit', 'The model used its response budget before finishing the brief. Try a narrower question.');
        }
        const content = envelope.data.choices[0].message.content;
        if (!content?.trim()) throw new AgentError(502, 'model_empty_response', 'The model returned no final answer. Please retry.');
        let problem = 'Return valid JSON only, without a code fence.';
        try {
            const parsed = schema.safeParse(JSON.parse(content));
            if (parsed.success) return parsed.data;
            problem = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        } catch { /* Retry malformed JSON once. */ }
        messages.push({role: 'assistant', content}, {
            role: 'user', content: `Your response failed validation: ${problem}. Correct the JSON, preserving the original task and evidence.`,
        });
    }
    throw new AgentError(502, 'invalid_response', 'The brief did not pass evidence and format checks. Please retry.');
}

async function research(plan: z.infer<typeof researchPlanSchema>, config: AgentConfig, signal: AbortSignal,
    deps: Dependencies): Promise<Evidence[]> {
    const now = deps.now().toISOString();
    const searches = await Promise.all(plan.queries.map(async query => {
        const raw = await postJson('https://api.tavily.com/search', {
            query: `${query.query} (as of ${now.slice(0, 10)})`,
            topic: 'general', search_depth: 'advanced', max_results: 5,
            include_answer: false, include_raw_content: false,
            ...(query.recency !== 'any' ? {time_range: query.recency} : {}),
        }, {Authorization: `Bearer ${config.searchKey}`}, signal, deps, 'research');
        const parsed = searchResponseSchema.safeParse(raw);
        if (!parsed.success) throw new AgentError(502, 'research_invalid', 'Current research could not be verified. Please retry.');
        return parsed.data.results;
    }));
    const sources: Evidence[] = [];
    const urls = new Set<string>();
    // Round-robin so a fundamentals search cannot crowd out the recent-news search (or vice versa).
    for (let i = 0; i < 5; i++) {
        for (const results of searches) {
            const result = results[i];
            if (!result || !safeUrl.safeParse(result.url).success || !result.content.trim() || !result.title.trim()) continue;
            const url = new URL(result.url);
            url.hash = '';
            for (const key of [...url.searchParams.keys()]) {
                if (key.startsWith('utm_')) url.searchParams.delete(key);
            }
            if (urls.has(url.href) || sources.length >= 12) continue;
            urls.add(url.href);
            sources.push({
                id: `S${sources.length + 1}`, title: result.title.slice(0, 600), url: url.href,
                publishedAt: result.published_date?.slice(0, 100) || null, retrievedAt: now,
                content: result.content.slice(0, 2200),
            });
        }
    }
    if (!sources.length) throw new AgentError(502, 'research_empty', 'No usable current sources were found. No investment call was made. Try a more specific question.');
    return sources;
}

export async function runAgent(input: AgentRequest, config: AgentConfig, signal: AbortSignal,
    deps: Dependencies = {fetch: globalThis.fetch, now: () => new Date()}): Promise<AgentResponse> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new AgentError(400, 'invalid_request', 'Check your message length, or start a new brief if this conversation is full.');
    if (!config.openRouterKey || !config.model || !config.searchKey) {
        throw new AgentError(503, 'not_configured', 'The research desk is not connected yet. Please try again after setup is complete.');
    }
    const request = parsed.data;
    const plan = await modelJson(plannerPrompt, {today: deps.now().toISOString(), ...request}, planSchema, config, signal, deps);
    if (plan.kind === 'clarification') return plan;

    // There is deliberately no model-only fallback: every substantive response goes through fresh search.
    const evidence = await research(plan, config, signal, deps);
    const ids = new Set(evidence.map(source => source.id));
    const groundedBriefSchema = briefSchema.superRefine((brief, ctx) => {
        if (brief.kind !== plan.intent) ctx.addIssue({code: 'custom', message: `The requested intent requires kind ${plan.intent}.`});
        const cited = new Set([...brief.reasons, ...brief.risks].flatMap(claim => claim.sourceIds));
        if ([...cited].some(id => !ids.has(id))) ctx.addIssue({code: 'custom', message: 'Use only IDs from the retrieved evidence.'});
        const domains = new Set(evidence.filter(source => cited.has(source.id)).map(source => new URL(source.url).hostname.replace(/^www\./, '')));
        if (brief.evidence === 'sufficient' && domains.size < 2) {
            ctx.addIssue({code: 'custom', message: 'Sufficient evidence requires citations from at least two independent domains; otherwise mark limited with low confidence.'});
        }
    });
    const analysisInput = {
        today: deps.now().toISOString(), ...request, task: plan.task, intent: plan.intent,
        evidence, researchNote: 'Fresh web search extracts. Not a live quote feed. A missing publication date means unknown freshness.',
    };
    let brief = await modelJson(analystPrompt, analysisInput, groundedBriefSchema, config, signal, deps);
    for (let attempt = 0; attempt < 2; attempt++) {
        const review = await modelJson(reviewPrompt, {...analysisInput, brief}, reviewSchema, config, signal, deps);
        if (review.approved) break;
        if (attempt === 1) throw new AgentError(502, 'evidence_check_failed', 'The brief needs stronger evidence before a call can be made. Try narrowing the question or retry research.');
        brief = await modelJson(analystPrompt, {...analysisInput, previousBrief: brief, requiredCorrections: review.issues},
            groundedBriefSchema, config, signal, deps);
    }
    const cited = new Set([...brief.reasons, ...brief.risks].flatMap(claim => claim.sourceIds));
    const sources = evidence.filter(source => cited.has(source.id)).map(({id, title, url, publishedAt, retrievedAt}) =>
        ({id, title, url, publishedAt, retrievedAt}));
    return responseSchema.parse({...brief, sources, researchedAt: deps.now().toISOString()});
}
