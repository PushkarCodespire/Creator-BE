// ===========================================
// USER DASHBOARD CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    conversation: { count: jest.fn(), findMany: jest.fn() },
    message: { count: jest.fn(), findMany: jest.fn() },
    follow: { count: jest.fn(), findMany: jest.fn() },
    notification: { count: jest.fn(), findMany: jest.fn() },
    subscription: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/recommendation.service', () => ({
  getRecommendedCreatorsForUser: jest.fn().mockResolvedValue([])
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getDashboardStats,
  getRecentConversations,
  getRecommendedCreators,
  getActivityFeed
} from '../../../controllers/userDashboard.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('UserDashboard Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getDashboardStats', () => {
    it('should return dashboard stats', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.conversation.count as jest.Mock).mockResolvedValue(5);
      (prisma.message.count as jest.Mock).mockResolvedValue(50);
      (prisma.follow.count as jest.Mock).mockResolvedValue(3);
      (prisma.notification.count as jest.Mock).mockResolvedValue(2);
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE', status: 'ACTIVE', messagesUsedToday: 2, currentPeriodEnd: null
      });
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getDashboardStats(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getDashboardStats(req, res)).rejects.toThrow('Authentication required');
    });
  });

  describe('getRecentConversations', () => {
    it('should return recent conversations', async () => {
      const req = mockReq({ query: { limit: '5' } });
      const res = mockRes();

      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getRecentConversations(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getRecentConversations(req, res)).rejects.toThrow('Authentication required');
    });
  });

  describe('getRecommendedCreators', () => {
    it('should return recommended creators', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: ['Tech'] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getRecommendedCreators(req, res)).rejects.toThrow('Authentication required');
    });
  });

  describe('getActivityFeed', () => {
    it('should return activity feed', async () => {
      const req = mockReq({ query: { limit: '10', days: '7' } });
      const res = mockRes();

      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getActivityFeed(req, res)).rejects.toThrow('Authentication required');
    });
  });

  // ===========================================
  // NEW BRANCH COVERAGE TESTS
  // ===========================================

  describe('getDashboardStats — additional branches', () => {
    const setupMocks = (overrides: Record<string, any> = {}) => {
      (prisma.conversation.count as jest.Mock).mockResolvedValue(overrides.totalChats ?? 0);
      (prisma.message.count as jest.Mock).mockResolvedValue(overrides.msgCount ?? 0);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(
        overrides.subscription ?? null
      );
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue(overrides.recent ?? []);
      (prisma.message.findMany as jest.Mock).mockResolvedValue(overrides.messages30 ?? []);
    };

    it('should compute PREMIUM plan quota as 999999 with 0% usage', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ subscription: { plan: 'PREMIUM', status: 'ACTIVE', messagesUsedToday: 0, currentPeriodEnd: null } });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.messageQuota).toBe(999999);
      expect(call.data.subscription.quotaPercentage).toBe(0);
    });

    it('should compute FREE plan quota as 5 with correct percentage', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ subscription: { plan: 'FREE', status: 'ACTIVE', messagesUsedToday: 3, currentPeriodEnd: null } });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.messageQuota).toBe(5);
      expect(call.data.subscription.quotaPercentage).toBe(60);
    });

    it('should default plan to FREE and status to ACTIVE when no subscription', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ subscription: null });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.plan).toBe('FREE');
      expect(call.data.subscription.status).toBe('ACTIVE');
    });

    it('should set messagesUsed=0 when subscription.messagesUsedToday is undefined', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ subscription: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null } });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.messagesUsedToday).toBe(0);
    });

    it('should calculate active streak of 1 for today-only activity', async () => {
      const req = mockReq();
      const res = mockRes();

      const todayMsg = { createdAt: new Date() };
      setupMocks({ messages30: [todayMsg] });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.stats.activeStreak).toBe(1);
    });

    it('should calculate streak=0 when there are no recent messages', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ messages30: [] });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.stats.activeStreak).toBe(0);
    });

    it('should count activeConversationsThisWeek from recentActivity', async () => {
      const req = mockReq();
      const res = mockRes();
      setupMocks({ recent: [{ id: 'c1' }, { id: 'c2' }] });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.stats.activeConversationsThisWeek).toBe(2);
    });

    it('should include renewalDate from subscription.currentPeriodEnd', async () => {
      const req = mockReq();
      const res = mockRes();
      const endDate = new Date('2026-12-31');
      setupMocks({ subscription: { plan: 'PREMIUM', status: 'ACTIVE', messagesUsedToday: 0, currentPeriodEnd: endDate } });

      await getDashboardStats(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.subscription.renewalDate).toEqual(endDate);
    });
  });

  describe('getRecentConversations — additional branches', () => {
    it('should default limit to 5 when not provided', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getRecentConversations(req, res);

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it('should use custom limit from query', async () => {
      const req = mockReq({ query: { limit: '3' } });
      const res = mockRes();
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getRecentConversations(req, res);

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      );
    });

    it('should truncate lastMessage content longer than 100 chars', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const longContent = 'A'.repeat(150);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'conv-1',
          creator: { id: 'c1', displayName: 'Creator', profileImage: null, category: 'FITNESS', isVerified: true, rating: 5, tagline: 'Hi' },
          messages: [{ content: longContent, createdAt: new Date(), role: 'ASSISTANT' }],
          _count: { messages: 50 },
          lastMessageAt: new Date(),
          createdAt: new Date()
        }
      ]);

      await getRecentConversations(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      const lastMsg = call.data.conversations[0].lastMessage;
      expect(lastMsg.content).toContain('...');
      expect(lastMsg.content.length).toBeLessThanOrEqual(103);
    });

    it('should set lastMessage to null when no messages exist', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'conv-1',
          creator: { id: 'c1', displayName: 'Creator', profileImage: null, category: 'FITNESS', isVerified: true, rating: 5, tagline: 'Hi' },
          messages: [],
          _count: { messages: 0 },
          lastMessageAt: new Date(),
          createdAt: new Date()
        }
      ]);

      await getRecentConversations(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.conversations[0].lastMessage).toBeNull();
    });

    it('should NOT truncate content exactly 100 chars long', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const exactContent = 'B'.repeat(100);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'conv-1',
          creator: { id: 'c1', displayName: 'Creator', profileImage: null, category: 'FITNESS', isVerified: false, rating: 4, tagline: '' },
          messages: [{ content: exactContent, createdAt: new Date(), role: 'USER' }],
          _count: { messages: 1 },
          lastMessageAt: new Date(),
          createdAt: new Date()
        }
      ]);

      await getRecentConversations(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.conversations[0].lastMessage.content).not.toContain('...');
    });
  });

  describe('getRecommendedCreators — additional branches', () => {
    it('should use default limit of 10 when not provided', async () => {
      const { getRecommendedCreatorsForUser } = require('../../../services/recommendation.service');
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(req, res);

      expect(getRecommendedCreatorsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });

    it('should use empty interests array when user has no interests', async () => {
      const { getRecommendedCreatorsForUser } = require('../../../services/recommendation.service');
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(req, res);

      expect(getRecommendedCreatorsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ interests: [] })
      );
    });

    it('should map following list to array of IDs', async () => {
      const { getRecommendedCreatorsForUser } = require('../../../services/recommendation.service');
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { followingId: 'cr-1' },
        { followingId: 'cr-2' }
      ]);

      await getRecommendedCreators(req, res);

      expect(getRecommendedCreatorsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ followingIds: ['cr-1', 'cr-2'] })
      );
    });
  });

  describe('getActivityFeed — additional branches', () => {
    it('should use default limit=20 and days=7 when not provided', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.activities).toEqual([]);
      expect(call.data.total).toBe(0);
    });

    it('should include notification activities in response', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const notif = {
        id: 'n1', type: 'CHAT', title: 'Hello', message: 'Msg', actionUrl: '/chat',
        isRead: false, createdAt: new Date(), priority: 'NORMAL'
      };
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([notif]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.activities[0]).toMatchObject({ type: 'notification', id: 'n1' });
    });

    it('should include follow activities with correct message', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { id: 'f1', createdAt: new Date(), following: { id: 'cr1', displayName: 'Jane', profileImage: null, category: 'YOGA' } }
      ]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      const followActivity = call.data.activities.find((a: any) => a.type === 'follow');
      expect(followActivity.message).toBe('You started following Jane');
    });

    it('should include conversation activities with correct message', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
        { id: 'conv1', createdAt: new Date(), creator: { id: 'cr1', displayName: 'Bob', profileImage: null, category: 'FITNESS' } }
      ]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      const convActivity = call.data.activities.find((a: any) => a.type === 'conversation');
      expect(convActivity.message).toBe('Started chatting with Bob');
    });

    it('should sort activities by timestamp descending', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const olderDate = new Date(Date.now() - 10000);
      const newerDate = new Date();

      (prisma.notification.findMany as jest.Mock).mockResolvedValue([
        { id: 'n-old', type: 'CHAT', title: 'Old', message: 'Old', actionUrl: null, isRead: false, createdAt: olderDate, priority: 'NORMAL' }
      ]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { id: 'f-new', createdAt: newerDate, following: { id: 'cr1', displayName: 'Jane', profileImage: null, category: 'YOGA' } }
      ]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.activities[0].id).toBe('f-new');
      expect(call.data.activities[1].id).toBe('n-old');
    });

    it('should slice activities to the limit', async () => {
      const req = mockReq({ query: { limit: '2' } });
      const res = mockRes();

      const makeNotif = (id: string, offset: number) => ({
        id, type: 'CHAT', title: id, message: id, actionUrl: null, isRead: false,
        createdAt: new Date(Date.now() - offset), priority: 'NORMAL'
      });

      (prisma.notification.findMany as jest.Mock).mockResolvedValue([
        makeNotif('n1', 1000), makeNotif('n2', 2000), makeNotif('n3', 3000)
      ]);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getActivityFeed(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.activities.length).toBe(2);
      expect(call.data.total).toBe(3);
    });
  });
});
