import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import ChatMessage from './ChatMessage';

const renderMessage = (text: string, isUser = false) => render(
    <ChatMessage message={{id: 'message-1', text, isUser, timestamp: new Date('2026-09-16T12:00:00Z')}}/>
);

describe('ChatMessage', () => {
    it('renders assistant answers as paragraphs, headings, emphasis, and nested lists', () => {
        renderMessage(`Start with a **clear goal**.

Keep the plan *manageable*.

## Your next steps

1. Review your budget.
2. Set a savings target.
   - Start small.
   - Revisit it monthly.`);

        expect(screen.getByRole('heading', {level: 2, name: 'Your next steps'})).toBeInTheDocument();
        expect(screen.getByText('clear goal').tagName).toBe('STRONG');
        expect(screen.getByText('manageable').tagName).toBe('EM');
        expect(screen.getByText('clear goal').closest('p')).not.toBe(screen.getByText('manageable').closest('p'));
        const lists = screen.getAllByRole('list');
        expect(lists[0].tagName).toBe('OL');
        expect(lists[1].tagName).toBe('UL');
        expect(lists[1].closest('li')).toHaveTextContent('Set a savings target.');
        expect(screen.getAllByRole('listitem')).toHaveLength(4);
    });

    it('renders comparison tables and safe links', () => {
        renderMessage(`| Category | Monthly amount |
| --- | ---: |
| Needs | $1,500 |
| Savings | $600 |

[Read the guide](https://example.com/guide)`);

        const tableRegion = screen.getByRole('region', {name: 'Table'});
        expect(tableRegion).toHaveAttribute('tabindex', '0');
        const table = within(tableRegion).getByRole('table');
        expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
        expect(within(table).getByRole('cell', {name: '$600'})).toBeInTheDocument();
        const link = screen.getByRole('link', {name: 'Read the guide'});
        expect(link).toHaveAttribute('href', 'https://example.com/guide');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('preserves whitespace and literal markup in fenced code blocks', () => {
        const code = 'const label = "<strong>example</strong>";\n  const amount = 100;\n';
        renderMessage('Use `amount` in the calculation.\n\n```js\n' + code + '```');

        expect(screen.getByText('amount').tagName).toBe('CODE');
        const block = screen.getByLabelText('Code block');
        expect(block.tagName).toBe('PRE');
        expect(block).toHaveAttribute('tabindex', '0');
        expect(block.querySelector('code')?.textContent).toBe(code);
        expect(block.querySelector('strong')).toBeNull();
    });

    it('does not render raw HTML or allow executable link URLs', () => {
        const {container} = renderMessage(`<script>alert('unsafe')</script>

<img src="x" onerror="alert('unsafe')">

[Unsafe link](javascript:alert%281%29)

Still readable.`);

        expect(container.querySelector('script, img')).toBeNull();
        expect(screen.getByText('Unsafe link')).toHaveAttribute('href', '');
        expect(screen.getByText('Still readable.').tagName).toBe('P');
    });

    it('keeps user messages literal, including Markdown and newlines', () => {
        const text = '## My question\n\nExplain **this** and <b>that</b>.';
        const {container} = renderMessage(text, true);

        expect(container.querySelector('.message-plain-text')?.textContent).toBe(text);
        expect(container.querySelector('h2, strong, b')).toBeNull();
        expect(container.querySelector('.user-message')).toBeInTheDocument();
    });

    it('continues displaying plain-text assistant replies and their timestamp', () => {
        const {container} = renderMessage('Happy to help!');

        expect(screen.getByText('Happy to help!').tagName).toBe('P');
        expect(container.querySelector('.message-timestamp')).toHaveTextContent(/\d+:\d+/);
    });
});
