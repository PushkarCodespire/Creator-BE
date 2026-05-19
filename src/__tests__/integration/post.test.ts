// ===========================================
// POST INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import postRoutes from '../../routes/post.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/posts', postRoutes);
app.use(errorHandler);

describe('Post API - Integration Tests', () => {
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

  describe('POST /api/posts', () => {
    it('should create a post as a creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          content: 'This is a test post from integration tests.',
          type: 'TEXT',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('content', 'This is a test post from integration tests.');
      expect(response.body.data).toHaveProperty('creator');
    });

    it('should reject post from non-creator user', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          content: 'Test post from a regular user',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should reject post with empty content', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({
          content: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject unauthenticated post creation', async () => {
      const response = await request(app)
        .post('/api/posts')
        .send({ content: 'Test' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/posts', () => {
    it('should return feed of posts', async () => {
      const creator = await createTestCreator();

      // Create a post first
      await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Feed post for testing.' });

      const response = await request(app).get('/api/posts');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should work without authentication', async () => {
      const response = await request(app).get('/api/posts');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/posts/:id', () => {
    it('should return a specific post', async () => {
      const creator = await createTestCreator();

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Specific post content for test.' });

      const postId = createResponse.body.data.id;

      const response = await request(app).get(`/api/posts/${postId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', postId);
    });

    it('should return 404 for non-existent post', async () => {
      const response = await request(app)
        .get('/api/posts/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/posts/:id', () => {
    it('should update own post', async () => {
      const creator = await createTestCreator();

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Original post content.' });

      const postId = createResponse.body.data.id;

      const response = await request(app)
        .put(`/api/posts/${postId}`)
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Updated post content.' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated update', async () => {
      const response = await request(app)
        .put('/api/posts/some-id')
        .send({ content: 'Updated' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/posts/:id', () => {
    it('should delete own post', async () => {
      const creator = await createTestCreator();

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Post to be deleted.' });

      const postId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/posts/${postId}`)
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated delete', async () => {
      const response = await request(app).delete('/api/posts/some-id');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/posts/:id/like', () => {
    it('should like a post', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Post to be liked.' });

      const postId = createResponse.body.data.id;

      const response = await request(app)
        .post(`/api/posts/${postId}/like`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject unauthenticated like', async () => {
      const response = await request(app)
        .post('/api/posts/some-id/like');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/posts/:id/like', () => {
    it('should unlike a post', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Post to be liked then unliked.' });

      const postId = createResponse.body.data.id;

      // Like first
      await request(app)
        .post(`/api/posts/${postId}/like`)
        .set('Authorization', `Bearer ${user.token}`);

      // Unlike
      const response = await request(app)
        .delete(`/api/posts/${postId}/like`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/posts/:id/likes', () => {
    it('should return likes for a post', async () => {
      const creator = await createTestCreator();

      const createResponse = await request(app)
        .post('/api/posts')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Post with likes.' });

      const postId = createResponse.body.data.id;

      const response = await request(app)
        .get(`/api/posts/${postId}/likes`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/posts/stats/overview', () => {
    it('should return post stats for creator', async () => {
      const creator = await createTestCreator();

      const response = await request(app)
        .get('/api/posts/stats/overview')
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject non-creator from viewing stats', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .get('/api/posts/stats/overview')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });
});
