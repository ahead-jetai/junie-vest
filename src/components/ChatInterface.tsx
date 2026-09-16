import {useState, useEffect, useRef} from 'react';
import {type ChatMessage as ChatMessageType, chatService} from '../services/chatService';
import type {AgentRequest, InvestorContext} from '../shared/agent';
import ChatMessage from './ChatMessage';
import {ArrowIcon, PlusIcon} from './Icons';
import './ChatInterface.css';

const starters = [
    {tag: 'MAKE THE CALL', title: 'Should I invest in SpaceX today?', detail: 'Access, valuation, catalysts. Give me a yes or no.'},
    {tag: 'FIND THE ANGLE', title: 'What’s a less crowded way to invest in AI?', detail: 'Look beyond the obvious mega-cap trade.'},
    {tag: 'PUT CASH TO WORK', title: 'Build a strategy for my idle cash.', detail: 'Start with my timeline, then compare the options.'},
];
const emptyContext: InvestorContext = {capital: '', horizon: '', risk: '', country: ''};

export default function ChatInterface() {
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [context, setContext] = useState<InvestorContext>(emptyContext);
    const [error, setError] = useState('');
    const [failedRequest, setFailedRequest] = useState<AgentRequest | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [connectionFailed, setConnectionFailed] = useState(false);
    const [contextExpanded, setContextExpanded] = useState(() => window.innerWidth > 600);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const activeRequest = useRef<AbortController | null>(null);
    const generation = useRef(0);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/health', {signal: controller.signal})
            .then(response => { if (!response.ok) throw new Error(); return response.json(); })
            .then((data: {configured: boolean}) => setConfigured(data.configured === true))
            .catch(() => { if (!controller.signal.aborted) setConnectionFailed(true); });
        return () => { controller.abort(); activeRequest.current?.abort(); };
    }, []);

    useEffect(() => {
        const latest = messages.at(-1);
        if (!latest && !isLoading && !error) return;
        const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        if (latest && !latest.isUser && !isLoading && !error) {
            document.getElementById(latest.id)?.scrollIntoView({behavior, block: 'start'});
        } else messagesEndRef.current?.scrollIntoView({behavior, block: 'end'});
    }, [messages, isLoading, error]);

    async function runRequest(request: AgentRequest) {
        if (activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        const currentGeneration = ++generation.current;
        setIsLoading(true);
        setError('');
        setFailedRequest(null);
        const timeout = setTimeout(() => controller.abort('timeout'), 125000);
        try {
            const response = await chatService.getBotResponse(request, controller.signal);
            if (currentGeneration === generation.current && !controller.signal.aborted) {
                setMessages(previous => [...previous, chatService.createResponse(response)]);
                setConfigured(true);
                setConnectionFailed(false);
            }
        } catch (cause) {
            if (currentGeneration !== generation.current) return;
            setError(controller.signal.aborted
                ? controller.signal.reason === 'timeout' ? 'Research took too long. Please retry.' : 'Research stopped. You can retry this brief.'
                : cause instanceof Error ? cause.message : 'The brief could not be completed. Please retry.');
            setFailedRequest(request);
        } finally {
            clearTimeout(timeout);
            if (currentGeneration === generation.current) {
                activeRequest.current = null;
                setIsLoading(false);
                inputRef.current?.focus();
            }
        }
    }

    function send(text: string) {
        if (!text.trim() || activeRequest.current) return;
        const next = [...messages, chatService.createMessage(text.trim(), true)];
        setMessages(next);
        setInputValue('');
        void runRequest(chatService.createRequest(next, {...context}));
    }

    function reset() {
        generation.current++;
        activeRequest.current?.abort();
        activeRequest.current = null;
        setMessages([]);
        setIsLoading(false);
        setError('');
        setFailedRequest(null);
        setInputValue('');
        inputRef.current?.focus();
    }

    return <div className="app-shell">
        <aside className="desk-sidebar">
            <a className="brand" href="/" aria-label="JunieVest home"><span className="brand-mark">jv<span><ArrowIcon/></span></span><span>junie<span>vest</span><small>THE RESEARCH DESK</small></span></a>
            <button className="new-brief" onClick={reset}><PlusIcon/> New brief <span><ArrowIcon/></span></button>
            <div className="sidebar-label">YOUR EDGE</div>
            <div className="desk-principle"><span>01</span><div>A view, not a vague answer.<p>A clear call with a thesis you can challenge.</p></div></div>
            <div className="desk-principle"><span>02</span><div>Evidence before conviction.<p>Fresh research. Sources you can inspect.</p></div></div>
            <div className="desk-principle"><span>03</span><div>More than the obvious trade.<p>Better entry points. Smarter expressions.</p></div></div>
            <details className="investor-context" open={contextExpanded} onToggle={event => setContextExpanded(event.currentTarget.open)}>
                <summary>Your investing context <span>Optional</span></summary>
                <p>A few details make the strategy yours.</p>
                <label>Capital to deploy<input value={context.capital} maxLength={120} placeholder="e.g. $10,000"
                    onChange={event => setContext({...context, capital: event.target.value})}/></label>
                <label>Time horizon<input value={context.horizon} maxLength={120} placeholder="e.g. 5+ years"
                    onChange={event => setContext({...context, horizon: event.target.value})}/></label>
                <label>Risk appetite<select value={context.risk} onChange={event => setContext({...context, risk: event.target.value})}>
                    <option value="">Select if known</option><option>Capital preservation</option><option>Moderate</option><option>Aggressive</option>
                </select></label>
                <label>Country / tax residence<input value={context.country} maxLength={120} placeholder="e.g. United States"
                    onChange={event => setContext({...context, country: event.target.value})}/></label>
            </details>
            <div className="sidebar-footer"><span className="tiny-square"/> Independent thinking.<br/>Evidence-led decisions.</div>
        </aside>
        <main className="chat-interface">
            <header className="chat-header">
                <span className="workspace-title">Research desk <span>/</span> <strong>{messages.length ? 'Active brief' : 'New brief'}</strong></span>
                <div className={`connection-status ${configured ? 'ready' : ''}`}><span/>
                    {connectionFailed ? 'Desk offline' : configured === null ? 'Connecting' : configured ? 'Research configured' : 'Setup required'}
                </div>
                <button className="mobile-reset" onClick={reset} aria-label="New brief"><PlusIcon/></button>
            </header>
            <div className="chat-messages">
                {messages.length === 0 && <div className="welcome-screen">
                    <div className="welcome-eyebrow"><span/> CONVICTION STARTS WITH A BETTER QUESTION</div>
                    <h1>Don’t just follow<br/>the market. <em>Think ahead.</em></h1>
                    <p className="welcome-description">Bring a ticker, a thesis, or a money move.<br/>Get a clear call, the evidence behind it, and a way to act.</p>
                    <div className="starter-grid">{starters.map((starter, index) => <button key={starter.tag} onClick={() => send(starter.title)}>
                        <div className="starter-top"><span>{starter.tag}</span><ArrowIcon/></div>
                        <h2>{starter.title}</h2><p>{starter.detail}</p><span className="starter-number">0{index + 1}</span>
                    </button>)}</div>
                    <div className="desk-method"><span>THE PROCESS</span><p>Clarify the goal <b><ArrowIcon/></b> Research what’s changed <b><ArrowIcon/></b> Make the call</p></div>
                </div>}
                {messages.map((message, index) => <ChatMessage key={message.id} message={message} onFollowUp={send}
                    disabled={isLoading || index !== messages.length - 1}/>)}
                {isLoading && <div className="research-progress" role="status"><span className="research-spinner"/>
                    <div><strong>Preparing your brief</strong><p>Reading your context, then checking current evidence before making the call.</p></div>
                    <button onClick={() => activeRequest.current?.abort('cancelled')}>Stop</button>
                </div>}
                {error && <div className="request-error" role="alert"><p>{error}</p>
                    {failedRequest && <button onClick={() => void runRequest(failedRequest)}>Retry brief <ArrowIcon/></button>}
                </div>}
                <div ref={messagesEndRef}/>
            </div>
            <div className="chat-input-container">
                {configured === false && <p className="setup-note">The research desk needs to be connected before it can build a brief.</p>}
                <form className="chat-input-wrapper" onSubmit={event => { event.preventDefault(); send(inputValue); }}>
                    <label className="sr-only" htmlFor="message-input">Your investment question</label>
                    <textarea id="message-input" ref={inputRef} className="chat-input" value={inputValue} maxLength={4000}
                        onChange={event => setInputValue(event.target.value)} rows={2}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault(); send(inputValue);
                            }
                        }} placeholder={messages.length ? 'Challenge the thesis. Ask a follow-up…' : 'Should I buy it? What’s the smarter play? Ask JunieVest…'}/>
                    <button type="submit" className="send-button" aria-label="Send message" disabled={!inputValue.trim() || isLoading}><ArrowIcon/></button>
                </form>
                <div className="composer-footer"><span>Research-backed views. Your decision.</span><span>Enter to send <b>·</b> Shift + Enter for a new line</span></div>
            </div>
        </main>
    </div>;
}
