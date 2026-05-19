// ===========================================
// CONTEXT BUILDER UTIL — UNIT TESTS
// Covers: buildEnhancedContext, calculateTemporalWeight
// ===========================================

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    contentChunk: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/vectorStore', () => ({
  searchSimilar: jest.fn(),
}));

jest.mock('../../utils/openai', () => ({
  generateEmbedding: jest.fn(),
}));

import prisma from '../../../prisma/client';
import * as vectorStore from '../../utils/vectorStore';
import * as openaiUtil from '../../utils/openai';
import {
  buildEnhancedContext,
  calculateTemporalWeight,
} from '../../utils/contextBuilder';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockSearchSimilar = vectorStore.searchSimilar as jest.Mock;
const mockGenerateEmbedding = openaiUtil.generateEmbedding as jest.Mock;

// -----------------------------------------------------------------------
// calculateTemporalWeight — pure function, no mocks needed
// -----------------------------------------------------------------------

describe('calculateTemporalWeight', () => {
  it('should return 1.0 for very recent content (< ~29 days)', () => {
    const recentDate = new Date();
    const weight = calculateTemporalWeight(recentDate, 10);
    expect(weight).toBe(1.0);
  });

  it('should return 1.0 for content at the 0.08 boundary (~29 days)', () => {
    const weight = calculateTemporalWeight(new Date(), 29);
    expect(weight).toBe(1.0);
  });

  it('should return less than 1.0 for older content (> 29 days)', () => {
    const weight = calculateTemporalWeight(new Date(), 180);
    expect(weight).toBeLessThan(1.0);
  });

  it('should return at least 0.5 for any content age', () => {
    const weight = calculateTemporalWeight(new Date(), 365);
    expect(weight).toBeGreaterThanOrEqual(0.5);
  });

  it('should return exactly 0.5 for 1-year-old content (max age)', () => {
    const weight = calculateTemporalWeight(new Date(), 365);
    // ageRatio = 1.0  →  1.0 - 1.0 * 0.5 = 0.5
    expect(weight).toBe(0.5);
  });

  it('should cap at 0.5 for content older than maxAge', () => {
    const weight = calculateTemporalWeight(new Date(), 730); // 2 years
    // ageRatio is capped at 1 by Math.min  →  same as 365
    expect(weight).toBe(0.5);
  });

  it('should return 1.0 for brand-new content (0 days old)', () => {
    const weight = calculateTemporalWeight(new Date(), 0);
    expect(weight).toBe(1.0);
  });
});

// -----------------------------------------------------------------------
// buildEnhancedContext
// -----------------------------------------------------------------------

