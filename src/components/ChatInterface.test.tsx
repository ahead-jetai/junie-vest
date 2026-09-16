import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('ChatInterface response formatting', () => {
    it('displays an unformatted API response as separate paragraphs after sending a question', async () => {
        const responseText = [
            'Start by writing down your monthly income and the expenses that you already know you will need to cover.',
            'Include both the bills that stay the same and the purchases that tend to change from month to month.',
            'Next, choose a savings target that leaves enough room for your everyday needs and a few unexpected costs.',
            'An example target might be $125.50 each month, but the right amount depends on the rest of your budget.',
            'Review the numbers after a month so you can see which estimates were useful and which need changing.',
            'Keep the first version simple enough that you can maintain it and build on it as you learn more.'
        ].join(' ');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({choices: [{message: {content: responseText}}]})
        });
        vi.stubEnv('VITE_OPENROUTER_API_KEY', 'test-api-key');
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.resetModules();
        const {default: ChatInterface} = await import('./ChatInterface');
        const user = userEvent.setup();
        render(<ChatInterface/>);

        await user.type(screen.getByRole('textbox'), 'Help me plan my budget{Enter}');

        const firstParagraph = await screen.findByText(/Start by writing down your monthly income/);
        const paragraphs = [...firstParagraph.closest('.message-markdown')!.querySelectorAll('p')];
        expect(paragraphs).toHaveLength(3);
        expect(paragraphs.map(paragraph => paragraph.textContent).join('')).toBe(responseText);
        expect(screen.getByText('Help me plan my budget')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1]).toEqual({
            role: 'user', content: 'Help me plan my budget'
        });
    });
});
