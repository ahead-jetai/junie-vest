import {clarificationSchema, type AgentRequest} from '../src/shared/agent.ts';

// Conservative shortcuts only. Complex questions and follow-ups retain model routing,
// so pronouns, comparisons and prior constraints are not guessed from keywords.
export function quickPlan(request: AgentRequest) {
    if (request.messages.length !== 1) return undefined;
    const text = request.messages[0].content.trim();
    const vague = /^(?:help me invest|help me with investing|i want to invest|how should i invest|what should i invest in|help with my finances|build a strategy for my idle cash)[?.!]*$/i.test(text);
    if (vague) {
        const questions = [
            ...(!request.context.horizon ? [{id: 'horizon', question: 'When will you need this money?', options: ['Within 2 years', '3–5 years', 'More than 5 years']}] : []),
            ...(!request.context.capital ? [{id: 'capital', question: 'How much are you looking to put to work?', options: []}] : []),
            ...(!request.context.country ? [{id: 'country', question: 'Which country are you investing from?', options: ['United States', 'United Kingdom', 'Canada']}] : []),
        ];
        if (questions.length) return clarificationSchema.parse({
            kind: 'clarification', headline: 'Let’s give this money a clear job.',
            summary: 'Your timeline, available capital and country determine which choices are practical.', questions,
        });
        return undefined;
    }
    const match = text.match(/^should i (buy|sell|invest in|avoid) (\$?[\p{L}][\p{L}\p{N} .&-]{0,69}?)(?: (?:today|right now|now))?[?.!]*$/iu);
    if (!match) return undefined;
    const asset = match[2].trim().replace(/^\$/, '');
    // Send only the explicitly requested subject to search, never the full personal
    // question or profile. Ambiguous subjects and financial amounts go to the planner.
    if (asset.split(/\s+/).length > 5 || /\b(my|our|your|their|his|her|it|this|that|anything|something|money|savings|portfolio|with|for|at|\d+)\b/i.test(asset)) return undefined;
    return {
        kind: 'research' as const, intent: 'decision' as const, task: text,
        queries: [
            {query: `${asset} latest price valuation listing status catalysts risks`, recency: 'week' as const},
            {query: `${asset} official investor disclosures investment access fees valuation`, recency: 'any' as const},
        ],
    };
}
