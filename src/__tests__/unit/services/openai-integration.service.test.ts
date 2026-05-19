// ===========================================
// OPENAI INTEGRATION SERVICE — UNIT TESTS
// ===========================================

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
}));

import { generateStreamingResponse } from '../../../services/ai/openai-integration.service';

describe('OpenAIIntegrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateStreamingResponse', () => {
    it('should accumulate streamed chunks and call onChunk callback', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ];

      // Simulate async iterable
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      });

      const onChunk = jest.fn();

      const result = await generateStreamingResponse(
        'You are helpful',
        [],
        'Say hello',
        onChunk,
        'gpt-4o',
        0.7
      );

      expect(result.content).toBe('Hello world!');
      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world', 'Hello world');
      expect(onChunk).toHaveBeenNthCalledWith(3, '!', 'Hello world!');
    });

    it('should return correct usage statistics', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Test response' } }] };
        },
      });

      const result = await generateStreamingResponse(
        'System prompt',
        [],
        'User message',
        jest.fn()
      );

      expect(result.usage.promptTokens).toBeGreaterThan(0);
      expect(result.usage.completionTokens).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBe(
        result.usage.promptTokens + result.usage.completionTokens
      );
    });

    it('should calculate cost based on token usage', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Response' } }] };
        },
      });

      const result = await generateStreamingResponse(
        'System prompt',
        [],
        'User message',
        jest.fn()
      );

      expect(result.cost).toBeGreaterThan(0);
      expect(result.model).toBe('gpt-4o');
    });

    it('should include conversation history in messages', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'OK' } }] };
        },
      });

      const history = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ];

      await generateStreamingResponse(
        'System',
        history,
        'New question',
        jest.fn()
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            { role: 'user', content: 'New question' },
          ]),
        })
      );
    });

    it('should throw and log error on API failure', async () => {
      const apiError = new Error('API rate limit exceeded');
      mockCreate.mockRejectedValue(apiError);

      await expect(
        generateStreamingResponse('System', [], 'User msg', jest.fn())
      ).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle empty delta content gracefully', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: {} }] };
          yield { choices: [{ delta: { content: ' there' } }] };
        },
      });

      const onChunk = jest.fn();
      const result = await generateStreamingResponse(
        'System',
        [],
        'User',
        onChunk
      );

      expect(result.content).toBe('Hello there');
    });
  });
});
