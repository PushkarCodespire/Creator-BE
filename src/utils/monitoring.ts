// ===========================================
// MONITORING & ANALYTICS UTILITIES
// Performance tracking, error monitoring, business metrics
// ===========================================

import { Request, Response, NextFunction } from 'express';
import prisma from '../../prisma/client';
import { getRedisClient, isRedisConnected } from './redis';
import { logWarning, logError } from './logger';

interface PerformanceMetrics {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  timestamp: Date;
  userId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface BusinessMetrics {
  eventType: string;
  eventName: string;
  userId?: string;
  properties?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Performance monitoring middleware
 * Tracks API response times and logs slow requests
 */
export const performanceMonitoring = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();
  const endpoint = req.originalUrl || req.url;
  const method = req.method;

  // Override res.end to capture response time
  const originalEnd = res.end.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: () => void) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log slow requests (> 1 second)
    if (responseTime > 1000) {
      logWarning(`Slow Request: ${method} ${endpoint} - ${responseTime}ms`);
    }

    // Track performance metrics
    trackPerformanceMetric({
      endpoint,
      method,
      responseTime,
      statusCode,
      timestamp: new Date(),
      userId: (req as unknown as { user?: { id: string } }).user?.id,
    });

    // Call original end
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (originalEnd as any)(chunk, encoding, cb);
    return res;
  };

  next();
};

/**
 * Track performance metric
 */
async function trackPerformanceMetric(metric: PerformanceMetrics) {
  try {
    // Store in Redis for real-time monitoring
    const redisClient = getRedisClient();
    if (redisClient && isRedisConnected()) {
      const key = `perf:${metric.endpoint}:${metric.method}`;
      await redisClient.lPush(key, JSON.stringify(metric));
      await redisClient.lTrim(key, 0, 99); // Keep last 100 metrics
      await redisClient.expire(key, 3600); // Expire after 1 hour
    }

    // Store in database for historical analysis (if model exists)
    if (prisma.analyticsEvent) {
      await prisma.analyticsEvent.create({
        data: {
          userId: metric.userId,
          eventType: 'api_performance',
          eventName: `${metric.method} ${metric.endpoint}`,
          properties: {
            responseTime: metric.responseTime,
            statusCode: metric.statusCode,
          },
          createdAt: metric.timestamp,
        },
      });
    }
  } catch (_error) {
    // Silently fail - don't log every metric tracking failure
  }
}

/**
 * Track business event
 */
export async function trackBusinessEvent(
  eventType: string,
  eventName: string,
  userId?: string,
  properties?: Record<string, unknown>
) {
  try {
    // Store in database (if model exists)
    if (prisma.analyticsEvent) {
      await prisma.analyticsEvent.create({
        data: {
          userId,
          eventType,
          eventName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          properties: (properties || {}) as any,
          createdAt: new Date(),
        },
      });
    }

    // Also track in Redis for real-time dashboards
    const redisClient = getRedisClient();
    if (redisClient && isRedisConnected()) {
      const key = `event:${eventType}:${eventName}`;
      await redisClient.incr(key);
      await redisClient.expire(key, 86400); // 24 hours
    }
  } catch (_error) {
    // Silently fail - don't log every event tracking failure
  }
}

/**
 * Get API performance stats
 */
export async function getAPIPerformanceStats(
  endpoint?: string,
  hours: number = 24
) {
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hours);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    eventType: 'api_performance',
    createdAt: { gte: startDate },
  };

  if (endpoint) {
    where.eventName = { contains: endpoint };
  }

  const events = await prisma.analyticsEvent.findMany({
    where,
    select: {
      properties: true,
      createdAt: true,
    },
  });

  const stats = {
    totalRequests: events.length,
    avgResponseTime: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    errorRate: 0,
  };

  if (events.length === 0) {
    return stats;
  }

  const responseTimes = events
    .map((e) => {
      const props = e.properties as Record<string, unknown> | null;
      return (props?.responseTime as number) || 0;
    })
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  const statusCodes = events.map((e) => {
    const props = e.properties as Record<string, unknown> | null;
    return (props?.statusCode as number) || 200;
  });

  stats.avgResponseTime =
    responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  stats.p50 = responseTimes[Math.floor(responseTimes.length * 0.5)] || 0;
  stats.p95 = responseTimes[Math.floor(responseTimes.length * 0.95)] || 0;
  stats.p99 = responseTimes[Math.floor(responseTimes.length * 0.99)] || 0;
  stats.errorRate =
    (statusCodes.filter((s) => s >= 400).length / statusCodes.length) * 100;

  return stats;
}

/**
 * Get business metrics
 */
export async function getBusinessMetrics(
  eventType?: string,
  days: number = 7
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    createdAt: { gte: startDate },
  };

  if (eventType) {
    where.eventType = eventType;
  }

  const events = await prisma.analyticsEvent.groupBy({
    by: ['eventType', 'eventName'],
    where,
    _count: true,
  });

  return events.map((e) => ({
    eventType: e.eventType,
    eventName: e.eventName,
    count: e._count,
  }));
}

/**
 * Error tracking utility
 * Enhanced error logging with context
 * Call this from error handler middleware
 */
export function trackError(
  error: Error,
  req: Request,
  additionalContext?: Record<string, unknown>
) {
  const errorContext = {
    message: error.message,
    stack: error.stack,
    endpoint: req.originalUrl || req.url,
    method: req.method,
    userId: (req as unknown as { user?: { id: string } }).user?.id,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date(),
    ...additionalContext,
  };

  // Log to console (in production, this would go to a logging service)
  logError(error, errorContext);

  // Track error event
  trackBusinessEvent('error', error.name, (req as unknown as { user?: { id: string } }).user?.id, errorContext);

  // Send to error tracking service (e.g., Sentry)
  // Sentry.captureException(error, { extra: errorContext });
}

