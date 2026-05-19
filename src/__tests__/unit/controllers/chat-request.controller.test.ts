// ===========================================
// CHAT REQUEST CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    conversation: { findUnique: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), count: jest.fn() },
    subscription: { findUnique: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/queue/chat-queue', () => ({
  chatQueue: { add: jest.fn().mockResolvedValue({}) },
  isChatQueueEnabled: false
}));

jest.mock('../../../controllers/chat.controller', () => ({
  sendMessage: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(), logError: jest.fn()
}));

jest.mock('../../../config', () => ({
  config: {
    rateLimit: { freeMessagesPerDay: 5, guestMessagesTotal: 10 },
    subscription: { tokensPerMessage: 800 }
  }
}));

import { Request, Response, NextFunction } from 'express';
import prisma from '../../../../prisma/client';
import {
  sendMessageEnhanced,
  getRateLimitStatus
} from '../../../controllers/chat/chat-request.controller';

const mockReq = (overrides = {}) =>
  ({
    body: {}, params: {}, query: {},
    user: { id: 'user-1', role: 'USER' },
    headers: {},
    ...overrides
  } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn() as NextFunction;

describe('Chat Request Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('sendMessageEnhanced', () => {
    it('should fall back to legacy handler when queue disabled', async () => {
      const { sendMessage: legacySend } = require('../../../controllers/chat.controller');
      const req = mockReq({ body: { conversationId: 'conv-1', content: 'Hello' } });
      const res = mockRes();

      await sendMessageEnhanced(req, res, mockNext);
      expect(legacySend).toHaveBeenCalledWith(req, res, mockNext);
    });

    it('should throw 400 when content and media are missing', async () => {
      // Override isChatQueueEnabled for this test
      jest.resetModules();
      jest.doMock('../../../services/queue/chat-queue', () => ({
        chatQueue: { add: jest.fn() },
        isChatQueueEnabled: true
      }));

      // Re-import to get new mock
      const { sendMessageEnhanced: send } = require('../../../controllers/chat/chat-request.controller');

      const req = mockReq({ body: { conversationId: 'conv-1' } });
      const res = mockRes();

      await expect(send(req, res, mockNext)).rejects.toThrow('Message content or media is required');
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return rate limit for authenticated user', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.subscription.findUnique as jest.Mock)
        .mockResolvedValueOnce({ plan: 'FREE', messagesUsedToday: 3 })
        .mockResolvedValueOnce({ tokenBalance: 0, tokenGrant: 0 });

      await getRateLimitStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when no user or guest id', async () => {
      const req = mockReq({ user: undefined, headers: {} });
      const res = mockRes();

      await expect(getRateLimitStatus(req, res)).rejects.toThrow('Unauthorized');
    });
  });
});

// ===========================================
// EXTENDED COVERAGE — additional branches
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    conversation: { findUnique: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), count: jest.fn() },
    subscription: { findUnique: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/queue/chat-queue', () => ({
  chatQueue: { add: jest.fn().mockResolvedValue({}) },
  isChatQueueEnabled: false
}));

jest.mock('../../../controllers/chat.controller', () => ({
  sendMessage: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(), logError: jest.fn()
}));

jest.mock('../../../config', () => ({
  config: {
    rateLimit: { freeMessagesPerDay: 5, guestMessagesTotal: 10 },
    subscription: { tokensPerMessage: 800 }
  }
}));

const makeReq2 = (o: any = {}) => ({
  body: {}, params: {}, query: {},
  headers: { authorization: 'Bearer t' },
  user: { id: 'u1', role: 'USER', email: 'e@e.com' },
  ip: '127.0.0.1',
  cookies: {},
  ...o
});
const makeRes2 = () => {
  const r: any = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  r.send = jest.fn(() => r);
  return r;
};

