// ===========================================
// ADMIN INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import adminRoutes from '../../routes/admin.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser, createTestCreator, createTestUsers } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use(errorHandler);

describe('Admin API - Integration Tests', () => {
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

  describe('GET /api/admin/stats', () => {
    it('should return dashboard stats for admin', async () => {
      const admin = await createTestUser(UserRole.ADMIN);

      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('overview');
      expect(response.body.data).toHaveProperty('growth');
      expect(response.body.data).toHaveProperty('revenue');
      expect(response.body.data).toHaveProperty('engagement');
      expect(response.body.data.overview).toHaveProperty('totalUsers');
      expect(response.body.data.overview).toHaveProperty('totalCreators');
    });

    it('should reject non-admin user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/admin/stats');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should return paginated user list', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      await createTestUser(UserRole.USER);
      await createTestUser(UserRole.CREATOR);

      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('users');
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data.pagination).toHaveProperty('total');
      expect(response.body.data.users.length).toBeGreaterThanOrEqual(1);
    });

    it('should support role filter', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      await createTestUser(UserRole.CREATOR);

      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .query({ role: 'CREATOR' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // All returned users should be creators (or at least some)
      const allCreators = response.body.data.users.every(
        (u: any) => u.role === 'CREATOR'
      );
      expect(allCreators).toBe(true);
    });

    it('should support search', async () => {
      const admin = await createTestUser(UserRole.ADMIN);

      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${admin.token}`)
        .query({ search: 'test' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject non-admin user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/users/:userId', () => {
    it('should return user details', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get(`/api/admin/users/${user.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', user.id);
      expect(response.body.data).toHaveProperty('email');
      expect(response.body.data).toHaveProperty('role');
    });
  });

  describe('PUT /api/admin/users/:userId/role', () => {
    it('should update user role', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put(`/api/admin/users/${user.id}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'CREATOR' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/admin/users/:userId/suspend', () => {
    it('should suspend a user', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post(`/api/admin/users/${user.id}/suspend`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          reason: 'Violation of terms',
          duration: 7,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/admin/users/:userId/unsuspend', () => {
    it('should unsuspend a user', async () => {
      const admin = await createTestUser(UserRole.ADMIN);
      const user = await createTestUser(UserRole.USER);

      // Suspend first
      await request(app)
        .post(`/api/admin/users/${user.id}/suspend`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ reason: 'Test', duration: 7 });

      const response = await request(app)
        .post(`/api/admin/users/${user.id}/unsuspend`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/deals', () => {
    it('should return paginated deals list', async () => {
      const admin = await createTestUser(UserRole.ADMIN);

      const response = await request(app)
        .get('/api/admin/deals')
        .set('Authorization', `Bearer ${admin.token}`)
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('deals');
      expect(response.body.data).toHaveProperty('pagination');
    });

    it('should support status filter', async () => {
      const admin = await createTestUser(UserRole.ADMIN);

      const response = await request(app)
        .get('/api/admin/deals')
        .set('Authorization', `Bearer ${admin.token}`)
        .query({ status: 'COMPLETED' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/companies', () => {
    it('should return companies list', async () => {
      const admin = await createTestUser(UserRole.ADMIN);

      const response = await request(app)
        .get('/api/admin/companies')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
