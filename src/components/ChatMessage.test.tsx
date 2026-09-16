import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import ChatMessage from './ChatMessage';

const unstructuredAnswer = [
    'Start with a clear picture of your monthly income and spending so you can choose a realistic next step.',
    'Write down your regular bills, flexible expenses, and the amount you want to set aside for future goals.',
    'Keep a small cushion for unexpected costs instead of committing every dollar before the month begins.',
    'If an account shows a 3.5% rate, compare its fees and access rules before deciding whether it suits your needs.',
    'Review the plan at the end of the month and adjust the categories that did not match your actual spending.',
    'Choose one manageable action today, then revisit your progress when your next paycheck arrives.'
].join(' ');

const renderMessage = (text: string, isUser = false) => render(
    <ChatMessage message={{id: 'message-1', text, isUser, timestamp: new Date('2026-09-16T12:00:00Z')}}/>
);

describe('ChatMessage', () => {
    it('breaks a long unformatted answer into readable paragraphs without changing its text', () => {
        const {container} = renderMessage(unstructuredAnswer);

        const paragraphs = [...container.querySelectorAll('.message-markdown > p')];
        expect(paragraphs).toHaveLength(3);
        expect(paragraphs.map(paragraph => paragraph.textContent).join('')).toBe(unstructuredAnswer);
        expect(paragraphs[1]).toHaveTextContent('3.5% rate');
    });

    it('preserves emphasis, links, and inline code when breaking up long prose', () => {
        const {container} = renderMessage(unstructuredAnswer
            .replace('clear picture', '**clear picture**')
            .replace('3.5% rate', '[3.5% rate](https://example.com/rates?value=3.5)')
            .replace('one manageable action', '`one manageable action`'));

        const paragraphs = [...container.querySelectorAll('.message-markdown > p')];
        expect(paragraphs).toHaveLength(3);
        expect(paragraphs.map(paragraph => paragraph.textContent).join('')).toBe(unstructuredAnswer);
        expect(screen.getByText('clear picture').tagName).toBe('STRONG');
        expect(screen.getByRole('link', {name: '3.5% rate'})).toHaveAttribute('href', 'https://example.com/rates?value=3.5');
        expect(screen.getByText('one manageable action').tagName).toBe('CODE');
    });

    it('leaves long list items, quotations, and code blocks intact', () => {
        const {container} = renderMessage('- ' + unstructuredAnswer + '\n\n> ' + unstructuredAnswer + '\n\n```text\n' + unstructuredAnswer + '\n```');

        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByRole('listitem').textContent).toBe(unstructuredAnswer);
        expect(container.querySelectorAll('blockquote > p')).toHaveLength(1);
        expect(container.querySelector('blockquote > p')?.textContent).toBe(unstructuredAnswer);
        expect(screen.getByLabelText('Code block').textContent).toBe(unstructuredAnswer + '\n');
    });

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
        const text = '## My question\n\nExplain **this** and <b>that</b>. ' + unstructuredAnswer;
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
