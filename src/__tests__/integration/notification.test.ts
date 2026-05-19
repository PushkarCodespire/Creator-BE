// ===========================================
// NOTIFICATION INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import notificationRoutes from '../../routes/notification.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/notifications', notificationRoutes);
app.use(errorHandler);

// Helper to create a test notification
async function createTestNotification(userId: string) {
  return await prisma.notification.create({
    data: {
      userId,
      type: 'CHAT_MESSAGE',
      title: 'Test Notification',
      message: 'This is a test notification',
      actionUrl: '/test',
      priority: 'NORMAL',
    },
  });
}

describe('Notification API - Integration Tests', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('GET /api/notifications', () => {
    it('should return notifications for authenticated user', async () => {
      const testUser = await createTestUser(UserRole.USER);
      await createTestNotification(testUser.id);

      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support pagination', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${testUser.token}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/notifications');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread count', async () => {
      const testUser = await createTestUser(UserRole.USER);
      await createTestNotification(testUser.id);

      const response = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('count');
      expect(response.body.data.count).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 for user with no notifications', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.count).toBe(0);
    });
  });

  describe('PUT /api/notifications/:id/read', () => {
    it('should mark a notification as read', async () => {
      const testUser = await createTestUser(UserRole.USER);
      const notification = await createTestNotification(testUser.id);

      const response = await request(app)
        .put(`/api/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify it's marked as read
      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(updated!.isRead).toBe(true);
    });

    it('should return 404 for non-existent notification', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/notifications/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should not allow reading another user notification', async () => {
      const user1 = await createTestUser(UserRole.USER);
      const user2 = await createTestUser(UserRole.USER);
      const notification = await createTestNotification(user1.id);

      const response = await request(app)
        .put(`/api/notifications/${notification.id}/read`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      const testUser = await createTestUser(UserRole.USER);
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);

      const response = await request(app)
        .put('/api/notifications/read-all')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify all are read
      const unreadCount = await prisma.notification.count({
        where: { userId: testUser.id, isRead: false },
      });
      expect(unreadCount).toBe(0);
    });
  });

  describe('DELETE /api/notifications/:id', () => {
    it('should delete a notification', async () => {
      const testUser = await createTestUser(UserRole.USER);
      const notification = await createTestNotification(testUser.id);

      const response = await request(app)
        .delete(`/api/notifications/${notification.id}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify deleted
      const deleted = await prisma.notification.findUnique({
        where: { id: notification.id },
      });
      expect(deleted).toBeNull();
    });
  });

  describe('GET /api/notifications/settings', () => {
    it('should return notification settings', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/notifications/settings')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('PUT /api/notifications/settings', () => {
    it('should update notification settings', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/notifications/settings')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          emailNotifications: false,
          pushNotifications: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
