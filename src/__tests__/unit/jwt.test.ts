// ===========================================
// JWT UNIT TESTS
// ===========================================

const mockRedisGet = jest.fn();
const mockRedisSetEx = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisHSet = jest.fn();
const mockRedisHGetAll = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisSAdd = jest.fn();
const mockRedisSRem = jest.fn();
const mockRedisSMembers = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisLPush = jest.fn();
const mockRedisLTrim = jest.fn();
const mockRedisQuit = jest.fn();

jest.mock('../../utils/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisConnected: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarning: jest.fn(),
  logDebug: jest.fn(),
}));

import jwt from 'jsonwebtoken';
import * as redisModule from '../../utils/redis';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
  storeRefreshToken,
  isValidRefreshToken,
  revokeRefreshToken,
  validatePassword,
  hashPassword,
  comparePassword,
  generateDeviceId,
  generateSessionId,
  createSession,
  validateSession,
  destroySession,
  getUserActiveSessions,
  terminateAllUserSessions,
} from '../../utils/jwt';

const mockRedisClient = {
  get: mockRedisGet,
  setEx: mockRedisSetEx,
  del: mockRedisDel,
  hSet: mockRedisHSet,
  hGetAll: mockRedisHGetAll,
  expire: mockRedisExpire,
  sAdd: mockRedisSAdd,
  sRem: mockRedisSRem,
  sMembers: mockRedisSMembers,
  incr: mockRedisIncr,
  lPush: mockRedisLPush,
  lTrim: mockRedisLTrim,
  quit: mockRedisQuit,
};

