// ===========================================
// REDIS CLIENT
// ===========================================

import { createClient } from 'redis';
import { logInfo, logError, logWarning } from './logger';

// Create Redis client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;
let isConnected = false;

const REDIS_URL = (process.env.REDIS_URL || '').trim();
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

export const isRedisConfigured = (): boolean => {
  return REDIS_ENABLED && REDIS_URL.length > 0;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getRedisClient = (): any => {
  return redisClient;
};

export const isRedisConnected = (): boolean => {
  return isConnected;
};

export const connectRedis = async (): Promise<void> => {
  // Skip Redis if explicitly disabled
  if (!REDIS_ENABLED) {
    redisClient = null;
    isConnected = false;
    logInfo('Redis is disabled - caching will be bypassed');
    return;
  }

  if (!REDIS_URL) {
    logInfo('Redis URL not set - caching will be bypassed');
    redisClient = null;
    isConnected = false;
    return;
  }

  try {
    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logError(new Error('Redis: Too many reconnection attempts'));
            return new Error('Too many retries');
          }
          return Math.min(retries * 100, 3000); // Exponential backoff, max 3s
        },
        connectTimeout: 5000 // 5 seconds
      }
    });

    redisClient.on('error', (err: Error) => {
      logError(err, { context: 'Redis Client Error' });
      isConnected = false;
    });

    redisClient.on('connect', () => {
      logInfo('Redis connecting...');
    });

    redisClient.on('ready', () => {
      logInfo('Redis connected successfully');
      isConnected = true;
    });

    redisClient.on('end', () => {
      logInfo('Redis connection closed');
      isConnected = false;
    });

    redisClient.on('reconnecting', () => {
      logInfo('Redis reconnecting...');
      isConnected = false;
    });

    await redisClient.connect();
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Redis connection failed' });
    logWarning('Running without Redis cache - all requests will hit the database');
    redisClient = null;
    isConnected = false;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient && isConnected) {
    try {
      await redisClient.quit();
      logInfo('Redis disconnected gracefully');
    } catch (error: unknown) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error disconnecting Redis' });
    }
  }
};

export default redisClient;
