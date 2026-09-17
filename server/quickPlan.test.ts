// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {quickPlan} from './quickPlan';
import {requestFixture} from '../src/test/fixtures';

const plan = (content: string) => quickPlan({...requestFixture, mode: 'quick', messages: [{role: 'user', content}]});

describe('conservative local routing', () => {
    it.each(['SpaceX', '$NVDA', 'Rocket Lab', 'BRK.B', 'Bitcoin'])('recognizes an explicit %s investment question without assuming listing status', asset => {
        const result = plan(`Should I invest in ${asset} today?`);
        expect(result).toMatchObject({kind: 'research', intent: 'decision'});
        if (result?.kind !== 'research') throw new Error('Missing plan');
        expect(result.queries[0]).toMatchObject({recency: 'week'});
        expect(result.queries[0].query).toContain(asset.replace('$', ''));
        expect(result.queries[0].query).not.toContain('today latest');
    });

    it.each(['Should I sell Tesla now?', 'Should I avoid Ethereum?', 'Should I buy Apple?'])('preserves the action in %s', question => {
        expect(plan(question)).toMatchObject({kind: 'research', task: question, intent: 'decision'});
    });

    it.each(['Should I invest my savings?', 'Should I buy it today?', 'Should I buy Tesla with $20,000?',
        'Should I buy 100 shares of AAPL?', 'Compare Tesla and Nvidia', 'Should I invest in my company?',
        'Should I invest in Tesla? My email is investor@example.com.'])('defers complex, ambiguous, or personal questions: %s', question => {
        expect(plan(question)).toBeUndefined();
    });

    it('asks only for missing context immediately, without requiring provider setup', () => {
        const result = quickPlan({...requestFixture, messages: [{role: 'user', content: 'Help me invest.'}],
            context: {...requestFixture.context, horizon: '', country: ''}});
        expect(result?.kind).toBe('clarification');
        if (result?.kind !== 'clarification') throw new Error('Missing clarification');
        expect(result.questions.map(question => question.id)).toEqual(['horizon', 'country']);
        expect(quickPlan({...requestFixture, messages: [{role: 'user', content: 'Help me invest.'}]})).toBeUndefined();
    });

    it('lets the planner resolve follow-ups against the entire conversation', () => {
        expect(quickPlan({...requestFixture, messages: [...requestFixture.messages, {role: 'assistant', content: 'A previous thesis'},
            {role: 'user', content: 'Should I sell Tesla now?'}]})).toBeUndefined();
    });
});
