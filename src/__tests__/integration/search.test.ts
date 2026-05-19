// ===========================================
// SEARCH INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import searchRoutes from '../../routes/search.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', searchRoutes);
app.use(errorHandler);

describe('Search API - Integration Tests', () => {
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

  describe('GET /api/search', () => {
    it('should return search results for valid query', async () => {
      await createTestCreator();

      const response = await request(app)
        .get('/api/search')
        .query({ q: 'Test' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return 400 for missing query', async () => {
      const response = await request(app).get('/api/search');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for query too short', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'a' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should support type filter', async () => {
      await createTestCreator();

      const response = await request(app)
        .get('/api/search')
        .query({ q: 'Test', type: 'creator' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'Test', page: 1, limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/search/autocomplete', () => {
    it('should return autocomplete suggestions', async () => {
      await createTestCreator();

      const response = await request(app)
        .get('/api/search/autocomplete')
        .query({ q: 'Tes' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/search/popular', () => {
    it('should return popular searches', async () => {
      const response = await request(app)
        .get('/api/search/popular');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/search/suggestions', () => {
    it('should return personalized suggestions for authenticated user', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/search/suggestions')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/search/suggestions');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
