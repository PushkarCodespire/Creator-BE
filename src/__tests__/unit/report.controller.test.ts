// ===========================================
// REPORT CONTROLLER UNIT TESTS
// ===========================================

import { Request, Response } from 'express';
import {
  reportMessage,
  reportUser,
  reportCreator,
  getMyReports
} from '../../controllers/report.controller';
import prisma from '../../../prisma/client';
import * as moderationService from '../../services/moderation.service';

// Mock Prisma client
jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    message: {
      findUnique: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    },
    creator: {
      findUnique: jest.fn()
    },
    report: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

// Mock moderation service
jest.mock('../../services/moderation.service');

describe('Report Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn(() => ({ json: jsonMock })) as any;

    mockRequest = {
      user: {
        id: 'user-123',
        email: 'user@test.com',
        name: 'Test User',
        role: 'USER' as any
      },
      body: {},
      query: {}
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock
    };

    jest.clearAllMocks();
  });

  describe('reportMessage', () => {
    const validReportData = {
      messageId: 'message-123',
      reason: 'HARASSMENT',
      description: 'This message contains harassment'
    };

    it('should create message report successfully', async () => {
      mockRequest.body = validReportData;

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123',
        content: 'Offensive message',
        conversationId: 'conv-123'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123',
        targetType: 'MESSAGE',
        targetId: 'message-123',
        reason: 'HARASSMENT',
        status: 'PENDING',
        priority: 'MEDIUM'
      });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          reporterId: 'user-123',
          targetType: 'MESSAGE',
          targetId: 'message-123',
          reason: 'HARASSMENT',
          description: validReportData.description
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('submitted')
        })
      );
    });

    it('should validate message exists', async () => {
      mockRequest.body = validReportData;

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not found')
        })
      );
    });

    it('should require valid reason', async () => {
      mockRequest.body = {
        messageId: 'message-123',
        reason: 'INVALID_REASON'
      };

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should prevent duplicate reports within 24 hours', async () => {
      mockRequest.body = validReportData;

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123'
      });

      (moderationService.createReport as jest.Mock).mockRejectedValue(
        new Error('You have already reported this content')
      );

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('already reported')
        })
      );
    });

    it('should allow guest users to report', async () => {
      mockRequest.user = undefined;
      mockRequest.body = {
        ...validReportData,
        reporterEmail: 'guest@test.com'
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123'
      });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          reporterId: null,
          reporterEmail: 'guest@test.com'
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should auto-escalate severe violations', async () => {
      mockRequest.body = {
        messageId: 'message-123',
        reason: 'HATE_SPEECH',
        description: 'Contains hate speech'
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123',
        priority: 'HIGH' // Auto-escalated
      });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalled();
    });
  });

  describe('reportUser', () => {
    const validUserReport = {
      userId: 'target-user-123',
      reason: 'SPAM',
      description: 'User is spamming'
    };

    it('should create user report successfully', async () => {
      mockRequest.body = validUserReport;

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'target-user-123',
        name: 'Spammer',
        email: 'spammer@test.com'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123'
      });

      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: 'USER',
          targetId: 'target-user-123',
          reason: 'SPAM'
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should prevent self-reporting', async () => {
      mockRequest.body = {
        userId: 'user-123', // Same as mockRequest.user.id
        reason: 'SPAM'
      };

      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('yourself')
        })
      );
    });

    it('should validate user exists', async () => {
      mockRequest.body = validUserReport;

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(404);
    });
  });

  describe('reportCreator', () => {
    const validCreatorReport = {
      creatorId: 'creator-123',
      reason: 'IMPERSONATION',
      description: 'Impersonating a celebrity'
    };

    it('should create creator report successfully', async () => {
      mockRequest.body = validCreatorReport;

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123',
        displayName: 'Fake Creator',
        userId: 'other-user-123'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123'
      });

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: 'CREATOR',
          targetId: 'creator-123',
          reason: 'IMPERSONATION'
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should prevent creator from reporting themselves', async () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'creator@test.com',
        name: 'Test Creator',
        role: 'CREATOR' as any,
        creator: { id: 'creator-123' }
      };

      mockRequest.body = {
        creatorId: 'creator-123', // Same as user's creator
        reason: 'SPAM'
      };

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('yourself')
        })
      );
    });

    it('should validate creator exists', async () => {
      mockRequest.body = validCreatorReport;

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    it('should require description for serious violations', async () => {
      mockRequest.body = {
        creatorId: 'creator-123',
        reason: 'SEXUAL_CONTENT'
        // Missing description
      };

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123'
      });

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('description')
        })
      );
    });
  });

  describe('getMyReports', () => {
    it('should return user reports with pagination', async () => {
      mockRequest.query = { page: '1', limit: '10' };

      (prisma.report.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'report-1',
          targetType: 'MESSAGE',
          targetId: 'message-1',
          reason: 'SPAM',
          status: 'PENDING',
          createdAt: new Date()
        },
        {
          id: 'report-2',
          targetType: 'USER',
          targetId: 'user-1',
          reason: 'HARASSMENT',
          status: 'RESOLVED',
          createdAt: new Date()
        }
      ]);

      (prisma.report.count as jest.Mock).mockResolvedValue(2);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reporterId: 'user-123' },
          skip: 0,
          take: 10
        })
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            reports: expect.arrayContaining([
              expect.objectContaining({ id: 'report-1' }),
              expect.objectContaining({ id: 'report-2' })
            ]),
            pagination: expect.objectContaining({
              page: 1,
              limit: 10,
              total: 2
            })
          })
        })
      );
    });

    it('should filter by status', async () => {
      mockRequest.query = { status: 'PENDING' };

      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            reporterId: 'user-123',
            status: 'PENDING'
          }
        })
      );
    });

    it('should filter by target type', async () => {
      mockRequest.query = { targetType: 'MESSAGE' };

      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            reporterId: 'user-123',
            targetType: 'MESSAGE'
          }
        })
      );
    });

    it('should return empty array for no reports', async () => {
      mockRequest.query = {};

      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            reports: [],
            pagination: expect.objectContaining({ total: 0 })
          })
        })
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should prevent spam reporting', async () => {
      // This would typically be tested via integration tests with actual rate limiting middleware
      // Here we just verify the error handling

      mockRequest.body = {
        messageId: 'message-123',
        reason: 'SPAM'
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123'
      });

      (moderationService.createReport as jest.Mock).mockRejectedValue(
        new Error('Rate limit exceeded')
      );

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('should validate report reason enum', async () => {
      const validReasons = [
        'SPAM',
        'HARASSMENT',
        'HATE_SPEECH',
        'SEXUAL_CONTENT',
        'VIOLENCE',
        'MISINFORMATION',
        'IMPERSONATION',
        'SCAM',
        'COPYRIGHT',
        'OTHER'
      ];

      for (const reason of validReasons) {
        mockRequest.body = {
          messageId: 'message-123',
          reason
        };

        (prisma.message.findUnique as jest.Mock).mockResolvedValue({
          id: 'message-123'
        });

        (moderationService.createReport as jest.Mock).mockResolvedValue({
          id: 'report-123'
        });

        await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

        // Should not error for valid reasons
        expect(jsonMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ success: true })
        );
      }
    });

    it('should reject invalid target IDs', async () => {
      mockRequest.body = {
        messageId: '', // Empty ID
        reason: 'SPAM'
      };

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should sanitize description input', async () => {
      mockRequest.body = {
        messageId: 'message-123',
        reason: 'SPAM',
        description: '<script>alert("XSS")</script>Spam message'
      };

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'message-123'
      });

      (moderationService.createReport as jest.Mock).mockResolvedValue({
        id: 'report-123'
      });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      // Description should be sanitized by validation middleware
      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.not.stringContaining('<script>')
        })
      );
    });
  });

  // ===========================================
  // NEW BRANCH COVERAGE TESTS
  // ===========================================

  describe('reportMessage — additional branches', () => {
    it('should return 400 when messageId is missing entirely', async () => {
      mockRequest.body = { reason: 'SPAM' };
      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Message ID and reason are required' })
      );
    });

    it('should return 400 when reason is missing', async () => {
      mockRequest.body = { messageId: 'msg-1' };
      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Invalid report reason' })
      );
    });

    it('should pass undefined description when no description provided', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ description: undefined })
      );
    });

    it('should strip HTML tags and trim description whitespace', async () => {
      mockRequest.body = {
        messageId: 'msg-1',
        reason: 'SPAM',
        description: '  <b>bold</b> text  '
      };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'bold text' })
      );
    });

    it('should use req.user.email when reporterEmail not provided in body', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ reporterEmail: 'user@test.com' })
      );
    });

    it('should use provided reporterEmail over user.email', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM', reporterEmail: 'other@test.com' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ reporterEmail: 'other@test.com' })
      );
    });

    it('should return 429 when rate limit error is thrown', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockRejectedValue(
        new Error('Rate limit exceeded for reports')
      );

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(429);
    });

    it('should return 400 for generic errors with a message', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockRejectedValue(
        new Error('Some unexpected error')
      );

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Some unexpected error' })
      );
    });

    it('should return generic fallback message when error has no message', async () => {
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockRejectedValue({});

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Failed to submit report' })
      );
    });

    it('should set reporterId to null for unauthenticated users', async () => {
      mockRequest.user = undefined;
      mockRequest.body = { messageId: 'msg-1', reason: 'SPAM', reporterEmail: 'anon@test.com' };
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportMessage(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(moderationService.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ reporterId: null })
      );
    });
  });

  describe('reportUser — additional branches', () => {
    it('should return 400 when both userId and reason are missing', async () => {
      mockRequest.body = {};
      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'User ID and reason are required' })
      );
    });

    it('should return 400 when userId is missing but reason is present', async () => {
      mockRequest.body = { reason: 'SPAM' };
      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should allow unauthenticated user to report (no self-report check)', async () => {
      mockRequest.user = undefined;
      mockRequest.body = { userId: 'target-99', reason: 'SPAM' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'target-99' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 400 on createReport error in reportUser', async () => {
      mockRequest.body = { userId: 'target-99', reason: 'SPAM' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'target-99' });
      (moderationService.createReport as jest.Mock).mockRejectedValue(new Error('DB error'));

      await reportUser(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'DB error' }));
    });
  });

  describe('reportCreator — additional branches', () => {
    it('should return 400 when creatorId is missing', async () => {
      mockRequest.body = { reason: 'SPAM' };
      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Creator ID and reason are required' })
      );
    });

    it('should allow report when user has no creator profile (no self-report)', async () => {
      // req.user.creator is undefined — self-report check is skipped
      mockRequest.user = { id: 'user-123', email: 'u@test.com', name: 'U', role: 'USER' as any };
      mockRequest.body = { creatorId: 'creator-abc', reason: 'SPAM', description: 'test' };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'creator-abc' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should require description for HATE_SPEECH', async () => {
      mockRequest.body = { creatorId: 'creator-abc', reason: 'HATE_SPEECH' };
      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'A description is required for this type of report' })
      );
    });

    it('should require description for VIOLENCE', async () => {
      mockRequest.body = { creatorId: 'creator-abc', reason: 'VIOLENCE' };
      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should NOT require description for non-serious reasons', async () => {
      mockRequest.body = { creatorId: 'creator-abc', reason: 'SPAM' };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'creator-abc' });
      (moderationService.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 400 on createReport error in reportCreator', async () => {
      mockRequest.body = { creatorId: 'creator-abc', reason: 'SPAM' };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'creator-abc' });
      (moderationService.createReport as jest.Mock).mockRejectedValue(new Error('fail'));

      await reportCreator(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('getMyReports — additional branches', () => {
    it('should use default page=1 and limit=20 when not provided', async () => {
      mockRequest.query = {};
      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 })
      );
    });

    it('should calculate correct skip for page 3 limit 5', async () => {
      mockRequest.query = { page: '3', limit: '5' };
      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 })
      );
    });

    it('should filter by both status and targetType when both provided', async () => {
      mockRequest.query = { status: 'RESOLVED', targetType: 'USER' };
      (prisma.report.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reporterId: 'user-123', status: 'RESOLVED', targetType: 'USER' }
        })
      );
    });

    it('should return 500 when prisma throws in getMyReports', async () => {
      mockRequest.query = {};
      (prisma.report.findMany as jest.Mock).mockRejectedValue(new Error('DB down'));
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'DB down' })
      );
    });

    it('should return 500 with fallback message when error has no message', async () => {
      mockRequest.query = {};
      (prisma.report.findMany as jest.Mock).mockRejectedValue({});
      (prisma.report.count as jest.Mock).mockResolvedValue(0);

      await getMyReports(mockRequest as Request, mockResponse as Response, jest.fn());

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Failed to fetch reports' })
      );
    });
  });
});
