// ===========================================
// AI MODERATION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    report: { findMany: jest.fn() },
    moderationLog: { findMany: jest.fn(), count: jest.fn() }
  }
}));

jest.mock('../../../services/moderation/ai-moderation.service', () => ({
  __esModule: true,
  default: {
    moderateContent: jest.fn().mockResolvedValue({ shouldFlag: false, score: 0.1 })
  }
}));

jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import { sendError } from '../../../utils/apiResponse';
import {
  getAIModerationStats,
  testModeration,
  updateThresholds,
  getAIModerationLogs
} from '../../../controllers/admin/ai-moderation.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'admin-1', role: 'ADMIN' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('AI Moderation Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getAIModerationStats', () => {
    it('should return AI moderation stats', async () => {
      const req = mockReq({ query: { timeframe: '7d' } });
      const res = mockRes();

      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);

      await getAIModerationStats(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle errors gracefully', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.report.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await getAIModerationStats(req, res);
      expect(sendError).toHaveBeenCalledWith(res, 500, 'AI_STATS_ERROR', expect.any(String));
    });
  });

  describe('testModeration', () => {
    it('should test content moderation', async () => {
      const req = mockReq({ body: { content: 'Hello world' } });
      const res = mockRes();

      await testModeration(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 400 when content missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await testModeration(req, res);
      expect(sendError).toHaveBeenCalledWith(res, 400, 'CONTENT_REQUIRED', expect.any(String));
    });
  });

  describe('updateThresholds', () => {
    it('should update thresholds', async () => {
      const req = mockReq({ body: { category: 'hate', blockThreshold: 0.9, flagThreshold: 0.7 } });
      const res = mockRes();

      await updateThresholds(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getAIModerationLogs', () => {
    it('should return AI moderation logs', async () => {
      const req = mockReq({ query: { page: '1', limit: '20' } });
      const res = mockRes();

      (prisma.moderationLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.moderationLog.count as jest.Mock).mockResolvedValue(0);

      await getAIModerationLogs(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
