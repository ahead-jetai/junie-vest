import {describe, it, expect, vi, afterEach} from 'vitest';
import {chatService} from './chatService';
import {requestFixture, responseFixture, clarificationFixture} from '../test/fixtures';

const mockFetch = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('chat transport', () => {
    it('sends history and context to the same-origin backend without browser credentials', async () => {
        vi.stubGlobal('fetch', mockFetch.mockResolvedValue(new Response(JSON.stringify(responseFixture))));
        const signal = new AbortController().signal;
        expect(await chatService.getBotResponse(requestFixture, signal)).toEqual(responseFixture);
        expect(mockFetch).toHaveBeenCalledWith('/api/chat', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(requestFixture), signal,
        });
    });

    it('preserves clarification questions, answers and source context in subsequent turns', () => {
        const messages = [chatService.createMessage('Help me invest.', true), chatService.createResponse(clarificationFixture),
            chatService.createMessage('More than 5 years, United States.', true), chatService.createResponse(responseFixture)];
        const request = chatService.createRequest(messages, requestFixture.context);
        expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
        expect(JSON.parse(request.messages[1].content)).toEqual(clarificationFixture);
        expect(JSON.parse(request.messages[3].content)).toEqual(responseFixture);
        expect(new Set(messages.map(message => message.id)).size).toBe(4);
    });

    it('rejects an answer with a fabricated citation rather than rendering it', async () => {
        vi.stubGlobal('fetch', mockFetch.mockResolvedValue(new Response(JSON.stringify({
            ...responseFixture, reasons: [{title: 'Claim', detail: 'Unverified.', sourceIds: ['S99']}],
        }))));
        await expect(chatService.getBotResponse(requestFixture)).rejects.toThrow('incomplete brief');
    });

    it('surfaces actionable server errors and handles a non-JSON proxy response', async () => {
        vi.stubGlobal('fetch', mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({error: 'Current research is unavailable.'}), {status: 502}))
            .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', {status: 502})));
        await expect(chatService.getBotResponse(requestFixture)).rejects.toThrow('Current research is unavailable.');
        await expect(chatService.getBotResponse(requestFixture)).rejects.toThrow('Please retry');
    });

    it('preserves cancellation and translates network errors', async () => {
        vi.stubGlobal('fetch', mockFetch.mockRejectedValue(new Error('network')));
        await expect(chatService.getBotResponse(requestFixture)).rejects.toThrow('Check your connection');
        const controller = new AbortController();
        controller.abort();
        await expect(chatService.getBotResponse(requestFixture, controller.signal)).rejects.toThrow('network');
    });
});