describe('getRateLimitStatus — extended', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: jest.fn().mockResolvedValue({}) },
      isChatQueueEnabled: false
    }));
    jest.doMock('../../../config', () => ({
      config: {
        rateLimit: { freeMessagesPerDay: 5, guestMessagesTotal: 10 },
        subscription: { tokensPerMessage: 800 }
      }
    }));
  });

  it('returns PREMIUM limit when subscription plan is PREMIUM', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce({ plan: 'PREMIUM', messagesUsedToday: 0 })
      .mockResolvedValueOnce({ tokenBalance: 5000, tokenGrant: 10000 });

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({ user: { id: 'u1', role: 'USER' } }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.data.limits.daily.limit).toBe(1000);
    expect(response.data.tokens.balance).toBe(5000);
  });

  it('returns FREE limit when subscription plan is FREE', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce({ plan: 'FREE', messagesUsedToday: 2 })
      .mockResolvedValueOnce({ tokenBalance: 0, tokenGrant: 0 });

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({ user: { id: 'u1', role: 'USER' } }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.data.limits.daily.used).toBe(2);
    expect(response.data.limits.daily.remaining).toBe(3);
  });

  it('returns guest rate limit with message count from DB', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.message.count as jest.Mock).mockResolvedValue(4);

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({
      user: undefined,
      headers: { 'x-guest-id': 'guest-abc' }
    }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.data.limits.daily.used).toBe(4);
    expect(response.data.limits.daily.limit).toBe(10);
    expect(response.data.limits.daily.remaining).toBe(6);
  });

  it('clamps remaining to 0 when used exceeds limit', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.message.count as jest.Mock).mockResolvedValue(15);

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({
      user: undefined,
      headers: { 'x-guest-id': 'guest-xyz' }
    }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.data.limits.daily.remaining).toBe(0);
  });

  it('returns GUEST plan for guest user', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.message.count as jest.Mock).mockResolvedValue(0);

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({
      user: undefined,
      headers: { 'x-guest-id': 'guest-def' }
    }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.data.subscription.plan).toBe('GUEST');
  });

  it('handles null subscription for authenticated user (defaults FREE)', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({ user: { id: 'u2', role: 'USER' } }), res);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.data.subscription.plan).toBe('FREE');
    expect(response.data.tokens.balance).toBe(0);
  });

  it('returns resetAt as next midnight for authenticated user', async () => {
    const prismaMock = require('../../../../prisma/client').default;
    (prismaMock.subscription.findUnique as jest.Mock)
      .mockResolvedValueOnce({ plan: 'FREE', messagesUsedToday: 1 })
      .mockResolvedValueOnce({ tokenBalance: 100, tokenGrant: 200 });

    const { getRateLimitStatus: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(makeReq2({ user: { id: 'u1', role: 'USER' } }), res);

    const resetAt = (res.json as jest.Mock).mock.calls[0][0].data.limits.daily.resetAt;
    expect(resetAt).toBeInstanceOf(Date);
  });
});

