import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {ChatMessage as ChatMessageType} from '../services/chatService';
import './ChatMessage.css';

interface ChatMessageProps {
    message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({message}) => {
    const formatTime = (timestamp: Date) => {
        return timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    return (
        <div className={`message-container ${message.isUser ? 'user-message' : 'bot-message'}`}>
            <div className="message-bubble">
                <div className={`message-text ${message.isUser ? 'message-plain-text' : 'message-markdown'}`}>
                    {message.isUser ? message.text : (
                        <Markdown
                            remarkPlugins={[remarkGfm]}
                            skipHtml
                            components={{
                                a: ({href, title, children}) => (
                                    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                                        {children}
                                    </a>
                                ),
                                table: ({children}) => (
                                    <div className="message-table" role="region" aria-label="Table" tabIndex={0}>
                                        <table>{children}</table>
                                    </div>
                                ),
                                pre: ({children}) => (
                                    <pre tabIndex={0} aria-label="Code block">{children}</pre>
                                )
                            }}
                        >
                            {message.text}
                        </Markdown>
                    )}
                </div>
                <div className="message-timestamp">
                    {formatTime(message.timestamp)}
                </div>
            </div>
        </div>
    );
};

export default ChatMessage;
