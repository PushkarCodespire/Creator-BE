// ===========================================
// CHAT CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn(), update: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn(), update: jest.fn(), count: jest.fn() },
    subscription: { findUnique: jest.fn(), update: jest.fn() },
    report: { create: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../config', () => ({
  config: {
    openai: { model: 'gpt-4' },
    subscription: { tokensPerMessage: 800, premiumPrice: 79900, creatorShare: 0.86, tokenGrant: 1000000 },
    rateLimit: { freeMessagesPerDay: 5, guestMessagesTotal: 10 }
  }
}));

jest.mock('../../../utils/openai', () => ({
  generateEmbedding: jest.fn(),
  generateCreatorResponse: jest.fn().mockResolvedValue({ content: 'AI response', tokensUsed: 100 }),
  isOpenAIConfigured: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/vectorStore', () => ({
  searchSimilar: jest.fn(),
  hybridSearch: jest.fn()
}));

jest.mock('../../../utils/contextBuilder', () => ({
  buildEnhancedContext: jest.fn()
}));

jest.mock('../../../sockets', () => ({
  emitToConversation: jest.fn(),
  emitToUser: jest.fn()
}));

jest.mock('../../../utils/profanityFilter', () => ({
  getToxicityScore: jest.fn().mockReturnValue(0),
  getFlaggedWords: jest.fn().mockReturnValue([]),
  shouldAutoFlag: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/earnings', () => ({
  distributeEarnings: jest.fn()
}));

jest.mock('../../../services/moderation/moderation-actions.service', () => ({
  __esModule: true,
  default: {
    createAIReport: jest.fn(),
    logModerationAction: jest.fn()
  }
}));

jest.mock('../../../services/media/media-processor.service', () => ({
  buildAttachmentContext: jest.fn().mockResolvedValue({ combined: '' })
}));

jest.mock('../../../services/notification.service', () => ({
  createAndEmit: jest.fn().mockResolvedValue({})
}));

jest.mock('../../../utils/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisConfigured: jest.fn().mockReturnValue(false),
  isRedisConnected: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(), logDebug: jest.fn(), logWarning: jest.fn()
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  startConversation,
  getConversation,
  getUserConversations,
  editMessage,
  deleteMessage
} from '../../../controllers/chat.controller';

const mockReq = (overrides = {}) =>
  ({
    body: {}, params: {}, query: {},
    user: { id: 'user-1', role: 'USER' },
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: jest.fn() },
    ...overrides
  } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Chat Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('startConversation', () => {
    it('should start or get conversation', async () => {
      const req = mockReq({ body: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'cr-1', displayName: 'Creator', welcomeMessage: null, isActive: true, allowNewConversations: true
      });
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
        id: 'conv-1', messages: []
      });

      await startConversation(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when creatorId missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(startConversation(req, res)).rejects.toThrow('Creator ID is required');
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ body: { creatorId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(startConversation(req, res)).rejects.toThrow('Creator not found or inactive');
    });

    it('should throw 404 when creator is inactive', async () => {
      const req = mockReq({ body: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'cr-1', isActive: false
      });

      await expect(startConversation(req, res)).rejects.toThrow('Creator not found or inactive');
    });

    it('should throw 403 when creator not accepting new conversations', async () => {
      const req = mockReq({ body: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'cr-1', isActive: true, allowNewConversations: false
      });
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(startConversation(req, res)).rejects.toThrow('not accepting new conversations');
    });
  });

  describe('getConversation', () => {
    it('should return conversation', async () => {
      const req = mockReq({ params: { conversationId: 'conv-1' } });
      const res = mockRes();

      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1', userId: 'user-1', creator: {}, messages: []
      });

      await getConversation(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when conversation not found', async () => {
      const req = mockReq({ params: { conversationId: 'bad' } });
      const res = mockRes();

      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getConversation(req, res)).rejects.toThrow('Conversation not found');
    });

    it('should throw 403 when user not owner', async () => {
      const req = mockReq({ params: { conversationId: 'conv-1' } });
      const res = mockRes();

      (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'conv-1', userId: 'other-user', creator: {}, messages: []
      });

      await expect(getConversation(req, res)).rejects.toThrow('Unauthorized');
    });
  });

  describe('getUserConversations', () => {
    it('should return paginated conversations', async () => {
      const req = mockReq({ query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.conversation.count as jest.Mock).mockResolvedValue(0);

      await getUserConversations(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('editMessage', () => {
    it('should edit own message', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { content: 'updated' }, app: { get: jest.fn() } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', role: 'USER', userId: 'user-1', conversationId: 'conv-1', conversation: {}
      });
      (prisma.message.update as jest.Mock).mockResolvedValue({ id: 'msg-1', content: 'updated' });

      await editMessage(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when content is empty', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { content: '' } });
      const res = mockRes();

      await expect(editMessage(req, res)).rejects.toThrow('Message content is required');
    });

    it('should throw 400 when content too long', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { content: 'x'.repeat(2001) } });
      const res = mockRes();

      await expect(editMessage(req, res)).rejects.toThrow('less than 2000 characters');
    });

    it('should throw 404 when message not found', async () => {
      const req = mockReq({ params: { messageId: 'bad' }, body: { content: 'hi' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(editMessage(req, res)).rejects.toThrow('Message not found');
    });

    it('should throw 403 when editing other user message', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { content: 'hi' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', role: 'USER', userId: 'other-user', conversation: {}
      });

      await expect(editMessage(req, res)).rejects.toThrow('Unauthorized');
    });
  });

  describe('deleteMessage', () => {
    it('should delete own message', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, app: { get: jest.fn() } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', role: 'USER', userId: 'user-1', conversationId: 'conv-1', conversation: {}
      });
      (prisma.message.delete as jest.Mock).mockResolvedValue({});

      await deleteMessage(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when message not found', async () => {
      const req = mockReq({ params: { messageId: 'bad' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteMessage(req, res)).rejects.toThrow('Message not found');
    });

    it('should throw 403 when deleting other user message', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', role: 'USER', userId: 'other-user', conversation: {}
      });

      await expect(deleteMessage(req, res)).rejects.toThrow('Unauthorized');
    });
  });
});
