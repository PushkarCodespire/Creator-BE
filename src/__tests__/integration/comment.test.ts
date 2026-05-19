// ===========================================
// COMMENT INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import commentRoutes from '../../routes/comment.routes';
import postRoutes from '../../routes/post.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { cleanupTestData, createTestCreator, createTestUser } from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import { UserRole } from '@prisma/client';

// Create test app - mount both post and comment routes since comments need posts
const app = express();
app.use(express.json());
app.use('/api/posts', postRoutes);
app.use('/api', commentRoutes);
app.use(errorHandler);

// Helper to create a test post
async function createPost(token: string, content = 'Test post for comment testing') {
  const response = await request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({ content });
  return response.body.data;
}

describe('Comment API - Integration Tests', () => {
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

  describe('POST /api/posts/:postId/comments', () => {
    it('should create a comment on a post', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const response = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Great post!' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('content', 'Great post!');
      expect(response.body.data).toHaveProperty('user');
    });

    it('should reject empty comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const response = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: '' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent post', async () => {
      const user = await createTestUser(UserRole.USER);

      const response = await request(app)
        .post('/api/posts/00000000-0000-0000-0000-000000000000/comments')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Comment on non-existent post' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should create a reply to another comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      // Create parent comment
      const parentResponse = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Parent comment' });

      const parentId = parentResponse.body.data.id;

      // Create reply
      const response = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ content: 'Reply to parent', parentId });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('parentId', parentId);
    });

    it('should reject unauthenticated comment', async () => {
      const response = await request(app)
        .post('/api/posts/some-id/comments')
        .send({ content: 'Unauthorized comment' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/posts/:postId/comments', () => {
    it('should return comments for a post', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      // Create a comment
      await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Test comment for listing' });

      const response = await request(app)
        .get(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('PUT /api/comments/:commentId', () => {
    it('should update own comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const commentResponse = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Original comment' });

      const commentId = commentResponse.body.data.id;

      const response = await request(app)
        .put(`/api/comments/${commentId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Updated comment' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /api/comments/:commentId', () => {
    it('should delete own comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const commentResponse = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Comment to delete' });

      const commentId = commentResponse.body.data.id;

      const response = await request(app)
        .delete(`/api/comments/${commentId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/comments/:commentId/like', () => {
    it('should like a comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const commentResponse = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Comment to like' });

      const commentId = commentResponse.body.data.id;

      const response = await request(app)
        .post(`/api/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /api/comments/:commentId/like', () => {
    it('should unlike a comment', async () => {
      const creator = await createTestCreator();
      const user = await createTestUser(UserRole.USER);
      const post = await createPost(creator.token);

      const commentResponse = await request(app)
        .post(`/api/posts/${post.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: 'Comment to unlike' });

      const commentId = commentResponse.body.data.id;

      // Like first
      await request(app)
        .post(`/api/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${creator.token}`);

      // Unlike
      const response = await request(app)
        .delete(`/api/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${creator.token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
