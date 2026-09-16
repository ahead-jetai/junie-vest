import {render, screen, waitFor, within, fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ChatInterface from './ChatInterface';
import {clarificationFixture, responseFixture} from '../test/fixtures';

const mockFetch = vi.fn();
beforeEach(() => {
    mockFetch.mockReset().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/health' ? {configured: true} : responseFixture))));
    vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => vi.unstubAllGlobals());
const chatCalls = () => mockFetch.mock.calls.filter(([url]) => url === '/api/chat');

describe('research desk conversation', () => {
    it('displays long API prose as readable paragraphs while keeping the structured brief', async () => {
        const responseText = [
            'Start by writing down your monthly income and the expenses that you already know you will need to cover.',
            'Include both the bills that stay the same and the purchases that tend to change from month to month.',
            'Next, choose a savings target that leaves enough room for your everyday needs and a few unexpected costs.',
            'An example target might be $125.50 each month, but the right amount depends on the rest of your budget.',
            'Review the numbers after a month so you can see which estimates were useful and which need changing.',
            'Keep the first version simple enough that you can maintain it and build on it as you learn more.',
        ].join(' ');
        mockFetch.mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(
            url === '/api/health' ? {configured: true} : {...responseFixture, summary: responseText},
        ))));
        const user = userEvent.setup();
        render(<ChatInterface/>);
        await user.type(screen.getByRole('textbox', {name: 'Your investment question'}), 'Help me plan my budget{Enter}');
        const brief = await screen.findByRole('article', {name: 'Investment brief'});
        const paragraphs = [...brief.querySelectorAll('.brief-summary')];
        expect(paragraphs).toHaveLength(3);
        expect(paragraphs.map(paragraph => paragraph.textContent).join('')).toBe(responseText);
        expect(screen.getByText('Help me plan my budget')).toBeInTheDocument();
        expect(chatCalls()).toHaveLength(1);
        expect(JSON.parse(chatCalls()[0][1].body).messages).toEqual([
            {role: 'user', content: 'Help me plan my budget'},
        ]);
    });

    it('recovers the connection indicator after a transient health check failure', async () => {
        const user = userEvent.setup();
        mockFetch.mockImplementation((url: string) => url === '/api/health' ? Promise.reject(new Error('offline'))
            : Promise.resolve(new Response(JSON.stringify(responseFixture))));
        render(<ChatInterface/>);
        await screen.findByText('Desk offline');
        await user.click(screen.getByRole('button', {name: /Should I invest in SpaceX today/}));
        await screen.findByRole('article', {name: 'Investment brief'});
        expect(screen.getByText('Research configured')).toBeInTheDocument();
    });

    it('turns a vague request into clickable questions and retains context in the final brief', async () => {
        const user = userEvent.setup();
        mockFetch.mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/health' ? {configured: true}
            : chatCalls().length === 1 ? clarificationFixture : responseFixture))));
        render(<ChatInterface/>);
        await user.type(screen.getByLabelText('Capital to deploy'), '$10,000');
        await user.type(screen.getByLabelText('Your investment question'), 'Help me invest.');
        await user.click(screen.getByRole('button', {name: 'Send message'}));
        expect(await screen.findByRole('region', {name: 'Clarifying questions'})).toBeInTheDocument();
        const submit = screen.getByRole('button', {name: /Build my brief/});
        expect(submit).toBeDisabled();
        await user.click(screen.getByRole('button', {name: 'More than 5 years'}));
        await user.type(screen.getByRole('textbox', {name: 'Where are you investing from?'}), 'Canada');
        await user.click(submit);
        const brief = await screen.findByRole('article', {name: 'Investment brief'});
        expect(within(brief).getByText('NO / THE CALL')).toBeInTheDocument();
        expect(within(brief).getByText(/What would change my mind/)).toBeInTheDocument();
        const second = JSON.parse(chatCalls()[1][1].body);
        expect(second.context.capital).toBe('$10,000');
        expect(second.messages).toHaveLength(3);
        expect(second.messages[0].content).toBe('Help me invest.');
        expect(second.messages[1].content).toContain('When will you need this money?');
        expect(second.messages[2].content).toContain('Canada');
        expect(screen.getByRole('button', {name: 'More than 5 years'})).toBeDisabled();
    });

    it('retries a failed request without duplicating the user message or sending errors as history', async () => {
        const user = userEvent.setup();
        mockFetch.mockImplementation((url: string) => Promise.resolve(url === '/api/health' ? new Response('{"configured":true}')
            : chatCalls().length === 1 ? new Response('{"error":"Current research is unavailable."}', {status: 502})
                : new Response(JSON.stringify(responseFixture))));
        render(<ChatInterface/>);
        await user.click(screen.getByRole('button', {name: /Should I invest in SpaceX today/}));
        expect(await screen.findByRole('alert')).toHaveTextContent('Current research is unavailable.');
        await user.click(screen.getByRole('button', {name: /Retry brief/}));
        await screen.findByRole('article', {name: 'Investment brief'});
        expect(chatCalls()[0][1].body).toBe(chatCalls()[1][1].body);
        expect(screen.getAllByText('Should I invest in SpaceX today?')).toHaveLength(1);
        await user.click(screen.getByRole('button', {name: /What would a better entry look like/}));
        await waitFor(() => expect(chatCalls()).toHaveLength(3));
        expect(JSON.parse(chatCalls()[2][1].body).messages).toHaveLength(3);
    });

    it('stops a pending request and can start a new brief without late responses leaking in', async () => {
        const user = userEvent.setup();
        let resolveChat: (response: Response) => void = () => {};
        mockFetch.mockImplementation((url: string) => url === '/api/health' ? Promise.resolve(new Response('{"configured":true}'))
            : new Promise<Response>(resolve => { resolveChat = resolve; }));
        render(<ChatInterface/>);
        await user.click(screen.getByRole('button', {name: /Should I invest in SpaceX today/}));
        expect(await screen.findByRole('status')).toHaveTextContent('Preparing your brief');
        const signal = chatCalls()[0][1].signal as AbortSignal;
        await user.click(screen.getByRole('button', {name: 'Stop'}));
        expect(signal.aborted).toBe(true);
        await user.click(screen.getAllByRole('button', {name: /New brief/})[0]);
        resolveChat(new Response(JSON.stringify(responseFixture)));
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', {name: /Don’t just follow/})).toBeInTheDocument();
    });

    it('supports Shift+Enter and avoids submitting while an IME composition is active', async () => {
        render(<ChatInterface/>);
        const input = screen.getByRole('textbox', {name: 'Your investment question'});
        fireEvent.change(input, {target: {value: 'Should I buy?'}});
        fireEvent.keyDown(input, {key: 'Enter', shiftKey: true});
        fireEvent.keyDown(input, {key: 'Enter', isComposing: true});
        expect(chatCalls()).toHaveLength(0);
        fireEvent.keyDown(input, {key: 'Enter'});
        await screen.findByRole('article', {name: 'Investment brief'});
        expect(chatCalls()).toHaveLength(1);
    });
});
