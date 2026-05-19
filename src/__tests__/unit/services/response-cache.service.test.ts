// ===========================================
// RESPONSE CACHE SERVICE — UNIT TESTS
// ===========================================

const mockRedis = {
  get: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

jest.mock('../../../utils/redis', () => ({
  getRedisClient: jest.fn(() => mockRedis),
  isRedisConnected: jest.fn(() => true),
}));

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(),
}));

import {
  generateQueryHash,
  generateCacheKey,
  shouldCacheResponse,
  cacheResponse,
  getCachedResponse,
  invalidateCreatorCache,
} from '../../../services/ai/response-cache.service';
import { getRedisClient, isRedisConnected } from '../../../utils/redis';

describe('ResponseCacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setEx.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(0);
    mockRedis.scan.mockResolvedValue({ cursor: 0, keys: [] });
    (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
    (isRedisConnected as jest.Mock).mockReturnValue(true);
  });

  describe('generateQueryHash', () => {
    it('should generate consistent hash for same input', () => {
      const hash1 = generateQueryHash('test query');
      const hash2 = generateQueryHash('test query');
      expect(hash1).toBe(hash2);
    });

    it('should be case-insensitive', () => {
      const hash1 = generateQueryHash('Test Query');
      const hash2 = generateQueryHash('test query');
      expect(hash1).toBe(hash2);
    });

    it('should trim whitespace', () => {
      const hash1 = generateQueryHash('  test query  ');
      const hash2 = generateQueryHash('test query');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different input', () => {
      const hash1 = generateQueryHash('query one');
      const hash2 = generateQueryHash('query two');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateCacheKey', () => {
    it('should include creator ID and query hash', () => {
      const key = generateCacheKey('creator-1', 'test query');
      expect(key).toMatch(/^ai:response:creator-1:[a-f0-9]+$/);
    });

    it('should generate different keys for different creators', () => {
      const key1 = generateCacheKey('creator-1', 'same query');
      const key2 = generateCacheKey('creator-2', 'same query');
      expect(key1).not.toBe(key2);
    });
  });

  describe('shouldCacheResponse', () => {
    it('should return true for normal messages', () => {
      expect(shouldCacheResponse('What is your favorite topic?', 'I love coding!')).toBe(true);
    });

    it('should return false for short messages (< 10 chars)', () => {
      expect(shouldCacheResponse('Hi there', 'Hello!')).toBe(false);
    });

    it('should return false for long responses (> 1000 chars)', () => {
      const longResponse = 'a'.repeat(1001);
      expect(shouldCacheResponse('A normal question here', longResponse)).toBe(false);
    });

    it('should return false for greeting messages', () => {
      expect(shouldCacheResponse('hello', 'Hi there!')).toBe(false);
      expect(shouldCacheResponse('hi', 'Hi there!')).toBe(false);
      expect(shouldCacheResponse('hey friend', 'Hey!')).toBe(false);
    });

    it('should return false for time-sensitive queries', () => {
      expect(shouldCacheResponse('What is happening now?', 'Something')).toBe(false);
      expect(shouldCacheResponse('Give me the latest news', 'Here is the news')).toBe(false);
      expect(shouldCacheResponse('What is the current price', 'The price is 5')).toBe(false);
    });
  });

  describe('cacheResponse', () => {
    it('should cache response in Redis with TTL', async () => {
      mockRedis.setEx.mockResolvedValue('OK');

      await cacheResponse('test-key', {
        content: 'response',
        tokensUsed: 100,
        model: 'gpt-4o',
      });

      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'test-key',
        3600,
        expect.stringContaining('"content":"response"')
      );
    });

    it('should use custom TTL', async () => {
      mockRedis.setEx.mockResolvedValue('OK');

      await cacheResponse('key', { content: 'r', tokensUsed: 10, model: 'gpt-4o' }, 7200);

      expect(mockRedis.setEx).toHaveBeenCalledWith('key', 7200, expect.any(String));
    });

    it('should skip caching when Redis is not connected', async () => {
      (isRedisConnected as jest.Mock).mockReturnValue(false);

      await cacheResponse('key', { content: 'r', tokensUsed: 10, model: 'gpt-4o' });

      expect(mockRedis.setEx).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.setEx.mockRejectedValue(new Error('Redis timeout'));

      await expect(
        cacheResponse('key', { content: 'r', tokensUsed: 10, model: 'gpt-4o' })
      ).resolves.toBeUndefined();
    });
  });

  describe('getCachedResponse', () => {
    it('should return parsed cached response', async () => {
      const cached = {
        content: 'cached response',
        tokensUsed: 50,
        model: 'gpt-4o',
        cachedAt: 1000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await getCachedResponse('test-key');

      expect(result).toEqual(cached);
    });

    it('should return null when cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await getCachedResponse('missing-key');

      expect(result).toBeNull();
    });

    it('should return null when Redis is not connected', async () => {
      (isRedisConnected as jest.Mock).mockReturnValue(false);

      const result = await getCachedResponse('key');

      expect(result).toBeNull();
    });

    it('should handle parse errors gracefully', async () => {
      mockRedis.get.mockResolvedValue('invalid-json{{{');

      const result = await getCachedResponse('key');

      expect(result).toBeNull();
    });
  });

  describe('invalidateCreatorCache', () => {
    it('should scan and delete all keys for a creator', async () => {
      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['ai:response:creator-1:abc', 'ai:response:creator-1:def'],
      });
      mockRedis.del.mockResolvedValue(2);

      await invalidateCreatorCache('creator-1');

      expect(mockRedis.scan).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith([
        'ai:response:creator-1:abc',
        'ai:response:creator-1:def',
      ]);
    });

    it('should skip when Redis is not connected', async () => {
      (isRedisConnected as jest.Mock).mockReturnValue(false);

      await invalidateCreatorCache('creator-1');

      expect(mockRedis.scan).not.toHaveBeenCalled();
    });

    it('should handle scan errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis error'));

      await expect(invalidateCreatorCache('creator-1')).resolves.toBeUndefined();
    });
  });
});
