import React, {useState, useEffect, useRef} from 'react';
import {type ChatMessage as ChatMessageType, chatService} from '../services/chatService';
import ChatMessage from './ChatMessage';
import './ChatInterface.css';

const ChatInterface: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages are added
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize with welcome message
    useEffect(() => {
        const welcomeMessage = chatService.getWelcomeMessage();
        setMessages([welcomeMessage]);
    }, []);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMessage = chatService.createMessage(inputValue, true);
        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);

        try {
            const botResponse = await chatService.getBotResponse(inputValue);
            const botMessage = chatService.createMessage(botResponse, false);
            setMessages(prev => [...prev, botMessage]);
        } catch {
            const errorMessage = chatService.createMessage(
                "I'm sorry, I'm having trouble processing your request right now. Please try again.",
                false
            );
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="chat-interface">
            <div className="chat-header">
                <div className="header-content">
                    <div className="bot-avatar">💰</div>
                    <div className="header-text">
                        <h1>JunieVest</h1>
                        <p>Your Personal Finance Assistant</p>
                    </div>
                </div>
            </div>

            <div className="chat-messages">
                {messages.map((message) => (
                    <ChatMessage key={message.id} message={message}/>
                ))}
                {isLoading && (
                    <div className="typing-indicator">
                        <div className="typing-bubble">
                            <div className="typing-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef}/>
            </div>

            <div className="chat-input-container">
                <div className="chat-input-wrapper">
          <textarea
              className="chat-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask me about budgeting, saving, investing..."
              rows={1}
              disabled={isLoading}
          />
                    <button
                        className="send-button"
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || isLoading}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatInterface;