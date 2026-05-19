// ===========================================
// CACHE MIDDLEWARE
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { getRedisClient, isRedisConnected } from '../utils/redis';
import { logDebug, logError } from '../utils/logger';

/**
 * Cache middleware - caches GET requests
 * @param duration - Cache duration in seconds (default: 300 = 5 minutes)
 */
export const cacheMiddleware = (duration: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache if Redis is not connected
    const redisClient = getRedisClient();
    if (!redisClient || !isRedisConnected()) {
      return next();
    }

    // Skip cache in development for easier debugging
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    // Generate cache key from URL and query params (scope by user when authenticated)
    const userId = req.user?.id;
    const key = `cache:${req.originalUrl || req.url}${userId ? `:user:${userId}` : ''}`;

    try {
      // Try to get cached data
      const cachedData = await redisClient.get(key);

      if (cachedData) {
        logDebug(`Cache HIT: ${key}`);
        return res.json(JSON.parse(cachedData as string));
      }

      logDebug(`Cache MISS: ${key}`);

      // Store original res.json function
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = (data: unknown) => {
        // Cache the response asynchronously (don't wait)
        redisClient.setEx(key, duration, JSON.stringify(data))
          .then(() => {
            logDebug(`Cached: ${key} (TTL: ${duration}s)`);
          })
          .catch((err: Error) => {
            logError(err, { context: `Cache set error for ${key}` });
          });

        // Send response immediately
        return originalJson(data);
      };

      next();
    } catch (error: unknown) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Redis cache error' });
      // Continue without cache on error
      next();
    }
  };
};

/**
 * Invalidate cache by pattern
 * @param pattern - Redis key pattern (e.g., "cache:/api/creators*")
 */
export const invalidateCache = async (pattern: string): Promise<number> => {
  const redisClient = getRedisClient();

  if (!redisClient || !isRedisConnected()) {
    return 0;
  }

  try {
    const keys = await redisClient.keys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    await redisClient.del(keys);
    logDebug(`Invalidated ${keys.length} cache keys matching: ${pattern}`);
    return keys.length;
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Cache invalidation error' });
    return 0;
  }
};

/**
 * Clear all cache
 */
export const clearAllCache = async (): Promise<void> => {
  const redisClient = getRedisClient();

  if (!redisClient || !isRedisConnected()) {
    return;
  }

  try {
    const keys = await redisClient.keys('cache:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
      logDebug(`Cleared all cache (${keys.length} keys)`);
    }
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Clear all cache error' });
  }
};
