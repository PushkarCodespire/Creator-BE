// ===========================================
// SUBSCRIPTION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    subscription: { upsert: jest.fn(), findUnique: jest.fn() },
    message: { count: jest.fn(), findMany: jest.fn() },
    transaction: { findMany: jest.fn(), count: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../config', () => ({
  config: {
    subscription: { tokensPerMessage: 800, premiumPrice: 79900, tokenGrant: 1000000 }
  }
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getSubscriptionDetails,
  getPlanFeatures,
  getTransactionHistory,
  getUsageAnalytics
} from '../../../controllers/subscription.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Subscription Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.subscription.upsert as jest.Mock).mockResolvedValue({ id: 'sub-1', plan: 'FREE', status: 'ACTIVE' });
  });

  describe('getSubscriptionDetails', () => {
    it('should return subscription details', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        id: 'sub-1', plan: 'FREE', status: 'ACTIVE',
        user: { name: 'Test', email: 'test@t.com' },
        tokenBalance: 0, tokenGrant: 0, tokenGrantedAt: null
      });
      (prisma.message.count as jest.Mock).mockResolvedValue(0);

      await getSubscriptionDetails(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getSubscriptionDetails(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when subscription not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.upsert as jest.Mock).mockResolvedValue(null);
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.message.count as jest.Mock).mockResolvedValue(0);

      await expect(getSubscriptionDetails(req, res)).rejects.toThrow();
    });
  });

  describe('getPlanFeatures', () => {
    it('should return plan features', async () => {
      const req = mockReq();
      const res = mockRes();

      await getPlanFeatures(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ plans: expect.any(Array) }) })
      );
    });
  });

  describe('getTransactionHistory', () => {
    it('should return paginated transactions', async () => {
      const req = mockReq({ query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ id: 'sub-1' });
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.transaction.count as jest.Mock).mockResolvedValue(0);

      await getTransactionHistory(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getTransactionHistory(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when subscription not found', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.upsert as jest.Mock).mockRejectedValue(new Error('Subscription not found'));

      await expect(getTransactionHistory(req, res)).rejects.toThrow('Subscription not found');
    });
  });

  describe('getUsageAnalytics', () => {
    it('should return usage analytics', async () => {
      const req = mockReq({ query: { period: '30' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE', createdAt: new Date() });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getUsageAnalytics(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getUsageAnalytics(req, res)).rejects.toThrow('Authentication required');
    });

    it('should handle null subscription (no plan set) as FREE', async () => {
      const req = mockReq({ query: { period: '7' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getUsageAnalytics(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.plan).toBe('FREE');
    });

    it('should compute messagesPerRupee for PREMIUM user', async () => {
      const req = mockReq({ query: { period: '30' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'PREMIUM', createdAt: new Date() });
      // 3 messages → messagesPerRupee = 3 / 799 ≈ 0
      const fakeDate = new Date('2024-01-15T10:30:00Z');
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { createdAt: fakeDate, conversation: { creatorId: 'c1', creator: { displayName: 'Creator A', category: 'Music' } } },
        { createdAt: fakeDate, conversation: { creatorId: 'c1', creator: { displayName: 'Creator A', category: 'Music' } } },
        { createdAt: new Date('2024-01-16T14:00:00Z'), conversation: { creatorId: 'c2', creator: { displayName: 'Creator B', category: null } } }
      ]);

      await getUsageAnalytics(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.summary.messagesPerRupee).not.toBeNull();
      expect(call.data.charts.topCreators).toHaveLength(2);
    });

    it('should return null messagesPerRupee for FREE user', async () => {
      const req = mockReq({ query: { period: '30' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE', createdAt: new Date() });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getUsageAnalytics(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.summary.messagesPerRupee).toBeNull();
    });

    it('should return null peakUsageHour when no messages', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE', createdAt: new Date() });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getUsageAnalytics(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.summary.peakUsageHour).toBeNull();
    });

    it('should set peakUsageHour when messages exist', async () => {
      const req = mockReq({ query: { period: '30' } });
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ plan: 'FREE', createdAt: new Date() });
      const d = new Date('2024-03-01T08:00:00Z');
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { createdAt: d, conversation: { creatorId: 'c1', creator: { displayName: 'X', category: 'Tech' } } }
      ]);

      await getUsageAnalytics(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(typeof call.data.summary.peakUsageHour).toBe('string');
    });
  });

  describe('getSubscriptionDetails – PREMIUM branch', () => {
    it('should compute 0% usage percentage for PREMIUM users', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        id: 'sub-1', plan: 'PREMIUM', status: 'ACTIVE',
        user: { name: 'Pro User', email: 'pro@t.com' },
        tokenBalance: 1000000, tokenGrant: 1000000, tokenGrantedAt: new Date()
      });
      (prisma.message.count as jest.Mock).mockResolvedValue(42);

      await getSubscriptionDetails(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.usage.dailyUsagePercentage).toBe(0);
      expect(call.data.usage.monthlyUsagePercentage).toBe(0);
      expect(call.data.usage.dailyQuota).toBe(999999);
    });
  });

  describe('getTransactionHistory – status filter branch', () => {
    it('should filter by status when query.status provided', async () => {
      const req = mockReq({ query: { page: '2', limit: '5', status: 'COMPLETED' } });
      const res = mockRes();

      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
        { id: 't1', amount: 799, currency: 'INR', status: 'COMPLETED', razorpayPaymentId: 'p1', razorpayOrderId: 'o1', description: 'sub', metadata: {}, createdAt: new Date() }
      ]);
      (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

      await getTransactionHistory(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.summary.successfulTransactions).toBe(1);
      expect(call.data.summary.totalSpent).toBe(799);
      expect(call.data.pagination.page).toBe(2);
    });

    it('should compute summary for FAILED transactions', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
        { id: 't2', amount: 799, currency: 'INR', status: 'FAILED', razorpayPaymentId: null, razorpayOrderId: 'o2', description: 'sub', metadata: {}, createdAt: new Date() }
      ]);
      (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

      await getTransactionHistory(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.summary.failedTransactions).toBe(1);
      expect(call.data.summary.totalSpent).toBe(0);
    });
  });

  describe('getPlanFeatures – shape checks', () => {
    it('should return two plans (FREE and PREMIUM)', async () => {
      const req = mockReq();
      const res = mockRes();

      await getPlanFeatures(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.plans).toHaveLength(2);
      expect(call.data.plans[0].name).toBe('FREE');
      expect(call.data.plans[1].name).toBe('PREMIUM');
    });

    it('should include features arrays for each plan', async () => {
      const req = mockReq();
      const res = mockRes();

      await getPlanFeatures(req, res);
      const { plans } = (res.json as jest.Mock).mock.calls[0][0].data;
      plans.forEach((p: any) => expect(Array.isArray(p.features)).toBe(true));
    });
  });
});
