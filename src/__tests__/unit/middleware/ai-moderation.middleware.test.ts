// ===========================================
// AI MODERATION MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';

const mockModerateContent = jest.fn();

jest.mock('../../../services/moderation/ai-moderation.service', () => ({
  __esModule: true,
  default: {
    moderateContent: (...args: any[]) => mockModerateContent(...args)
  }
}));
jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() }
  }
}));
jest.mock('../../../config', () => ({
  config: {
    aiModeration: {
      enabled: true,
      failOpen: true
    }
  }
}));
jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

import { autoModerateContent, checkUserModeration } from '../../../middleware/ai-moderation.middleware';
import prisma from '../../../../prisma/client';
import { config } from '../../../config';
import { sendError } from '../../../utils/apiResponse';

const createMockReq = (overrides: Partial<Request> = {}): Request => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  ...overrides
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('AI Moderation Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset config state for each test
    (config as any).aiModeration.enabled = true;
    (config as any).aiModeration.failOpen = true;
    (sendError as jest.Mock).mockImplementation((res: any, status: number, code: string, message: string, details?: any) => {
      res.status(status);
      res.json({ success: false, error: { code, message, details } });
      return res;
    });
  });

  // ===========================================
  // autoModerateContent
  // ===========================================
  describe('autoModerateContent', () => {
    it('should call next when no content in body', async () => {
      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockModerateContent).not.toHaveBeenCalled();
    });

    it('should call next when moderation is disabled', async () => {
      (config as any).aiModeration.enabled = false;

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Hello world' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockModerateContent).not.toHaveBeenCalled();
    });

    it('should allow safe content and call next', async () => {
      mockModerateContent.mockResolvedValue({
        shouldBlock: false,
        shouldFlag: false,
        reason: null,
        severity: 'LOW',
        violatedCategories: []
      });

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Safe message' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(mockModerateContent).toHaveBeenCalledWith('Safe message', 'MESSAGE');
      expect((req as any).moderationResult).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should block content that violates guidelines', async () => {
      mockModerateContent.mockResolvedValue({
        shouldBlock: true,
        shouldFlag: true,
        reason: 'Hate speech detected',
        severity: 'HIGH',
        violatedCategories: ['HATE']
      });

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Harmful content' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(sendError).toHaveBeenCalledWith(
        res,
        403,
        'CONTENT_BLOCKED',
        'Your content violates our community guidelines',
        expect.objectContaining({
          reason: 'Hate speech detected',
          severity: 'HIGH',
          categories: ['HATE']
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should flag content and still call next', async () => {
      mockModerateContent.mockResolvedValue({
        shouldBlock: false,
        shouldFlag: true,
        reason: 'Borderline content',
        severity: 'MEDIUM',
        violatedCategories: ['MILD']
      });

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Borderline message' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should use custom content field name', async () => {
      mockModerateContent.mockResolvedValue({
        shouldBlock: false,
        shouldFlag: false,
        reason: null,
        severity: 'LOW',
        violatedCategories: []
      });

      const middleware = autoModerateContent('message', 'CHAT');
      const req = createMockReq({ body: { message: 'Custom field content' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(mockModerateContent).toHaveBeenCalledWith('Custom field content', 'CHAT');
    });

    it('should fail open when moderation service errors (failOpen=true)', async () => {
      (config as any).aiModeration.failOpen = true;
      mockModerateContent.mockRejectedValue(new Error('Service unavailable'));

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Some content' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 503 when moderation service errors (failOpen=false)', async () => {
      (config as any).aiModeration.failOpen = false;
      mockModerateContent.mockRejectedValue(new Error('Service unavailable'));

      const middleware = autoModerateContent('content', 'MESSAGE');
      const req = createMockReq({ body: { content: 'Some content' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(sendError).toHaveBeenCalledWith(
        res,
        503,
        'MODERATION_UNAVAILABLE',
        'AI moderation service is temporarily unavailable'
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should use default content field and type', async () => {
      mockModerateContent.mockResolvedValue({
        shouldBlock: false,
        shouldFlag: false,
        reason: null,
        severity: 'LOW',
        violatedCategories: []
      });

      const middleware = autoModerateContent();
      const req = createMockReq({ body: { content: 'Default field' } });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(mockModerateContent).toHaveBeenCalledWith('Default field', 'MESSAGE');
    });
  });

  // ===========================================
  // checkUserModeration
  // ===========================================
  describe('checkUserModeration', () => {
    it('should call next when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await checkUserModeration(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should call next for non-banned, non-suspended user', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1', isBanned: false, isSuspended: false };
      const res = createMockRes();
      const next = jest.fn();

      await checkUserModeration(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 403 for banned user', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1', isBanned: true, isSuspended: false };
      const res = createMockRes();
      const next = jest.fn();

      await checkUserModeration(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'USER_BANNED', 'Your account has been permanently banned');
    });

    it('should return 403 for suspended user within suspension period', async () => {
      const futureDate = new Date(Date.now() + 86400000); // 24h from now
      const req = createMockReq();
      (req as any).user = {
        id: 'user-1',
        isBanned: false,
        isSuspended: true,
        suspendedUntil: futureDate.toISOString()
      };
      const res = createMockRes();
      const next = jest.fn();

      await checkUserModeration(req, res, next);

      expect(sendError).toHaveBeenCalledWith(
        res,
        403,
        'USER_SUSPENDED',
        expect.stringContaining('Your account is suspended'),
        expect.any(Object)
      );
    });

    it('should allow previously suspended user past suspension date', async () => {
      const pastDate = new Date(Date.now() - 86400000); // 24h ago
      const req = createMockReq();
      (req as any).user = {
        id: 'user-1',
        isBanned: false,
        isSuspended: true,
        suspendedUntil: pastDate.toISOString()
      };
      const res = createMockRes();
      const next = jest.fn();

      await checkUserModeration(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should fetch user from DB when moderation fields are missing', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' }; // isBanned/isSuspended undefined
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        isBanned: false,
        isSuspended: false,
        suspendedUntil: null
      });

      await checkUserModeration(req, res, next);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({ isBanned: true, isSuspended: true })
      });
      expect(next).toHaveBeenCalled();
    });

    it('should call next when user not found in DB', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'nonexistent' };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await checkUserModeration(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should call next on error (fail-open)', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

      await checkUserModeration(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
