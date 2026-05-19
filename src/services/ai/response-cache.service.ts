// ===========================================
// RESPONSE CACHE SERVICE
// Cache AI responses to reduce costs and latency
// ===========================================

import crypto from 'crypto';
import { logInfo } from '../../utils/logger';

/**
 * Generate cache key from query
 */
export function generateQueryHash(text: string): string {
    return crypto
        .createHash('md5')
        .update(text.toLowerCase().trim())
        .digest('hex');
}

/**
 * Generate cache key for creator and query
 */
export function generateCacheKey(creatorId: string, query: string): string {
    const queryHash = generateQueryHash(query);
    return `ai:response:${creatorId}:${queryHash}`;
}

/**
 * Check if response should be cached
 */
export function shouldCacheResponse(
    userMessage: string,
    aiResponse: string
): boolean {
    // Don't cache if message too short
    if (userMessage.length < 10) {
        return false;
    }

    // Don't cache if response too long (> 1000 chars)
    if (aiResponse.length > 1000) {
        return false;
    }

    // Don't cache greetings
    const greetings = ['hello', 'hi', 'hey', 'greetings'];
    const lowerMessage = userMessage.toLowerCase();
    if (greetings.some(g => lowerMessage === g || lowerMessage.startsWith(g + ' '))) {
        return false;
    }

    // Don't cache time-sensitive queries
    const timeSensitive = ['now', 'today', 'current', 'latest', 'what time'];
    if (timeSensitive.some(keyword => lowerMessage.includes(keyword))) {
        return false;
    }

    return true;
}

import { getRedisClient, isRedisConnected } from '../../utils/redis';

/**
 * Cache response in Redis
 */
export async function cacheResponse(
    cacheKey: string,
    response: {
        content: string;
        tokensUsed: number;
        model: string;
    },
    ttl: number = 3600
): Promise<void> {
    const redis = getRedisClient();

    if (!redis || !isRedisConnected()) {
        logInfo(`Redis not available - skipping cache for key: ${cacheKey}`);
        return;
    }

    try {
        await redis.setEx(
            cacheKey,
            ttl,
            JSON.stringify({
                ...response,
                cachedAt: Date.now()
            })
        );
        logInfo(`Cached AI response: ${cacheKey}`);
    } catch (error: unknown) {
        logInfo(`Error caching response: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get cached response from Redis
 */
export async function getCachedResponse(
    cacheKey: string
): Promise<{
    content: string;
    tokensUsed: number;
    model: string;
    cachedAt: number;
} | null> {
    const redis = getRedisClient();

    if (!redis || !isRedisConnected()) {
        return null;
    }

    try {
        const cached = await redis.get(cacheKey);

        if (!cached) {
            return null;
        }

        return JSON.parse(cached);
    } catch (error: unknown) {
        logInfo(`Error reading from cache: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Invalidate all cached responses for a creator
 */
export async function invalidateCreatorCache(creatorId: string): Promise<void> {
    const redis = getRedisClient();

    if (!redis || !isRedisConnected()) {
        return;
    }

    try {
        // Use SCAN to find keys with pattern
        const pattern = `ai:response:${creatorId}:*`;
        let cursor: number = 0;
        let keysFound = 0;

        do {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const reply = await (redis as any).scan(cursor, {
                MATCH: pattern,
                COUNT: 100
            });

            cursor = reply.cursor;
            const keys = reply.keys;

            if (keys.length > 0) {
                await redis.del(keys);
                keysFound += keys.length;
            }
        } while (cursor !== 0);

        if (keysFound > 0) {
            logInfo(`Invalidated ${keysFound} cached responses for creator ${creatorId}`);
        }
    } catch (error: unknown) {
        logInfo(`Error invalidating cache: ${error instanceof Error ? error.message : String(error)}`);
    }
}
