// ===========================================
// USER INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import userRoutes from '../../routes/user.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);
app.use(errorHandler);

describe('User API - Integration Tests', () => {
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

  describe('GET /api/users/profile', () => {
    it('should return user profile for authenticated user', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testUser.id);
      expect(response.body.data).toHaveProperty('email', testUser.email);
      expect(response.body.data).toHaveProperty('name');
      expect(response.body.data).toHaveProperty('role', 'USER');
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/users/profile');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('should update user profile successfully', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          name: 'Updated Test User',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated profile update', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({ name: 'New Name' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/users/interests', () => {
    it('should return user interests', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/users/interests')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('interests');
      expect(Array.isArray(response.body.data.interests)).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/users/interests');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/users/interests', () => {
    it('should update user interests with valid categories', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/users/interests')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          interests: ['Fitness', 'Tech', 'Education'],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.interests).toEqual(['Fitness', 'Tech', 'Education']);
    });

    it('should reject invalid interest categories', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/users/interests')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          interests: ['InvalidCategory'],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject non-array interests', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/users/interests')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          interests: 'Fitness',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/users/categories', () => {
    it('should return available categories without auth', async () => {
      const response = await request(app).get('/api/users/categories');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('value');
      expect(response.body.data[0]).toHaveProperty('label');
    });
  });

  describe('GET /api/users/favorites', () => {
    it('should return user favorites', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/users/favorites')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/users/chats', () => {
    it('should return user chat history', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/users/chats')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('conversations');
      expect(response.body.data).toHaveProperty('pagination');
    });

    it('should support pagination and sort parameters', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/users/chats')
        .set('Authorization', `Bearer ${testUser.token}`)
        .query({ page: 1, limit: 10, sort: 'recent' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination).toHaveProperty('page', 1);
      expect(response.body.data.pagination).toHaveProperty('limit', 10);
    });

    it('should reject unauthenticated chat history request', async () => {
      const response = await request(app).get('/api/users/chats');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
