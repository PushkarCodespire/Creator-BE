// ===========================================
// ANALYTICS SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    conversation: { findMany: jest.fn(), count: jest.fn() },
    message: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
    payout: { findMany: jest.fn(), aggregate: jest.fn() },
    creator: { findUnique: jest.fn() },
    subscription: { count: jest.fn() },
  },
}));

import prisma from '../../../../prisma/client';
import {
  getUserRetention,
  getRevenueForecast,
  getPeakActivityHours,
  getConversionFunnel,
  getComparativeAnalytics,
} from '../../../services/analytics.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('AnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserRetention', () => {
    it('should return empty array when no conversations exist', async () => {
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getUserRetention('creator-1');

      expect(result).toEqual([]);
    });

    it('should calculate retention cohorts from conversations', async () => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          messages: [
            { userId: 'user-1', createdAt: now },
            { userId: 'user-2', createdAt: now },
          ],
        },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].cohortMonth).toBe(monthKey);
      expect(result[0].cohortSize).toBe(2);
    });

    it('should sort cohorts chronologically', async () => {
      const month1 = new Date('2024-01-15');
      const month2 = new Date('2024-03-15');

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          messages: [
            { userId: 'user-1', createdAt: month2 },
            { userId: 'user-2', createdAt: month1 },
          ],
        },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result[0].cohortMonth).toBe('2024-01');
      expect(result[1].cohortMonth).toBe('2024-03');
    });
  });

  describe('getRevenueForecast', () => {
    it('should return empty forecast when insufficient data', async () => {
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue([
        { amount: 100, completedAt: new Date() },
      ]);

      const result = await getRevenueForecast('creator-1');

      expect(result.forecast).toEqual([]);
      expect(result.trend).toBe('stable');
      expect(result.growthRate).toBe(0);
    });

    it('should calculate trend as increasing for growing revenue', async () => {
      const now = new Date();
      const payouts = [
        { amount: 100, completedAt: new Date(now.getTime() - 5 * 30 * 24 * 3600 * 1000) },
        { amount: 200, completedAt: new Date(now.getTime() - 4 * 30 * 24 * 3600 * 1000) },
        { amount: 300, completedAt: new Date(now.getTime() - 3 * 30 * 24 * 3600 * 1000) },
      ];
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      expect(result.trend).toBe('increasing');
      expect(result.growthRate).toBeGreaterThan(10);
    });

    it('should generate 3 months of forecast', async () => {
      const now = new Date();
      const payouts = Array.from({ length: 4 }, (_, i) => ({
        amount: 100 + i * 50,
        completedAt: new Date(now.getTime() - (4 - i) * 30 * 24 * 3600 * 1000),
      }));
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      expect(result.forecast).toHaveLength(3);
      result.forecast.forEach((f) => {
        expect(f.revenue).toBeGreaterThanOrEqual(0);
        expect(f.confidence.low).toBeLessThanOrEqual(f.revenue);
        expect(f.confidence.high).toBeGreaterThanOrEqual(f.revenue);
      });
    });
  });

  describe('getPeakActivityHours', () => {
    it('should return 7x24 hourly grid', async () => {
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getPeakActivityHours('creator-1');

      expect(result.hourly).toHaveLength(7);
      result.hourly.forEach((day) => {
        expect(day).toHaveLength(24);
      });
      expect(result.totalMessages).toBe(0);
    });

    it('should count messages by day and hour', async () => {
      // Wednesday at 14:00
      const wednesday2pm = new Date('2024-06-12T14:00:00');
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { createdAt: wednesday2pm },
        { createdAt: wednesday2pm },
        { createdAt: wednesday2pm },
      ]);

      const result = await getPeakActivityHours('creator-1');

      expect(result.totalMessages).toBe(3);
      // Wednesday = day 3, 14:00 = hour 14
      expect(result.hourly[3][14]).toBe(3);
    });

    it('should identify peak hour correctly', async () => {
      const peakTime = new Date('2024-06-10T09:00:00'); // Monday 9am
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue(
        Array(10).fill({ createdAt: peakTime })
      );

      const result = await getPeakActivityHours('creator-1');

      expect(result.peakHour.count).toBe(10);
    });
  });

  describe('getConversionFunnel', () => {
    it('should return funnel with zero rates when no data', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ profileViews: 0 });
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(0);

      const result = await getConversionFunnel('creator-1');

      expect(result.profileViews).toBe(0);
      expect(result.chatStarts).toBe(0);
      expect(result.conversionRate.viewToChat).toBe(0);
    });

    it('should calculate conversion rates correctly', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ profileViews: 1000 });
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
        { userId: 'user-1' }, // duplicate user
      ]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([
        { userId: 'user-1', _count: 5 }, // returning
        { userId: 'user-2', _count: 1 }, // not returning
      ]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(1);

      const result = await getConversionFunnel('creator-1');

      expect(result.profileViews).toBe(1000);
      expect(result.chatStarts).toBe(3); // 3 unique users
      expect(result.returning).toBe(1); // 1 user with >1 message
    });
  });

  describe('getComparativeAnalytics', () => {
    it('should return comparative data for two periods', async () => {
      (mockPrisma.message.count as jest.Mock)
        .mockResolvedValueOnce(100) // current messages
        .mockResolvedValueOnce(80); // previous messages
      (mockPrisma.payout.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: 500 } }) // current
        .mockResolvedValueOnce({ _sum: { amount: 400 } }); // previous
      (mockPrisma.conversation.count as jest.Mock)
        .mockResolvedValueOnce(50) // current
        .mockResolvedValueOnce(40); // previous

      const result = await getComparativeAnalytics('creator-1', 30);

      expect(result.currentPeriod.messages).toBe(100);
      expect(result.previousPeriod.messages).toBe(80);
      expect(result.change.messages).toBe(25); // 25% increase
    });

    it('should handle zero previous period without division by zero', async () => {
      (mockPrisma.message.count as jest.Mock)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(0);
      (mockPrisma.payout.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: 100 } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      (mockPrisma.conversation.count as jest.Mock)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0);

      const result = await getComparativeAnalytics('creator-1');

      expect(result.change.messages).toBe(0);
      expect(result.change.revenue).toBe(0);
      expect(result.change.newUsers).toBe(0);
    });
  });
});

