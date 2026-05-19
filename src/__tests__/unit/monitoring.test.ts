// ===========================================
// MONITORING UNIT TESTS
// ===========================================

const mockRedisLPush = jest.fn();
const mockRedisLTrim = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisIncr = jest.fn();

jest.mock('../../utils/redis', () => ({
  getRedisClient: jest.fn(() => ({
    lPush: mockRedisLPush,
    lTrim: mockRedisLTrim,
    expire: mockRedisExpire,
    incr: mockRedisIncr,
  })),
  isRedisConnected: jest.fn(() => true),
}));

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    analyticsEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  logError: jest.fn((...args: unknown[]) => console.error(...args)),
  logWarning: jest.fn(),
  logInfo: jest.fn(),
  logDebug: jest.fn(),
}));

import { getRedisClient, isRedisConnected } from '../../utils/redis';
import { logError } from '../../utils/logger';
import prisma from '../../../prisma/client';
import {
  performanceMonitoring,
  trackBusinessEvent,
  getAPIPerformanceStats,
  getBusinessMetrics,
  trackError,
} from '../../utils/monitoring';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Monitoring Utils - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisLPush.mockResolvedValue(1);
    mockRedisLTrim.mockResolvedValue('OK');
    mockRedisExpire.mockResolvedValue(true);
    mockRedisIncr.mockResolvedValue(1);
    (getRedisClient as jest.Mock).mockReturnValue({
      lPush: mockRedisLPush,
      lTrim: mockRedisLTrim,
      expire: mockRedisExpire,
      incr: mockRedisIncr,
    });
    (isRedisConnected as jest.Mock).mockReturnValue(true);
    (logError as jest.Mock).mockImplementation((...args: unknown[]) => console.error(...args));
    (console.error as jest.Mock).mockImplementation(() => {});
  });

  describe('performanceMonitoring', () => {
    it('should call next() to pass to next middleware', () => {
      const req: any = {
        originalUrl: '/api/test',
        method: 'GET',
        user: { id: 'user-1' },
      };
      const res: any = {
        statusCode: 200,
        end: jest.fn(),
      };
      const next = jest.fn();

      performanceMonitoring(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should override res.end to track response time', () => {
      const req: any = {
        originalUrl: '/api/test',
        method: 'GET',
      };
      const originalEnd = jest.fn();
      const res: any = {
        statusCode: 200,
        end: originalEnd,
      };
      const next = jest.fn();

      performanceMonitoring(req, res, next);

      // res.end should have been overridden
      expect(res.end).not.toBe(originalEnd);
    });

    it('should call original res.end when response ends', () => {
      const req: any = {
        originalUrl: '/api/test',
        method: 'GET',
      };
      const originalEnd = jest.fn();
      const res: any = {
        statusCode: 200,
        end: originalEnd,
      };
      const next = jest.fn();

      performanceMonitoring(req, res, next);

      // Call the overridden end
      res.end('body', 'utf-8');

      expect(originalEnd).toHaveBeenCalled();
    });

    it('should use req.url when originalUrl is not available', () => {
      const req: any = {
        url: '/api/fallback',
        method: 'POST',
      };
      const res: any = {
        statusCode: 201,
        end: jest.fn(),
      };
      const next = jest.fn();

      performanceMonitoring(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('trackBusinessEvent', () => {
    it('should store event in database', async () => {
      await trackBusinessEvent('user', 'signup', 'user-1', { source: 'google' });

      expect((mockPrisma.analyticsEvent as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'user',
            eventName: 'signup',
            userId: 'user-1',
          }),
        })
      );
    });

    it('should store event in Redis for real-time dashboards', async () => {
      await trackBusinessEvent('payment', 'checkout', 'user-1');

      expect(mockRedisIncr).toHaveBeenCalledWith('event:payment:checkout');
      expect(mockRedisExpire).toHaveBeenCalled();
    });

    it('should handle missing userId', async () => {
      await trackBusinessEvent('system', 'startup');

      expect((mockPrisma.analyticsEvent as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: undefined,
          }),
        })
      );
    });

    it('should not throw on database error', async () => {
      (mockPrisma.analyticsEvent as any).create.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        trackBusinessEvent('error', 'test')
      ).resolves.not.toThrow();
    });

    it('should handle missing properties by defaulting to empty object', async () => {
      await trackBusinessEvent('test', 'event', 'user-1');

      expect((mockPrisma.analyticsEvent as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            properties: {},
          }),
        })
      );
    });
  });

  describe('getAPIPerformanceStats', () => {
    it('should return zero stats when no events found', async () => {
      (mockPrisma.analyticsEvent as any).findMany.mockResolvedValue([]);

      const stats = await getAPIPerformanceStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.avgResponseTime).toBe(0);
      expect(stats.p50).toBe(0);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should compute stats from events', async () => {
      (mockPrisma.analyticsEvent as any).findMany.mockResolvedValue([
        { properties: { responseTime: 100, statusCode: 200 }, createdAt: new Date() },
        { properties: { responseTime: 200, statusCode: 200 }, createdAt: new Date() },
        { properties: { responseTime: 500, statusCode: 400 }, createdAt: new Date() },
        { properties: { responseTime: 150, statusCode: 200 }, createdAt: new Date() },
      ]);

      const stats = await getAPIPerformanceStats();

      expect(stats.totalRequests).toBe(4);
      expect(stats.avgResponseTime).toBeGreaterThan(0);
      expect(stats.errorRate).toBeGreaterThan(0);
    });

    it('should filter by endpoint when provided', async () => {
      (mockPrisma.analyticsEvent as any).findMany.mockResolvedValue([]);

      await getAPIPerformanceStats('/api/users', 12);

      expect((mockPrisma.analyticsEvent as any).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventName: { contains: '/api/users' },
          }),
        })
      );
    });

    it('should use custom hours parameter', async () => {
      (mockPrisma.analyticsEvent as any).findMany.mockResolvedValue([]);

      await getAPIPerformanceStats(undefined, 48);

      expect((mockPrisma.analyticsEvent as any).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      );
    });
  });

  describe('getBusinessMetrics', () => {
    it('should return aggregated metrics', async () => {
      (mockPrisma.analyticsEvent as any).groupBy.mockResolvedValue([
        { eventType: 'user', eventName: 'signup', _count: 42 },
        { eventType: 'payment', eventName: 'checkout', _count: 10 },
      ]);

      const result = await getBusinessMetrics();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ eventType: 'user', eventName: 'signup', count: 42 });
    });

    it('should filter by eventType when provided', async () => {
      (mockPrisma.analyticsEvent as any).groupBy.mockResolvedValue([]);

      await getBusinessMetrics('payment', 30);

      expect((mockPrisma.analyticsEvent as any).groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: 'payment',
          }),
        })
      );
    });

    it('should return empty array when no data', async () => {
      (mockPrisma.analyticsEvent as any).groupBy.mockResolvedValue([]);

      const result = await getBusinessMetrics();

      expect(result).toEqual([]);
    });
  });

  describe('trackError', () => {
    it('should log error with request context', () => {
      const error = new Error('Test error');
      const req: any = {
        originalUrl: '/api/test',
        method: 'POST',
        user: { id: 'user-1' },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('Test Browser'),
      };

      trackError(error, req);

      expect(console.error).toHaveBeenCalled();
    });

    it('should include additional context when provided', () => {
      const error = new Error('Detailed error');
      const req: any = {
        originalUrl: '/api/test',
        method: 'GET',
        ip: '10.0.0.1',
        get: jest.fn().mockReturnValue('Chrome'),
      };

      trackError(error, req, { requestId: 'req-123' });

      expect(console.error).toHaveBeenCalled();
    });

    it('should handle missing user on request', () => {
      const error = new Error('No user');
      const req: any = {
        originalUrl: '/api/public',
        method: 'GET',
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('Firefox'),
      };

      // Should not throw
      trackError(error, req);

      expect(console.error).toHaveBeenCalled();
    });

    it('should use req.url as fallback when originalUrl missing', () => {
      const error = new Error('Fallback');
      const req: any = {
        url: '/api/fallback-url',
        method: 'DELETE',
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('Safari'),
      };

      trackError(error, req);

      expect(console.error).toHaveBeenCalled();
    });
  });
});
