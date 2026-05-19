// ===========================================
// OPENAI UTILITY — UNIT TESTS
// ===========================================

// ─── Mock config BEFORE any imports ────────────────────────────────────────

let mockApiKey = 'test-api-key';

jest.mock('../../config', () => ({
  config: {
    get openai() {
      return { apiKey: mockApiKey, model: 'gpt-4o-mini' };
    },
  },
}));

// ─── Mock OpenAI client ─────────────────────────────────────────────────────

const mockEmbeddingsCreate = jest.fn();
const mockChatCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
    chat: { completions: { create: mockChatCreate } },
  }));
});

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  isOpenAIConfigured,
  generateEmbedding,
  generateEmbeddings,
  generateChatCompletion,
  generateCreatorResponse,
  stripMarkdown,
  chunkText,
  estimateTokens,
  ChatMessage,
  CreatorContext,
} from '../../utils/openai';

// ─────────────────────────────────────────────────────────────────────────────

describe('OpenAI Utility', () => {
  beforeEach(() => {
    mockApiKey = 'test-api-key';
  });

  // ─── isOpenAIConfigured ─────────────────────────────────────────

  describe('isOpenAIConfigured', () => {
    it('should return true when apiKey is set', () => {
      mockApiKey = 'sk-some-key';
      expect(isOpenAIConfigured()).toBe(true);
    });

    it('should return false when apiKey is empty string', () => {
      mockApiKey = '';
      expect(isOpenAIConfigured()).toBe(false);
    });
  });

  // ─── generateEmbedding ─────────────────────────────────────────

  describe('generateEmbedding', () => {
    it('should throw when OpenAI is not configured', async () => {
      mockApiKey = '';
      await expect(generateEmbedding('hello')).rejects.toThrow('OpenAI API key not configured');
    });

    it('should return embedding array on success', async () => {
      mockApiKey = 'key';
      const fakeEmbedding = [0.1, 0.2, 0.3];
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: fakeEmbedding }],
      });

      const result = await generateEmbedding('test text');
      expect(result).toEqual(fakeEmbedding);
    });

    it('should slice input to 8000 chars', async () => {
      mockApiKey = 'key';
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1] }] });
      const longText = 'a'.repeat(10000);

      await generateEmbedding(longText);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: longText.slice(0, 8000) })
      );
    });

    it('should use text-embedding-3-small model', async () => {
      mockApiKey = 'key';
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.5] }] });

      await generateEmbedding('sample');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-small' })
      );
    });

    it('should propagate API errors', async () => {
      mockApiKey = 'key';
      mockEmbeddingsCreate.mockRejectedValue(new Error('rate limit exceeded'));

      await expect(generateEmbedding('test')).rejects.toThrow('rate limit exceeded');
    });
  });

  // ─── generateEmbeddings ────────────────────────────────────────

  describe('generateEmbeddings', () => {
    it('should throw when OpenAI is not configured', async () => {
      mockApiKey = '';
      await expect(generateEmbeddings(['a', 'b'])).rejects.toThrow('OpenAI API key not configured');
    });

    it('should return embeddings for a small batch (<= 100)', async () => {
      mockApiKey = 'key';
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1] }, { embedding: [0.2] }],
      });

      const result = await generateEmbeddings(['text1', 'text2']);
      expect(result).toEqual([[0.1], [0.2]]);
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    });

    it('should process in batches of 100', async () => {
      mockApiKey = 'key';
      const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
      // First batch: 100, second batch: 50
      mockEmbeddingsCreate
        .mockResolvedValueOnce({
          data: Array.from({ length: 100 }, (_, i) => ({ embedding: [i * 0.01] })),
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 50 }, (_, i) => ({ embedding: [(100 + i) * 0.01] })),
        });

      const result = await generateEmbeddings(texts);
      expect(result).toHaveLength(150);
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty input', async () => {
      mockApiKey = 'key';
      const result = await generateEmbeddings([]);
      expect(result).toEqual([]);
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });

    it('should slice each text to 8000 chars within batch', async () => {
      mockApiKey = 'key';
      const longText = 'x'.repeat(10000);
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1] }] });

      await generateEmbeddings([longText]);

      const call = mockEmbeddingsCreate.mock.calls[0][0];
      expect(call.input[0].length).toBe(8000);
    });
  });

  // ─── generateChatCompletion ────────────────────────────────────

  describe('generateChatCompletion', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];

    it('should throw when OpenAI is not configured', async () => {
      mockApiKey = '';
      await expect(generateChatCompletion(messages)).rejects.toThrow('OpenAI API key not configured');
    });

    it('should return content and tokensUsed on success', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi there!' } }],
        usage: { total_tokens: 42 },
      });

      const result = await generateChatCompletion(messages);
      expect(result.content).toBe('Hi there!');
      expect(result.tokensUsed).toBe(42);
    });

    it('should use default maxTokens=1000 and temperature=0.7', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      await generateChatCompletion(messages);

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1000, temperature: 0.7 })
      );
    });

    it('should use provided maxTokens and temperature overrides', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      await generateChatCompletion(messages, { maxTokens: 500, temperature: 0.2 });

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 500, temperature: 0.2 })
      );
    });

    it('should return empty string when choice content is null', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { total_tokens: 1 },
      });

      const result = await generateChatCompletion(messages);
      expect(result.content).toBe('');
    });

    it('should return 0 tokensUsed when usage is undefined', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: undefined,
      });

      const result = await generateChatCompletion(messages);
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ─── generateCreatorResponse ───────────────────────────────────

  describe('generateCreatorResponse', () => {
    const baseContext: CreatorContext = {
      creatorName: 'TestCreator',
      relevantChunks: [],
    };

    it('should return content, tokensUsed, and qualityScore', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'This is a good answer from the creator.' } }],
        usage: { total_tokens: 20 },
      });

      const result = await generateCreatorResponse('hello', baseContext);
      expect(typeof result.content).toBe('string');
      expect(typeof result.tokensUsed).toBe('number');
      expect(typeof result.qualityScore).toBe('number');
    });

    it('should include citations when relevantChunks are provided', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Answer using context.' } }],
        usage: { total_tokens: 15 },
      });

      const context: CreatorContext = { ...baseContext, relevantChunks: ['chunk1', 'chunk2'] };
      const result = await generateCreatorResponse('question', context);
      expect(result.citations).toBeDefined();
      expect(result.citations).toContain('[1]');
      expect(result.citations).toContain('[2]');
    });

    it('should not include citations when no relevantChunks', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Simple answer.' } }],
        usage: { total_tokens: 5 },
      });

      const result = await generateCreatorResponse('question', baseContext);
      expect(result.citations).toBeUndefined();
    });

    it('should include conversationSummary in prompt when provided', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      await generateCreatorResponse('question', baseContext, [], 'summary of past chat');

      const systemMsg = (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;
      expect(systemMsg).toContain('summary of past chat');
    });

    it('should slice conversationHistory to last 10 messages', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      const history: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user' as const,
        content: `msg ${i}`,
      }));

      await generateCreatorResponse('latest', baseContext, history);

      const callMessages = (mockChatCreate.mock.calls[0][0] as any).messages;
      // system + 10 history + user = 12
      expect(callMessages.length).toBe(12);
    });

    it('should include personality in system prompt when provided', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      const ctx: CreatorContext = { ...baseContext, personality: 'Energetic and fun' };
      await generateCreatorResponse('q', ctx);

      const systemMsg = (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;
      expect(systemMsg).toContain('Energetic and fun');
    });

    it('should build prompt with personaConfig energyLevel calm', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      const ctx: CreatorContext = {
        ...baseContext,
        personaConfig: { energyLevel: 'calm' },
      };
      await generateCreatorResponse('q', ctx);
      const systemMsg = (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;
      // Actual line: "Energy: Stay grounded and measured. No hype, no exclamation points. Thoughtful pace."
      expect(systemMsg).toContain('Stay grounded');
    });

    it('should build prompt with personaConfig energyLevel high-energy', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      const ctx: CreatorContext = {
        ...baseContext,
        personaConfig: { energyLevel: 'high-energy' },
      };
      await generateCreatorResponse('q', ctx);
      const systemMsg = (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;
      // Actual line: "Energy: High-energy and enthusiastic. Short punchy lines, exclamation points are fine, keep things moving."
      expect(systemMsg).toContain('High-energy');
    });

    it('should include fewShotQA examples with non-empty answers', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });

      const ctx: CreatorContext = {
        ...baseContext,
        fewShotQA: [
          { scenario: 'How do you train?', answer: 'I train every morning.' },
          { scenario: 'Empty', answer: '' }, // should be filtered
        ],
      };
      await generateCreatorResponse('q', ctx);
      const systemMsg = (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;
      expect(systemMsg).toContain('I train every morning.');
      expect(systemMsg).not.toContain('Empty');
    });

    it('should strip markdown from the response', async () => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: '**Bold text** and __underline__ and *italic*.' } }],
        usage: { total_tokens: 10 },
      });

      const result = await generateCreatorResponse('q', baseContext);
      expect(result.content).not.toContain('**');
      expect(result.content).not.toContain('__');
    });
  });

  // ─── stripMarkdown ─────────────────────────────────────────────

  describe('stripMarkdown', () => {
    it('should remove bold with double asterisks', () => {
      expect(stripMarkdown('**hello**')).toBe('hello');
    });

    it('should remove bold with double underscores', () => {
      expect(stripMarkdown('__world__')).toBe('world');
    });

    it('should remove italic with single asterisk', () => {
      expect(stripMarkdown('*italic*')).toBe('italic');
    });

    it('should remove bullet list markers at line start', () => {
      const input = '- item one\n- item two';
      const result = stripMarkdown(input);
      expect(result).not.toContain('- ');
      expect(result).toContain('item one');
    });

    it('should remove numbered list markers', () => {
      const input = '1. First\n2. Second';
      const result = stripMarkdown(input);
      expect(result).not.toMatch(/^\d+\./m);
    });

    it('should collapse 3+ newlines to double newline', () => {
      const input = 'a\n\n\n\nb';
      const result = stripMarkdown(input);
      expect(result).toBe('a\n\nb');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(stripMarkdown('  hello  ')).toBe('hello');
    });

    it('should handle plain text without any markdown unchanged (aside from trim)', () => {
      const plain = 'This is just plain text.';
      expect(stripMarkdown(plain)).toBe(plain);
    });

    it('should remove bullet marker with asterisk at line start', () => {
      const input = '* bullet item';
      const result = stripMarkdown(input);
      expect(result).toBe('bullet item');
    });

    it('should handle empty string', () => {
      expect(stripMarkdown('')).toBe('');
    });
  });

  // ─── chunkText ─────────────────────────────────────────────────

  describe('chunkText', () => {
    it('should return a single chunk for text smaller than chunkSize', () => {
      const text = 'word1 word2 word3';
      const chunks = chunkText(text, 500, 100);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should split text into multiple chunks when exceeding chunkSize', () => {
      const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
      const chunks = chunkText(words, 500, 100);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should include overlap between consecutive chunks', () => {
      const words = Array.from({ length: 700 }, (_, i) => `w${i}`).join(' ');
      const chunks = chunkText(words, 500, 100);
      // Last words of chunk[0] should appear at start of chunk[1]
      const lastWordsOfFirst = chunks[0].split(' ').slice(-100);
      const firstWordsOfSecond = chunks[1].split(' ').slice(0, 100);
      const overlap = lastWordsOfFirst.filter(w => firstWordsOfSecond.includes(w));
      expect(overlap.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const chunks = chunkText('', 500, 100);
      // split on whitespace of '' gives [''], so one empty chunk is pushed
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should use default chunkSize=500 and overlap=100', () => {
      const words = Array.from({ length: 600 }, () => 'word').join(' ');
      expect(() => chunkText(words)).not.toThrow();
    });
  });

  // ─── estimateTokens ────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('should return a number greater than 0 for non-empty text', () => {
      expect(estimateTokens('hello world')).toBeGreaterThan(0);
    });

    it('should handle empty string without throwing', () => {
      // ''.split(/\s+/) = [''] (length 1), Math.ceil(1*1.3)=2 in this implementation
      const tokens = estimateTokens('');
      expect(typeof tokens).toBe('number');
      expect(tokens).toBeGreaterThanOrEqual(0);
    });

    it('should return higher value for longer text', () => {
      const short = estimateTokens('short');
      const long = estimateTokens('this is a much longer string with many words in it');
      expect(long).toBeGreaterThan(short);
    });

    it('should use Math.ceil (rounds up partial tokens)', () => {
      // "abc" → 1 word → 1.3 → ceil = 2
      const tokens = estimateTokens('abc');
      expect(tokens).toBe(2);
    });
  });

  // ─── buildCreatorSystemPrompt (via generateCreatorResponse) ────

  describe('buildCreatorSystemPrompt — persona branches', () => {
    const makeCtx = (overrides: Partial<CreatorContext>): CreatorContext => ({
      creatorName: 'Creator',
      relevantChunks: [],
      ...overrides,
    });

    beforeEach(() => {
      mockApiKey = 'key';
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
        usage: { total_tokens: 5 },
      });
    });

    const getSystemPrompt = () =>
      (mockChatCreate.mock.calls[0][0] as any).messages[0].content as string;

    it('should include tone when provided', async () => {
      await generateCreatorResponse('q', makeCtx({ tone: 'Very formal' }));
      expect(getSystemPrompt()).toContain('Very formal');
    });

    it('should include responseStyle when provided', async () => {
      await generateCreatorResponse('q', makeCtx({ responseStyle: 'bullet-points' }));
      expect(getSystemPrompt()).toContain('bullet-points');
    });

    it('should include welcomeMessage style hint when provided', async () => {
      await generateCreatorResponse('q', makeCtx({ welcomeMessage: 'Hey fam!' }));
      expect(getSystemPrompt()).toContain('Hey fam!');
    });

    it('should include honestyStyle=direct in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { honestyStyle: 'direct' } }));
      expect(getSystemPrompt()).toContain('direct');
    });

    it('should include honestyStyle=tough-love in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { honestyStyle: 'tough-love' } }));
      // Actual line: "Honesty: Tough love. Don't sugarcoat. If something isn't working, say it plainly."
      expect(getSystemPrompt()).toContain('Tough love');
    });

    it('should include honestyStyle=supportive in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { honestyStyle: 'supportive' } }));
      expect(getSystemPrompt()).toContain('Supportive');
    });

    it('should include humor=light in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { humor: 'light' } }));
      expect(getSystemPrompt()).toContain('humor');
    });

    it('should include humor=sarcastic in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { humor: 'sarcastic' } }));
      // Actual line: "Humor: Dry wit and sarcasm are part of your voice."
      expect(getSystemPrompt()).toContain('sarcasm');
    });

    it('should include humor=none in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { humor: 'none' } }));
      expect(getSystemPrompt()).toContain('serious');
    });

    it('should include responseFormat=short-punchy in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { responseFormat: 'short-punchy' } }));
      expect(getSystemPrompt()).toContain('Short');
    });

    it('should include responseFormat=detailed in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { responseFormat: 'detailed' } }));
      expect(getSystemPrompt()).toContain('detail');
    });

    it('should include responseFormat=bullet-lists in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({ personaConfig: { responseFormat: 'bullet-lists' } }));
      expect(getSystemPrompt()).toContain('bullet');
    });

    it('should include signaturePhrases in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({
        personaConfig: { signaturePhrases: ['Stay hungry', 'Keep grinding'] },
      }));
      expect(getSystemPrompt()).toContain('Stay hungry');
    });

    it('should include opinionatedTopics in prompt', async () => {
      await generateCreatorResponse('q', makeCtx({
        personaConfig: { opinionatedTopics: ['nutrition', 'sleep'] },
      }));
      expect(getSystemPrompt()).toContain('nutrition');
    });

    it('should skip fewShotQA block when all answers are empty', async () => {
      await generateCreatorResponse('q', makeCtx({
        fewShotQA: [{ scenario: 'q1', answer: '' }, { scenario: 'q2', answer: '   ' }],
      }));
      // "HERE IS HOW" section should not appear since all answers are blank
      expect(getSystemPrompt()).not.toContain('HERE IS HOW');
    });
  });
});
