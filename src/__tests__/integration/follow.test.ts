// ===========================================
// FOLLOW INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import followRoutes from '../../routes/follow.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/follow', followRoutes);
app.use(errorHandler);

describe('Follow API - Integration Tests', () => {
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

  describe('POST /api/follow/:creatorId', () => {
    it('should follow a creator successfully', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('followerId', user.id);
      expect(response.body.data).toHaveProperty('followingId', creator.creatorId);
    });

    it('should reject duplicate follow', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      // Follow first time
      await request(app)
        .post(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      // Follow again
      const response = await request(app)
        .post(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated follow', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .post(`/api/follow/${creator.creatorId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent creator', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/follow/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/follow/:creatorId', () => {
    it('should unfollow a creator successfully', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      // Follow first
      await request(app)
        .post(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      // Unfollow
      const response = await request(app)
        .delete(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 when not following', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .delete(`/api/follow/${creator.creatorId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated unfollow', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .delete(`/api/follow/${creator.creatorId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/follow/check/:creatorId', () => {
    it('should return follow status', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/follow/check/${creator.creatorId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/follow/users/:userId/followers', () => {
    it('should return followers list for a user', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/follow/users/${creator.id}/followers`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/follow/users/:userId/following', () => {
    it('should return following list for a user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get(`/api/follow/users/${user.id}/following`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/follow/users/:userId/stats', () => {
    it('should return follow stats for a user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get(`/api/follow/users/${user.id}/stats`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/follow/suggestions', () => {
    it('should return creator suggestions for authenticated user', async () => {
      const user = await createTestUser(UserRole.USER);
      await createTestCreator();

      const response = await request(app)
        .get('/api/follow/suggestions')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/follow/suggestions');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
