// ===========================================
// TRENDING CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    post: { findMany: jest.fn(), count: jest.fn() },
    creator: { findMany: jest.fn(), count: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/trending.service', () => ({
  getTrendingPosts: jest.fn((posts: any[]) => posts),
  getTrendingCreators: jest.fn((creators: any[]) => creators),
  getTrendingHashtags: jest.fn(() => []),
  getCategoryTrending: jest.fn((posts: any[]) => posts)
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  getTrendingPostsController,
  getTrendingCreatorsController,
  getTrendingHashtagsController,
  getCategoryTrendingController,
  getTrendingStatsController
} from '../../../controllers/trending.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Trending Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.post.count as jest.Mock).mockResolvedValue(0);
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const trendingService = require('../../../services/trending.service');
    (trendingService.getTrendingPosts as jest.Mock).mockImplementation((posts: any[]) => posts);
    (trendingService.getTrendingCreators as jest.Mock).mockImplementation((creators: any[]) => creators);
    (trendingService.getTrendingHashtags as jest.Mock).mockImplementation(() => []);
    (trendingService.getCategoryTrending as jest.Mock).mockImplementation((posts: any[]) => posts);
  });

  describe('getTrendingPostsController', () => {
    it('should return trending posts', async () => {
      const req = mockReq({ query: { timeWindow: '24', limit: '10' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingPostsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 for invalid time window', async () => {
      const req = mockReq({ query: { timeWindow: '999' } });
      const res = mockRes();

      await expect(getTrendingPostsController(req, res)).rejects.toThrow('Invalid time window');
    });
  });

  describe('getTrendingCreatorsController', () => {
    it('should return trending creators', async () => {
      const req = mockReq({ query: { timeWindow: '168' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingCreatorsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getTrendingHashtagsController', () => {
    it('should return trending hashtags', async () => {
      const req = mockReq({ query: { timeWindow: '24' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getTrendingHashtagsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getCategoryTrendingController', () => {
    it('should return category trending', async () => {
      const req = mockReq({ params: { category: 'Tech' }, query: {} });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

      await getCategoryTrendingController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when category is missing', async () => {
      const req = mockReq({ params: {}, query: {} });
      const res = mockRes();

      await expect(getCategoryTrendingController(req, res)).rejects.toThrow('Category is required');
    });
  });

  describe('getTrendingStatsController', () => {
    it('should return trending stats', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.post.count as jest.Mock).mockResolvedValue(10);
      (prisma.creator.count as jest.Mock).mockResolvedValue(2);

      await getTrendingStatsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
