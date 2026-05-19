// ===========================================
// TRENDING INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import trendingRoutes from '../../routes/trending.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', trendingRoutes);
app.use(errorHandler);

describe('Trending API - Integration Tests', () => {
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

  describe('GET /api/trending/posts', () => {
    it('should return trending posts', async () => {
      const response = await request(app).get('/api/trending/posts');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support timeWindow parameter', async () => {
      const response = await request(app)
        .get('/api/trending/posts')
        .query({ timeWindow: 24 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid timeWindow', async () => {
      const response = await request(app)
        .get('/api/trending/posts')
        .query({ timeWindow: 999 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should support limit parameter', async () => {
      const response = await request(app)
        .get('/api/trending/posts')
        .query({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/trending/creators', () => {
    it('should return trending creators', async () => {
      await createTestCreator();

      const response = await request(app).get('/api/trending/creators');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support timeWindow parameter', async () => {
      const response = await request(app)
        .get('/api/trending/creators')
        .query({ timeWindow: 168 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/trending/hashtags', () => {
    it('should return trending hashtags', async () => {
      const response = await request(app).get('/api/trending/hashtags');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support limit parameter', async () => {
      const response = await request(app)
        .get('/api/trending/hashtags')
        .query({ limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/trending/category/:category', () => {
    it('should return category-specific trending', async () => {
      const response = await request(app)
        .get('/api/trending/category/Tech');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle unknown category gracefully', async () => {
      const response = await request(app)
        .get('/api/trending/category/UnknownCategory');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/trending/stats', () => {
    it('should return trending stats overview', async () => {
      const response = await request(app).get('/api/trending/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });
});
