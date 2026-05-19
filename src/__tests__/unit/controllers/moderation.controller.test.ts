// ===========================================
// ADMIN MODERATION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    report: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    message: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    creator: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    moderationLog: { findMany: jest.fn(), count: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/moderation.service', () => ({
  getReports: jest.fn().mockResolvedValue({ reports: [], total: 0 }),
  resolveReport: jest.fn().mockResolvedValue({}),
  getModerationStats: jest.fn().mockResolvedValue({})
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import * as moderationService from '../../../services/moderation.service';
import {
  getModerationQueue,
  getReportDetails,
  resolveReportAction,
  dismissReport,
  getModerationStatsController,
  getModerationLog,
  getUserModerationHistory
} from '../../../controllers/admin/moderation.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'admin-1', role: 'ADMIN' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Moderation Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (moderationService.getReports as jest.Mock).mockResolvedValue({ reports: [], total: 0 });
    (moderationService.resolveReport as jest.Mock).mockResolvedValue({});
    (moderationService.getModerationStats as jest.Mock).mockResolvedValue({});
  });

  describe('getModerationQueue', () => {
    it('should return moderation queue', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await getModerationQueue(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getReportDetails', () => {
    it('should return report details', async () => {
      const req = mockReq({ params: { id: 'r-1' } });
      const res = mockRes();

      (prisma.report.findUnique as jest.Mock).mockResolvedValue({
        id: 'r-1', targetType: 'USER', targetId: 'u-1', reporter: {}
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-1' });
      (prisma.moderationLog.findMany as jest.Mock).mockResolvedValue([]);

      await getReportDetails(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when report not found', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.report.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getReportDetails(req, res)).rejects.toThrow('Report not found');
    });
  });

  describe('resolveReportAction', () => {
    it('should resolve a report', async () => {
      const req = mockReq({ params: { id: 'r-1' }, body: { action: 'WARNING_SENT' } });
      const res = mockRes();

      await resolveReportAction(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when action is missing', async () => {
      const req = mockReq({ params: { id: 'r-1' }, body: {} });
      const res = mockRes();

      await expect(resolveReportAction(req, res)).rejects.toThrow('Action is required');
    });
  });

  describe('dismissReport', () => {
    it('should dismiss a report', async () => {
      const req = mockReq({ params: { id: 'r-1' }, body: { reason: 'False positive' } });
      const res = mockRes();

      (prisma.report.update as jest.Mock).mockResolvedValue({});

      await dismissReport(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getModerationStatsController', () => {
    it('should return moderation stats', async () => {
      const req = mockReq();
      const res = mockRes();

      await getModerationStatsController(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getModerationLog', () => {
    it('should return moderation log', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.moderationLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.moderationLog.count as jest.Mock).mockResolvedValue(0);

      await getModerationLog(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getUserModerationHistory', () => {
    it('should return user moderation history', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.moderationLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-1' });

      await getUserModerationHistory(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});
