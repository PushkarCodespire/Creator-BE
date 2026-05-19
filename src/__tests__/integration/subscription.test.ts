// ===========================================
// SUBSCRIPTION INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import subscriptionRoutes from '../../routes/subscription.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/subscriptions', subscriptionRoutes);
app.use(errorHandler);

describe('Subscription API - Integration Tests', () => {
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

  describe('GET /api/subscriptions/plans', () => {
    it('should return pricing plans without authentication', async () => {
      const response = await request(app).get('/api/subscriptions/plans');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(2);

      const freePlan = response.body.data.find((p: any) => p.id === 'free');
      const premiumPlan = response.body.data.find((p: any) => p.id === 'premium');
      expect(freePlan).toBeDefined();
      expect(premiumPlan).toBeDefined();
      expect(freePlan.price).toBe(0);
      expect(premiumPlan.price).toBeGreaterThan(0);
    });
  });

  describe('GET /api/subscriptions/current', () => {
    it('should return current subscription for authenticated user', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/subscriptions/current')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('plan', 'FREE');
      expect(response.body.data).toHaveProperty('status', 'ACTIVE');
      expect(response.body.data).toHaveProperty('limits');
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/subscriptions/current');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/subscriptions/current')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/subscriptions/features', () => {
    it('should return feature access for free user', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/subscriptions/features')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('plan', 'FREE');
      expect(response.body.data).toHaveProperty('features');
      expect(response.body.data.features).toHaveProperty('chat');
      expect(response.body.data.features).toHaveProperty('social');
      expect(response.body.data.features.chat.unlimited).toBe(false);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/subscriptions/features');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/subscriptions/upgrade', () => {
    it('should upgrade user to premium (test mode)', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/subscriptions/upgrade')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify subscription was updated
      const subscription = await prisma.subscription.findUnique({
        where: { userId: testUser.id },
      });
      expect(subscription!.plan).toBe('PREMIUM');
    });

    it('should reject unauthenticated upgrade', async () => {
      const response = await request(app).post('/api/subscriptions/upgrade');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/subscriptions/cancel', () => {
    it('should cancel subscription successfully', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/subscriptions/cancel')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify subscription was cancelled
      const subscription = await prisma.subscription.findUnique({
        where: { userId: testUser.id },
      });
      expect(subscription!.status).toBe('CANCELLED');
      expect(subscription!.plan).toBe('FREE');
    });

    it('should reject unauthenticated cancel', async () => {
      const response = await request(app).post('/api/subscriptions/cancel');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/subscriptions/transactions', () => {
    it('should return transaction history for authenticated user', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/subscriptions/transactions')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/subscriptions/transactions');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
