// Synthetic fixtures only: these are not market research or investment recommendations.
import type {AgentResponse, AgentRequest, Brief} from '../shared/agent';

export const requestFixture: AgentRequest = {
    mode: 'deep', // The original full-harness tests deliberately exercise deep research.
    messages: [{role: 'user', content: 'Should I invest in OrbitalCo today?'}],
    context: {capital: '$10,000', horizon: '5 years', risk: 'Moderate', country: 'United States'},
};
export const clarificationFixture: AgentResponse = {
    kind: 'clarification', headline: 'Let’s define the job for this money.',
    summary: 'Your timeline changes which investments fit.',
    questions: [
        {id: 'horizon', question: 'When will you need this money?', options: ['Within 2 years', 'More than 5 years']},
        {id: 'country', question: 'Where are you investing from?', options: ['United States', 'United Kingdom']},
    ],
};
export const briefFixture: Brief = {
    kind: 'decision', verdict: 'no', headline: 'No — wait for a verifiable entry price.',
    summary: 'I would not buy this exposure today: the available terms do not yet support the trade.',
    confidence: 'medium', evidence: 'sufficient', assumptions: ['You need a route available to a retail investor.'],
    reasons: [{title: 'Access comes with a catch', detail: 'The fund disclosure includes transfer restrictions.', sourceIds: ['S1']}],
    strategy: ['Request the current valuation and a full fee schedule before committing capital.'],
    risks: [{title: 'Your exit can disappear', detail: 'The broker terms do not promise a secondary market.', sourceIds: ['S2']}],
    changeMyMind: 'A documented valuation and an accessible instrument with acceptable exit terms.',
    followUps: ['What would a better entry look like?'],
};
export const responseFixture: AgentResponse = {
    ...briefFixture,
    sources: [
        {id: 'S1', title: 'Illustrative fund disclosure', url: 'https://example.com/disclosure', publishedAt: null, retrievedAt: '2026-09-16T12:00:00.000Z'},
        {id: 'S2', title: 'Illustrative broker terms', url: 'https://example.org/terms', publishedAt: '2026-09-15', retrievedAt: '2026-09-16T12:00:00.000Z'},
    ],
    researchedAt: '2026-09-16T12:00:00.000Z',
};
