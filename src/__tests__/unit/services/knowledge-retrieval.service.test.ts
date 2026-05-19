// ===========================================
// KNOWLEDGE RETRIEVAL SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    contentChunk: { findMany: jest.fn() },
  },
}));

jest.mock('../../../utils/openai', () => ({
  generateEmbedding: jest.fn(),
}));

jest.mock('../../../utils/vectorStore', () => ({
  hybridSearch: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
}));

import prisma from '../../../../prisma/client';
import { generateEmbedding } from '../../../utils/openai';
import { hybridSearch } from '../../../utils/vectorStore';
import { retrieveRelevantKnowledge } from '../../../services/ai/knowledge-retrieval.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGenerateEmbedding = generateEmbedding as jest.MockedFunction<typeof generateEmbedding>;
const mockHybridSearch = hybridSearch as jest.MockedFunction<typeof hybridSearch>;

describe('KnowledgeRetrievalService', () => {
  const creatorId = 'creator-1';
  const query = 'What is your content about?';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('retrieveRelevantKnowledge', () => {
    it('should return knowledge from hybrid search when results exist', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockHybridSearch.mockReturnValue([
        { text: 'Relevant chunk 1', score: 0.9 },
        { text: 'Relevant chunk 2', score: 0.8 },
      ] as any);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual(['Relevant chunk 1', 'Relevant chunk 2']);
      expect(mockGenerateEmbedding).toHaveBeenCalledWith(query);
      expect(mockHybridSearch).toHaveBeenCalledWith(creatorId, [0.1, 0.2, 0.3], query, 3, 0.7);
    });

    it('should fallback to database chunks when hybrid search returns empty', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockHybridSearch.mockReturnValue([]);

      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([
        { text: 'DB chunk 1' },
        { text: 'DB chunk 2' },
      ]);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual(['DB chunk 1', 'DB chunk 2']);
    });

    it('should return empty array when embedding generation fails', async () => {
      mockGenerateEmbedding.mockResolvedValue(null as any);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
      expect(mockHybridSearch).not.toHaveBeenCalled();
    });

    it('should return empty array and log error on exception', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('API error'));

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
    });

    it('should use default topK of 3', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([{ text: 'chunk', score: 0.9 }] as any);

      await retrieveRelevantKnowledge(creatorId, query);

      expect(mockHybridSearch).toHaveBeenCalledWith(creatorId, [0.1], query, 3, 0.7);
    });

    // ─── NEW TESTS ──────────────────────────────────────────────────

    it('should pass custom topK to hybridSearch', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.5, 0.5]);
      mockHybridSearch.mockReturnValue([{ text: 'r1', score: 0.8 }] as any);

      await retrieveRelevantKnowledge(creatorId, query, 7);

      expect(mockHybridSearch).toHaveBeenCalledWith(creatorId, [0.5, 0.5], query, 7, 0.7);
    });

    it('should pass custom topK to prisma fallback when hybridSearch returns empty', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([
        { text: 'chunk A' },
        { text: 'chunk B' },
      ]);

      await retrieveRelevantKnowledge(creatorId, query, 5);

      expect(mockPrisma.contentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it('should query prisma with correct creatorId in fallback', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

      await retrieveRelevantKnowledge('creator-xyz', query, 3);

      expect(mockPrisma.contentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            content: {
              creatorId: 'creator-xyz',
              status: 'COMPLETED',
            },
          },
        })
      );
    });

    it('should return empty array when both hybridSearch and prisma return empty', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
    });

    it('should return empty array when embedding is undefined', async () => {
      mockGenerateEmbedding.mockResolvedValue(undefined as any);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
      expect(mockHybridSearch).not.toHaveBeenCalled();
      expect(mockPrisma.contentChunk.findMany).not.toHaveBeenCalled();
    });

    it('should map hybrid search results to text strings only', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([
        { id: 'v1', text: 'First result', score: 0.95, metadata: { key: 'val' } },
        { id: 'v2', text: 'Second result', score: 0.80 },
      ] as any);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual(['First result', 'Second result']);
    });

    it('should map prisma chunk fallback to text strings only', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.2]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([
        { text: 'DB text 1', id: 'c1', createdAt: new Date() },
        { text: 'DB text 2', id: 'c2', createdAt: new Date() },
      ]);

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual(['DB text 1', 'DB text 2']);
    });

    it('should return empty array and not throw when generateEmbedding throws non-Error', async () => {
      mockGenerateEmbedding.mockRejectedValue('string error');

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
    });

    it('should return empty array when prisma fallback throws', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(result).toEqual([]);
    });

    it('should not call prisma when hybrid search returns results', async () => {
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([{ text: 'hit', score: 0.9 }] as any);

      await retrieveRelevantKnowledge(creatorId, query, 3);

      expect(mockPrisma.contentChunk.findMany).not.toHaveBeenCalled();
    });

    it('should pass the exact query string to generateEmbedding', async () => {
      const specificQuery = 'How do I get started with your premium plan?';
      mockGenerateEmbedding.mockResolvedValue([0.1]);
      mockHybridSearch.mockReturnValue([]);
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

      await retrieveRelevantKnowledge(creatorId, specificQuery, 3);

      expect(mockGenerateEmbedding).toHaveBeenCalledWith(specificQuery);
    });
  });
});
