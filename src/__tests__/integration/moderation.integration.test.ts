// ===========================================
// MODERATION INTEGRATION TESTS
// ===========================================
// Tests the full moderation flow: report → review → action

import request from 'supertest';
import express from 'express';
import {
  createTestUser,
  createTestCreator,
  createTestConversation,
  createTestMessage,
  cleanupTestData,
  authHeader
} from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import reportRoutes from '../../routes/report.routes';
import adminRoutes from '../../routes/admin.routes';
import { authenticate, requireAdmin } from '../../middleware/auth';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

describe('Moderation Integration Tests', () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Report Submission Flow', () => {
    it('should submit message report and create auto-flag', async () => {
      // Setup: Create users and conversation
      const [user, creator] = await Promise.all([
        createTestUser('USER'),
        createTestCreator(true)
      ]);

      const conversation = await createTestConversation(user.id, creator.creatorId);

      // Create a toxic message
      const message = await createTestMessage(
        conversation.id,
        user.id,
        'fuck you bitch I hate you'
      );

      // User reports the message
      const reportResponse = await request(app)
        .post('/api/reports/message')
        .set(authHeader(user.token))
        .send({
          messageId: message.id,
          reason: 'HARASSMENT',
          description: 'This message is harassing me'
        })
        .expect(200);

      expect(reportResponse.body.success).toBe(true);
      expect(reportResponse.body.message).toContain('submitted');

      // Verify report was created
      const report = await prisma.report.findFirst({
        where: {
          targetType: 'MESSAGE',
          targetId: message.id
        }
      });

      expect(report).not.toBeNull();
      expect(report?.reason).toBe('HARASSMENT');
      expect(report?.status).toBe('PENDING');
      expect(report?.reporterId).toBe(user.id);
    });

    it('should prevent duplicate reports within 24 hours', async () => {
      const [user, creator] = await Promise.all([
        createTestUser('USER'),
        createTestCreator(true)
      ]);

      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'spam message');

      // First report should succeed
      await request(app)
        .post('/api/reports/message')
        .set(authHeader(user.token))
        .send({
          messageId: message.id,
          reason: 'SPAM',
          description: 'This is spam'
        })
        .expect(200);

      // Second report for same message should fail
      const duplicateResponse = await request(app)
        .post('/api/reports/message')
        .set(authHeader(user.token))
        .send({
          messageId: message.id,
          reason: 'SPAM',
          description: 'This is spam again'
        })
        .expect(400);

      expect(duplicateResponse.body.success).toBe(false);
      expect(duplicateResponse.body.error).toContain('already reported');
    });

    it('should allow guest users to report with email', async () => {
      const creator = await createTestCreator(true);
      const user = await createTestUser('USER');
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'offensive message');

      // Guest report (no auth token)
      const response = await request(app)
        .post('/api/reports/message')
        .send({
          messageId: message.id,
          reason: 'HARASSMENT',
          description: 'Offensive content',
          reporterEmail: 'guest@test.com'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify report has email but no reporter ID
      const report = await prisma.report.findFirst({
        where: { targetId: message.id }
      });

      expect(report?.reporterId).toBeNull();
      expect(report?.reporterEmail).toBe('guest@test.com');
    });

    it('should auto-escalate severe violations', async () => {
      const [user, creator] = await Promise.all([
        createTestUser('USER'),
        createTestCreator(true)
      ]);

      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(
        conversation.id,
        user.id,
        'violent threatening message'
      );

      await request(app)
        .post('/api/reports/message')
        .set(authHeader(user.token))
        .send({
          messageId: message.id,
          reason: 'VIOLENCE',
          description: 'Contains violent threats'
        })
        .expect(200);

      // Verify priority was escalated
      const report = await prisma.report.findFirst({
        where: { targetId: message.id }
      });

      expect(report?.priority).toBe('HIGH');
    });
  });

  describe('Admin Moderation Flow', () => {
    it('should retrieve moderation queue', async () => {
      const admin = await createTestUser('ADMIN');
      const [user, creator] = await Promise.all([
        createTestUser('USER'),
        createTestCreator(true)
      ]);

      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'spam');

      // Create report
      await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'SPAM',
          description: 'Spam message',
          status: 'PENDING',
          priority: 'MEDIUM'
        }
      });

      // Admin fetches queue
      const response = await request(app)
        .get('/api/admin/moderation/reports')
        .set(authHeader(admin.token))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reports).toHaveLength(1);
      expect(response.body.data.reports[0].reason).toBe('SPAM');
    });

    it('should filter reports by status', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);

      // Create multiple reports with different statuses
      const messages = await Promise.all([
        createTestMessage(conversation.id, user.id, 'message 1'),
        createTestMessage(conversation.id, user.id, 'message 2')
      ]);

      await Promise.all([
        prisma.report.create({
          data: {
            reporterId: user.id,
            targetType: 'MESSAGE',
            targetId: messages[0].id,
            reason: 'SPAM',
            status: 'PENDING',
            priority: 'LOW'
          }
        }),
        prisma.report.create({
          data: {
            reporterId: user.id,
            targetType: 'MESSAGE',
            targetId: messages[1].id,
            reason: 'HARASSMENT',
            status: 'RESOLVED',
            priority: 'MEDIUM'
          }
        })
      ]);

      // Filter by PENDING
      const pendingResponse = await request(app)
        .get('/api/admin/moderation/reports?status=PENDING')
        .set(authHeader(admin.token))
        .expect(200);

      expect(pendingResponse.body.data.reports).toHaveLength(1);
      expect(pendingResponse.body.data.reports[0].status).toBe('PENDING');
    });

    it('should resolve report with warning action', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'mild violation');

      // Create report
      const report = await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'SPAM',
          status: 'PENDING',
          priority: 'LOW'
        }
      });

      // Admin resolves with warning
      const response = await request(app)
        .post(`/api/admin/moderation/reports/${report.id}/resolve`)
        .set(authHeader(admin.token))
        .send({
          action: 'WARNING_SENT',
          reviewNotes: 'First offense, sending warning'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify report was updated
      const updatedReport = await prisma.report.findUnique({
        where: { id: report.id }
      });

      expect(updatedReport?.status).toBe('RESOLVED');
      expect(updatedReport?.actionTaken).toBe('WARNING_SENT');
      expect(updatedReport?.reviewedBy).toBe(admin.id);

      // Verify user received warning
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id }
      });

      expect(updatedUser?.warningCount).toBe(1);
      expect(updatedUser?.lastWarningAt).not.toBeNull();

      // Verify moderation log was created
      const log = await prisma.moderationLog.findFirst({
        where: {
          reportId: report.id,
          action: 'WARNING_SENT'
        }
      });

      expect(log).not.toBeNull();
      expect(log?.moderatorId).toBe(admin.id);
    });

    it('should suspend user with duration', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'serious violation');

      const report = await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'HARASSMENT',
          status: 'PENDING',
          priority: 'HIGH'
        }
      });

      // Admin suspends user for 7 days
      const response = await request(app)
        .post(`/api/admin/moderation/reports/${report.id}/resolve`)
        .set(authHeader(admin.token))
        .send({
          action: 'USER_SUSPENDED',
          suspensionDays: 7,
          reviewNotes: 'Repeated harassment, 7-day suspension'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify user was suspended
      const suspendedUser = await prisma.user.findUnique({
        where: { id: user.id }
      });

      expect(suspendedUser?.isSuspended).toBe(true);
      expect(suspendedUser?.suspendedAt).not.toBeNull();
      expect(suspendedUser?.suspendedUntil).not.toBeNull();

      // Verify suspension duration (should be ~7 days from now)
      const expectedUntil = new Date();
      expectedUntil.setDate(expectedUntil.getDate() + 7);
      const actualUntil = new Date(suspendedUser!.suspendedUntil!);
      const timeDiff = Math.abs(actualUntil.getTime() - expectedUntil.getTime());
      expect(timeDiff).toBeLessThan(60000); // Within 1 minute
    });

    it('should permanently ban user', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'severe violation');

      const report = await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'HATE_SPEECH',
          status: 'PENDING',
          priority: 'URGENT'
        }
      });

      // Admin bans user
      const response = await request(app)
        .post(`/api/admin/moderation/reports/${report.id}/resolve`)
        .set(authHeader(admin.token))
        .send({
          action: 'USER_BANNED',
          reviewNotes: 'Hate speech - permanent ban'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify user was banned
      const bannedUser = await prisma.user.findUnique({
        where: { id: user.id }
      });

      expect(bannedUser?.isBanned).toBe(true);
      expect(bannedUser?.bannedAt).not.toBeNull();
      expect(bannedUser?.banReason).toBe('Hate speech - permanent ban');
    });

    it('should hide message content', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'inappropriate content');

      const report = await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'SEXUAL_CONTENT',
          status: 'PENDING',
          priority: 'MEDIUM'
        }
      });

      // Admin hides message
      const response = await request(app)
        .post(`/api/admin/moderation/reports/${report.id}/resolve`)
        .set(authHeader(admin.token))
        .send({
          action: 'CONTENT_HIDDEN',
          reviewNotes: 'Inappropriate content - message hidden'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify message was hidden
      const hiddenMessage = await prisma.message.findUnique({
        where: { id: message.id }
      });

      expect(hiddenMessage?.isHidden).toBe(true);
      expect(hiddenMessage?.hiddenBy).toBe(admin.id);
      expect(hiddenMessage?.hiddenReason).toBe('Inappropriate content - message hidden');
    });

    it('should dismiss report with no action', async () => {
      const admin = await createTestUser('ADMIN');
      const user = await createTestUser('USER');
      const creator = await createTestCreator(true);
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'clean message');

      const report = await prisma.report.create({
        data: {
          reporterId: user.id,
          targetType: 'MESSAGE',
          targetId: message.id,
          reason: 'SPAM',
          status: 'PENDING',
          priority: 'LOW'
        }
      });

      // Admin dismisses report
      const response = await request(app)
        .post(`/api/admin/moderation/reports/${report.id}/dismiss`)
        .set(authHeader(admin.token))
        .send({
          reason: 'No violation found - false report'
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify report was dismissed
      const dismissedReport = await prisma.report.findUnique({
        where: { id: report.id }
      });

      expect(dismissedReport?.status).toBe('DISMISSED');
      expect(dismissedReport?.reviewedBy).toBe(admin.id);
    });
  });

  describe('Moderation Statistics', () => {
    it('should return accurate moderation stats', async () => {
      const admin = await createTestUser('ADMIN');
      const [user1, user2] = await Promise.all([
        createTestUser('USER'),
        createTestUser('USER')
      ]);

      // Create some moderation activity
      await Promise.all([
        prisma.user.update({
          where: { id: user1.id },
          data: { isSuspended: true, suspendedAt: new Date() }
        }),
        prisma.user.update({
          where: { id: user2.id },
          data: { isBanned: true, bannedAt: new Date() }
        })
      ]);

      // Create reports
      await Promise.all([
        prisma.report.create({
          data: {
            reporterId: user1.id,
            targetType: 'MESSAGE',
            targetId: 'msg-1',
            reason: 'SPAM',
            status: 'PENDING',
            priority: 'LOW'
          }
        }),
        prisma.report.create({
          data: {
            reporterId: user1.id,
            targetType: 'MESSAGE',
            targetId: 'msg-2',
            reason: 'HARASSMENT',
            status: 'RESOLVED',
            priority: 'MEDIUM',
            reviewedBy: admin.id,
            reviewedAt: new Date()
          }
        })
      ]);

      // Get stats
      const response = await request(app)
        .get('/api/admin/moderation/stats')
        .set(authHeader(admin.token))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        pendingReports: 1,
        suspendedUsers: 1,
        bannedUsers: 1
      });
    });
  });

  describe('Authorization', () => {
    it('should block non-admin from accessing moderation endpoints', async () => {
      const user = await createTestUser('USER');

      await request(app)
        .get('/api/admin/moderation/reports')
        .set(authHeader(user.token))
        .expect(403);
    });

    it('should block unauthenticated requests to admin endpoints', async () => {
      await request(app)
        .get('/api/admin/moderation/reports')
        .expect(401);
    });

    it('should allow admin access to all moderation endpoints', async () => {
      const admin = await createTestUser('ADMIN');

      const responses = await Promise.all([
        request(app)
          .get('/api/admin/moderation/reports')
          .set(authHeader(admin.token)),
        request(app)
          .get('/api/admin/moderation/stats')
          .set(authHeader(admin.token))
      ]);

      responses.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });
  });
});
