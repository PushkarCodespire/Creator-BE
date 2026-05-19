// ===========================================
// RECOMMENDATION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn(), findMany: jest.fn() },
    post: { findMany: jest.fn() }
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
  buildUserProfile: jest.fn().mockResolvedValue({
    followingIds: [],
    likedPostCategories: [],
    interests: []
  }),
  getContentBasedRecommendations: jest.fn(() => []),
  getCollaborativeRecommendations: jest.fn().mockResolvedValue([]),
  getSimilarCreators: jest.fn(() => []),
  getRecommendedPosts: jest.fn(() => []),
  diversifyRecommendations: jest.fn((recs: any[]) => recs)
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getRecommendedCreators,
  getSimilarCreatorsController,
  getRecommendedPostsController,
  getForYouRecommendations,
  getCategoryRecommendations
} from '../../../controllers/recommendation.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Recommendation Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
    const service = require('../../../services/recommendation.service');
    (service.buildUserProfile as jest.Mock).mockResolvedValue({
      followingIds: [],
      likedPostCategories: [],
      interests: []
    });
    (service.getCollaborativeRecommendations as jest.Mock).mockResolvedValue([]);
    (service.getContentBasedRecommendations as jest.Mock).mockImplementation(() => []);
    (service.getSimilarCreators as jest.Mock).mockImplementation(() => []);
    (service.getRecommendedPosts as jest.Mock).mockImplementation(() => []);
    (service.diversifyRecommendations as jest.Mock).mockImplementation((recs: any[]) => recs);
  });

  describe('getRecommendedCreators', () => {
    it('should return recommendations', async () => {
      const req = mockReq({ query: { limit: '5' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedCreators(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getRecommendedCreators(req, res)).rejects.toThrow('Authentication required');
    });
  });

  describe('getSimilarCreatorsController', () => {
    it('should return similar creators', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' }, query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'cr-1', displayName: 'C', category: 'Tech', _count: { followers: 10, posts: 5 }
      });
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getSimilarCreatorsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { creatorId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getSimilarCreatorsController(req, res)).rejects.toThrow('Creator not found');
    });
  });

  describe('getRecommendedPostsController', () => {
    it('should return recommended posts', async () => {
      const req = mockReq({ query: { limit: '10' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getRecommendedPostsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getRecommendedPostsController(req, res)).rejects.toThrow('Authentication required');
    });
  });

  describe('getForYouRecommendations', () => {
    it('should return popular creators for unauthenticated users', async () => {
      const req = mockReq({ user: undefined, query: {} });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getForYouRecommendations(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return personalized recs for authenticated users', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getForYouRecommendations(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getCategoryRecommendations', () => {
    it('should return creators in category', async () => {
      const req = mockReq({ params: { category: 'Tech' }, query: {} });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCategoryRecommendations(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