describe('JWT Utils - Unit Tests', () => {
  const testPayload = {
    userId: 'user-123',
    email: 'test@example.com',
    role: 'CREATOR',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (redisModule.getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
    (redisModule.isRedisConnected as jest.Mock).mockReturnValue(true);
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT access token', () => {
      const token = generateAccessToken(testPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should contain the correct payload', () => {
      const token = generateAccessToken(testPayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('CREATOR');
    });

    it('should have an expiration claim', () => {
      const token = generateAccessToken(testPayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.exp).toBeDefined();
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid JWT refresh token', () => {
      const token = generateRefreshToken(testPayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should contain the correct payload', () => {
      const token = generateRefreshToken(testPayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.userId).toBe('user-123');
    });

    it('should have a longer expiration than access token', () => {
      const accessToken = generateAccessToken(testPayload);
      const refreshToken = generateRefreshToken(testPayload);
      const accessDecoded = jwt.decode(accessToken) as any;
      const refreshDecoded = jwt.decode(refreshToken) as any;
      expect(refreshDecoded.exp).toBeGreaterThan(accessDecoded.exp);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken(testPayload);
      const result = verifyAccessToken(token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-123');
    });

    it('should return null for an invalid token', () => {
      const result = verifyAccessToken('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for an expired token', () => {
      const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev';
      const expiredToken = jwt.sign(testPayload, secret, { expiresIn: '0s' });
      const result = verifyAccessToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for a token signed with wrong secret', () => {
      const wrongToken = jwt.sign(testPayload, 'wrong-secret', { expiresIn: '15m' });
      const result = verifyAccessToken(wrongToken);
      expect(result).toBeNull();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const token = generateRefreshToken(testPayload);
      const result = verifyRefreshToken(token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-123');
    });

    it('should return null for an invalid token', () => {
      const result = verifyRefreshToken('invalid.token');
      expect(result).toBeNull();
    });

    it('should return null for a token signed with wrong secret', () => {
      const wrongToken = jwt.sign(testPayload, 'wrong-refresh-secret', { expiresIn: '7d' });
      const result = verifyRefreshToken(wrongToken);
      expect(result).toBeNull();
    });
  });

  describe('generateTokenPair', () => {
    it('should generate both access and refresh tokens', async () => {
      mockRedisSetEx.mockResolvedValue('OK');

      const result = await generateTokenPair('user-123', 'test@example.com', 'CREATOR');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should store refresh token in Redis', async () => {
      mockRedisSetEx.mockResolvedValue('OK');

      await generateTokenPair('user-123', 'test@example.com', 'CREATOR');

      expect(mockRedisSetEx).toHaveBeenCalledWith(
        'refresh_token:user-123',
        expect.any(Number),
        expect.any(String)
      );
    });
  });

  describe('storeRefreshToken', () => {
    it('should store token in Redis with expiration', async () => {
      mockRedisSetEx.mockResolvedValue('OK');

      await storeRefreshToken('user-123', 'token-value');

      expect(mockRedisSetEx).toHaveBeenCalledWith(
        'refresh_token:user-123',
        expect.any(Number),
        'token-value'
      );
    });
  });

  describe('isValidRefreshToken', () => {
    it('should return true if token matches stored token', async () => {
      mockRedisGet.mockResolvedValue('my-token');

      const result = await isValidRefreshToken('user-123', 'my-token');

      expect(result).toBe(true);
    });

    it('should return false if token does not match', async () => {
      mockRedisGet.mockResolvedValue('different-token');

      const result = await isValidRefreshToken('user-123', 'my-token');

      expect(result).toBe(false);
    });

    it('should return false if no stored token', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await isValidRefreshToken('user-123', 'my-token');

      expect(result).toBe(false);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should delete the refresh token from Redis', async () => {
      mockRedisDel.mockResolvedValue(1);

      await revokeRefreshToken('user-123');

      expect(mockRedisDel).toHaveBeenCalledWith('refresh_token:user-123');
    });
  });

  describe('validatePassword', () => {
    it('should accept a strong password', () => {
      const result = validatePassword('MyStr0ng!Pass');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject a password shorter than 8 characters', () => {
      const result = validatePassword('Ab1!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject a password without uppercase', () => {
      const result = validatePassword('nouppercas3!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject a password without a number', () => {
      const result = validatePassword('NoNumber!Here');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject a password without special character', () => {
      const result = validatePassword('NoSpecial123');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should reject common passwords', () => {
      const result = validatePassword('Password123!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password is too common');
    });

    it('should return multiple errors for very weak passwords', () => {
      const result = validatePassword('abc');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('hashPassword / comparePassword', () => {
    it('should hash and verify a password', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(await comparePassword(password, hash)).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('CorrectPassword123!');

      expect(await comparePassword('WrongPassword123!', hash)).toBe(false);
    });

    it('should produce different hashes for same password', async () => {
      const password = 'SamePassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateDeviceId / generateSessionId', () => {
    it('should generate a unique device ID (UUID format)', () => {
      const id = generateDeviceId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate a unique session ID (UUID format)', () => {
      const id = generateSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate different IDs on each call', () => {
      const id1 = generateDeviceId();
      const id2 = generateDeviceId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createSession', () => {
    it('should store session in Redis', async () => {
      mockRedisHSet.mockResolvedValue(1);
      mockRedisExpire.mockResolvedValue(true);
      mockRedisSAdd.mockResolvedValue(1);

      const futureDate = new Date(Date.now() + 86400000);
      await createSession({
        sessionId: 'sess-1',
        userId: 'user-1',
        deviceId: 'device-1',
        userAgent: 'Test Browser',
        ip: '127.0.0.1',
        createdAt: new Date(),
        expiresAt: futureDate,
        isActive: true,
      });

      expect(mockRedisHSet).toHaveBeenCalledWith(
        'session:sess-1',
        expect.objectContaining({ userId: 'user-1' })
      );
      expect(mockRedisSAdd).toHaveBeenCalledWith('user_sessions:user-1', 'sess-1');
    });
  });

  describe('validateSession', () => {
    it('should return session info for valid session', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockRedisHGetAll.mockResolvedValue({
        userId: 'user-1',
        deviceId: 'device-1',
        userAgent: 'Test',
        ip: '127.0.0.1',
        createdAt: new Date().toISOString(),
        expiresAt: futureDate.toISOString(),
        isActive: 'true',
      });

      const result = await validateSession('sess-1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.isActive).toBe(true);
    });

    it('should return null for empty session data', async () => {
      mockRedisHGetAll.mockResolvedValue({});

      const result = await validateSession('nonexistent');

      expect(result).toBeNull();
    });

    it('should destroy and return null for expired session', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      mockRedisHGetAll.mockResolvedValue({
        userId: 'user-1',
        deviceId: 'device-1',
        userAgent: 'Test',
        ip: '127.0.0.1',
        createdAt: new Date().toISOString(),
        expiresAt: pastDate.toISOString(),
        isActive: 'true',
      });
      mockRedisDel.mockResolvedValue(1);
      mockRedisSRem.mockResolvedValue(1);

      const result = await validateSession('sess-expired');

      expect(result).toBeNull();
    });

    it('should destroy and return null for inactive session', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockRedisHGetAll.mockResolvedValue({
        userId: 'user-1',
        deviceId: 'device-1',
        userAgent: 'Test',
        ip: '127.0.0.1',
        createdAt: new Date().toISOString(),
        expiresAt: futureDate.toISOString(),
        isActive: 'false',
      });
      mockRedisDel.mockResolvedValue(1);
      mockRedisSRem.mockResolvedValue(1);

      const result = await validateSession('sess-inactive');

      expect(result).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('should remove session and clean up user session set', async () => {
      mockRedisHGetAll.mockResolvedValue({ userId: 'user-1' });
      mockRedisSRem.mockResolvedValue(1);
      mockRedisDel.mockResolvedValue(1);

      await destroySession('sess-1');

      expect(mockRedisSRem).toHaveBeenCalledWith('user_sessions:user-1', 'sess-1');
      expect(mockRedisDel).toHaveBeenCalledWith('session:sess-1');
    });

    it('should do nothing if session does not exist', async () => {
      mockRedisHGetAll.mockResolvedValue({});

      await destroySession('nonexistent');

      expect(mockRedisSRem).not.toHaveBeenCalled();
    });
  });

  describe('getUserActiveSessions', () => {
    it('should return active sessions for a user', async () => {
      mockRedisSMembers.mockResolvedValue(['sess-1', 'sess-2']);
      const futureDate = new Date(Date.now() + 86400000);
      mockRedisHGetAll.mockResolvedValue({
        userId: 'user-1',
        deviceId: 'device-1',
        userAgent: 'Test',
        ip: '127.0.0.1',
        createdAt: new Date().toISOString(),
        expiresAt: futureDate.toISOString(),
        isActive: 'true',
      });

      const result = await getUserActiveSessions('user-1');

      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array if no sessions exist', async () => {
      mockRedisSMembers.mockResolvedValue([]);

      const result = await getUserActiveSessions('user-no-sessions');

      expect(result).toEqual([]);
    });
  });

  describe('terminateAllUserSessions', () => {
    it('should destroy all sessions and revoke refresh token', async () => {
      mockRedisSMembers.mockResolvedValue(['sess-1', 'sess-2']);
      mockRedisHGetAll.mockResolvedValue({ userId: 'user-1' });
      mockRedisSRem.mockResolvedValue(1);
      mockRedisDel.mockResolvedValue(1);

      await terminateAllUserSessions('user-1');

      expect(mockRedisDel).toHaveBeenCalledWith('user_sessions:user-1');
      expect(mockRedisDel).toHaveBeenCalledWith('refresh_token:user-1');
    });
  });
});
