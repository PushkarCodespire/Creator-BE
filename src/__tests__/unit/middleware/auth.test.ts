// ===========================================
// AUTH MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

// Mock dependencies before importing the module under test
jest.mock('jsonwebtoken');
jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() }
  }
}));
jest.mock('../../../config', () => ({
  config: {
    jwt: { secret: 'test-secret', expiresIn: '7d' }
  }
}));
jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

import { authenticate, optionalAuth, requireRole, requireAdmin, requireCreator, requireCompany, requireUser, generateToken } from '../../../middleware/auth';
import prisma from '../../../../prisma/client';
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
    json: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

const mockNext: NextFunction = jest.fn();

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: UserRole.CREATOR,
  creator: { id: 'creator-1' },
  company: null
};

describe('Auth Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sendError as jest.Mock).mockImplementation((res: any, status: number, code: string, message: string) => {
      res.status(status);
      res.json({ success: false, error: { code, message } });
      return res;
    });
  });

  // ===========================================
  // authenticate
  // ===========================================
  describe('authenticate', () => {
    it('should authenticate with valid Bearer token', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          creator: { select: { id: true } },
          company: { select: { id: true } }
        }
      });
      expect(req.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should authenticate from cookie when no Bearer header', async () => {
      const req = createMockReq({
        headers: { cookie: 'accessToken=cookie-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('cookie-token', 'test-secret');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 401 when no token is provided', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await authenticate(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'TOKEN_MISSING', 'No token provided');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid JWT', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer invalid-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await authenticate(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'TOKEN_INVALID', 'Invalid token');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for expired JWT', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer expired-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new jwt.TokenExpiredError('jwt expired', new Date());
      });

      await authenticate(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'TOKEN_INVALID', 'Invalid token');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not found in DB', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'nonexistent',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await authenticate(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'USER_NOT_FOUND', 'User not found');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should clear auth cookies on missing token', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await authenticate(req, res, mockNext);

      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('should clear auth cookies on invalid token', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer bad' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad token');
      });

      await authenticate(req, res, mockNext);

      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('should prefer Bearer token over cookies', async () => {
      const req = createMockReq({
        headers: {
          authorization: 'Bearer bearer-token',
          cookie: 'accessToken=cookie-token'
        } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('bearer-token', 'test-secret');
    });
  });

  // ===========================================
  // optionalAuth
  // ===========================================
  describe('optionalAuth', () => {
    it('should attach user when valid token is provided', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await optionalAuth(req, res, mockNext);

      expect(req.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user when no token is provided', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user when token is invalid', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer invalid' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user when user is not found', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'nonexistent',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  // ===========================================
  // requireRole
  // ===========================================
  describe('requireRole', () => {
    it('should allow user with matching role', () => {
      const req = createMockReq();
      req.user = { ...mockUser };
      const res = createMockRes();

      const middleware = requireRole(UserRole.CREATOR);
      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow user with any of the specified roles', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.ADMIN };
      const res = createMockRes();

      const middleware = requireRole(UserRole.CREATOR, UserRole.ADMIN);
      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny user without matching role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.USER };
      const res = createMockRes();

      const middleware = requireRole(UserRole.ADMIN);
      middleware(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
      const req = createMockReq();
      const res = createMockRes();

      const middleware = requireRole(UserRole.ADMIN);
      middleware(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'AUTH_REQUIRED', 'Authentication required');
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // Shorthand role checks
  // ===========================================
  describe('requireAdmin', () => {
    it('should allow ADMIN role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.ADMIN };
      const res = createMockRes();

      requireAdmin(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny non-ADMIN role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.CREATOR };
      const res = createMockRes();

      requireAdmin(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    });
  });

  describe('requireCreator', () => {
    it('should allow CREATOR role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.CREATOR };
      const res = createMockRes();

      requireCreator(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow ADMIN role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.ADMIN };
      const res = createMockRes();

      requireCreator(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny USER role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.USER };
      const res = createMockRes();

      requireCreator(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    });
  });

  describe('requireCompany', () => {
    it('should allow COMPANY role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.COMPANY };
      const res = createMockRes();

      requireCompany(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow ADMIN role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.ADMIN };
      const res = createMockRes();

      requireCompany(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny CREATOR role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.CREATOR };
      const res = createMockRes();

      requireCompany(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    });
  });

  describe('requireUser', () => {
    it('should allow USER role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.USER };
      const res = createMockRes();

      requireUser(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow ADMIN role', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.ADMIN };
      const res = createMockRes();

      requireUser(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  // ===========================================
  // generateToken
  // ===========================================
  describe('generateToken', () => {
    it('should call jwt.sign with correct payload', () => {
      (jwt.sign as jest.Mock).mockReturnValue('generated-token');

      const user = { id: 'user-1', email: 'test@example.com', role: UserRole.CREATOR };
      const token = generateToken(user);

      expect(jwt.sign).toHaveBeenCalledWith(
        { userId: 'user-1', email: 'test@example.com', role: UserRole.CREATOR },
        'test-secret',
        expect.objectContaining({ expiresIn: '7d' })
      );
      expect(token).toBe('generated-token');
    });
  });

  // ===========================================
  // authenticate — additional cookie branches
  // ===========================================
  describe('authenticate — cookie fallback variations', () => {
    it('should read token from "token" cookie name', async () => {
      const req = createMockReq({
        headers: { cookie: 'token=my-token-value' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.USER
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('my-token-value', 'test-secret');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should read token from "authToken" cookie name', async () => {
      const req = createMockReq({
        headers: { cookie: 'authToken=auth-tok' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.USER
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('auth-tok', 'test-secret');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle cookie with = sign in token value', async () => {
      const req = createMockReq({
        headers: { cookie: 'accessToken=base64==; other=val' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.USER
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await authenticate(req, res, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('base64==', 'test-secret');
    });

    it('should return 401 TOKEN_MISSING when Bearer prefix has empty token', async () => {
      // 'Bearer '.split(' ')[1] === '' which is falsy — treated as no token
      const req = createMockReq({
        headers: { authorization: 'Bearer ' } as any
      });
      const res = createMockRes();

      await authenticate(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'TOKEN_MISSING', 'No token provided');
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // optionalAuth — additional branches
  // ===========================================
  describe('optionalAuth — additional branches', () => {
    it('should read token from cookie in optionalAuth', async () => {
      const req = createMockReq({
        headers: { cookie: 'accessToken=optional-tok' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: UserRole.USER
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await optionalAuth(req, res, mockNext);

      expect(req.user).toEqual(mockUser);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should clear cookies and continue on optionalAuth token error', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer bad-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad');
      });

      await optionalAuth(req, res, mockNext);

      expect(res.clearCookie).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    it('should not attach user when db returns null in optionalAuth', async () => {
      const req = createMockReq({
        headers: { authorization: 'Bearer some-token' } as any
      });
      const res = createMockRes();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'ghost-id',
        email: 'ghost@example.com',
        role: UserRole.USER
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  // ===========================================
  // requireRole — edge cases
  // ===========================================
  describe('requireRole — additional edge cases', () => {
    it('should allow COMPANY role when COMPANY is listed', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.COMPANY };
      const res = createMockRes();

      const middleware = requireRole(UserRole.COMPANY, UserRole.ADMIN);
      middleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should deny USER role when only CREATOR and ADMIN are allowed', () => {
      const req = createMockReq();
      req.user = { ...mockUser, role: UserRole.USER };
      const res = createMockRes();

      const middleware = requireRole(UserRole.CREATOR, UserRole.ADMIN);
      middleware(req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    });
  });
});
