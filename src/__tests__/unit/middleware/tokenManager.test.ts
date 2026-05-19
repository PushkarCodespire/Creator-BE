// ===========================================
// TOKEN MANAGER MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

const mockGenerateTokenPair = jest.fn();
const mockVerifyRefreshToken = jest.fn();
const mockIsValidRefreshToken = jest.fn();
const mockRevokeRefreshToken = jest.fn();
const mockGenerateAccessToken = jest.fn();
const mockVerifyAccessToken = jest.fn();
const mockGenerateSessionId = jest.fn(() => 'mock-session-id');
const mockGenerateDeviceId = jest.fn(() => 'mock-device-id');
const mockCreateSession = jest.fn();
const mockValidateSession = jest.fn();
const mockDestroySession = jest.fn();
const mockGetUserActiveSessions = jest.fn();
const mockTerminateAllUserSessions = jest.fn();

jest.mock('../../../utils/jwt', () => ({
  generateTokenPair: (...args: any[]) => mockGenerateTokenPair(...args),
  verifyRefreshToken: (...args: any[]) => mockVerifyRefreshToken(...args),
  isValidRefreshToken: (...args: any[]) => mockIsValidRefreshToken(...args),
  revokeRefreshToken: (...args: any[]) => mockRevokeRefreshToken(...args),
  generateAccessToken: (...args: any[]) => mockGenerateAccessToken(...args),
  verifyAccessToken: (...args: any[]) => mockVerifyAccessToken(...args),
  generateSessionId: (...args: any[]) => mockGenerateSessionId(...args),
  generateDeviceId: (...args: any[]) => mockGenerateDeviceId(...args),
  createSession: (...args: any[]) => mockCreateSession(...args),
  validateSession: (...args: any[]) => mockValidateSession(...args),
  destroySession: (...args: any[]) => mockDestroySession(...args),
  getUserActiveSessions: (...args: any[]) => mockGetUserActiveSessions(...args),
  terminateAllUserSessions: (...args: any[]) => mockTerminateAllUserSessions(...args),
  validatePassword: jest.fn(() => ({ isValid: true, errors: [] }))
}));

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() }
  }
}));

import {
  setAuthTokens,
  refreshToken,
  logout,
  logoutAll,
  sessionManager,
  getUserSessions,
  revokeSession,
  secureTokenTransmission,
  validateTokenWithRateLimit,
  deviceFingerprint,
  runTokenCleanupJob
} from '../../../middleware/tokenManager';
import prisma from '../../../../prisma/client';

