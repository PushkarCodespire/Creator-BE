// ===========================================
// RECOMMENDATION CONTROLLER UNIT TESTS
// ===========================================

import { Request, Response } from 'express';
import {
  getRecommendedCreators,
  getSimilarCreatorsController,
  getRecommendedPostsController,
  getForYouRecommendations,
  getCategoryRecommendations,
} from '../../controllers/recommendation.controller';
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
    creator: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    post: {
      findMany: jest.fn(),
    },
    follow: {
      findMany: jest.fn(),
    },
    like: {
      findMany: jest.fn(),
    },
  },
}));

// Mock recommendation service
jest.mock('../../services/recommendation.service', () => ({
  buildUserProfile: jest.fn().mockResolvedValue({
    userId: 'user-123',
    followingIds: [],
    likedPostCategories: [],
    interactionHistory: [],
  }),
  getContentBasedRecommendations: jest.fn((creators: any[]) =>
    creators.map((c: any) => ({ ...c, _recommendationScore: 50, _reasons: ['Test reason'] }))
  ),
  getCollaborativeRecommendations: jest.fn().mockResolvedValue([]),
  getSimilarCreators: jest.fn((target: any, creators: any[], limit: number) =>
    creators.slice(0, limit).map((c: any) => ({ ...c, _similarityScore: 60 }))
  ),
  getRecommendedPosts: jest.fn((posts: any[]) =>
    posts.map((p: any) => ({ ...p, _recommendationScore: 40 }))
  ),
  diversifyRecommendations: jest.fn((recs: any[]) => recs),
}));

