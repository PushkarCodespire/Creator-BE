// ===========================================
// JWT AUTHENTICATION UTILITIES
// ===========================================
// Handles JWT token generation, validation, and refresh

import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getRedisClient, isRedisConnected } from './redis';
import { logError } from './logger';

export interface JWTPayload extends JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  deviceId: string;
  userAgent: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(payload: Omit<JWTPayload, 'exp'>): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev';
  const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m'; // 15 minutes
  
  const options: SignOptions = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { expiresIn: expiresIn as any };
  return jwt.sign(payload, secret as string, options);
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(payload: Omit<JWTPayload, 'exp'>): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev';
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // 7 days
  
  const options: SignOptions = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { expiresIn: expiresIn as any };
  return jwt.sign(payload, secret as string, options);
}

/**
 * Generate token pair (access + refresh)
 */
export async function generateTokenPair(userId: string, email: string, role: string): Promise<TokenPair> {
  const payload: Omit<JWTPayload, 'exp'> = {
    userId,
    email,
    role
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // Store refresh token in Redis for session management
  await storeRefreshToken(userId, refreshToken);

  return { accessToken, refreshToken };
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev';
    return jwt.verify(token, secret as string) as JWTPayload;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Access token verification failed' });
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): JWTPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_dev';
    return jwt.verify(token, secret as string) as JWTPayload;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Refresh token verification failed' });
    return null;
  }
}

/**
 * Store refresh token in Redis with expiration
 */
export async function storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    logError(new Error('Redis not available for storing refresh token'));
    return;
  }

  // Calculate expiration time (same as token expiry)
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const expiresInSeconds = parseTimeToSeconds(expiresIn);

  // Store with user ID as key
  await redis.setEx(`refresh_token:${userId}`, expiresInSeconds, refreshToken);
}

/**
 * Validate refresh token exists in Redis
 */
export async function isValidRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    return false;
  }

  const storedToken = await redis.get(`refresh_token:${userId}`);
  return storedToken === refreshToken;
}

/**
 * Revoke refresh token (logout)
 */
export async function revokeRefreshToken(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    logError(new Error('Redis not available for revoking refresh token'));
    return;
  }

  await redis.del(`refresh_token:${userId}`);
}

/**
 * Create session in Redis
 */
export async function createSession(sessionInfo: SessionInfo): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    logError(new Error('Redis not available for session management'));
    return;
  }

  const sessionKey = `session:${sessionInfo.sessionId}`;
  await redis.hSet(sessionKey, {
    userId: sessionInfo.userId,
    deviceId: sessionInfo.deviceId,
    userAgent: sessionInfo.userAgent,
    ip: sessionInfo.ip,
    createdAt: sessionInfo.createdAt.toISOString(),
    expiresAt: sessionInfo.expiresAt.toISOString(),
    isActive: sessionInfo.isActive.toString()
  });

  // Set expiration for session
  const ttl = Math.floor((sessionInfo.expiresAt.getTime() - Date.now()) / 1000);
  await redis.expire(sessionKey, ttl);

  // Add to user's active sessions
  const userSessionsKey = `user_sessions:${sessionInfo.userId}`;
  await redis.sAdd(userSessionsKey, sessionInfo.sessionId);
  
  // Set expiration for user sessions set
  await redis.expire(userSessionsKey, ttl);
}

/**
 * Validate session
 */
export async function validateSession(sessionId: string): Promise<SessionInfo | null> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    return null;
  }

  const sessionKey = `session:${sessionId}`;
  const sessionData = await redis.hGetAll(sessionKey);

  if (Object.keys(sessionData).length === 0) {
    return null;
  }

  const session: SessionInfo = {
    sessionId: sessionId,
    userId: sessionData.userId,
    deviceId: sessionData.deviceId,
    userAgent: sessionData.userAgent,
    ip: sessionData.ip,
    createdAt: new Date(sessionData.createdAt),
    expiresAt: new Date(sessionData.expiresAt),
    isActive: sessionData.isActive === 'true'
  };

  if (!session.isActive || session.expiresAt < new Date()) {
    await destroySession(sessionId);
    return null;
  }

  return session;
}

/**
 * Destroy session
 */
export async function destroySession(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    logError(new Error('Redis not available for session destruction'));
    return;
  }

  const sessionKey = `session:${sessionId}`;
  const sessionData = await redis.hGetAll(sessionKey);

  if (Object.keys(sessionData).length > 0) {
    // Remove from user's active sessions
    const userSessionsKey = `user_sessions:${sessionData.userId}`;
    await redis.sRem(userSessionsKey, sessionId);
    
    // Delete session
    await redis.del(sessionKey);
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserActiveSessions(userId: string): Promise<SessionInfo[]> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    return [];
  }

  const userSessionsKey = `user_sessions:${userId}`;
  const sessionIds = await redis.sMembers(userSessionsKey);
  
  const sessions: SessionInfo[] = [];
  for (const sessionId of sessionIds) {
    const session = await validateSession(sessionId);
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}

/**
 * Terminate all sessions for a user (used for logout from all devices)
 */
export async function terminateAllUserSessions(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    logError(new Error('Redis not available for terminating user sessions'));
    return;
  }

  const userSessionsKey = `user_sessions:${userId}`;
  const sessionIds = await redis.sMembers(userSessionsKey);

  for (const sessionId of sessionIds) {
    await destroySession(sessionId);
  }

  await redis.del(userSessionsKey);
  await revokeRefreshToken(userId);
}

/**
 * Parse time string to seconds (e.g., '15m', '7d', '24h')
 */
function parseTimeToSeconds(timeStr: string): number {
  const num = parseInt(timeStr);
  const unit = timeStr.replace(num.toString(), '').toLowerCase();

  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 60 * 60;
    case 'd': return num * 24 * 60 * 60;
    default: return num; // Assume seconds if no unit
  }
}

/**
 * Hash password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12');
  return bcrypt.hash(password, saltRounds);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check against common passwords (basic implementation)
  const commonPasswords = ['password', '12345678', 'qwerty', 'admin'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password is too common');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Generate device ID
 */
export function generateDeviceId(): string {
  return uuidv4();
}

/**
 * Generate session ID
 */
export function generateSessionId(): string {
  return uuidv4();
}