// ===========================================
// AUTH INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import authRoutes from '../../routes/auth.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestUser, randomEmail } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(errorHandler);

describe('Auth API - Integration Tests', () => {
  // Clean up database before and after tests
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

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: randomEmail(),
          password: 'Test1234',
          name: 'Test User',
          role: 'USER',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.email).toBeDefined();
      expect(response.body.data.user.password).toBeUndefined(); // Password should not be returned
    });

    it('should create subscription for USER role', async () => {
      const email = randomEmail();
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Test1234',
          name: 'Test User',
          role: 'USER',
        });

      expect(response.status).toBe(201);

      // Verify subscription was created
      const user = await prisma.user.findUnique({ where: { email } });
      const subscription = await prisma.subscription.findUnique({
        where: { userId: user!.id },
      });

      expect(subscription).toBeDefined();
      expect(subscription!.plan).toBe('FREE');
      expect(subscription!.status).toBe('ACTIVE');
    });

    it('should create creator profile for CREATOR role', async () => {
      const email = randomEmail();
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Test1234',
          name: 'Test Creator',
          role: 'CREATOR',
        });

      expect(response.status).toBe(201);

      // Verify creator profile was created
      const user = await prisma.user.findUnique({ where: { email } });
      const creator = await prisma.creator.findUnique({
        where: { userId: user!.id },
      });

      expect(creator).toBeDefined();
      expect(creator!.displayName).toBe('Test Creator');
    });

    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Test1234',
          name: 'Test User',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.details).toContain('Valid email is required');
    });

    it('should reject registration with weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: randomEmail(),
          password: 'weak', // Too short, no uppercase, no number
          name: 'Test User',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject registration with duplicate email', async () => {
      const email = randomEmail();

      // First registration
      await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Test1234',
          name: 'Test User',
        });

      // Second registration with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Test1234',
          name: 'Another User',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject registration with invalid role', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: randomEmail(),
          password: 'Test1234',
          name: 'Test User',
          role: 'INVALID_ROLE',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully with correct credentials', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.email).toBe(testUser.email);
    });

    it('should reject login with incorrect password', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject login with non-existent email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Test1234',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject login with invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'Test1234',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should include user role in response', async () => {
      const testUser = await createTestUser(UserRole.CREATOR);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.user.role).toBe('CREATOR');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe(testUser.email);
      expect(response.body.data.id).toBe(testUser.id);
    });

    it('should reject request without token', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('should update user profile successfully', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          name: 'Updated Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Name');
    });

    it('should reject update with invalid name', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          name: 'A', // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/auth/password', () => {
    it('should change password successfully', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          currentPassword: testUser.password,
          newPassword: 'NewPass1234',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify can login with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'NewPass1234',
        });

      expect(loginResponse.status).toBe(200);
    });

    it('should reject password change with incorrect current password', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          currentPassword: 'WrongPassword123',
          newPassword: 'NewPass1234',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject password change with same password', async () => {
      const testUser = await createTestUser(UserRole.USER);

      const response = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({
          currentPassword: testUser.password,
          newPassword: testUser.password, // Same as current
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
