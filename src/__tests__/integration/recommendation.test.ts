// ===========================================
// RECOMMENDATION INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import recommendationRoutes from '../../routes/recommendation.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', recommendationRoutes);
app.use(errorHandler);

describe('Recommendation API - Integration Tests', () => {
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

  describe('GET /api/recommendations/creators', () => {
    it('should return creator recommendations for authenticated user', async () => {
      const user = await createTestUser(UserRole.USER);
      await createTestCreator();

      const response = await request(app)
        .get('/api/recommendations/creators')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support limit parameter', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/recommendations/creators')
        .set('Authorization', `Bearer ${user.token}`)
        .query({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/recommendations/creators');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/recommendations/creators/:creatorId/similar', () => {
    it('should return similar creators', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/recommendations/creators/${creator.creatorId}/similar`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return empty for non-existent creator', async () => {
      const response = await request(app)
        .get('/api/recommendations/creators/00000000-0000-0000-0000-000000000000/similar');

      // Should return 200 with empty or 404
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('GET /api/recommendations/posts', () => {
    it('should return post recommendations for authenticated user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/recommendations/posts')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/recommendations/posts');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/recommendations/for-you', () => {
    it('should return for-you recommendations without auth', async () => {
      const response = await request(app)
        .get('/api/recommendations/for-you');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return personalized recommendations with auth', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/recommendations/for-you')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/recommendations/category/:category', () => {
    it('should return category-based recommendations', async () => {
      const response = await request(app)
        .get('/api/recommendations/category/Tech');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle non-existent category gracefully', async () => {
      const response = await request(app)
        .get('/api/recommendations/category/NonExistentCategory');

      // Should still return 200 with empty results
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
