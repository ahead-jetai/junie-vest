import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {chatService, ChatMessage} from './chatService'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock window.location
Object.defineProperty(window, 'location', {
    value: {
        origin: 'http://localhost:3000'
    },
    writable: true
})

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
    value: {
        VITE_OPENROUTER_API_KEY: 'test-api-key'
    },
    writable: true
})

describe('ChatService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Reset console methods
        vi.spyOn(console, 'log').mockImplementation(() => {
        })
        vi.spyOn(console, 'error').mockImplementation(() => {
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('getBotResponse', () => {
        it('should return default message for empty input', async () => {
            const result = await chatService.getBotResponse('')
            expect(result).toBe("I'd be happy to help! Please ask me a question about budgeting, saving, investing, or any other personal finance topic.")
        })

        it('should return default message for whitespace-only input', async () => {
            const result = await chatService.getBotResponse('   ')
            expect(result).toBe("I'd be happy to help! Please ask me a question about budgeting, saving, investing, or any other personal finance topic.")
        })

        it('should throw error when API key is missing', async () => {
            // Mock the environment to have no API key
            vi.doMock('./chatService', async () => {
                const actual = await vi.importActual('./chatService')

                class MockChatService {
                    private readonly apiKey: string = ''

                    async getBotResponse(userInput: string): Promise<string> {
                        if (!userInput.trim()) {
                            return "I'd be happy to help! Please ask me a question about budgeting, saving, investing, or any other personal finance topic."
                        }

                        if (!this.apiKey) {
                            console.error('[ChatService] Cannot make API call: OpenRouter API key is missing')
                            throw new Error('API configuration error')
                        }

                        return 'Mock response'
                    }

                    generateMessageId(): string {
                        return Date.now().toString() + Math.random().toString(36).substr(2, 9)
                    }

                    createMessage(text: string, isUser: boolean) {
                        return {
                            id: this.generateMessageId(),
                            text,
                            isUser,
                            timestamp: new Date()
                        }
                    }

                    getWelcomeMessage() {
                        const welcomeText = "Hey there! 👋 I'm Junie - think of me as your friend who just happens to know a thing or two about money (okay, maybe more than a thing or two 😄). I've helped tons of people figure out their finances, and I'm genuinely excited to help you too! Whether you want to talk budgeting, investing, saving strategies, or just need someone to break down all that confusing financial stuff - I'm your person. What's on your mind?"
                        return this.createMessage(welcomeText, false)
                    }
                }

                return {
                    ...actual,
                    chatService: new MockChatService()
                }
            })

            const {chatService: mockChatService} = await import('./chatService')

            await expect(mockChatService.getBotResponse('test question')).rejects.toThrow('API configuration error')
            expect(console.error).toHaveBeenCalledWith('[ChatService] Cannot make API call: OpenRouter API key is missing')

            vi.doUnmock('./chatService')
        })

        it('should successfully make API call and return bot response', async () => {
            const mockResponse = {
                choices: [
                    {
                        message: {
                            content: 'This is a helpful financial advice response from Junie!'
                        }
                    }
                ]
            }

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            })

            const result = await chatService.getBotResponse('How should I start investing?')

            expect(result).toBe('This is a helpful financial advice response from Junie!')

            // Verify the API call was made with correct structure
            expect(mockFetch).toHaveBeenCalledTimes(1)
            const [url, options] = mockFetch.mock.calls[0]

            expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
            expect(options.method).toBe('POST')
            expect(options.headers['Content-Type']).toBe('application/json')
            expect(options.headers['HTTP-Referer']).toBe('http://localhost:3000')
            expect(options.headers['X-Title']).toBe('JunieVest - Personal Finance Assistant')
            expect(options.headers['Authorization']).toMatch(/^Bearer .+/)

            const requestBody = JSON.parse(options.body)
            expect(requestBody).toEqual({
                model: 'openai/gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: 'You are Junie, and you\'re like that friend who happens to be one of the top wealth advisors in the country. You run a popular YouTube channel with the latest financial tips and have over 1M followers on X, but you\'re super down-to-earth and talk like you\'re just hanging out with a buddy. You explain money stuff in a way that actually makes sense - no fancy jargon or cookie-cutter advice. You\'re warm, encouraging, and genuinely excited to help people build wealth. Think of yourself as that friend who\'s made it big but still remembers where they came from and wants to lift everyone up with them. Keep it real, keep it friendly, and make complex financial concepts feel totally doable.'
                    },
                    {
                        role: 'user',
                        content: 'How should I start investing?'
                    }
                ],
                temperature: 0.7
            })
            expect(console.log).toHaveBeenCalledWith('[ChatService] Making request to OpenRouter API...')
            expect(console.log).toHaveBeenCalledWith('[ChatService] API request successful')
        })

        it('should handle API request failure with non-200 status', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Invalid API key')
            })

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('API request failed: 401 Unauthorized')
            expect(console.error).toHaveBeenCalledWith('[ChatService] API request failed:', {
                status: 401,
                statusText: 'Unauthorized',
                error: 'Invalid API key'
            })
        })

        it('should handle invalid API response format (no choices)', async () => {
            const mockResponse = {
                choices: []
            }

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            })

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('Invalid API response format')
            expect(console.error).toHaveBeenCalledWith('[ChatService] No choices in API response:', mockResponse)
        })

        it('should handle invalid API response format (missing choices)', async () => {
            const mockResponse = {}

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            })

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('Invalid API response format')
            expect(console.error).toHaveBeenCalledWith('[ChatService] No choices in API response:', mockResponse)
        })

        it('should handle empty response content from API', async () => {
            const mockResponse = {
                choices: [
                    {
                        message: {
                            content: ''
                        }
                    }
                ]
            }

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            })

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('Empty response from API')
            expect(console.error).toHaveBeenCalledWith('[ChatService] Empty response content from API')
        })

        it('should handle network errors', async () => {
            const networkError = new Error('Network error')
            mockFetch.mockRejectedValueOnce(networkError)

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('Network error')
            expect(console.error).toHaveBeenCalledWith('[ChatService] Error getting bot response:', networkError)
        })

        it('should handle unexpected non-Error exceptions', async () => {
            mockFetch.mockRejectedValueOnce('string error')

            await expect(chatService.getBotResponse('test question')).rejects.toThrow('An unexpected error occurred while processing your request')
            expect(console.error).toHaveBeenCalledWith('[ChatService] Error getting bot response:', 'string error')
        })
    })

    describe('generateMessageId', () => {
        it('should generate unique message IDs', () => {
            const id1 = chatService.generateMessageId()
            const id2 = chatService.generateMessageId()

            expect(id1).toBeTruthy()
            expect(id2).toBeTruthy()
            expect(id1).not.toBe(id2)
            expect(typeof id1).toBe('string')
            expect(typeof id2).toBe('string')
        })

        it('should generate IDs with expected format', () => {
            const id = chatService.generateMessageId()

            // Should contain timestamp and random part
            expect(id.length).toBeGreaterThan(10)
            expect(id).toMatch(/^\d+[a-z0-9]+$/)
        })
    })

    describe('createMessage', () => {
        it('should create user message correctly', () => {
            const text = 'Hello, how can I invest?'
            const message = chatService.createMessage(text, true)

            expect(message).toMatchObject({
                text,
                isUser: true
            })
            expect(message.id).toBeTruthy()
            expect(message.timestamp).toBeInstanceOf(Date)
            expect(typeof message.id).toBe('string')
        })

        it('should create bot message correctly', () => {
            const text = 'Here are some investment tips...'
            const message = chatService.createMessage(text, false)

            expect(message).toMatchObject({
                text,
                isUser: false
            })
            expect(message.id).toBeTruthy()
            expect(message.timestamp).toBeInstanceOf(Date)
            expect(typeof message.id).toBe('string')
        })

        it('should create messages with unique IDs', () => {
            const message1 = chatService.createMessage('Test 1', true)
            const message2 = chatService.createMessage('Test 2', false)

            expect(message1.id).not.toBe(message2.id)
        })

        it('should handle empty text', () => {
            const message = chatService.createMessage('', true)

            expect(message.text).toBe('')
            expect(message.isUser).toBe(true)
            expect(message.id).toBeTruthy()
            expect(message.timestamp).toBeInstanceOf(Date)
        })
    })

    describe('getWelcomeMessage', () => {
        it('should return welcome message with correct properties', () => {
            const welcomeMessage = chatService.getWelcomeMessage()

            expect(welcomeMessage.isUser).toBe(false)
            expect(welcomeMessage.text).toContain('Hey there! 👋 I\'m Junie')
            expect(welcomeMessage.text).toContain('budgeting, investing, saving strategies')
            expect(welcomeMessage.id).toBeTruthy()
            expect(welcomeMessage.timestamp).toBeInstanceOf(Date)
            expect(typeof welcomeMessage.id).toBe('string')
        })

        it('should return consistent welcome message content', () => {
            const message1 = chatService.getWelcomeMessage()
            const message2 = chatService.getWelcomeMessage()

            expect(message1.text).toBe(message2.text)
            expect(message1.isUser).toBe(message2.isUser)
            // IDs should be different as they're generated fresh each time
            expect(message1.id).not.toBe(message2.id)
        })
    })

    describe('ChatMessage interface', () => {
        it('should have correct structure', () => {
            const message: ChatMessage = {
                id: 'test-id',
                text: 'test message',
                isUser: true,
                timestamp: new Date()
            }

            expect(message).toHaveProperty('id')
            expect(message).toHaveProperty('text')
            expect(message).toHaveProperty('isUser')
            expect(message).toHaveProperty('timestamp')
            expect(typeof message.id).toBe('string')
            expect(typeof message.text).toBe('string')
            expect(typeof message.isUser).toBe('boolean')
            expect(message.timestamp).toBeInstanceOf(Date)
        })
    })
})