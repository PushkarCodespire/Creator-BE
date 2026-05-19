jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    userAchievement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn() },
    creator: { findMany: jest.fn() },
    achievement: { findMany: jest.fn() },
    message: { count: jest.fn() },
  },
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getUserAchievements,
  getLeaderboard,
  checkAchievements,
} from '../../../controllers/gamification.controller';

const makeReq = (overrides: Partial<Request> = {}) =>
  ({ user: { id: 'user-1' }, body: {}, query: {}, params: {}, ...overrides } as unknown as Request);

const makeRes = () => {
  const r = {} as Response;
  r.json = jest.fn().mockReturnValue(r);
  r.status = jest.fn().mockReturnValue(r);
  return r;
};

const p = prisma as jest.Mocked<typeof prisma>;

describe('Gamification Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (p.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
    (p.user.findMany as jest.Mock).mockResolvedValue([]);
    (p.creator.findMany as jest.Mock).mockResolvedValue([]);
    (p.achievement.findMany as jest.Mock).mockResolvedValue([]);
    (p.message.count as jest.Mock).mockResolvedValue(0);
    (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);
    (p.userAchievement.create as jest.Mock).mockResolvedValue({});
    (p.userAchievement.update as jest.Mock).mockResolvedValue({});
  });

  describe('getUserAchievements', () => {
    it('returns user achievements', async () => {
      const achievements = [{ id: 'a1', isUnlocked: true, achievement: { name: 'First Chat' } }];
      (p.userAchievement.findMany as jest.Mock).mockResolvedValue(achievements);

      const req = makeReq();
      const res = makeRes();
      await getUserAchievements(req, res);

      expect(p.userAchievement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, include: { achievement: true } })
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: achievements });
    });

    it('returns empty list when no achievements', async () => {
      const req = makeReq();
      const res = makeRes();
      await getUserAchievements(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });

  describe('getLeaderboard', () => {
    it('returns users leaderboard', async () => {
      const users = [
        { id: 'u1', name: 'Alice', avatar: null, _count: { messages: 50 } },
        { id: 'u2', name: 'Bob', avatar: null, _count: { messages: 30 } },
      ];
      (p.user.findMany as jest.Mock).mockResolvedValue(users);

      const req = makeReq({ query: { type: 'users' } });
      const res = makeRes();
      await getLeaderboard(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          { rank: 1, userId: 'u1', name: 'Alice', avatar: null, score: 50 },
          { rank: 2, userId: 'u2', name: 'Bob', avatar: null, score: 30 },
        ],
      });
    });

    it('defaults to users type', async () => {
      (p.user.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ query: {} });
      const res = makeRes();
      await getLeaderboard(req, res);

      expect(p.user.findMany).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    it('returns creators leaderboard', async () => {
      const creators = [
        { id: 'c1', displayName: 'Creator1', profileImage: null, totalChats: 100, totalEarnings: 500 },
      ];
      (p.creator.findMany as jest.Mock).mockResolvedValue(creators);

      const req = makeReq({ query: { type: 'creators' } });
      const res = makeRes();
      await getLeaderboard(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ rank: 1, creatorId: 'c1', displayName: 'Creator1', profileImage: null, score: 100, earnings: 500 }],
      });
    });

    it('throws 400 for invalid leaderboard type', async () => {
      const req = makeReq({ query: { type: 'invalid' } });
      const res = makeRes();

      await expect(getLeaderboard(req, res)).rejects.toThrow('Invalid leaderboard type');
    });
  });

  describe('checkAchievements', () => {
    it('returns empty unlocked when no matching achievements', async () => {
      (p.achievement.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { unlockedAchievements: [] } });
    });

    it('creates new achievement progress for chat category - not unlocked', async () => {
      const achievement = { id: 'ach1', category: 'chat', isActive: true };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);
      (p.message.count as jest.Mock).mockResolvedValue(50);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', achievementId: 'ach1', isUnlocked: false }) })
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { unlockedAchievements: [] } });
    });

    it('unlocks achievement when message count >= 100', async () => {
      const achievement = { id: 'ach1', category: 'chat', isActive: true };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);
      (p.message.count as jest.Mock).mockResolvedValue(100);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isUnlocked: true }) })
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { unlockedAchievements: [achievement] } });
    });

    it('updates existing achievement progress', async () => {
      const achievement = { id: 'ach1', category: 'chat', isActive: true };
      const existing = { id: 'ua1', isUnlocked: false };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(existing);
      (p.message.count as jest.Mock).mockResolvedValue(75);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ua1' }, data: expect.objectContaining({ isUnlocked: false }) })
      );
    });

    it('skips already unlocked achievements', async () => {
      const achievement = { id: 'ach1', category: 'chat', isActive: true };
      const existing = { id: 'ua1', isUnlocked: true };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(existing);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.update).not.toHaveBeenCalled();
      expect(p.userAchievement.create).not.toHaveBeenCalled();
    });

    it('handles streak category with mock progress', async () => {
      const achievement = { id: 'ach2', category: 'streak', isActive: true };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ body: { eventType: 'streak' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 50, isUnlocked: false }) })
      );
    });

    it('handles default category with 0 progress', async () => {
      const achievement = { id: 'ach3', category: 'social', isActive: true };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ body: { eventType: 'social' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ progress: 0 }) })
      );
    });

    it('updates and unlocks existing achievement on chat with 100+ messages', async () => {
      const achievement = { id: 'ach1', category: 'chat', isActive: true };
      const existing = { id: 'ua1', isUnlocked: false };
      (p.achievement.findMany as jest.Mock).mockResolvedValue([achievement]);
      (p.userAchievement.findUnique as jest.Mock).mockResolvedValue(existing);
      (p.message.count as jest.Mock).mockResolvedValue(200);

      const req = makeReq({ body: { eventType: 'chat' } });
      const res = makeRes();
      await checkAchievements(req, res);

      expect(p.userAchievement.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isUnlocked: true }) })
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { unlockedAchievements: [achievement] } });
    });
  });
});
