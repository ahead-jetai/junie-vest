import {z} from 'zod';

const shortText = z.string().trim().min(1).max(600);
const detail = z.string().trim().min(1).max(1800);

export const contextSchema = z.object({
    capital: z.string().trim().max(120).default(''),
    horizon: z.string().trim().max(120).default(''),
    risk: z.string().trim().max(120).default(''),
    country: z.string().trim().max(120).default(''),
});
export type InvestorContext = z.infer<typeof contextSchema>;

export const requestSchema = z.object({
    mode: z.enum(['quick', 'deep']).optional(),
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(16000),
    })).min(1).max(40),
    context: contextSchema,
}).refine(value => value.messages.at(-1)?.role === 'user', 'The last message must be from the user.')
    .refine(value => value.messages.reduce((size, message) => size + message.content.length, 0) <= 60000,
        'This conversation is full. Start a new brief.');
export type AgentRequest = z.infer<typeof requestSchema>;

export const questionSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    question: shortText,
    options: z.array(z.string().trim().min(1).max(160)).max(4),
});

export const clarificationSchema = z.object({
    kind: z.literal('clarification'),
    headline: shortText,
    summary: detail,
    questions: z.array(questionSchema).min(1).max(3),
}).refine(value => new Set(value.questions.map(q => q.id)).size === value.questions.length,
    'Question IDs must be unique.');

const claimSchema = z.object({
    title: z.string().trim().min(1).max(140),
    detail,
    sourceIds: z.array(z.string().regex(/^S\d+$/)).min(1).max(6),
});

export const briefSchema = z.object({
    kind: z.enum(['decision', 'analysis']),
    verdict: z.enum(['yes', 'no']).nullable(),
    headline: shortText,
    summary: detail,
    confidence: z.enum(['low', 'medium', 'high']),
    evidence: z.enum(['sufficient', 'limited']),
    assumptions: z.array(shortText).max(4),
    reasons: z.array(claimSchema).min(1).max(4),
    strategy: z.array(shortText).min(1).max(4),
    risks: z.array(claimSchema).min(1).max(3),
    changeMyMind: detail,
    followUps: z.array(z.string().trim().min(1).max(180)).max(3),
}).superRefine((value, ctx) => {
    if ((value.kind === 'decision') !== (value.verdict !== null)) {
        ctx.addIssue({code: 'custom', message: 'Decisions require yes/no; analyses require a null verdict.'});
    }
    if (value.evidence === 'limited' && (value.verdict === 'yes' || value.confidence !== 'low')) {
        ctx.addIssue({code: 'custom', message: 'Limited evidence requires low confidence and cannot support a yes.'});
    }
});
export type Brief = z.infer<typeof briefSchema>;

export const safeUrl = z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
}, 'Sources must use an HTTP or HTTPS URL.');

export const sourceSchema = z.object({
    id: z.string().regex(/^S\d+$/),
    title: shortText,
    url: safeUrl,
    publishedAt: z.string().max(100).nullable(),
    retrievedAt: z.string().datetime(),
});
export type Source = z.infer<typeof sourceSchema>;

export const responseSchema = z.union([
    clarificationSchema,
    briefSchema.safeExtend({
        sources: z.array(sourceSchema).min(1).max(12),
        researchedAt: z.string().datetime(),
    }).superRefine((value, ctx) => {
        const ids = new Set(value.sources.map(source => source.id));
        if (ids.size !== value.sources.length || [...value.reasons, ...value.risks]
            .some(claim => claim.sourceIds.some(id => !ids.has(id)))) {
            ctx.addIssue({code: 'custom', message: 'Every citation must refer to a retrieved source.'});
        }
    }),
]);
export type AgentResponse = z.infer<typeof responseSchema>;

export function responseToText(response: AgentResponse): string {
    // The full brief (including questions and cited evidence) stays in conversational memory.
    return JSON.stringify(response);
}
