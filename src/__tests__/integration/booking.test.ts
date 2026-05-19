// ===========================================
// BOOKING INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import bookingRoutes from '../../routes/booking.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/bookings', bookingRoutes);
app.use(errorHandler);

describe('Booking API - Integration Tests', () => {
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

  describe('GET /api/bookings/public/:creatorId', () => {
    it('should return available booking slots for a creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/bookings/public/${creator.creatorId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return empty array for creator with no slots', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get(`/api/bookings/public/${creator.creatorId}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /api/bookings/slots', () => {
    it('should return creator booking slots', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      const response = await request(app).get('/api/bookings/slots');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/bookings/slots', () => {
    it('should create a booking slot', async () => {
      const creator = await createTestCreator();
      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

      const response = await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          title: 'Consultation',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          price: 500,
          type: 'consultation',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('title', 'Consultation');
    });

    it('should reject slot without start/end time', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          title: 'Consultation',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject overlapping slots', async () => {
      const creator = await createTestCreator();
      const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      // Create first slot
      await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      // Try overlapping slot
      const response = await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/bookings/slots/:id', () => {
    it('should delete a booking slot', async () => {
      const creator = await createTestCreator();
      const startTime = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      // Create slot first
      const createResponse = await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const slotId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/bookings/slots/${slotId}`)
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/bookings/request', () => {
    it('should create a booking request for available slot', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const startTime = new Date(Date.now() + 96 * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      // Create slot
      const slotResponse = await request(app)
        .post('/api/bookings/slots')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        });

      const slotId = slotResponse.body.data.id;

      const response = await request(app)
        .post('/api/bookings/request')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          slotId,
          message: 'I would like to book this slot',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
    });

    it('should reject request without slot ID', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/bookings/request')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          message: 'I want to book',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/bookings/requests', () => {
    it('should return booking requests for creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/bookings/requests')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/bookings/stats', () => {
    it('should return booking stats for creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/bookings/stats')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalSlots');
      expect(response.body.data).toHaveProperty('totalBookings');
      expect(response.body.data).toHaveProperty('pendingRequests');
    });

    it('should reject unauthenticated stats request', async () => {
      const response = await request(app).get('/api/bookings/stats');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
