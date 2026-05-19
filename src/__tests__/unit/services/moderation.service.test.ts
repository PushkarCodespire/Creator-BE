// ===========================================
// MODERATION SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    report: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    message: {
      update: jest.fn(),
    },
    creator: {
      update: jest.fn(),
    },
    moderationLog: {
      create: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}));

jest.mock('../../../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../prisma/client';
import { sendEmail } from '../../../utils/email';
import {
  createReport,
  getReports,
  resolveReport,
  issueWarning,
  suspendUser,
  banUser,
  hideMessage,
  suspendCreator,
  getModerationStats,
} from '../../../services/moderation.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// Mock enums
const ReportType = { MESSAGE: 'MESSAGE', USER: 'USER', COMMENT: 'COMMENT', POST: 'POST', CREATOR: 'CREATOR' };
const ReportReason = {
  HATE_SPEECH: 'HATE_SPEECH',
  VIOLENCE: 'VIOLENCE',
  SEXUAL_CONTENT: 'SEXUAL_CONTENT',
  SPAM: 'SPAM',
  HARASSMENT: 'HARASSMENT',
  OTHER: 'OTHER',
};
const ReportStatus = { PENDING: 'PENDING', RESOLVED: 'RESOLVED', DISMISSED: 'DISMISSED' };
const ReportPriority = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT' };
const ModerationAction = {
  NO_ACTION: 'NO_ACTION',
  WARNING_SENT: 'WARNING_SENT',
  CONTENT_HIDDEN: 'CONTENT_HIDDEN',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_BANNED: 'USER_BANNED',
  CREATOR_SUSPENDED: 'CREATOR_SUSPENDED',
};

describe('ModerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // resetMocks: true clears implementations; restore sendEmail so .catch() works
    (sendEmail as jest.Mock).mockResolvedValue(undefined);
  });

  describe('createReport', () => {
    it('should create a new report', async () => {
      (mockPrisma.report.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
        targetType: 'MESSAGE',
        targetId: 'msg-1',
        reason: 'SPAM',
        priority: 'MEDIUM',
        status: 'PENDING',
      });

      const result = await createReport({
        reporterId: 'user-1',
        targetType: 'MESSAGE' as any,
        targetId: 'msg-1',
        reason: 'SPAM' as any,
      });

      expect(result.id).toBe('report-1');
      expect(mockPrisma.report.create).toHaveBeenCalled();
    });

    it('should reject duplicate reports within 24 hours', async () => {
      (mockPrisma.report.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-report',
      });

      await expect(
        createReport({
          reporterId: 'user-1',
          targetType: 'MESSAGE' as any,
          targetId: 'msg-1',
          reason: 'SPAM' as any,
        })
      ).rejects.toThrow('You have already reported this content recently');
    });

    it('should auto-escalate priority for severe reasons', async () => {
      (mockPrisma.report.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.report.create as jest.Mock).mockImplementation(({ data }) => {
        return Promise.resolve({ id: 'report-2', ...data });
      });

      await createReport({
        reporterId: 'user-1',
        targetType: 'MESSAGE' as any,
        targetId: 'msg-1',
        reason: 'HATE_SPEECH' as any,
        priority: 'MEDIUM' as any,
      });

      expect(mockPrisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'HIGH' }),
        })
      );
    });

    it('should skip duplicate check when reporterId is not provided', async () => {
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({
        id: 'report-3',
        status: 'PENDING',
      });

      await createReport({
        targetType: 'MESSAGE' as any,
        targetId: 'msg-1',
        reason: 'SPAM' as any,
      });

      expect(mockPrisma.report.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.report.create).toHaveBeenCalled();
    });
  });

  describe('getReports', () => {
    it('should return paginated reports', async () => {
      (mockPrisma.report.findMany as jest.Mock).mockResolvedValue([
        { id: 'report-1' },
        { id: 'report-2' },
      ]);
      (mockPrisma.report.count as jest.Mock).mockResolvedValue(2);

      const result = await getReports({ page: 1, limit: 20 });

      expect(result.reports).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
    });

    it('should filter by status', async () => {
      (mockPrisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.report.count as jest.Mock).mockResolvedValue(0);

      await getReports({ status: 'PENDING' as any });

      expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        })
      );
    });

    it('should use default pagination values', async () => {
      (mockPrisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.report.count as jest.Mock).mockResolvedValue(0);

      const result = await getReports({});

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });
  });

  describe('resolveReport', () => {
    it('should resolve report and create moderation log', async () => {
      (mockPrisma.report.findUnique as jest.Mock).mockResolvedValue({
        id: 'report-1',
        targetId: 'msg-1',
        targetType: 'MESSAGE',
        reason: 'SPAM',
      });
      (mockPrisma.report.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.moderationLog.create as jest.Mock).mockResolvedValue({});

      await resolveReport({
        reportId: 'report-1',
        moderatorId: 'mod-1',
        action: 'NO_ACTION' as any,
        reviewNotes: 'Looks fine',
      });

      expect(mockPrisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RESOLVED' }),
        })
      );
      expect(mockPrisma.moderationLog.create).toHaveBeenCalled();
    });

    it('should throw error when report not found', async () => {
      (mockPrisma.report.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        resolveReport({
          reportId: 'nonexistent',
          moderatorId: 'mod-1',
          action: 'NO_ACTION' as any,
        })
      ).rejects.toThrow('Report not found');
    });
  });

  describe('issueWarning', () => {
    it('should increment warning count and send email', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        name: 'Test User',
        email: 'test@test.com',
        warningCount: 1,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await issueWarning('user-1', 'mod-1', 'report-1', 'Spam violation');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warningCount: { increment: 1 },
          }),
        })
      );
      expect(result.warningCount).toBe(2);
    });

    it('should throw error when user not found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        issueWarning('nonexistent', 'mod-1', 'report-1', 'reason')
      ).rejects.toThrow('User not found');
    });
  });

  describe('hideMessage', () => {
    it('should mark message as hidden', async () => {
      (mockPrisma.message.update as jest.Mock).mockResolvedValue({
        id: 'msg-1',
        isHidden: true,
      });

      const result = await hideMessage('msg-1', 'mod-1', 'Inappropriate content');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: expect.objectContaining({
            isHidden: true,
            hiddenBy: 'mod-1',
          }),
        })
      );
    });
  });

  describe('getModerationStats', () => {
    it('should return aggregated moderation statistics', async () => {
      (mockPrisma.report.count as jest.Mock)
        .mockResolvedValueOnce(100) // totalReports
        .mockResolvedValueOnce(25)  // pendingReports
        .mockResolvedValueOnce(10); // resolvedToday
      (mockPrisma.user.count as jest.Mock)
        .mockResolvedValueOnce(5)   // bannedUsers
        .mockResolvedValueOnce(3);  // suspendedUsers
      (mockPrisma.report.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.moderationLog.groupBy as jest.Mock).mockResolvedValue([]);

      const stats = await getModerationStats();

      expect(stats.totalReports).toBe(100);
      expect(stats.pendingReports).toBe(25);
      expect(stats.resolvedToday).toBe(10);
      expect(stats.bannedUsers).toBe(5);
      expect(stats.suspendedUsers).toBe(3);
    });
  });
});
