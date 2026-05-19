// ===========================================
// ANALYTICS WORKER UNIT TESTS
// ===========================================

// Standard helpers
const makeReq = (o: any = {}) => ({ body: {}, params: {}, query: {}, headers: { authorization: 'Bearer t' }, user: { id: 'u1', role: 'USER', email: 'e@e.com' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, cookies: {}, ...o });
const makeRes = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); r.send = jest.fn(() => r); r.setHeader = jest.fn(() => r); r.getHeader = jest.fn(() => undefined); r.on = jest.fn(() => r); r.once = jest.fn(() => r); r.emit = jest.fn(); r.headersSent = false; r.locals = {}; r.writableEnded = false; return r; };
const next = jest.fn();

// ---- Module mocks (before imports) ----

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { count: jest.fn() },
    creator: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    company: { count: jest.fn() },
    message: { count: jest.fn() },
    conversation: { count: jest.fn() },
    payout: { aggregate: jest.fn() },
    creatorContent: { count: jest.fn() },
    analyticsEvent: { count: jest.fn(), create: jest.fn() }
  }
}));

const mockRedisClient = {
  setEx: jest.fn().mockResolvedValue('OK'),
  keys: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  lRange: jest.fn().mockResolvedValue([])
};

jest.mock('../../utils/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisConnected: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn()
}));

import prisma from '../../../prisma/client';
import { AnalyticsWorker } from '../../workers/analyticsWorker';
import { getRedisClient, isRedisConnected } from '../../utils/redis';

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================
// AnalyticsWorker.processJob — routing
// =============================================
describe('AnalyticsWorker.processJob', () => {
  it('throws for unknown job type', async () => {
    await expect(
      AnalyticsWorker.processJob({ type: 'unknown_type' as any })
    ).rejects.toThrow('Unknown job type: unknown_type');
  });

  it('routes to daily_report', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(5);
    (prisma.creator.count as jest.Mock).mockResolvedValue(2);
    (prisma.company.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.count as jest.Mock).mockResolvedValue(100);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(10);
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 5000 } });
    (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(3);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await expect(
      AnalyticsWorker.processJob({ type: 'daily_report' })
    ).resolves.toBeUndefined();
  });

  it('routes to weekly_report', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await expect(
      AnalyticsWorker.processJob({ type: 'weekly_report' })
    ).resolves.toBeUndefined();
  });

  it('routes to monthly_report', async () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 100000, fee: 5000 } });
    (prisma.user.count as jest.Mock).mockResolvedValue(20);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(15);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await expect(
      AnalyticsWorker.processJob({ type: 'monthly_report' })
    ).resolves.toBeUndefined();
  });

  it('routes to aggregate_metrics — skips when Redis not connected', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await expect(
      AnalyticsWorker.processJob({ type: 'aggregate_metrics' })
    ).resolves.toBeUndefined();
  });
});

// =============================================
// Daily report
// =============================================
describe('generateDailyReport', () => {
  const setupDailyMocks = (amountSum: any = 5000) => {
    (prisma.user.count as jest.Mock).mockResolvedValue(5);
    (prisma.creator.count as jest.Mock).mockResolvedValue(2);
    (prisma.company.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.count as jest.Mock).mockResolvedValue(100);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(10);
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: amountSum } });
    (prisma.analyticsEvent.count as jest.Mock).mockResolvedValue(3);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});
  };

  it('generates report and saves to DB', async () => {
    setupDailyMocks();
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await AnalyticsWorker.processJob({ type: 'daily_report' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'daily_report',
          eventName: 'daily_metrics'
        })
      })
    );
  });

  it('caches result in Redis when connected', async () => {
    setupDailyMocks();
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    await AnalyticsWorker.processJob({ type: 'daily_report' });

    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringContaining('analytics:daily:'),
      86400,
      expect.any(String)
    );
  });

  it('skips Redis cache when not connected', async () => {
    setupDailyMocks();
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await AnalyticsWorker.processJob({ type: 'daily_report' });

    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('handles null payout aggregate', async () => {
    setupDailyMocks(null);
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await expect(
      AnalyticsWorker.processJob({ type: 'daily_report' })
    ).resolves.toBeUndefined();
  });

  it('uses provided date parameter', async () => {
    setupDailyMocks();
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    const specificDate = new Date('2024-06-15');
    await AnalyticsWorker.processJob({ type: 'daily_report', date: specificDate });

    // Should still create a report
    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });
});

