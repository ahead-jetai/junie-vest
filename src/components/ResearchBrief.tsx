import {useState, type ReactNode} from 'react';
import type {AgentResponse} from '../shared/agent';
import {ArrowIcon} from './Icons';
import {splitReadableText} from './rehypeReadableParagraphs';

function ReadableProse({text, className, children}: {text: string; className?: string; children?: ReactNode}) {
    const paragraphs = splitReadableText(text);
    return <>{paragraphs.map((paragraph, index) => <p className={className} key={index}>
        {paragraph}{index === paragraphs.length - 1 && children}
    </p>)}</>;
}

type Props = {
    response: AgentResponse;
    onFollowUp?: (text: string) => void;
    disabled?: boolean;
};

export default function ResearchBrief({response, onFollowUp, disabled}: Props) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    if (response.kind === 'clarification') {
        const complete = response.questions.every(question => answers[question.id]?.trim());
        return <section className="clarification-card" aria-label="Clarifying questions">
            <div className="brief-eyebrow">LET’S SHARPEN THE BRIEF</div>
            <h2>{response.headline}</h2>
            <ReadableProse text={response.summary}/>
            <form onSubmit={event => {
                event.preventDefault();
                if (complete && !disabled) onFollowUp?.(response.questions.map(question =>
                    `${question.question} ${answers[question.id].trim()}`).join('\n'));
            }}>
                {response.questions.map((question, index) => <fieldset key={question.id} disabled={disabled}>
                    <legend><span className="question-number">0{index + 1}</span>{question.question}</legend>
                    <div className="question-options">
                        {question.options.map(option => <button type="button" key={option}
                            aria-pressed={answers[question.id] === option}
                            onClick={() => setAnswers({...answers, [question.id]: option})}>{option}</button>)}
                    </div>
                    <input aria-label={question.question} placeholder="Your answer, or choose above"
                        value={answers[question.id] || ''} maxLength={400} required
                        onChange={event => setAnswers({...answers, [question.id]: event.target.value})}/>
                </fieldset>)}
                <button className="primary-button" type="submit" disabled={!complete || disabled}>
                    Build my brief <ArrowIcon/>
                </button>
            </form>
        </section>;
    }

    const sourceLinks = (ids: string[]) => <span className="inline-citations">
        {ids.map(id => {
            const source = response.sources.find(item => item.id === id);
            return source && <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"
                title={source.title} aria-label={`Source ${id.slice(1)}: ${source.title}`}>[{id.slice(1)}]</a>;
        })}
    </span>;
    const researched = new Date(response.researchedAt).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});
    return <article className="research-brief" aria-label="Investment brief">
        <div className="brief-topline">
            <span className={`verdict verdict-${response.verdict || 'analysis'}`}>
                {response.verdict ? `${response.verdict.toUpperCase()} / THE CALL` : 'THE ANALYSIS'}
            </span>
            <span className="confidence">{response.confidence} confidence</span>
        </div>
        <h2>{response.headline}</h2>
        <ReadableProse className="brief-summary" text={response.summary}/>
        {response.evidence === 'limited' && <p className="evidence-note">Limited evidence · Read the gaps behind this call before acting.</p>}
        {response.assumptions.length > 0 && <div className="assumptions"><span>Working assumptions</span>
            <ul>{response.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
        </div>}
        <section className="brief-section">
            <h3><span>01</span> The thesis</h3>
            {response.reasons.map((reason, index) => <div className="brief-claim" key={index}>
                <h4>{reason.title}</h4><ReadableProse text={reason.detail}> {sourceLinks(reason.sourceIds)}</ReadableProse>
            </div>)}
        </section>
        <section className="brief-section strategy-section">
            <h3><span>02</span> How I’d approach it</h3>
            <ol>{response.strategy.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </section>
        <section className="brief-section">
            <h3><span>03</span> Pressure test</h3>
            {response.risks.map((risk, index) => <div className="brief-claim" key={index}>
                <h4>{risk.title}</h4><ReadableProse text={risk.detail}> {sourceLinks(risk.sourceIds)}</ReadableProse>
            </div>)}
        </section>
        <div className="change-view"><span>What would change my mind</span><ReadableProse text={response.changeMyMind}/></div>
        <details className="sources-panel">
            <summary>{response.sources.length} sources <span>Researched {researched}</span></summary>
            <p className="source-note">Web research, not a live execution quote. Publication dates are shown when supplied by the source.</p>
            <ol>{response.sources.map(source => <li key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">[{source.id.slice(1)}] {source.title} <ArrowIcon/></a>
                <span>{new URL(source.url).hostname.replace(/^www\./, '')} · {source.publishedAt ? `Published ${source.publishedAt}` : 'Publication date unavailable'}</span>
            </li>)}</ol>
        </details>
        {response.followUps.length > 0 && <div className="follow-ups" aria-label="Explore this thesis">
            {response.followUps.map(question => <button key={question} disabled={disabled} onClick={() => onFollowUp?.(question)}>
                {question} <ArrowIcon/>
            </button>)}
        </div>}
    </article>;
}
