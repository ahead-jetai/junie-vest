import {z} from 'zod';
import {
    briefSchema, clarificationSchema, requestSchema, responseSchema, safeUrl,
    type AgentRequest, type AgentResponse, type Source,
} from '../src/shared/agent.ts';
import {analystPrompt, plannerPrompt, reviewPrompt} from './prompts.ts';

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

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal,
    deps: Dependencies, service: 'model' | 'research'): Promise<unknown> {
    let response: Response;
    try {
        response = await deps.fetch(url, {
            method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
            body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
        });
    } catch {
        if (signal.aborted) throw signal.reason;
        throw new AgentError(502, `${service}_unavailable`, service === 'research'
            ? 'Current research is unavailable. No investment call was made. Please retry.'
            : 'The research desk could not complete this brief. Please retry.');
    }
    if (!response.ok) {
        // Provider bodies can contain secrets and private prompts; never return or log them.
        throw new AgentError(502, `${service}_unavailable`, service === 'research'
            ? 'Current research is unavailable. No investment call was made. Please retry.'
            : 'The research desk could not complete this brief. Please retry.');
    }
    try {
        return await response.json();
    } catch {
        throw new AgentError(502, `${service}_invalid`, 'The research desk returned an unreadable response. Please retry.');
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
        const raw = await postJson('https://openrouter.ai/api/v1/chat/completions', {
            model: config.model, messages, temperature: 0.3, max_tokens: 5000,
            response_format: {type: 'json_object'},
        }, {Authorization: `Bearer ${config.openRouterKey}`, 'X-Title': 'JunieVest Research Desk'}, signal, deps, 'model');
        const envelope = z.object({choices: z.array(z.object({
            message: z.object({content: z.string().min(1).max(24000)}),
        })).min(1)}).safeParse(raw);
        if (!envelope.success) throw new AgentError(502, 'invalid_response', 'The research desk returned an incomplete brief. Please retry.');
        const content = envelope.data.choices[0].message.content;
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