// =============================================
// Weekly report
// =============================================
describe('generateWeeklyReport', () => {
  it('generates weekly report with top creators and categories', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([
      { id: 'cr1', displayName: 'Creator 1', _count: { conversations: 10 } }
    ]);
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([
      { category: 'Music', _count: 5 },
      { category: 'Gaming', _count: 3 }
    ]);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'weekly_report' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'weekly_report',
          eventName: 'weekly_insights'
        })
      })
    );
  });

  it('handles empty creators and categories', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await expect(
      AnalyticsWorker.processJob({ type: 'weekly_report' })
    ).resolves.toBeUndefined();
  });

  it('uses provided date for weekly report', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    const date = new Date('2024-03-15');
    await AnalyticsWorker.processJob({ type: 'weekly_report', date });

    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });
});

// =============================================
// Monthly report
// =============================================
describe('generateMonthlyReport', () => {
  it('generates monthly report with revenue, users, and content', async () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: 200000, fee: 10000 }
    });
    (prisma.user.count as jest.Mock).mockResolvedValue(50);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(30);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'monthly_report' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'monthly_report',
          eventName: 'monthly_summary'
        })
      })
    );
  });

  it('handles null revenue sums', async () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: null, fee: null }
    });
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(0);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await expect(
      AnalyticsWorker.processJob({ type: 'monthly_report' })
    ).resolves.toBeUndefined();
  });

  it('uses provided date for monthly report', async () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0, fee: 0 } });
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(0);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'monthly_report', date: new Date('2024-12-01') });

    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });
});

// =============================================
// aggregateMetrics
// =============================================
describe('aggregateMetrics', () => {
  it('skips when Redis is not available', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    (isRedisConnected as jest.Mock).mockReturnValue(false);

    await AnalyticsWorker.processJob({ type: 'aggregate_metrics' });

    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('aggregates user events from Redis keys', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    mockRedisClient.keys
      .mockResolvedValueOnce(['event:user:page_view'])
      .mockResolvedValueOnce([]);
    mockRedisClient.get.mockResolvedValue('42');
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'aggregate_metrics' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'user',
          eventName: 'page_view',
          properties: { count: 42 }
        })
      })
    );
    expect(mockRedisClient.del).toHaveBeenCalledWith('event:user:page_view');
  });

  it('skips Redis key when value is null', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    mockRedisClient.keys
      .mockResolvedValueOnce(['event:user:null_value'])
      .mockResolvedValueOnce([]);
    mockRedisClient.get.mockResolvedValue(null);

    await AnalyticsWorker.processJob({ type: 'aggregate_metrics' });

    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('aggregates performance metrics from perf keys', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    mockRedisClient.keys
      .mockResolvedValueOnce([]) // no user events
      .mockResolvedValueOnce(['perf:api:/health']);

    const perfEntry = JSON.stringify({ method: 'GET', endpoint: '/health', responseTime: 45, statusCode: 200 });
    mockRedisClient.lRange.mockResolvedValue([perfEntry]);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'aggregate_metrics' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'api_performance',
          eventName: 'GET /health'
        })
      })
    );
    expect(mockRedisClient.del).toHaveBeenCalledWith('perf:api:/health');
  });

  it('logs error and continues when perf metric JSON is malformed', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    mockRedisClient.keys
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['perf:bad']);
    mockRedisClient.lRange.mockResolvedValue(['not valid json {{{']);

    await expect(
      AnalyticsWorker.processJob({ type: 'aggregate_metrics' })
    ).resolves.toBeUndefined();

    // Should still delete the key after processing
    expect(mockRedisClient.del).toHaveBeenCalledWith('perf:bad');
  });

  it('handles multiple perf metrics in a single key', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (isRedisConnected as jest.Mock).mockReturnValue(true);

    mockRedisClient.keys
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['perf:api:/users']);

    const entries = [
      JSON.stringify({ method: 'GET', endpoint: '/users', responseTime: 30, statusCode: 200 }),
      JSON.stringify({ method: 'POST', endpoint: '/users', responseTime: 120, statusCode: 201 })
    ];
    mockRedisClient.lRange.mockResolvedValue(entries);
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});

    await AnalyticsWorker.processJob({ type: 'aggregate_metrics' });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledTimes(2);
  });
});

// =============================================
// Error propagation
// =============================================
describe('AnalyticsWorker error propagation', () => {
  it('rethrows error from daily_report when prisma fails', async () => {
    (prisma.user.count as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

    await expect(
      AnalyticsWorker.processJob({ type: 'daily_report' })
    ).rejects.toThrow('DB connection lost');
  });

  it('rethrows error from weekly_report when prisma fails', async () => {
    (prisma.creator.findMany as jest.Mock).mockRejectedValue(new Error('Timeout'));

    await expect(
      AnalyticsWorker.processJob({ type: 'weekly_report' })
    ).rejects.toThrow('Timeout');
  });

  it('rethrows error from monthly_report when prisma fails', async () => {
    (prisma.payout.aggregate as jest.Mock).mockRejectedValue(new Error('Query failed'));

    await expect(
      AnalyticsWorker.processJob({ type: 'monthly_report' })
    ).rejects.toThrow('Query failed');
  });
});
