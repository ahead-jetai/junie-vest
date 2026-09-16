import type {Element, ElementContent, Root} from 'hast';

const LONG_PARAGRAPH_LENGTH = 360;
const TARGET_PARAGRAPH_LENGTH = 240;

function textContent(node: ElementContent): string {
    if (node.type === 'text') return node.value;
    if (node.type === 'element') return node.children.map(textContent).join('');
    return '';
}

function splitParagraph(paragraph: Element): Element[] {
    const text = textContent(paragraph);
    if (text.length <= LONG_PARAGRAPH_LENGTH) return [paragraph];

    let offset = 0;
    const children = paragraph.children.map(node => {
        const start = offset;
        offset += textContent(node).length;
        return {node, start, end: offset};
    });

    const sentences = [...new Intl.Segmenter('en', {granularity: 'sentence'}).segment(text)];
    const breaks = [0];
    let sentenceCount = 0;

    for (const {index, segment} of sentences.slice(0, -1)) {
        sentenceCount++;
        const end = index + segment.length;
        if (sentenceCount < 2 && end - breaks[breaks.length - 1] < TARGET_PARAGRAPH_LENGTH) continue;

        // Only split plain text or between inline elements. A link, emphasis,
        // or inline code span must stay intact even if it contains punctuation.
        const canSplit = children.some(child =>
            end === child.end ||
            (child.node.type === 'text' && end > child.start && end < child.end)
        );
        if (canSplit) {
            breaks.push(end);
            sentenceCount = 0;
        }
    }

    if (breaks.length === 1) return [paragraph];
    breaks.push(text.length);

    return breaks.slice(0, -1).map((start, index) => {
        const end = breaks[index + 1];
        const paragraphChildren: ElementContent[] = [];

        for (const child of children) {
            // Preserve elements without text, such as images and explicit breaks.
            if (child.start === child.end) {
                if (child.start >= start && (child.start < end || end === text.length)) {
                    paragraphChildren.push(child.node);
                }
                continue;
            }
            if (child.end <= start || child.start >= end) continue;

            paragraphChildren.push(child.node.type === 'text' ? {
                ...child.node,
                value: child.node.value.slice(Math.max(0, start - child.start), end - child.start)
            } : child.node);
        }

        return {type: 'element', tagName: 'p', properties: paragraph.properties, children: paragraphChildren};
    });
}

// Apply the fallback to answer prose only; leave lists, tables, quotes, and
// code blocks in the structure supplied by the model.
export function splitReadableText(text: string): string[] {
    return splitParagraph({
        type: 'element', tagName: 'p', properties: {}, children: [{type: 'text', value: text}],
    }).map(textContent);
}

export default function rehypeReadableParagraphs() {
    return (tree: Root) => {
        tree.children = tree.children.flatMap(node =>
            node.type === 'element' && node.tagName === 'p' ? splitParagraph(node) : [node]
        );
    };
}
