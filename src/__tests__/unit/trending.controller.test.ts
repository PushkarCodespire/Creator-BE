// ===========================================
// TRENDING CONTROLLER UNIT TESTS
// ===========================================

import { Request, Response } from 'express';
import {
  getTrendingPostsController,
  getTrendingCreatorsController,
  getTrendingHashtagsController,
  getCategoryTrendingController,
  getTrendingStatsController,
} from '../../controllers/trending.controller';
import prisma from '../../../prisma/client';

jest.mock('../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

// Mock Prisma client
jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    post: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    creator: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

// Mock trending service
jest.mock('../../services/trending.service', () => ({
  getTrendingPosts: jest.fn((posts: any[]) => posts),
  getTrendingCreators: jest.fn((creators: any[]) => creators),
  getTrendingHashtags: jest.fn(() => [{ tag: '#test', count: 5, posts: ['post-1'] }]),
  getCategoryTrending: jest.fn((posts: any[]) => posts),
}));

describe('Trending Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let nextMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn(() => ({ json: jsonMock })) as any;
    nextMock = jest.fn();

    mockRequest = {
      query: {},
      params: {},
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock,
    };

    // Default mock implementations returning arrays
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.post.count as jest.Mock).mockResolvedValue(0);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);

    // Restore trending service implementations cleared by jest.clearAllMocks()
    const trendingService = require('../../services/trending.service');
    (trendingService.getTrendingPosts as jest.Mock).mockImplementation((posts: any[]) => posts);
    (trendingService.getTrendingCreators as jest.Mock).mockImplementation((creators: any[]) => creators);
    (trendingService.getTrendingHashtags as jest.Mock).mockImplementation(() => [{ tag: '#test', count: 5, posts: ['post-1'] }]);
    (trendingService.getCategoryTrending as jest.Mock).mockImplementation((posts: any[]) => posts);
  });

  describe('getTrendingPostsController', () => {
    it('should return trending posts with default params', async () => {
      const mockPosts = [
        {
          id: 'post-1',
          isPublished: true,
          publishedAt: new Date(),
          creator: { id: 'creator-1', displayName: 'Creator 1', profileImage: null, isVerified: false, category: 'MUSIC' },
          _count: { likes: 10, comments: 5 },
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValue(mockPosts);

      await getTrendingPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.post.findMany).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            posts: expect.any(Array),
            timeWindow: expect.any(Number),
            count: expect.any(Number),
          }),
        })
      );
    });

    it('should accept custom time window and limit', async () => {
      mockRequest.query = { timeWindow: '168', limit: '5' };

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ timeWindow: 168 }),
        })
      );
    });

    it('should return 400 for invalid time window', async () => {
      mockRequest.query = { timeWindow: '999' };

      await expect(
        getTrendingPostsController(mockRequest as Request, mockResponse as Response, nextMock)
      ).rejects.toThrow('Invalid time window');
    });

    it('should filter by category when provided', async () => {
      mockRequest.query = { category: 'MUSIC', timeWindow: '24' };

      const mockPosts = [
        {
          id: 'post-1',
          isPublished: true,
          publishedAt: new Date(),
          creator: { id: 'creator-1', displayName: 'Creator 1', profileImage: null, isVerified: false, category: 'MUSIC' },
          _count: { likes: 10, comments: 5 },
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValue(mockPosts);

      await getTrendingPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should return empty array when no posts found', async () => {
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            posts: expect.any(Array),
            count: 0,
          }),
        })
      );
    });
  });

  describe('getTrendingCreatorsController', () => {
    it('should return trending creators with default params', async () => {
      const mockCreators = [
        {
          id: 'creator-1',
          isActive: true,
          createdAt: new Date(),
          user: { id: 'user-1', name: 'User 1', avatar: null },
          _count: { followers: 100, posts: 20 },
        },
      ];

      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getTrendingCreatorsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.creator.findMany).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            creators: expect.any(Array),
            timeWindow: expect.any(Number),
            count: expect.any(Number),
          }),
        })
      );
    });

    it('should filter by category when provided', async () => {
      mockRequest.query = { category: 'MUSIC' };

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingCreatorsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'MUSIC',
          }),
        })
      );
    });

    it('should return empty array when no creators found', async () => {
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingCreatorsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            creators: [],
            count: 0,
          }),
        })
      );
    });
  });

  describe('getTrendingHashtagsController', () => {
    it('should return trending hashtags', async () => {
      const mockPosts = [
        {
          id: 'post-1',
          content: 'Check out #music and #trending today!',
          createdAt: new Date(),
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValue(mockPosts);

      await getTrendingHashtagsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.post.findMany).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            hashtags: expect.any(Array),
            timeWindow: expect.any(Number),
            count: expect.any(Number),
          }),
        })
      );
    });

    it('should return empty hashtags when no posts', async () => {
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      const { getTrendingHashtags } = require('../../services/trending.service');
      (getTrendingHashtags as jest.Mock).mockReturnValue([]);

      await getTrendingHashtagsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            count: 0,
          }),
        })
      );
    });
  });

  describe('getCategoryTrendingController', () => {
    it('should return category trending posts', async () => {
      mockRequest.params = { category: 'MUSIC' };

      const mockPosts = [
        {
          id: 'post-1',
          isPublished: true,
          publishedAt: new Date(),
          creator: { id: 'creator-1', displayName: 'Creator 1', profileImage: null, isVerified: false, category: 'MUSIC' },
          _count: { likes: 10, comments: 5 },
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValue(mockPosts);

      await getCategoryTrendingController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            category: 'MUSIC',
            posts: expect.any(Array),
          }),
        })
      );
    });

    it('should return empty results for category with no posts', async () => {
      mockRequest.params = { category: 'UNKNOWN' };

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getCategoryTrendingController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            count: 0,
          }),
        })
      );
    });
  });

  describe('getTrendingStatsController', () => {
    it('should return trending stats overview', async () => {
      (prisma.post.count as jest.Mock).mockResolvedValue(42);
      (prisma.creator.count as jest.Mock).mockResolvedValue(10);

      await getTrendingStatsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            daily: expect.objectContaining({
              posts: expect.any(Number),
              newCreators: expect.any(Number),
            }),
            weekly: expect.objectContaining({
              posts: expect.any(Number),
              newCreators: expect.any(Number),
            }),
          }),
        })
      );
    });

    it('should return zero counts when no data', async () => {
      (prisma.post.count as jest.Mock).mockResolvedValue(0);
      (prisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getTrendingStatsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            daily: expect.objectContaining({
              posts: 0,
              newCreators: 0,
            }),
          }),
        })
      );
    });
  });
});
