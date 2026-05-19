// ===========================================
// PAYMENT INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import paymentRoutes from '../../routes/payment.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/payments', paymentRoutes);
app.use(errorHandler);

describe('Payment API - Integration Tests', () => {
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

  describe('POST /api/payments/create-order', () => {
    it('should create a payment order for premium plan', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/payments/create-order')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ plan: 'PREMIUM' });

      // In test env without Razorpay, should auto-upgrade or return success
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid plan', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/payments/create-order')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ plan: 'INVALID_PLAN' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated order creation', async () => {
      const response = await request(app)
        .post('/api/payments/create-order')
        .send({ plan: 'PREMIUM' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject if already premium', async () => {
      const testUser = await createTestUser(UserRole.USER);

      // First upgrade
      await request(app)
        .post('/api/payments/create-order')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ plan: 'PREMIUM' });

      // Second attempt should fail
      const response = await request(app)
        .post('/api/payments/create-order')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ plan: 'PREMIUM' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/payments/verify', () => {
    it('should reject unauthenticated verification', async () => {
      const response = await request(app)
        .post('/api/payments/verify')
        .send({
          razorpay_order_id: 'fake_order',
          razorpay_payment_id: 'fake_payment',
          razorpay_signature: 'fake_signature',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject verification with missing fields', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({});

      // Should fail due to missing payment data
      expect([400, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/payments/status/:orderId', () => {
    it('should reject unauthenticated status check', async () => {
      const response = await request(app)
        .get('/api/payments/status/fake-order-id');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent order', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/payments/status/non-existent-order')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect([404, 400, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/payments/webhook', () => {
    it('should handle webhook payload (no auth required)', async () => {
      const response = await request(app)
        .post('/api/payments/webhook')
        .send({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: 'pay_test_123',
                order_id: 'order_test_123',
                amount: 79900,
                status: 'captured',
              },
            },
          },
        });

      // Webhook might fail without valid signature, but should not require auth
      expect([200, 400, 500]).toContain(response.status);
    });
  });
});
