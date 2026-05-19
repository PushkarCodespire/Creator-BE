// ===========================================
// ADMIN CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    creator: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    company: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    conversation: { count: jest.fn() },
    message: { count: jest.fn() },
    report: { count: jest.fn() },
    creatorContent: { findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
    deal: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    opportunity: { count: jest.fn() },
    subscription: { findUnique: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../config', () => ({
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:3000',
    upload: { maxSize: 10000000 },
    rateLimit: {},
    subscription: {},
    brandDeal: {}
  }
}));

jest.mock('../../../utils/email', () => ({
  welcomeEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  emailVerificationEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  passwordResetEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  passwordChangedEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  paymentReceiptEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' }),
  creatorVerificationEmail: jest.fn().mockReturnValue({ subject: '', html: '', text: '' })
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import * as emailUtils from '../../../utils/email';
import {
  getUserDetail,
  updateUser,
  updateUserRole,
  suspendUserAdmin,
  unsuspendUserAdmin,
  banUserAdmin,
  unbanUserAdmin,
  listCreators,
  getCreatorDetail,
  updateCreator,
  setCreatorActive,
  listCompanies,
  getCompanyDetail,
  updateCompany,
  listCreatorContents,
  updateContentStatus,
  deleteContent,
  getDealDetail,
  updateDealStatus,
  getSystemConfig,
  getEmailPreview
} from '../../../controllers/admin/admin.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'admin-1', role: 'ADMIN' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Admin Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (emailUtils.welcomeEmail as jest.Mock).mockReturnValue({ subject: 'Welcome', html: '<p>Welcome</p>', text: 'Welcome' });
    (emailUtils.emailVerificationEmail as jest.Mock).mockReturnValue({ subject: 'Verify', html: '<p>Verify</p>', text: 'Verify' });
    (emailUtils.passwordResetEmail as jest.Mock).mockReturnValue({ subject: 'Reset', html: '<p>Reset</p>', text: 'Reset' });
    (emailUtils.passwordChangedEmail as jest.Mock).mockReturnValue({ subject: 'Changed', html: '<p>Changed</p>', text: 'Changed' });
    (emailUtils.paymentReceiptEmail as jest.Mock).mockReturnValue({ subject: 'Receipt', html: '<p>Receipt</p>', text: 'Receipt' });
    (emailUtils.creatorVerificationEmail as jest.Mock).mockReturnValue({ subject: 'Creator', html: '<p>Creator</p>', text: 'Creator' });
  });

  // USERS
  describe('getUserDetail', () => {
    it('should return user detail', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-1', email: 'u@t.com', name: 'U' });
      (prisma.conversation.count as jest.Mock).mockResolvedValue(5);
      (prisma.message.count as jest.Mock).mockResolvedValue(50);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getUserDetail(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when user not found', async () => {
      const req = mockReq({ params: { userId: 'bad' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getUserDetail(req, res)).rejects.toThrow('User not found');
    });
  });

  describe('updateUser', () => {
    it('should update user', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, body: { name: 'New' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u-1', name: 'New' });

      await updateUser(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, body: { role: 'CREATOR' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u-1', role: 'CREATOR' });

      await updateUserRole(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 for invalid role', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, body: { role: 'INVALID' } });
      const res = mockRes();

      await expect(updateUserRole(req, res)).rejects.toThrow('Invalid role');
    });
  });

  describe('suspendUserAdmin', () => {
    it('should suspend a user', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, body: { days: 7, reason: 'Bad behavior' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({
        id: 'u-1', isSuspended: true, suspendedUntil: new Date(), suspensionReason: 'Bad behavior'
      });

      await suspendUserAdmin(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'User suspended' }));
    });
  });

  describe('unsuspendUserAdmin', () => {
    it('should unsuspend a user', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u-1', isSuspended: false });

      await unsuspendUserAdmin(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'User unsuspended' }));
    });
  });

  describe('banUserAdmin', () => {
    it('should ban a user', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, body: { reason: 'Spam' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u-1', isBanned: true, bannedAt: new Date(), banReason: 'Spam' });

      await banUserAdmin(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'User banned' }));
    });
  });

  describe('unbanUserAdmin', () => {
    it('should unban a user', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u-1', isBanned: false });

      await unbanUserAdmin(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'User unbanned' }));
    });
  });

  // CREATORS
  describe('listCreators', () => {
    it('should return paginated creators', async () => {
      const req = mockReq({ query: { page: '1', limit: '20' } });
      const res = mockRes();

      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.count as jest.Mock).mockResolvedValue(0);

      await listCreators(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getCreatorDetail', () => {
    it('should return creator detail', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1', user: {} });
      (prisma.creatorContent.count as jest.Mock).mockResolvedValue(5);
      (prisma.conversation.count as jest.Mock).mockResolvedValue(10);
      (prisma.message.count as jest.Mock).mockResolvedValue(100);

      await getCreatorDetail(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { creatorId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCreatorDetail(req, res)).rejects.toThrow('Creator not found');
    });
  });

  describe('setCreatorActive', () => {
    it('should toggle creator active status', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' }, body: { isActive: false } });
      const res = mockRes();

      (prisma.creator.update as jest.Mock).mockResolvedValue({ id: 'cr-1', isActive: false });

      await setCreatorActive(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when isActive missing', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' }, body: {} });
      const res = mockRes();

      await expect(setCreatorActive(req, res)).rejects.toThrow('isActive is required');
    });
  });

  // COMPANIES
  describe('listCompanies', () => {
    it('should return companies', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.company.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.company.count as jest.Mock).mockResolvedValue(0);

      await listCompanies(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getCompanyDetail', () => {
    it('should return company detail', async () => {
      const req = mockReq({ params: { companyId: 'co-1' } });
      const res = mockRes();

      (prisma.company.findUnique as jest.Mock).mockResolvedValue({ id: 'co-1', user: {} });
      (prisma.opportunity.count as jest.Mock).mockResolvedValue(2);
      (prisma.deal.count as jest.Mock).mockResolvedValue(1);

      await getCompanyDetail(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when company not found', async () => {
      const req = mockReq({ params: { companyId: 'bad' } });
      const res = mockRes();

      (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCompanyDetail(req, res)).rejects.toThrow('Company not found');
    });
  });

  // CONTENT
  describe('updateContentStatus', () => {
    it('should throw 400 for invalid status', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' }, body: { status: 'INVALID' } });
      const res = mockRes();

      await expect(updateContentStatus(req, res)).rejects.toThrow('Invalid status');
    });
  });

  describe('deleteContent', () => {
    it('should delete content', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creatorContent.delete as jest.Mock).mockResolvedValue({});

      await deleteContent(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  // DEALS
  describe('getDealDetail', () => {
    it('should return deal detail', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue({ id: 'deal-1' });

      await getDealDetail(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when deal not found', async () => {
      const req = mockReq({ params: { dealId: 'bad' } });
      const res = mockRes();

      (prisma.deal.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getDealDetail(req, res)).rejects.toThrow('Deal not found');
    });
  });

  describe('updateDealStatus', () => {
    it('should throw 400 for invalid status', async () => {
      const req = mockReq({ params: { dealId: 'deal-1' }, body: { status: 'INVALID' } });
      const res = mockRes();

      await expect(updateDealStatus(req, res)).rejects.toThrow('Invalid status');
    });
  });

  // SYSTEM
  describe('getSystemConfig', () => {
    it('should return system config', async () => {
      const req = mockReq();
      const res = mockRes();

      await getSystemConfig(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getEmailPreview', () => {
    it('should return email preview for welcome type', async () => {
      const req = mockReq({ query: { type: 'welcome' } });
      const res = mockRes();

      await getEmailPreview(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when type is missing', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await expect(getEmailPreview(req, res)).rejects.toThrow('Email type is required');
    });

    it('should throw 400 for unknown email type', async () => {
      const req = mockReq({ query: { type: 'unknown' } });
      const res = mockRes();

      await expect(getEmailPreview(req, res)).rejects.toThrow('Unknown email type');
    });
  });
});
