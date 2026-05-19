// ===========================================
// CREATOR INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import creatorRoutes from '../../routes/creator.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/creators', creatorRoutes);
app.use(errorHandler);

describe('Creator API - Integration Tests', () => {
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

  describe('GET /api/creators', () => {
    it('should return list of creators', async () => {
      await createTestCreator();

      const response = await request(app).get('/api/creators');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support pagination', async () => {
      await createTestCreator();

      const response = await request(app)
        .get('/api/creators')
        .query({ page: 1, limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should support search query', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/creators')
        .query({ search: 'Test' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/creators/categories', () => {
    it('should return list of categories', async () => {
      const response = await request(app).get('/api/creators/categories');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('GET /api/creators/:id', () => {
    it('should return a specific creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app).get(`/api/creators/${creator.creatorId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', creator.creatorId);
    });

    it('should return 400 for invalid creator ID format', async () => {
      const response = await request(app).get('/api/creators/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent creator', async () => {
      const response = await request(app).get('/api/creators/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/creators/profile', () => {
    it('should update creator profile', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .put('/api/creators/profile')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          displayName: 'Updated Creator Name',
          bio: 'Updated bio for testing',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject update with display name too short', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .put('/api/creators/profile')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          displayName: 'A',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated update', async () => {
      const response = await request(app)
        .put('/api/creators/profile')
        .send({ displayName: 'Test' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject non-creator user from updating profile', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/creators/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'Test Name' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/creators/dashboard/me', () => {
    it('should return creator dashboard data', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/creators/dashboard/me')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should reject unauthenticated access', async () => {
      const response = await request(app).get('/api/creators/dashboard/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/creators/:id/reviews', () => {
    it('should return reviews for a creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/creators/${creator.creatorId}/reviews`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support sort parameter', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/creators/${creator.creatorId}/reviews`)
        .query({ sort: 'newest', page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/creators/:id/reviews', () => {
    it('should add a review for a creator', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post(`/api/creators/${creator.creatorId}/reviews`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          rating: 5,
          comment: 'Great creator!',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject review with invalid rating', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post(`/api/creators/${creator.creatorId}/reviews`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          rating: 10,
          comment: 'Invalid rating',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject review without authentication', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .post(`/api/creators/${creator.creatorId}/reviews`)
        .send({ rating: 5 });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/creators/analytics/me', () => {
    it('should return analytics for the creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/creators/analytics/me')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/creators/followers', () => {
    it('should return followers list for the creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/creators/followers')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
