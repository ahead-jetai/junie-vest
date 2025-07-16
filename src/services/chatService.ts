export interface ChatMessage {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: Date;
}

interface OpenRouterResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

class ChatService {
    private readonly apiKey: string;
    private readonly baseUrl = 'https://openrouter.ai/api/v1';

    constructor() {
        this.apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
        if (!this.apiKey) {
            console.error('[ChatService] OpenRouter API key not found in environment variables');
        }
    }

    // Main method to get bot response from OpenRouter API
    async getBotResponse(userInput: string): Promise<string> {
        if (!userInput.trim()) {
            return "I'd be happy to help! Please ask me a question about budgeting, saving, investing, or any other personal finance topic.";
        }

        if (!this.apiKey) {
            console.error('[ChatService] Cannot make API call: OpenRouter API key is missing');
            throw new Error('API configuration error');
        }

        try {
            console.log('[ChatService] Making request to OpenRouter API...');

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'JunieVest - Personal Finance Assistant'
                },
                body: JSON.stringify({
                    model: 'openai/gpt-4',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are Junie, and you\'re like that friend who happens to be one of the top wealth advisors in the country. You run a popular YouTube channel with the latest financial tips and have over 1M followers on X, but you\'re super down-to-earth and talk like you\'re just hanging out with a buddy. You explain money stuff in a way that actually makes sense - no fancy jargon or cookie-cutter advice. You\'re warm, encouraging, and genuinely excited to help people build wealth. Think of yourself as that friend who\'s made it big but still remembers where they came from and wants to lift everyone up with them. Keep it real, keep it friendly, and make complex financial concepts feel totally doable.'
                        },
                        {
                            role: 'user',
                            content: userInput
                        }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[ChatService] API request failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            const data: OpenRouterResponse = await response.json();
            console.log('[ChatService] API request successful');

            if (!data.choices || data.choices.length === 0) {
                console.error('[ChatService] No choices in API response:', data);
                throw new Error('Invalid API response format');
            }

            const botResponse = data.choices[0].message.content;
            if (!botResponse) {
                console.error('[ChatService] Empty response content from API');
                throw new Error('Empty response from API');
            }

            return botResponse;

        } catch (error) {
            console.error('[ChatService] Error getting bot response:', error);

            if (error instanceof Error) {
                // Re-throw the error to be handled by the UI
                throw error;
            } else {
                throw new Error('An unexpected error occurred while processing your request');
            }
        }
    }

    // Generate unique message ID
    generateMessageId(): string {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }

    // Create a new chat message
    createMessage(text: string, isUser: boolean): ChatMessage {
        return {
            id: this.generateMessageId(),
            text,
            isUser,
            timestamp: new Date()
        };
    }

    // Get welcome message
    getWelcomeMessage(): ChatMessage {
        const welcomeText = "Hey there! 👋 I'm Junie - think of me as your friend who just happens to know a thing or two about money (okay, maybe more than a thing or two 😄). I've helped tons of people figure out their finances, and I'm genuinely excited to help you too! Whether you want to talk budgeting, investing, saving strategies, or just need someone to break down all that confusing financial stuff - I'm your person. What's on your mind?";
        return this.createMessage(welcomeText, false);
    }
}

export const chatService = new ChatService();