describe('sendMessageEnhanced — queue enabled branches', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('throws 404 when conversation not found (queue enabled)', async () => {
    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: jest.fn().mockResolvedValue({}) },
      isChatQueueEnabled: true
    }));
    jest.doMock('../../../../prisma/client', () => ({
      __esModule: true,
      default: {
        conversation: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        message: { create: jest.fn(), count: jest.fn() },
        subscription: { findUnique: jest.fn() }
      }
    }));
    jest.doMock('../../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../middleware/errorHandler', () => {
      class AppError extends Error {
        statusCode: number;
        constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
      }
      return { AppError, asyncHandler: (fn: Function) => fn };
    });

    const { sendMessageEnhanced: fn } = require('../../../controllers/chat/chat-request.controller');
    await expect(
      fn(makeReq2({ body: { conversationId: 'bad', content: 'Hello' } }), makeRes2(), jest.fn())
    ).rejects.toThrow('Conversation not found');
  });

  it('creates user + assistant messages and queues job (queue enabled)', async () => {
    const mockConv = {
      id: 'conv1',
      creatorId: 'cr1',
      creator: { responseStyle: 'GPT-4' }
    };
    const mockUserMsg = { id: 'msg1' };
    const mockAssistantMsg = { id: 'msg2' };
    const conversationUpdate = jest.fn().mockResolvedValue({});
    const messageCreate = jest.fn()
      .mockResolvedValueOnce(mockUserMsg)
      .mockResolvedValueOnce(mockAssistantMsg);
    const chatQueueAdd = jest.fn().mockResolvedValue({});

    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: chatQueueAdd },
      isChatQueueEnabled: true
    }));
    jest.doMock('../../../../prisma/client', () => ({
      __esModule: true,
      default: {
        conversation: { findUnique: jest.fn().mockResolvedValue(mockConv), update: conversationUpdate },
        message: { create: messageCreate, count: jest.fn() },
        subscription: { findUnique: jest.fn() }
      }
    }));
    jest.doMock('../../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../middleware/errorHandler', () => {
      class AppError extends Error {
        statusCode: number;
        constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
      }
      return { AppError, asyncHandler: (fn: Function) => fn };
    });

    const { sendMessageEnhanced: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(
      makeReq2({ body: { conversationId: 'conv1', content: 'Hello', media: [] } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ assistantMessageId: 'msg2' })
    }));
  });

  it('throws 503 when chat queue add times out', async () => {
    const mockConv = {
      id: 'conv1',
      creatorId: 'cr1',
      creator: { responseStyle: null }
    };
    const messageCreate = jest.fn()
      .mockResolvedValueOnce({ id: 'msg1' })
      .mockResolvedValueOnce({ id: 'msg2' });

    // Simulate a queue that never resolves
    const chatQueueAdd = jest.fn().mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: chatQueueAdd },
      isChatQueueEnabled: true
    }));
    jest.doMock('../../../../prisma/client', () => ({
      __esModule: true,
      default: {
        conversation: { findUnique: jest.fn().mockResolvedValue(mockConv), update: jest.fn() },
        message: { create: messageCreate, count: jest.fn() },
        subscription: { findUnique: jest.fn() }
      }
    }));
    jest.doMock('../../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../middleware/errorHandler', () => {
      class AppError extends Error {
        statusCode: number;
        constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
      }
      return { AppError, asyncHandler: (fn: Function) => fn };
    });

    const { sendMessageEnhanced: fn } = require('../../../controllers/chat/chat-request.controller');
    await expect(
      fn(makeReq2({ body: { conversationId: 'conv1', content: 'Hi' } }), makeRes2(), jest.fn())
    ).rejects.toThrow('Chat queue unavailable');
  }, 10000);

  it('throws 400 when content empty and media empty (queue enabled)', async () => {
    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: jest.fn() },
      isChatQueueEnabled: true
    }));
    jest.doMock('../../../../prisma/client', () => ({
      __esModule: true,
      default: {
        conversation: { findUnique: jest.fn(), update: jest.fn() },
        message: { create: jest.fn(), count: jest.fn() },
        subscription: { findUnique: jest.fn() }
      }
    }));
    jest.doMock('../../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../middleware/errorHandler', () => {
      class AppError extends Error {
        statusCode: number;
        constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
      }
      return { AppError, asyncHandler: (fn: Function) => fn };
    });

    const { sendMessageEnhanced: fn } = require('../../../controllers/chat/chat-request.controller');
    await expect(
      fn(makeReq2({ body: { conversationId: 'conv1', media: [] } }), makeRes2(), jest.fn())
    ).rejects.toThrow('Message content or media is required');
  });

  it('accepts media-only message (no content) when queue enabled', async () => {
    const mockConv = { id: 'conv1', creatorId: 'cr1', creator: { responseStyle: 'GPT-4' } };
    const messageCreate = jest.fn()
      .mockResolvedValueOnce({ id: 'msg1' })
      .mockResolvedValueOnce({ id: 'msg2' });

    jest.doMock('../../../services/queue/chat-queue', () => ({
      chatQueue: { add: jest.fn().mockResolvedValue({}) },
      isChatQueueEnabled: true
    }));
    jest.doMock('../../../../prisma/client', () => ({
      __esModule: true,
      default: {
        conversation: { findUnique: jest.fn().mockResolvedValue(mockConv), update: jest.fn() },
        message: { create: messageCreate },
        subscription: { findUnique: jest.fn() }
      }
    }));
    jest.doMock('../../../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../middleware/errorHandler', () => {
      class AppError extends Error {
        statusCode: number;
        constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
      }
      return { AppError, asyncHandler: (fn: Function) => fn };
    });

    const { sendMessageEnhanced: fn } = require('../../../controllers/chat/chat-request.controller');
    const res = makeRes2();
    await fn(
      makeReq2({ body: { conversationId: 'conv1', media: ['img1.jpg'] } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