// ===========================================
// EXTENDED COVERAGE TESTS
// ===========================================

describe('AnalyticsService — extended coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- getUserRetention extended ----
  describe('getUserRetention — extended', () => {
    it('should count only users who have userId (skip null userId messages)', async () => {
      const now = new Date();

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          messages: [
            { userId: null, createdAt: now },
            { userId: 'user-1', createdAt: now },
          ],
        },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result[0].cohortSize).toBe(1);
    });

    it('should not double-count same user appearing in multiple conversations', async () => {
      const now = new Date();

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { messages: [{ userId: 'user-1', createdAt: now }] },
        { messages: [{ userId: 'user-1', createdAt: now }] },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result[0].cohortSize).toBe(1);
    });

    it('should group users into correct month cohorts', async () => {
      const jan = new Date('2024-01-10');
      const feb = new Date('2024-02-20');

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          messages: [
            { userId: 'u1', createdAt: jan },
            { userId: 'u2', createdAt: feb },
          ],
        },
      ]);

      const result = await getUserRetention('creator-1');

      const months = result.map((r) => r.cohortMonth);
      expect(months).toContain('2024-01');
      expect(months).toContain('2024-02');
    });

    it('should calculate week1 retention when user returns 7-14 days later', async () => {
      const firstMsg = new Date('2024-03-01');
      const week1Return = new Date('2024-03-10'); // +9 days — within week1 window

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          messages: [
            { userId: 'u1', createdAt: firstMsg },
            { userId: 'u1', createdAt: week1Return },
          ],
        },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result[0].retention.week1).toBe(100); // 1 of 1 user retained
    });

    it('should return 0% retention when no user returns', async () => {
      const firstMsg = new Date('2024-03-01');

      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { messages: [{ userId: 'u1', createdAt: firstMsg }] },
      ]);

      const result = await getUserRetention('creator-1');

      expect(result[0].retention.week1).toBe(0);
      expect(result[0].retention.week2).toBe(0);
      expect(result[0].retention.week4).toBe(0);
      expect(result[0].retention.week8).toBe(0);
    });
  });

  // ---- getRevenueForecast extended ----
  describe('getRevenueForecast — extended', () => {
    it('should return stable trend when growth is between -10 and 10', async () => {
      const now = new Date();
      // Two months, same revenue → 0% growth
      const payouts = [
        { amount: 500, completedAt: new Date(now.getTime() - 2 * 30 * 24 * 3600 * 1000) },
        { amount: 500, completedAt: new Date(now.getTime() - 1 * 30 * 24 * 3600 * 1000) },
      ];
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      expect(result.trend).toBe('stable');
      expect(result.growthRate).toBe(0);
    });

    it('should return decreasing trend for declining revenue', async () => {
      const now = new Date();
      const payouts = [
        { amount: 1000, completedAt: new Date(now.getTime() - 4 * 30 * 24 * 3600 * 1000) },
        { amount: 800, completedAt: new Date(now.getTime() - 3 * 30 * 24 * 3600 * 1000) },
        { amount: 600, completedAt: new Date(now.getTime() - 2 * 30 * 24 * 3600 * 1000) },
      ];
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      expect(result.trend).toBe('decreasing');
    });

    it('should return empty historical and empty forecast when no payouts', async () => {
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getRevenueForecast('creator-1');

      expect(result.historical).toEqual([]);
      expect(result.forecast).toEqual([]);
      expect(result.growthRate).toBe(0);
      expect(result.trend).toBe('stable');
    });

    it('should ensure forecast revenue is never negative', async () => {
      const now = new Date();
      const payouts = [
        { amount: 100, completedAt: new Date(now.getTime() - 5 * 30 * 24 * 3600 * 1000) },
        { amount: 50, completedAt: new Date(now.getTime() - 4 * 30 * 24 * 3600 * 1000) },
        { amount: 10, completedAt: new Date(now.getTime() - 3 * 30 * 24 * 3600 * 1000) },
        { amount: 1, completedAt: new Date(now.getTime() - 2 * 30 * 24 * 3600 * 1000) },
      ];
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      result.forecast.forEach((f) => {
        expect(f.revenue).toBeGreaterThanOrEqual(0);
        expect(f.confidence.low).toBeGreaterThanOrEqual(0);
      });
    });

    it('should group payouts from the same month together', async () => {
      const now = new Date();
      const sameMonth = new Date(now.getTime() - 2 * 30 * 24 * 3600 * 1000);
      const samePlusDay = new Date(sameMonth.getTime() + 24 * 3600 * 1000);

      const payouts = [
        { amount: 100, completedAt: sameMonth },
        { amount: 200, completedAt: samePlusDay },
        { amount: 300, completedAt: new Date(now.getTime() - 1 * 30 * 24 * 3600 * 1000) },
      ];
      (mockPrisma.payout.findMany as jest.Mock).mockResolvedValue(payouts);

      const result = await getRevenueForecast('creator-1');

      // The two same-month entries should be combined
      expect(result.historical.length).toBeLessThanOrEqual(2);
    });
  });

  // ---- getPeakActivityHours extended ----
  describe('getPeakActivityHours — extended', () => {
    it('should return peakHour with day Sunday and count 0 when no messages', async () => {
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getPeakActivityHours('creator-1');

      expect(result.peakHour).toEqual({ day: 'Sunday', hour: 0, count: 0 });
    });

    it('should correctly map day of week to day name', async () => {
      // Sunday = 0
      const sunday = new Date('2024-06-09T10:00:00'); // A Sunday
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { createdAt: sunday },
        { createdAt: sunday },
      ]);

      const result = await getPeakActivityHours('creator-1');

      expect(result.peakHour.day).toBe('Sunday');
      expect(result.peakHour.hour).toBe(10);
      expect(result.peakHour.count).toBe(2);
    });

    it('should count all 7x24 slots when multiple messages at different times', async () => {
      const monday10am = new Date('2024-06-10T10:00:00');
      const friday5pm = new Date('2024-06-14T17:00:00');
      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
        { createdAt: monday10am },
        { createdAt: friday5pm },
        { createdAt: friday5pm },
      ]);

      const result = await getPeakActivityHours('creator-1');

      expect(result.totalMessages).toBe(3);
      // Friday = day 5
      expect(result.hourly[5][17]).toBe(2);
      // Monday = day 1
      expect(result.hourly[1][10]).toBe(1);
    });

    it('should pick the highest count slot as peakHour', async () => {
      const tuesdayNoon = new Date('2024-06-11T12:00:00'); // Tuesday
      const times = Array(5).fill({ createdAt: tuesdayNoon });
      const mondayMorning = new Date('2024-06-10T08:00:00');
      times.push({ createdAt: mondayMorning });

      (mockPrisma.message.findMany as jest.Mock).mockResolvedValue(times);

      const result = await getPeakActivityHours('creator-1');

      expect(result.peakHour.day).toBe('Tuesday');
      expect(result.peakHour.hour).toBe(12);
      expect(result.peakHour.count).toBe(5);
    });
  });

  // ---- getConversionFunnel extended ----
  describe('getConversionFunnel — extended', () => {
    it('should handle null creator (profileViews defaults to 0)', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(0);

      const result = await getConversionFunnel('creator-missing');

      expect(result.profileViews).toBe(0);
    });

    it('should calculate chatToReturn rate correctly', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ profileViews: 100 });
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
        { userId: 'u4' },
      ]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([
        { userId: 'u1', _count: 5 },
        { userId: 'u2', _count: 3 },
      ]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(0);

      const result = await getConversionFunnel('creator-1');

      expect(result.chatStarts).toBe(4);
      expect(result.returning).toBe(2);
      expect(result.conversionRate.chatToReturn).toBe(50);
    });

    it('should count only users with message count > 1 as returning', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ profileViews: 50 });
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([
        { userId: 'u1', _count: 1 }, // NOT returning
        { userId: 'u2', _count: 2 }, // returning
      ]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(0);

      const result = await getConversionFunnel('creator-1');

      expect(result.returning).toBe(1);
    });

    it('should skip null userId conversations in unique chatters count', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ profileViews: 100 });
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { userId: null },
        { userId: 'u1' },
        { userId: 'u1' }, // same user
      ]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.subscription.count as jest.Mock).mockResolvedValue(0);

      const result = await getConversionFunnel('creator-1');

      expect(result.chatStarts).toBe(1); // only u1, null filtered out
    });
  });

  // ---- getComparativeAnalytics extended ----
  describe('getComparativeAnalytics — extended', () => {
    it('should use 30 days as default period', async () => {
      (mockPrisma.message.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.payout.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });
      (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(0);

      await getComparativeAnalytics('creator-1');

      // Should make 6 calls: message x2, payout x2, conversation x2
      expect(mockPrisma.message.count).toHaveBeenCalledTimes(2);
    });

    it('should calculate positive revenue change correctly', async () => {
      (mockPrisma.message.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.payout.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: 300 } })
        .mockResolvedValueOnce({ _sum: { amount: 200 } });
      (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(0);

      const result = await getComparativeAnalytics('creator-1', 30);

      expect(result.change.revenue).toBe(50); // (300-200)/200 * 100 = 50%
    });

    it('should calculate negative message change correctly', async () => {
      (mockPrisma.message.count as jest.Mock)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(100);
      (mockPrisma.payout.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(0);

      const result = await getComparativeAnalytics('creator-1', 30);

      expect(result.change.messages).toBe(-50); // (50-100)/100 * 100 = -50%
    });

    it('should treat null payout amount as 0', async () => {
      (mockPrisma.message.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.payout.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      (mockPrisma.conversation.count as jest.Mock).mockResolvedValue(0);

      const result = await getComparativeAnalytics('creator-1');

      expect(result.currentPeriod.revenue).toBe(0);
      expect(result.previousPeriod.revenue).toBe(0);
    });
  });
});