const createMockReq = (overrides: Partial<Request> = {}): Request => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  cookies: {},
  ip: '127.0.0.1',
  secure: false,
  header: jest.fn(),
  ...overrides
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('Token Manager Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateSessionId.mockReturnValue('mock-session-id');
    mockGenerateDeviceId.mockReturnValue('mock-device-id');
  });

  // ===========================================
  // setAuthTokens
  // ===========================================
  describe('setAuthTokens', () => {
    it('should generate token pair and set refresh cookie', async () => {
      const res = createMockRes();
      mockGenerateTokenPair.mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456'
      });

      const accessToken = await setAuthTokens(res, 'user-1', 'test@example.com', 'CREATOR');

      expect(mockGenerateTokenPair).toHaveBeenCalledWith('user-1', 'test@example.com', 'CREATOR');
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh-456',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/api/auth/refresh'
        })
      );
      expect(accessToken).toBe('access-123');
    });
  });

  // ===========================================
  // refreshToken
  // ===========================================
  describe('refreshToken', () => {
    it('should return 401 when no refresh token in cookies', async () => {
      const req = createMockReq({ cookies: {} });
      const res = createMockRes();

      await refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Refresh token not provided' }));
    });

    it('should return 401 when refresh token is invalid', async () => {
      const req = createMockReq({ cookies: { refreshToken: 'invalid' } });
      const res = createMockRes();

      mockVerifyRefreshToken.mockReturnValue(null);

      await refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid refresh token' }));
    });

    it('should return 401 when refresh token is revoked in Redis', async () => {
      const req = createMockReq({ cookies: { refreshToken: 'revoked-token' } });
      const res = createMockRes();

      mockVerifyRefreshToken.mockReturnValue({ userId: 'user-1' });
      mockIsValidRefreshToken.mockResolvedValue(false);

      await refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Refresh token revoked or expired' }));
    });

    it('should return 401 when user not found', async () => {
      const req = createMockReq({ cookies: { refreshToken: 'valid-token' } });
      const res = createMockRes();

      mockVerifyRefreshToken.mockReturnValue({ userId: 'user-1' });
      mockIsValidRefreshToken.mockResolvedValue(true);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await refreshToken(req, res);

      expect(mockRevokeRefreshToken).toHaveBeenCalledWith('user-1');
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return new access token on successful refresh', async () => {
      const req = createMockReq({ cookies: { refreshToken: 'valid-token' } });
      const res = createMockRes();

      mockVerifyRefreshToken.mockReturnValue({ userId: 'user-1' });
      mockIsValidRefreshToken.mockResolvedValue(true);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        role: UserRole.CREATOR
      });
      mockGenerateTokenPair.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh'
      });

      await refreshToken(req, res);

      expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'new-refresh', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-access',
          user: expect.objectContaining({ id: 'user-1' })
        })
      );
    });

    it('should return 500 on unexpected error', async () => {
      const req = createMockReq({ cookies: { refreshToken: 'valid-token' } });
      const res = createMockRes();

      mockVerifyRefreshToken.mockImplementation(() => { throw new Error('unexpected'); });

      await refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // logout
  // ===========================================
  describe('logout', () => {
    it('should revoke token and clear cookie', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      (req as any).sessionId = 'session-1';
      const res = createMockRes();

      await logout(req, res);

      expect(mockRevokeRefreshToken).toHaveBeenCalledWith('user-1');
      expect(mockDestroySession).toHaveBeenCalledWith('session-1');
      expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
    });

    it('should handle logout when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await logout(req, res);

      expect(mockRevokeRefreshToken).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
    });

    it('should handle logout without sessionId', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      await logout(req, res);

      expect(mockRevokeRefreshToken).toHaveBeenCalledWith('user-1');
      expect(mockDestroySession).not.toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockRevokeRefreshToken.mockRejectedValue(new Error('Redis error'));

      await logout(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // logoutAll
  // ===========================================
  describe('logoutAll', () => {
    it('should terminate all sessions and clear cookie', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      await logoutAll(req, res);

      expect(mockTerminateAllUserSessions).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out from all devices successfully' });
    });

    it('should handle logoutAll when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await logoutAll(req, res);

      expect(mockTerminateAllUserSessions).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out from all devices successfully' });
    });

    it('should return 500 on error', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockTerminateAllUserSessions.mockRejectedValue(new Error('Redis error'));

      await logoutAll(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // sessionManager
  // ===========================================
  describe('sessionManager', () => {
    it('should create session for authenticated user', async () => {
      const req = createMockReq({
        headers: { 'device-id': 'dev-1', 'user-agent': 'Mozilla' } as any,
        ip: '10.0.0.1'
      });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      await sessionManager(req, res, next);

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'mock-session-id',
          userId: 'user-1',
          deviceId: 'dev-1'
        })
      );
      expect((req as any).sessionId).toBe('mock-session-id');
      expect(next).toHaveBeenCalled();
    });

    it('should generate device ID when not provided', async () => {
      const req = createMockReq({
        headers: { 'user-agent': 'Mozilla' } as any,
        ip: '10.0.0.1'
      });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      await sessionManager(req, res, next);

      expect(mockGenerateDeviceId).toHaveBeenCalled();
    });

    it('should skip session creation for unauthenticated user', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await sessionManager(req, res, next);

      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should call next with error on failure', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      mockCreateSession.mockRejectedValue(new Error('Redis error'));

      await sessionManager(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ===========================================
  // getUserSessions
  // ===========================================
  describe('getUserSessions', () => {
    it('should return user sessions', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockGetUserActiveSessions.mockResolvedValue([
        { sessionId: 's1', userId: 'user-1', deviceId: 'd1' }
      ]);

      await getUserSessions(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          sessions: expect.any(Array),
          count: 1
        })
      );
    });

    it('should return 401 when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();

      await getUserSessions(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 500 on error', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockGetUserActiveSessions.mockRejectedValue(new Error('fail'));

      await getUserSessions(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // revokeSession
  // ===========================================
  describe('revokeSession', () => {
    it('should revoke session belonging to user', async () => {
      const req = createMockReq({ body: { sessionId: 'session-1' } });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockValidateSession.mockResolvedValue({ sessionId: 'session-1', userId: 'user-1' });

      await revokeSession(req, res);

      expect(mockDestroySession).toHaveBeenCalledWith('session-1');
      expect(res.json).toHaveBeenCalledWith({ message: 'Session revoked successfully' });
    });

    it('should return 401 when no user', async () => {
      const req = createMockReq({ body: { sessionId: 'session-1' } });
      const res = createMockRes();

      await revokeSession(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 when session belongs to another user', async () => {
      const req = createMockReq({ body: { sessionId: 'session-1' } });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockValidateSession.mockResolvedValue({ sessionId: 'session-1', userId: 'other-user' });

      await revokeSession(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when session does not exist', async () => {
      const req = createMockReq({ body: { sessionId: 'nonexistent' } });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockValidateSession.mockResolvedValue(null);

      await revokeSession(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 500 on error', async () => {
      const req = createMockReq({ body: { sessionId: 's1' } });
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();

      mockValidateSession.mockRejectedValue(new Error('fail'));

      await revokeSession(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ===========================================
  // secureTokenTransmission
  // ===========================================
  describe('secureTokenTransmission', () => {
    it('should set security headers and call next', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      secureTokenTransmission(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(next).toHaveBeenCalled();
    });

    it('should return 400 in production without HTTPS', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headerFn = jest.fn().mockReturnValue(undefined);
      const req = createMockReq({ secure: false, header: headerFn } as any);
      const res = createMockRes();
      const next = jest.fn();

      secureTokenTransmission(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it('should allow in production with x-forwarded-proto https', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headerFn = jest.fn((name: string) => name === 'x-forwarded-proto' ? 'https' : undefined);
      const req = createMockReq({ secure: false, header: headerFn } as any);
      const res = createMockRes();
      const next = jest.fn();

      secureTokenTransmission(req, res, next);

      expect(next).toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ===========================================
  // validateTokenWithRateLimit
  // ===========================================
  describe('validateTokenWithRateLimit', () => {
    it('should call next', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      validateTokenWithRateLimit(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // deviceFingerprint
  // ===========================================
  describe('deviceFingerprint', () => {
    it('should set device-fingerprint header', () => {
      const req = createMockReq({
        headers: {
          'user-agent': 'Mozilla/5.0',
          'accept-language': 'en-US',
          'accept-encoding': 'gzip',
          accept: 'text/html'
        } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      deviceFingerprint(req, res, next);

      expect(req.headers['device-fingerprint']).toBeDefined();
      expect(req.headers['device-fingerprint']).toContain('Mozilla/5.0');
      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // runTokenCleanupJob
  // ===========================================
  describe('runTokenCleanupJob', () => {
    it('should run without error', async () => {
      await expect(runTokenCleanupJob()).resolves.toBeUndefined();
    });
  });
});
