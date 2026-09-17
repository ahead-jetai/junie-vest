import {responseSchema, responseToText, type AgentResponse, type InvestorContext, type AgentRequest} from '../shared/agent';

export interface ChatMessage {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: Date;
    response?: AgentResponse;
}

class ChatService {
    async getBotResponse(request: AgentRequest, signal?: AbortSignal): Promise<AgentResponse> {
        let response: Response;
        try {
            response = await fetch('/api/chat', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(request), signal,
            });
        } catch (error) {
            if (signal?.aborted) throw error;
            throw new Error('Could not reach the research desk. Check your connection and retry.');
        }
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
                ? data.error : 'The research desk could not complete this brief. Please retry.';
            throw new Error(message);
        }
        const parsed = responseSchema.safeParse(data);
        if (!parsed.success) throw new Error('The research desk returned an incomplete brief. Please retry.');
        return parsed.data;
    }

    createRequest(messages: ChatMessage[], context: InvestorContext, mode: 'quick' | 'deep' = 'quick'): AgentRequest {
        return {messages: messages.map(message => ({
            role: message.isUser ? 'user' : 'assistant', content: message.text,
        })), context, mode};
    }

    createMessage(text: string, isUser: boolean): ChatMessage {
        return {id: crypto.randomUUID(), text, isUser, timestamp: new Date()};
    }

    createResponse(response: AgentResponse): ChatMessage {
        return {...this.createMessage(responseToText(response), false), response};
    }
}

export const chatService = new ChatService();