describe('Recommendation Controller', () => {
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
      user: {
        id: 'user-123',
        email: 'user@test.com',
        name: 'Test User',
        role: 'USER' as any,
      },
      query: {},
      params: {},
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock,
    };

    // Default mock implementations
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

    // Reset service mocks to default
    const service = require('../../services/recommendation.service');
    (service.buildUserProfile as jest.Mock).mockResolvedValue({
      userId: 'user-123',
      followingIds: [],
      likedPostCategories: [],
      interactionHistory: [],
    });
    (service.getCollaborativeRecommendations as jest.Mock).mockResolvedValue([]);
    (service.getContentBasedRecommendations as jest.Mock).mockImplementation((creators: any[]) =>
      creators.map((c: any) => ({ ...c, _recommendationScore: 50, _reasons: ['Test reason'] }))
    );
    (service.getSimilarCreators as jest.Mock).mockImplementation((target: any, creators: any[], limit: number) =>
      creators.slice(0, limit).map((c: any) => ({ ...c, _similarityScore: 60 }))
    );
    (service.getRecommendedPosts as jest.Mock).mockImplementation((posts: any[]) =>
      posts.map((p: any) => ({ ...p, _recommendationScore: 40 }))
    );
    (service.diversifyRecommendations as jest.Mock).mockImplementation((recs: any[]) => recs);
  });

  describe('getRecommendedCreators', () => {
    it('should return recommended creators for authenticated user', async () => {
      const mockCreators = [
        {
          id: 'creator-1',
          displayName: 'Creator 1',
          isActive: true,
          category: 'MUSIC',
          createdAt: new Date(),
          _count: { followers: 100, posts: 20 },
        },
      ];

      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.creator.findMany).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            recommendations: expect.any(Array),
            count: expect.any(Number),
          }),
        })
      );
    });

    it('should return 401 when user is not authenticated', async () => {
      mockRequest.user = undefined;

      await expect(
        getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock)
      ).rejects.toThrow('Authentication required');
    });

    it('should support content-based method', async () => {
      mockRequest.query = { method: 'content', limit: '5' };

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should support collaborative method', async () => {
      mockRequest.query = { method: 'collaborative', limit: '5' };

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should return empty recommendations when no creators available', async () => {
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            recommendations: [],
            count: 0,
          }),
        })
      );
    });

    it('should include user profile info in response', async () => {
      const service = require('../../services/recommendation.service');
      (service.buildUserProfile as jest.Mock).mockResolvedValue({
        userId: 'user-123',
        followingIds: ['creator-5', 'creator-6'],
        likedPostCategories: ['MUSIC', 'ART'],
        interactionHistory: [],
      });

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            userProfile: expect.objectContaining({
              followingCount: expect.any(Number),
            }),
          }),
        })
      );
    });
  });

  describe('getSimilarCreatorsController', () => {
    it('should return similar creators', async () => {
      mockRequest.params = { creatorId: 'creator-1' };

      const targetCreator = {
        id: 'creator-1',
        displayName: 'Creator 1',
        category: 'MUSIC',
        isActive: true,
        createdAt: new Date(),
        _count: { followers: 500, posts: 50 },
      };

      const allCreators = [
        {
          id: 'creator-2',
          displayName: 'Creator 2',
          category: 'MUSIC',
          isActive: true,
          createdAt: new Date(),
          _count: { followers: 300, posts: 30 },
        },
      ];

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(targetCreator);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue(allCreators);

      await getSimilarCreatorsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            similar: expect.any(Array),
            count: expect.any(Number),
            targetCreator: expect.objectContaining({
              id: 'creator-1',
            }),
          }),
        })
      );
    });

    it('should return 404 when creator not found', async () => {
      mockRequest.params = { creatorId: 'nonexistent' };

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        getSimilarCreatorsController(mockRequest as Request, mockResponse as Response, nextMock)
      ).rejects.toThrow('Creator not found');
    });

    it('should return empty similar list when no other creators', async () => {
      mockRequest.params = { creatorId: 'creator-1' };

      const targetCreator = {
        id: 'creator-1',
        displayName: 'Creator 1',
        category: 'MUSIC',
        createdAt: new Date(),
        _count: { followers: 100, posts: 10 },
      };

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(targetCreator);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      const service = require('../../services/recommendation.service');
      (service.getSimilarCreators as jest.Mock).mockReturnValue([]);

      await getSimilarCreatorsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            similar: [],
            count: 0,
          }),
        })
      );
    });
  });

  describe('getRecommendedPostsController', () => {
    it('should return recommended posts for authenticated user', async () => {
      const mockPosts = [
        {
          id: 'post-1',
          isPublished: true,
          publishedAt: new Date(),
          creator: { id: 'creator-1', displayName: 'Creator 1', profileImage: null, isVerified: false, category: 'MUSIC' },
          _count: { likes: 50, comments: 10 },
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValue(mockPosts);

      await getRecommendedPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.post.findMany).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            posts: expect.any(Array),
            pagination: expect.objectContaining({
              page: expect.any(Number),
              limit: expect.any(Number),
            }),
          }),
        })
      );
    });

    it('should return 401 when user is not authenticated', async () => {
      mockRequest.user = undefined;

      await expect(
        getRecommendedPostsController(mockRequest as Request, mockResponse as Response, nextMock)
      ).rejects.toThrow('Authentication required');
    });

    it('should support pagination', async () => {
      mockRequest.query = { page: '2', limit: '5' };

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            pagination: expect.objectContaining({
              page: 2,
              limit: 5,
            }),
          }),
        })
      );
    });

    it('should return empty posts when none available', async () => {
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      const service = require('../../services/recommendation.service');
      (service.getRecommendedPosts as jest.Mock).mockReturnValue([]);

      await getRecommendedPostsController(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            posts: [],
          }),
        })
      );
    });
  });

  describe('getForYouRecommendations', () => {
    it('should return personalized recommendations for authenticated user', async () => {
      const mockCreators = [
        {
          id: 'creator-1',
          displayName: 'Creator 1',
          isActive: true,
          category: 'MUSIC',
          createdAt: new Date(),
          _count: { followers: 200, posts: 30 },
        },
      ];

      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getForYouRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            recommendations: expect.any(Array),
          }),
        })
      );
    });

    it('should return popular creators for unauthenticated users', async () => {
      mockRequest.user = undefined;

      const mockCreators = [
        {
          id: 'creator-1',
          displayName: 'Popular Creator',
          isActive: true,
          category: 'MUSIC',
          createdAt: new Date(),
          _count: { followers: 5000, posts: 100 },
        },
      ];

      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getForYouRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            recommendations: expect.any(Array),
          }),
        })
      );
    });

    it('should return empty recommendations when no creators', async () => {
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getForYouRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });

  describe('getCategoryRecommendations', () => {
    it('should return creators in specified category', async () => {
      mockRequest.params = { category: 'MUSIC' };

      const mockCreators = [
        {
          id: 'creator-1',
          displayName: 'Music Creator',
          category: 'MUSIC',
          isActive: true,
          createdAt: new Date(),
          _count: { followers: 300, posts: 40 },
        },
      ];

      (prisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);

      await getCategoryRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'MUSIC',
          }),
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            category: 'MUSIC',
            creators: expect.any(Array),
            count: expect.any(Number),
          }),
        })
      );
    });

    it('should return empty when no creators in category', async () => {
      mockRequest.params = { category: 'UNKNOWN' };

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCategoryRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

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

    it('should support custom limit', async () => {
      mockRequest.params = { category: 'ART' };
      mockRequest.query = { limit: '5' };

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCategoryRecommendations(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });
  });
});
