// ===========================================
// CHAT FLOW INTEGRATION TESTS
// ===========================================

import request from 'supertest';
import express from 'express';
import chatRoutes from '../../routes/chat.routes';
import { authenticate } from '../../middleware/auth';

// Mock authentication middleware
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user-id' };
    next();
  },
}));

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

describe('Chat Flow Integration Tests', () => {
  describe('POST /api/chat/start', () => {
    it('should create a new conversation', async () => {
      const response = await request(app)
        .post('/api/chat/start')
        .send({
          creatorId: 'test-creator-id',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('conversationId');
    });

    it('should return existing conversation if one exists', async () => {
      // First request
      const firstResponse = await request(app)
        .post('/api/chat/start')
        .send({
          creatorId: 'test-creator-id',
        });

      const conversationId = firstResponse.body.data.conversationId;

      // Second request should return same conversation
      const secondResponse = await request(app)
        .post('/api/chat/start')
        .send({
          creatorId: 'test-creator-id',
        });

      expect(secondResponse.body.data.conversationId).toBe(conversationId);
    });
  });

  describe('POST /api/chat/message', () => {
    it('should send a message and receive AI response', async () => {
      // Start conversation first
      const startResponse = await request(app)
        .post('/api/chat/start')
        .send({
          creatorId: 'test-creator-id',
        });

      const conversationId = startResponse.body.data.conversationId;

      // Send message
      const messageResponse = await request(app)
        .post('/api/chat/message')
        .send({
          conversationId,
          content: 'Hello, how are you?',
        });

      expect(messageResponse.status).toBe(200);
      expect(messageResponse.body).toHaveProperty('success', true);
      expect(messageResponse.body.data).toHaveProperty('message');
      expect(messageResponse.body.data).toHaveProperty('aiResponse');
    });

    it('should handle message limits for free users', async () => {
      // This would require mocking subscription status
      // Implementation depends on subscription middleware
    });
  });

  describe('GET /api/chat/conversation/:conversationId', () => {
    it('should retrieve conversation history', async () => {
      // Start conversation and send messages first
      const startResponse = await request(app)
        .post('/api/chat/start')
        .send({
          creatorId: 'test-creator-id',
        });

      const conversationId = startResponse.body.data.conversationId;

      // Get conversation
      const getResponse = await request(app)
        .get(`/api/chat/conversation/${conversationId}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body).toHaveProperty('success', true);
      expect(getResponse.body.data).toHaveProperty('messages');
      expect(Array.isArray(getResponse.body.data.messages)).toBe(true);
    });
  });
});