describe('buildEnhancedContext', () => {
  const baseOptions = {
    creatorId: 'creator-1',
    userMessage: 'Tell me about pricing',
    conversationHistory: [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ],
  };

  beforeEach(() => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSearchSimilar.mockReturnValue([
      { text: 'Pricing information here', score: 0.9 },
      { text: 'Another relevant chunk', score: 0.8 },
    ]);
    (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('should return relevantChunks, enhancedHistory, and no summary by default', async () => {
    const result = await buildEnhancedContext(baseOptions);

    expect(result).toHaveProperty('relevantChunks');
    expect(result).toHaveProperty('enhancedHistory');
    expect(result.conversationSummary).toBeUndefined();
  });

  it('should call generateEmbedding with the user message', async () => {
    await buildEnhancedContext(baseOptions);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('Tell me about pricing');
  });

  it('should call searchSimilar with creatorId and embedding', async () => {
    await buildEnhancedContext(baseOptions);

    expect(mockSearchSimilar).toHaveBeenCalledWith(
      'creator-1',
      [0.1, 0.2, 0.3],
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('should limit enhancedHistory to last 20 messages', async () => {
    const longHistory = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i}`,
    }));

    const result = await buildEnhancedContext({
      ...baseOptions,
      conversationHistory: longHistory,
    });

    expect(result.enhancedHistory).toHaveLength(20);
    // Should be the LAST 20
    expect(result.enhancedHistory[0].content).toBe('message 10');
  });

  it('should score and return semantic chunks weighted at 0.7', async () => {
    mockSearchSimilar.mockReturnValue([{ text: 'chunk text here', score: 1.0 }]);

    const result = await buildEnhancedContext({
      ...baseOptions,
      useHybridSearch: false,
    });

    // Semantic weight = score * 0.7 = 1.0 * 0.7 = 0.7
    const chunk = result.relevantChunks.find((c) => c.text === 'chunk text here');
    expect(chunk).toBeDefined();
    expect(chunk!.score).toBeCloseTo(0.7, 5);
  });

  it('should not call contentChunk.findMany when useHybridSearch is false', async () => {
    await buildEnhancedContext({ ...baseOptions, useHybridSearch: false });

    expect(mockPrisma.contentChunk.findMany).not.toHaveBeenCalled();
  });

  it('should perform keyword search when useHybridSearch is true', async () => {
    (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([
      {
        text: 'Pricing details and subscription plans',
        content: { title: 'Pricing FAQ', type: 'FAQ' },
      },
    ]);

    const result = await buildEnhancedContext({
      ...baseOptions,
      useHybridSearch: true,
    });

    expect(mockPrisma.contentChunk.findMany).toHaveBeenCalled();
    expect(result.relevantChunks.length).toBeGreaterThan(0);
  });

  it('should generate a conversation summary when history > 10 and flag is set', async () => {
    const longHistory = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i} about pricing subscription plans`,
    }));

    const result = await buildEnhancedContext({
      ...baseOptions,
      conversationHistory: longHistory,
      includeConversationSummary: true,
    });

    expect(result.conversationSummary).toBeDefined();
    expect(typeof result.conversationSummary).toBe('string');
    expect(result.conversationSummary).toContain('Previous conversation topics:');
  });

  it('should NOT generate summary when history <= 10 even with flag set', async () => {
    const shortHistory = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i}`,
    }));

    const result = await buildEnhancedContext({
      ...baseOptions,
      conversationHistory: shortHistory,
      includeConversationSummary: true,
    });

    expect(result.conversationSummary).toBeUndefined();
  });

  it('should respect maxChunks limit on returned results', async () => {
    mockSearchSimilar.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({
        text: `unique chunk number ${i} with enough text`,
        score: 0.9 - i * 0.01,
      }))
    );

    const result = await buildEnhancedContext({
      ...baseOptions,
      maxChunks: 3,
      useHybridSearch: false,
    });

    expect(result.relevantChunks.length).toBeLessThanOrEqual(3);
  });

  it('should boost chunk score when it appears in both semantic and keyword results', async () => {
    const sharedText = 'shared chunk that appears in both results with enough text';
    mockSearchSimilar.mockReturnValue([{ text: sharedText, score: 1.0 }]);
    (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([
      {
        text: sharedText,
        content: { title: 'Shared Source', type: 'FAQ' },
      },
    ]);

    const result = await buildEnhancedContext({
      ...baseOptions,
      useHybridSearch: true,
    });

    const chunk = result.relevantChunks.find((c) => c.text === sharedText);
    expect(chunk).toBeDefined();
    // Semantic weight alone is 0.7; with keyword boost it should exceed 0.7
    expect(chunk!.score).toBeGreaterThan(0.7);
  });

  it('should handle empty semantic results gracefully', async () => {
    mockSearchSimilar.mockReturnValue([]);
    (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

    const result = await buildEnhancedContext(baseOptions);

    expect(result.relevantChunks).toEqual([]);
  });

  it('should return empty relevantChunks when userMessage has only stop words', async () => {
    mockSearchSimilar.mockReturnValue([]);
    (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

    const result = await buildEnhancedContext({
      ...baseOptions,
      userMessage: 'the and or but',
      useHybridSearch: true,
    });

    // No keywords extracted → keyword search returns []
    expect(result.relevantChunks).toEqual([]);
    // findMany should NOT be called when no keywords extracted
    expect(mockPrisma.contentChunk.findMany).not.toHaveBeenCalled();
  });
});
