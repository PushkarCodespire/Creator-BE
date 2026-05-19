// ===========================================
// CREATOR CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
    creatorContent: { findMany: jest.fn(), count: jest.fn() },
    creatorReview: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    message: { count: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
    conversation: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    subscription: { findUnique: jest.fn(), update: jest.fn() },
    contentChunk: { findMany: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../middleware/cache', () => ({
  invalidateCache: jest.fn()
}));

jest.mock('../../../services/analytics.service', () => ({}));

jest.mock('../../../sockets', () => ({
  emitToConversation: jest.fn(),
  emitToUser: jest.fn(),
  isUserOnline: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/openai', () => ({
  generateEmbedding: jest.fn(),
  generateCreatorResponse: jest.fn(),
  isOpenAIConfigured: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/vectorStore', () => ({
  hybridSearch: jest.fn()
}));

jest.mock('../../../utils/contextBuilder', () => ({
  buildEnhancedContext: jest.fn()
}));

jest.mock('../../../config', () => ({
  config: {
    openai: { model: 'gpt-4' },
    subscription: { tokensPerMessage: 800, premiumPrice: 79900, creatorShare: 0.86, tokenGrant: 1000000 }
  }
}));

jest.mock('../../../utils/logger', () => ({ logError: jest.fn() }));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import * as sockets from '../../../sockets';
import {
  getCreators,
  getCreator,
  getCreatorContent,
  getCategories
} from '../../../controllers/creator.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Creator Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.message.aggregate as jest.Mock).mockResolvedValue({ _avg: { responseTimeMs: null } });
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([]);
    (sockets.isUserOnline as jest.Mock).mockReturnValue(false);
  });

  describe('getCreators', () => {
    it('should return paginated creators', async () => {
      const req = mockReq({ query: { page: '1', limit: '12' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreators(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ creators: [], pagination: expect.any(Object) })
        })
      );
    });

    it('should filter by category', async () => {
      const req = mockReq({ query: { category: 'Tech' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreators(req, res);
      expect(prisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'Tech' })
        })
      );
    });

    it('should search by name', async () => {
      const req = mockReq({ query: { search: 'john' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreators(req, res);
      expect(prisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) })
        })
      );
    });
  });

  describe('getCreator', () => {
    it('should return a single creator', async () => {
      const req = mockReq({ params: { id: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'cr-1', displayName: 'Test', userId: 'u-1'
      });
      (prisma.message.count as jest.Mock).mockResolvedValue(10);
      (prisma.creatorReview.aggregate as jest.Mock).mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
      (prisma.creatorReview.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.creatorReview.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(5);
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await getCreator(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCreator(req, res)).rejects.toThrow('Creator not found');
    });
  });

  describe('getCategories', () => {
    it('should return categories', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([
        { category: 'Tech' },
        { category: 'Fitness' }
      ]);

      await getCategories(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
