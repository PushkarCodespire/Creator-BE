// ===========================================
// MILESTONE CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    deal: { findUnique: jest.fn() },
    milestone: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/notification.service', () => ({
  createAndEmit: jest.fn().mockResolvedValue({}),
  create: jest.fn().mockResolvedValue({})
}));

jest.mock('../../../utils/logger', () => ({ logError: jest.fn() }));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone
} from '../../../controllers/milestone.controller';

const mockReq = (overrides = {}) =>
  ({
    body: {}, params: {}, query: {},
    user: { id: 'user-1', role: 'COMPANY' },
    app: { get: jest.fn().mockReturnValue(undefined) },
    ...overrides
  } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockDeal = (role: 'COMPANY' | 'CREATOR' = 'COMPANY') => ({
  id: 'deal-1',
  companyId: 'comp-1',
  creatorId: 'cr-1',
  status: 'IN_PROGRESS',
  company: { id: 'comp-1', userId: role === 'COMPANY' ? 'user-1' : 'other', companyName: 'Corp' },
  creator: { id: 'cr-1', userId: role === 'CREATOR' ? 'user-1' : 'other', displayName: 'Creator' }
});

describe('Milestone Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listMilestones', () => {
    it('should list milestones for a deal', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal());
      (prisma.milestone.findMany as jest.Mock).mockResolvedValue([]);

      await listMilestones(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when deal not found', async () => {
      const req = mockReq({ params: { dealId: 'bad' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(listMilestones(req, res)).rejects.toThrow('Deal not found');
    });

    it('should throw 403 when user not authorized', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, user: { id: 'stranger' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue({
        ...mockDeal(),
        company: { id: 'comp-1', userId: 'other1', companyName: 'C' },
        creator: { id: 'cr-1', userId: 'other2', displayName: 'D' }
      });

      await expect(listMilestones(req, res)).rejects.toThrow('not authorized');
    });
  });

  describe('createMilestone', () => {
    it('should create a milestone', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, body: { title: 'First Draft' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal());
      (prisma.milestone.create as jest.Mock).mockResolvedValue({ id: 'm-1', title: 'First Draft', status: 'PENDING' });

      await createMilestone(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should throw 400 when title is missing', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, body: {} });
      const res = mockRes();

      await expect(createMilestone(req, res)).rejects.toThrow('Milestone title is required');
    });

    it('should throw 400 when title is too long', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, body: { title: 'x'.repeat(201) } });
      const res = mockRes();

      await expect(createMilestone(req, res)).rejects.toThrow('200 characters or fewer');
    });

    it('should throw 400 when deal is not IN_PROGRESS', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, body: { title: 'Draft' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue({ ...mockDeal(), status: 'COMPLETED' });

      await expect(createMilestone(req, res)).rejects.toThrow('Cannot add milestones');
    });
  });

  describe('updateMilestone', () => {
    it('should update a milestone', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: 'Updated' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'PENDING',
        deal: {
          id: 'deal-1', companyId: 'comp-1', creatorId: 'cr-1', status: 'IN_PROGRESS',
          company: { userId: 'user-1', companyName: 'Corp' },
          creator: { userId: 'other', displayName: 'C' }
        }
      });
      (prisma.milestone.update as jest.Mock).mockResolvedValue({ id: 'm-1', title: 'Updated' });

      await updateMilestone(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when milestone not found', async () => {
      const req = mockReq({ params: { id: 'bad' }, body: { title: 'X' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateMilestone(req, res)).rejects.toThrow('Milestone not found');
    });

    it('should throw 403 when creator tries to mark COMPLETED', async () => {
      const req = mockReq({
        params: { id: 'm-1' },
        body: { status: 'COMPLETED' },
        user: { id: 'creator-user' }
      });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'IN_PROGRESS',
        deal: {
          id: 'deal-1', status: 'IN_PROGRESS',
          company: { userId: 'company-user', companyName: 'Corp' },
          creator: { userId: 'creator-user', displayName: 'C' }
        }
      });

      await expect(updateMilestone(req, res)).rejects.toThrow('Only the paying company');
    });

    it('should throw 400 when editing completed milestone', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: 'X' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'COMPLETED',
        deal: {
          id: 'deal-1', status: 'IN_PROGRESS',
          company: { userId: 'user-1' },
          creator: { userId: 'other' }
        }
      });

      await expect(updateMilestone(req, res)).rejects.toThrow('Completed milestones cannot be edited');
    });
  });

  describe('deleteMilestone', () => {
    it('should delete a pending milestone by company', async () => {
      const req = mockReq({ params: { id: 'm-1' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'PENDING',
        deal: { id: 'deal-1', status: 'IN_PROGRESS', company: { userId: 'user-1' } }
      });
      (prisma.milestone.delete as jest.Mock).mockResolvedValue({});

      await deleteMilestone(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when milestone not found', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteMilestone(req, res)).rejects.toThrow('Milestone not found');
    });

    it('should throw 403 when non-company tries to delete', async () => {
      const req = mockReq({ params: { id: 'm-1' }, user: { id: 'creator-user' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'PENDING',
        deal: { id: 'deal-1', status: 'IN_PROGRESS', company: { userId: 'company-user' } }
      });

      await expect(deleteMilestone(req, res)).rejects.toThrow('Only the company');
    });

    it('should throw 400 when milestone is not PENDING', async () => {
      const req = mockReq({ params: { id: 'm-1' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'IN_PROGRESS',
        deal: { id: 'deal-1', status: 'IN_PROGRESS', company: { userId: 'user-1' } }
      });

      await expect(deleteMilestone(req, res)).rejects.toThrow('Cannot delete a milestone that is IN_PROGRESS');
    });
  });

  // ==========================================
  // ADDITIONAL BRANCH COVERAGE TESTS
  // ==========================================

  describe('listMilestones – creator role', () => {
    it('should list milestones when user is the creator', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal('CREATOR'));
      (prisma.milestone.findMany as jest.Mock).mockResolvedValue([{ id: 'm1', title: 'Design', status: 'PENDING' }]);

      await listMilestones(req, res);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.role).toBe('CREATOR');
      expect(call.data.milestones).toHaveLength(1);
    });
  });

  describe('createMilestone – description validation', () => {
    it('should throw 400 when description exceeds 2000 characters', async () => {
      const req = mockReq({
        params: { dealId: 'deal-1' },
        body: { title: 'Valid Title', description: 'x'.repeat(2001) }
      });
      const res = mockRes();

      await expect(createMilestone(req, res)).rejects.toThrow('Description must be 2000 characters or fewer');
    });

    it('should create milestone with dueDate when provided', async () => {
      const req = mockReq({
        params: { dealId: 'deal-1' },
        body: { title: 'Milestone with Due', dueDate: '2025-12-31' }
      });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal('COMPANY'));
      (prisma.milestone.create as jest.Mock).mockResolvedValue({
        id: 'm-due', title: 'Milestone with Due', status: 'PENDING', dueDate: new Date('2025-12-31')
      });

      await createMilestone(req, res);
      expect(prisma.milestone.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dueDate: expect.any(Date) }) })
      );
    });

    it('should notify creator when company creates milestone (with io)', async () => {
      const mockIo = {};
      const notifService = require('../../../services/notification.service');
      (notifService.createAndEmit as jest.Mock).mockResolvedValue({});

      const req = mockReq({
        params: { dealId: 'deal-1' },
        body: { title: 'Draft' },
        user: { id: 'user-1' },
        app: { get: jest.fn().mockReturnValue(mockIo) }
      });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal('COMPANY'));
      (prisma.milestone.create as jest.Mock).mockResolvedValue({ id: 'm1', title: 'Draft', status: 'PENDING' });

      await createMilestone(req, res);
      expect(notifService.createAndEmit).toHaveBeenCalled();
    });

    it('should notify company when creator creates milestone (no io)', async () => {
      const notifService = require('../../../services/notification.service');
      (notifService.create as jest.Mock).mockResolvedValue({});

      const req = mockReq({
        params: { dealId: 'deal-1' },
        body: { title: 'Creator Draft' },
        user: { id: 'user-1' },
        app: { get: jest.fn().mockReturnValue(undefined) }
      });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal('CREATOR'));
      (prisma.milestone.create as jest.Mock).mockResolvedValue({ id: 'm2', title: 'Creator Draft', status: 'PENDING' });

      await createMilestone(req, res);
      expect(notifService.create).toHaveBeenCalled();
    });

    it('should not crash when notification service throws', async () => {
      const notifService = require('../../../services/notification.service');
      (notifService.create as jest.Mock).mockRejectedValue(new Error('Notification failed'));

      const req = mockReq({
        params: { dealId: 'deal-1' },
        body: { title: 'Draft' },
        user: { id: 'user-1' },
        app: { get: jest.fn().mockReturnValue(undefined) }
      });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(mockDeal('COMPANY'));
      (prisma.milestone.create as jest.Mock).mockResolvedValue({ id: 'm3', title: 'Draft', status: 'PENDING' });

      // Should NOT throw even though notification fails
      await createMilestone(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('updateMilestone – additional branches', () => {
    const buildMilestoneWithDeal = (milestoneStatus: string, dealStatus = 'IN_PROGRESS', companyUserId = 'user-1') => ({
      id: 'm-1',
      status: milestoneStatus,
      title: 'Old Title',
      deal: {
        id: 'deal-1',
        companyId: 'comp-1',
        creatorId: 'cr-1',
        status: dealStatus,
        company: { userId: companyUserId, companyName: 'Corp' },
        creator: { userId: 'other', displayName: 'Creator' }
      }
    });

    it('should throw 403 when user is neither company nor creator', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: 'X' }, user: { id: 'stranger' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'PENDING',
        deal: {
          id: 'deal-1', status: 'IN_PROGRESS',
          company: { userId: 'company-u', companyName: 'Corp' },
          creator: { userId: 'creator-u', displayName: 'C' }
        }
      });

      await expect(updateMilestone(req, res)).rejects.toThrow('not authorized to edit');
    });

    it('should throw 400 when deal is not IN_PROGRESS', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: 'X' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING', 'COMPLETED'));

      await expect(updateMilestone(req, res)).rejects.toThrow('Cannot edit milestones');
    });

    it('should throw 400 when no fields to update', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: {} });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));

      await expect(updateMilestone(req, res)).rejects.toThrow('No fields to update');
    });

    it('should throw 400 when title is empty string', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: '   ' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));

      await expect(updateMilestone(req, res)).rejects.toThrow('Title cannot be empty');
    });

    it('should throw 400 when title is too long in update', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { title: 'x'.repeat(201) } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));

      await expect(updateMilestone(req, res)).rejects.toThrow('Title too long');
    });

    it('should throw 400 when description is too long in update', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { description: 'x'.repeat(2001) } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));

      await expect(updateMilestone(req, res)).rejects.toThrow('Description too long');
    });

    it('should throw 400 for invalid status value', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { status: 'INVALID_STATUS' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));

      await expect(updateMilestone(req, res)).rejects.toThrow('Invalid status');
    });

    it('should set dueDate to null when dueDate is null in body', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { dueDate: null } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('PENDING'));
      (prisma.milestone.update as jest.Mock).mockResolvedValue({ id: 'm-1', dueDate: null });

      await updateMilestone(req, res);
      expect(prisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dueDate: null }) })
      );
    });

    it('should set completedAt when marking COMPLETED by company', async () => {
      const req = mockReq({ params: { id: 'm-1' }, body: { status: 'COMPLETED' } });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('IN_PROGRESS'));
      (prisma.milestone.update as jest.Mock).mockResolvedValue({
        id: 'm-1', status: 'COMPLETED', title: 'Old Title'
      });

      await updateMilestone(req, res);
      expect(prisma.milestone.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ completedAt: expect.any(Date) }) })
      );
    });

    it('should notify creator on COMPLETED and use createAndEmit when io available', async () => {
      const mockIo = {};
      const notifService = require('../../../services/notification.service');
      (notifService.createAndEmit as jest.Mock).mockResolvedValue({});

      const req = mockReq({
        params: { id: 'm-1' },
        body: { status: 'COMPLETED' },
        app: { get: jest.fn().mockReturnValue(mockIo) }
      });
      const res = mockRes();

      (prisma.milestone.findUnique as jest.Mock).mockResolvedValue(buildMilestoneWithDeal('IN_PROGRESS'));
      (prisma.milestone.update as jest.Mock).mockResolvedValue({ id: 'm-1', status: 'COMPLETED', title: 'Old Title' });

      await updateMilestone(req, res);
      // createAndEmit is called as createAndEmit(io, params) from inside the controller
      expect(notifService.createAndEmit).toHaveBeenCalledWith(
        mockIo,
        expect.objectContaining({ type: 'DEAL_COMPLETED' })
      );
    });
  });
});
