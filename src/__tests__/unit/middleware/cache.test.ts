// ===========================================
// CACHE MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';

const mockGet = jest.fn();
const mockSetEx = jest.fn();
const mockKeys = jest.fn();
const mockDel = jest.fn();
let mockRedisClient: any = {
  get: mockGet,
  setEx: mockSetEx,
  keys: mockKeys,
  del: mockDel
};
let mockIsConnected = true;

const mockGetRedisClient = jest.fn();
const mockIsRedisConnected = jest.fn();

jest.mock('../../../utils/redis', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected
}));

import { cacheMiddleware, invalidateCache, clearAllCache } from '../../../middleware/cache';

const createMockReq = (overrides: Partial<Request> = {}): Request => ({
  method: 'GET',
  originalUrl: '/api/test',
  url: '/api/test',
  headers: {},
  body: {},
  query: {},
  params: {},
  ...overrides
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('Cache Middleware', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConnected = true;
    mockRedisClient = {
      get: mockGet,
      setEx: mockSetEx,
      keys: mockKeys,
      del: mockDel
    };
    mockGetRedisClient.mockImplementation(() => mockRedisClient);
    mockIsRedisConnected.mockImplementation(() => mockIsConnected);
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // ===========================================
  // cacheMiddleware
  // ===========================================
  describe('cacheMiddleware', () => {
    it('should skip non-GET requests', async () => {
      const req = createMockReq({ method: 'POST' });
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should skip when Redis is not connected', async () => {
      mockIsConnected = false;
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should skip when Redis client is null', async () => {
      mockRedisClient = null;
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip cache in development environment', async () => {
      process.env.NODE_ENV = 'development';
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should return cached data on cache hit', async () => {
      const cachedData = JSON.stringify({ data: 'cached' });
      mockGet.mockResolvedValue(cachedData);

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: 'cached' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next and override res.json on cache miss', async () => {
      mockGet.mockResolvedValue(null);
      mockSetEx.mockResolvedValue('OK');

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(600);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();

      // The res.json should have been overridden
      // Call the overridden json to trigger caching
      const responseData = { data: 'fresh' };
      res.json(responseData);

      // Wait for async cache set
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSetEx).toHaveBeenCalledWith(
        expect.stringContaining('cache:'),
        600,
        JSON.stringify(responseData)
      );
    });

    it('should include user ID in cache key when authenticated', async () => {
      mockGet.mockResolvedValue(null);

      const req = createMockReq();
      (req as any).user = { id: 'user-123' };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockGet).toHaveBeenCalledWith('cache:/api/test:user:user-123');
    });

    it('should use default duration of 300 seconds', async () => {
      mockGet.mockResolvedValue(null);
      mockSetEx.mockResolvedValue('OK');

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware();
      await middleware(req, res, next);

      // Trigger the overridden json to check duration
      res.json({ test: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSetEx).toHaveBeenCalledWith(
        expect.any(String),
        300,
        expect.any(String)
      );
    });

    it('should continue on Redis error during get', async () => {
      mockGet.mockRejectedValue(new Error('Redis connection error'));

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle Redis error during cache set gracefully', async () => {
      mockGet.mockResolvedValue(null);
      mockSetEx.mockRejectedValue(new Error('Redis set error'));

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      // Call overridden json - should not throw
      res.json({ data: 'test' });
      await new Promise(resolve => setImmediate(resolve));

      // Should not throw, just log error
    });
  });

  // ===========================================
  // invalidateCache
  // ===========================================
  describe('invalidateCache', () => {
    it('should delete matching keys', async () => {
      mockKeys.mockResolvedValue(['cache:key1', 'cache:key2']);
      mockDel.mockResolvedValue(2);

      const result = await invalidateCache('cache:*');

      expect(mockKeys).toHaveBeenCalledWith('cache:*');
      expect(mockDel).toHaveBeenCalledWith(['cache:key1', 'cache:key2']);
      expect(result).toBe(2);
    });

    it('should return 0 when no matching keys', async () => {
      mockKeys.mockResolvedValue([]);

      const result = await invalidateCache('cache:nonexistent*');

      expect(result).toBe(0);
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('should return 0 when Redis is not connected', async () => {
      mockIsConnected = false;

      const result = await invalidateCache('cache:*');

      expect(result).toBe(0);
    });

    it('should return 0 when Redis client is null', async () => {
      mockRedisClient = null;

      const result = await invalidateCache('cache:*');

      expect(result).toBe(0);
    });

    it('should return 0 on Redis error', async () => {
      mockKeys.mockRejectedValue(new Error('Redis error'));

      const result = await invalidateCache('cache:*');

      expect(result).toBe(0);
    });
  });

  // ===========================================
  // clearAllCache
  // ===========================================
  describe('clearAllCache', () => {
    it('should delete all cache keys', async () => {
      mockKeys.mockResolvedValue(['cache:a', 'cache:b']);
      mockDel.mockResolvedValue(2);

      await clearAllCache();

      expect(mockKeys).toHaveBeenCalledWith('cache:*');
      expect(mockDel).toHaveBeenCalledWith(['cache:a', 'cache:b']);
    });

    it('should handle empty cache gracefully', async () => {
      mockKeys.mockResolvedValue([]);

      await clearAllCache();

      expect(mockDel).not.toHaveBeenCalled();
    });

    it('should handle Redis not connected', async () => {
      mockIsConnected = false;

      await clearAllCache();

      expect(mockKeys).not.toHaveBeenCalled();
    });

    it('should handle Redis client null', async () => {
      mockRedisClient = null;

      await clearAllCache();

      expect(mockKeys).not.toHaveBeenCalled();
    });

    it('should handle Redis error gracefully', async () => {
      mockKeys.mockRejectedValue(new Error('Redis error'));

      await expect(clearAllCache()).resolves.toBeUndefined();
    });
  });

  // ===========================================
  // cacheMiddleware — additional branches
  // ===========================================
  describe('cacheMiddleware — additional branches', () => {
    it('should use req.url when originalUrl is not set', async () => {
      mockGet.mockResolvedValue(null);

      const req = createMockReq({ originalUrl: undefined as any, url: '/api/fallback' });
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(300);
      await middleware(req, res, next);

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/fallback'));
    });

    it('should scope cache key by user ID when user is present', async () => {
      mockGet.mockResolvedValue(null);

      const req = createMockReq({ originalUrl: '/api/feed' });
      (req as any).user = { id: 'user-abc' };
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(60);
      await middleware(req, res, next);

      expect(mockGet).toHaveBeenCalledWith('cache:/api/feed:user:user-abc');
    });

    it('should not scope cache key when user is absent', async () => {
      mockGet.mockResolvedValue(null);

      const req = createMockReq({ originalUrl: '/api/public' });
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware(60);
      await middleware(req, res, next);

      expect(mockGet).toHaveBeenCalledWith('cache:/api/public');
    });

    it('should return parsed JSON from cache hit (object)', async () => {
      const payload = { items: [1, 2, 3], count: 3 };
      mockGet.mockResolvedValue(JSON.stringify(payload));

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware();
      await middleware(req, res, next);

      expect(res.json).toHaveBeenCalledWith(payload);
    });

    it('should pass through PUT requests without caching', async () => {
      const req = createMockReq({ method: 'PUT' });
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should pass through DELETE requests without caching', async () => {
      const req = createMockReq({ method: 'DELETE' });
      const res = createMockRes();
      const next = jest.fn();

      const middleware = cacheMiddleware();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // invalidateCache — additional branches
  // ===========================================
  describe('invalidateCache — additional branches', () => {
    it('should delete exactly the matching key count', async () => {
      mockKeys.mockResolvedValue(['cache:/api/creators/1', 'cache:/api/creators/2', 'cache:/api/creators/3']);
      mockDel.mockResolvedValue(3);

      const result = await invalidateCache('cache:/api/creators*');

      expect(result).toBe(3);
      expect(mockDel).toHaveBeenCalledWith(['cache:/api/creators/1', 'cache:/api/creators/2', 'cache:/api/creators/3']);
    });

    it('should return 0 when del throws after keys found', async () => {
      mockKeys.mockResolvedValue(['cache:key1']);
      mockDel.mockRejectedValue(new Error('del failed'));

      const result = await invalidateCache('cache:*');

      expect(result).toBe(0);
    });
  });

  // ===========================================
  // clearAllCache — additional branches
  // ===========================================
  describe('clearAllCache — additional branches', () => {
    it('should delete all keys when many exist', async () => {
      const keys = Array.from({ length: 10 }, (_, i) => `cache:key-${i}`);
      mockKeys.mockResolvedValue(keys);
      mockDel.mockResolvedValue(10);

      await clearAllCache();

      expect(mockDel).toHaveBeenCalledWith(keys);
    });

    it('should swallow error when del throws', async () => {
      mockKeys.mockResolvedValue(['cache:x']);
      mockDel.mockRejectedValue(new Error('del failed'));

      await expect(clearAllCache()).resolves.toBeUndefined();
    });
  });
});
