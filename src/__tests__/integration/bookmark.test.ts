// ===========================================
// BOOKMARK INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import bookmarkRoutes from '../../routes/bookmark.routes';
import { errorHandler } from '../../middleware/errorHandler';
import {
  cleanupTestData,
  createTestUser,
  createTestCreator,
  createTestConversation,
  createTestMessage,
} from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', bookmarkRoutes);
app.use(errorHandler);

describe('Bookmark API - Integration Tests', () => {
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

  describe('POST /api/messages/:messageId/bookmark', () => {
    it('should bookmark a message successfully', async () => {
      const user = await createTestUser(UserRole.USER);
      const creator = await createTestCreator();
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'Test message');

      const response = await request(app)
        .post(`/api/messages/${message.id}/bookmark`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ note: 'Important message' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('messageId', message.id);
    });

    it('should update existing bookmark note', async () => {
      const user = await createTestUser(UserRole.USER);
      const creator = await createTestCreator();
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'Test message');

      // Bookmark first
      await request(app)
        .post(`/api/messages/${message.id}/bookmark`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ note: 'First note' });

      // Update bookmark
      const response = await request(app)
        .post(`/api/messages/${message.id}/bookmark`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ note: 'Updated note' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Bookmark updated');
    });

    it('should return 404 for non-existent message', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/messages/00000000-0000-0000-0000-000000000000/bookmark')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated bookmark', async () => {
      const response = await request(app)
        .post('/api/messages/some-id/bookmark');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/messages/:messageId/bookmark', () => {
    it('should remove a bookmark', async () => {
      const user = await createTestUser(UserRole.USER);
      const creator = await createTestCreator();
      const conversation = await createTestConversation(user.id, creator.creatorId);
      const message = await createTestMessage(conversation.id, user.id, 'Test message');

      // Create bookmark first
      await request(app)
        .post(`/api/messages/${message.id}/bookmark`)
        .set('Authorization', `Bearer ${user.token}`);

      // Remove bookmark
      const response = await request(app)
        .delete(`/api/messages/${message.id}/bookmark`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent bookmark', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .delete('/api/messages/00000000-0000-0000-0000-000000000000/bookmark')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/bookmarks', () => {
    it('should return user bookmarks', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/bookmarks')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/bookmarks');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/bookmarks/recommendations', () => {
    it('should return bookmark recommendations', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/bookmarks/recommendations')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
