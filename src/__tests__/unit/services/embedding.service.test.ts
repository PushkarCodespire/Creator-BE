// ===========================================
// EMBEDDING SERVICE — UNIT TESTS
// ===========================================

const mockEmbeddingsCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

jest.mock('../../../utils/openai', () => ({
  openai: {
    embeddings: { create: mockEmbeddingsCreate },
  },
}));

jest.mock('../../../config', () => ({
  config: {
    openai: { apiKey: 'test-key' },
  },
}));

jest.mock('../../../utils/metrics', () => ({
  recordOpenAICall: jest.fn(),
  embeddingGenerationDuration: { observe: jest.fn() },
}));

jest.mock('bottleneck', () => {
  return jest.fn().mockImplementation(() => ({
    schedule: (fn: Function) => fn(),
    running: jest.fn(() => 0),
    done: jest.fn(() => 0),
    queued: jest.fn(() => 0),
  }));
});

jest.mock('async-retry', () => {
  return jest.fn().mockImplementation((fn: Function) => fn(jest.fn(), 1));
});

import retry from 'async-retry';
import { generateEmbedding, generateEmbeddings, getRateLimiterStatus } from '../../../services/content/embedding.service';

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (retry as unknown as jest.Mock).mockImplementation((fn: Function) => fn(jest.fn(), 1));
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for a single text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await generateEmbedding('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'Test text',
      });
    });

    it('should truncate text longer than 8000 characters', async () => {
      const longText = 'x'.repeat(10000);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1] }],
      });

      await generateEmbedding(longText);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'x'.repeat(8000),
      });
    });

    it('should propagate errors from OpenAI API', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('API error'));

      await expect(generateEmbedding('test')).rejects.toThrow('API error');
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ],
      });

      const result = await generateEmbeddings(['Text 1', 'Text 2']);

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it('should return empty array for empty input', async () => {
      const result = await generateEmbeddings([]);
      expect(result).toEqual([]);
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });

    it('should handle batch failures by filling with empty arrays', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('Batch failed'));

      const result = await generateEmbeddings(['Text 1', 'Text 2']);

      expect(result).toEqual([[], []]);
    });

    it('should truncate individual texts in batch to 8000 chars', async () => {
      const longText = 'y'.repeat(10000);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.5] }],
      });

      await generateEmbeddings([longText]);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['y'.repeat(8000)],
      });
    });
  });

  describe('getRateLimiterStatus', () => {
    it('should return rate limiter status', () => {
      const status = getRateLimiterStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('done');
      expect(status).toHaveProperty('queued');
    });
  });
});
