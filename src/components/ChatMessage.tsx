import React from 'react';
import {type ChatMessage as ChatMessageType} from '../services/chatService';
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
                <div className="message-text">{message.text}</div>
                <div className="message-timestamp">
                    {formatTime(message.timestamp)}
                </div>
            </div>
        </div>
    );
};

export default ChatMessage;