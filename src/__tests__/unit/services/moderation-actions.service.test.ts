// ===========================================
// MODERATION ACTIONS SERVICE — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    report: { create: jest.fn() },
    message: { update: jest.fn() },
    post: { update: jest.fn() },
    comment: { update: jest.fn() },
    creatorContent: { update: jest.fn() },
    moderationLog: { create: jest.fn() },
  },
}));

jest.mock('../../../types/moderation.types', () => ({
  SeverityLevel: {
    SAFE: 'SAFE',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  },
  AutoActionType: { BLOCK: 'BLOCK', FLAG: 'FLAG' },
}));

import prisma from '../../../../prisma/client';
import moderationActionsService from '../../../services/moderation/moderation-actions.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('ModerationActionsService', () => {
  const baseModerationResult = {
    isFlagged: true,
    severity: 'HIGH' as any,
    violatedCategories: ['hate'],
    scores: { hate: 0.9 },
    shouldBlock: true,
    shouldFlag: true,
    reason: 'Content contains hate speech',
    recommendation: 'BLOCK_IMMEDIATELY',
    highestScore: 0.9,
    highestCategory: 'hate',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createAIReport', () => {
    it('should create AI-generated report with correct metadata', async () => {
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({
        id: 'report-1',
      });

      await moderationActionsService.createAIReport(
        'MESSAGE' as any,
        'msg-1',
        'user-1',
        baseModerationResult
      );

      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetType: 'MESSAGE',
          targetId: 'msg-1',
          reporterId: null,
          reporterEmail: 'ai-moderator@system',
          status: 'PENDING',
          metadata: expect.objectContaining({
            aiGenerated: true,
            userId: 'user-1',
          }),
        }),
      });
    });

    it('should map hate categories to HATE_SPEECH reason', async () => {
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({ id: 'report-2' });

      await moderationActionsService.createAIReport(
        'MESSAGE' as any,
        'msg-1',
        null,
        { ...baseModerationResult, violatedCategories: ['hate'] }
      );

      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'HATE_SPEECH',
        }),
      });
    });

    it('should map harassment categories to HARASSMENT reason', async () => {
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({ id: 'report-3' });

      await moderationActionsService.createAIReport(
        'MESSAGE' as any,
        'msg-1',
        null,
        { ...baseModerationResult, violatedCategories: ['harassment'] }
      );

      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'HARASSMENT',
        }),
      });
    });

    it('should use OTHER reason for unmapped categories', async () => {
      (mockPrisma.report.create as jest.Mock).mockResolvedValue({ id: 'report-4' });

      await moderationActionsService.createAIReport(
        'MESSAGE' as any,
        'msg-1',
        null,
        { ...baseModerationResult, violatedCategories: ['self-harm'] }
      );

      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'OTHER',
        }),
      });
    });

    it('should rethrow errors from prisma', async () => {
      (mockPrisma.report.create as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(
        moderationActionsService.createAIReport('MESSAGE' as any, 'msg-1', null, baseModerationResult)
      ).rejects.toThrow('DB error');
    });
  });

  describe('autoBlockContent', () => {
    it('should hide MESSAGE content', async () => {
      (mockPrisma.message.update as jest.Mock).mockResolvedValue({});

      await moderationActionsService.autoBlockContent('MESSAGE', 'msg-1', baseModerationResult);

      expect(mockPrisma.message.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ isHidden: true }),
      });
    });

    it('should unpublish POST content', async () => {
      (mockPrisma.post.update as jest.Mock).mockResolvedValue({});

      await moderationActionsService.autoBlockContent('POST', 'post-1', baseModerationResult);

      expect(mockPrisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: expect.objectContaining({ isPublished: false, isHidden: true }),
      });
    });

    it('should replace COMMENT content', async () => {
      (mockPrisma.comment.update as jest.Mock).mockResolvedValue({});

      await moderationActionsService.autoBlockContent('COMMENT', 'comment-1', baseModerationResult);

      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { content: '[removed by moderation]' },
      });
    });

    it('should mark CREATOR_CONTENT as FAILED', async () => {
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await moderationActionsService.autoBlockContent(
        'CREATOR_CONTENT',
        'content-1',
        baseModerationResult
      );

      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      });
    });

    it('should skip blocking for unsupported target types', async () => {
      await moderationActionsService.autoBlockContent(
        'UNKNOWN_TYPE',
        'id-1',
        baseModerationResult
      );

      expect(mockPrisma.message.update).not.toHaveBeenCalled();
      expect(mockPrisma.post.update).not.toHaveBeenCalled();
    });
  });

  describe('logModerationAction', () => {
    it('should create moderation log entry', async () => {
      (mockPrisma.moderationLog.create as jest.Mock).mockResolvedValue({});

      await moderationActionsService.logModerationAction(
        'MESSAGE',
        'msg-1',
        'CONTENT_HIDDEN' as any,
        baseModerationResult
      );

      expect(mockPrisma.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CONTENT_HIDDEN',
          targetType: 'MESSAGE',
          targetId: 'msg-1',
          moderatorId: null,
          metadata: expect.objectContaining({ aiGenerated: true }),
        }),
      });
    });

    it('should not throw on logging errors', async () => {
      (mockPrisma.moderationLog.create as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(
        moderationActionsService.logModerationAction(
          'MESSAGE',
          'msg-1',
          'CONTENT_HIDDEN' as any,
          baseModerationResult
        )
      ).resolves.toBeUndefined();
    });
  });
});
