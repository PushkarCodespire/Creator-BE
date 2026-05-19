// ===========================================
// GAMIFICATION CONTROLLER TESTS
// ===========================================

import { Request, Response } from 'express';
import { getUserAchievements, getLeaderboard, checkAchievements } from '../../controllers/gamification.controller';
import prisma from '../../../prisma/client';

jest.mock('../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    userAchievement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    creator: {
      findMany: jest.fn(),
    },
    achievement: {
      findMany: jest.fn(),
    },
    message: {
      count: jest.fn(),
    },
  },
}));

describe('Gamification Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      user: {
        id: 'user-123',
        email: 'user@test.com',
        name: 'Test User',
        role: 'USER' as any
      },
      query: {},
      body: {},
    };
    mockResponse = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();

    // Default prisma mock return values
    (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.userAchievement.create as jest.Mock).mockResolvedValue({});
    (prisma.userAchievement.update as jest.Mock).mockResolvedValue({});
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.achievement.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.message.count as jest.Mock).mockResolvedValue(0);
  });

  describe('getUserAchievements', () => {
    it('should return user achievements', async () => {
      const mockAchievements = [
        {
          id: 'ach-1',
          isUnlocked: true,
          unlockedAt: new Date(),
          progress: 100,
          achievement: {
            id: 'ach-1',
            name: 'First Chat',
            description: 'Send your first message',
            category: 'chat',
            points: 10,
            rarity: 'common',
          },
        },
      ];

      (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue(mockAchievements);

      await getUserAchievements(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockAchievements,
      });
    });
  });

  describe('getLeaderboard', () => {
    it('should return user leaderboard', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          name: 'User 1',
          avatar: null,
          _count: { messages: 100 },
        },
        {
          id: 'user-2',
          name: 'User 2',
          avatar: null,
          _count: { messages: 50 },
        },
      ];

      mockRequest.query = { type: 'users' };
      (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

      await getLeaderboard(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            rank: 1,
            userId: 'user-1',
            score: 100,
          }),
        ]),
      });
    });

    it('should return creator leaderboard', async () => {
      const mockCreators = [
        {
          id: 'creator-1',
          displayName: 'Creator 1',
          profileImage: null,
          totalChats: 200,
          totalEarnings: 1000,
        },
      ];

      mockRequest.query = { type: 'creators' };
      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getLeaderboard(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            rank: 1,
            creatorId: 'creator-1',
            score: 200,
          }),
        ]),
      });
    });
  });

  describe('checkAchievements', () => {
    it('should check and unlock achievements', async () => {
      const mockAchievements = [
        {
          id: 'ach-1',
          name: 'Chat Master',
          category: 'chat',
          points: 100,
        },
      ];

      mockRequest.body = { eventType: 'chat', eventData: {} };
      (prisma.achievement.findMany as jest.Mock).mockResolvedValue(mockAchievements);
      (prisma.userAchievement.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.message.count as jest.Mock).mockResolvedValue(100);
      (prisma.userAchievement.create as jest.Mock).mockResolvedValue({
        id: 'user-ach-1',
        userId: 'user-123',
        achievementId: 'ach-1',
        isUnlocked: true,
      });

      await checkAchievements(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          unlockedAchievements: expect.any(Array),
        }),
      });
    });
  });
});



