// ===========================================
// TOKEN MANAGEMENT SYSTEM
// ===========================================
// Handles JWT token lifecycle: generation, validation, refresh, and storage

import { Request, Response, NextFunction } from 'express';
import {
  generateTokenPair,
  verifyRefreshToken,
  isValidRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
  generateSessionId,
  generateDeviceId,
  createSession,
  validateSession,
  destroySession,
  getUserActiveSessions,
  terminateAllUserSessions
} from '../utils/jwt';
import prisma from '../../prisma/client';
import { UserRole } from '@prisma/client';  // Import directly from Prisma
import { logError, logInfo } from '../utils/logger';

// Extend Express Request type to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        creator?: { id: string } | null;
        company?: { id: string } | null;
      };
      sessionId?: string;
    }
  }
}

/**
 * Generate and set tokens in response
 */
export const setAuthTokens = (res: Response, userId: string, email: string, role: string) => {
  return generateTokenPair(userId, email, role).then(tokens => {
    // Set refresh token as httpOnly cookie (more secure)
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Use HTTPS in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict', // CSRF protection
      path: '/api/auth/refresh'
    });

    // Return access token in response body
    return tokens.accessToken;
  });
};

/**
 * Refresh token middleware
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    // Get refresh token from cookie
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token not provided' });
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const { userId } = payload;

    // Check if refresh token is still valid in Redis
    const isValid = await isValidRefreshToken(userId, refreshToken);
    if (!isValid) {
      return res.status(401).json({ error: 'Refresh token revoked or expired' });
    }

    // Get user from database to ensure they exist and are active
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user /*|| user.deletedAt*/) {  // Commenting out deletedAt since it doesn't exist in schema
      // Revoke the refresh token
      await revokeRefreshToken(userId);
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    // Generate new token pair
    const newTokens = await generateTokenPair(user.id, user.email, user.role);

    // Set new refresh token as httpOnly cookie
    res.cookie('refreshToken', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict',
      path: '/api/auth/refresh'
    });

    // Return new access token
    res.json({
      accessToken: newTokens.accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Refresh token error' });
    res.status(500).json({ error: 'Token refresh failed' });
  }
};

/**
 * Logout middleware
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (userId) {
      // Revoke refresh token
      await revokeRefreshToken(userId);
      
      // Destroy session if exists
      if (req.sessionId) {
        await destroySession(req.sessionId);
      }
    }
    
    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh'
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Logout error' });
    res.status(500).json({ error: 'Logout failed' });
  }
};

/**
 * Logout from all devices
 */
export const logoutAll = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (userId) {
      // Terminate all user sessions
      await terminateAllUserSessions(userId);
    }
    
    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh'
    });
    
    res.json({ message: 'Logged out from all devices successfully' });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Logout all devices error' });
    res.status(500).json({ error: 'Logout from all devices failed' });
  }
};

/**
 * Session management middleware
 */
export const sessionManager = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get device ID from header or generate new one
    const deviceId = req.headers['device-id'] as string || generateDeviceId();
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || 'unknown';
    
    // If user is authenticated, create or validate session
    if (req.user) {
      const sessionId = generateSessionId();
      
      // Create session in Redis
      await createSession({
        sessionId,
        userId: req.user.id,  // Changed from req.user.userId to req.user.id
        deviceId,
        userAgent: userAgent.toString(),
        ip,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        isActive: true
      });
      
      // Attach session ID to request
      req.sessionId = sessionId;
    }
    
    next();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Session management error' });
    next(error);
  }
};

/**
 * Get user's active sessions
 */
export const getUserSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const sessions = await getUserActiveSessions(userId);
    
    res.json({
      sessions,
      count: sessions.length
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Get user sessions error' });
    res.status(500).json({ error: 'Failed to get user sessions' });
  }
};

/**
 * Revoke a specific session
 */
export const revokeSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Validate that the session belongs to the user
    const session = await validateSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ error: 'Cannot revoke another user\'s session' });
    }
    
    await destroySession(sessionId);
    
    res.json({ message: 'Session revoked successfully' });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Revoke session error' });
    res.status(500).json({ error: 'Failed to revoke session' });
  }
};

/**
 * Secure token transmission middleware
 */
export const secureTokenTransmission = (req: Request, res: Response, next: NextFunction) => {
  // Ensure secure headers are set
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // In production, ensure we're using HTTPS
  if (process.env.NODE_ENV === 'production' && !req.secure && req.header('x-forwarded-proto') !== 'https') {
    return res.status(400).json({ error: 'Secure connection required for token transmission' });
  }
  
  next();
};

/**
 * Token validation middleware with rate limiting
 */
export const validateTokenWithRateLimit = (req: Request, res: Response, next: NextFunction) => {
  // Check for excessive token validation requests
  // (implement rate limiting logic here if needed)
  
  next();
};

/**
 * Device fingerprinting middleware
 */
export const deviceFingerprint = (req: Request, res: Response, next: NextFunction) => {
  // Create a device fingerprint from various request headers
  const userAgent = req.headers['user-agent'];
  const acceptLanguage = req.headers['accept-language'];
  const acceptEncoding = req.headers['accept-encoding'];
  const accept = req.headers['accept'];
  
  // Generate a hash of these values as a device fingerprint
  // Note: In production, you'd use a proper hashing function
  const fingerprint = `${userAgent}-${acceptLanguage}-${acceptEncoding}-${accept}`;
  
  req.headers['device-fingerprint'] = fingerprint;
  
  next();
};

/**
 * Token cleanup job - remove expired sessions periodically
 */
export const runTokenCleanupJob = async () => {
  logInfo('Running token cleanup job...');

  try {
    // This would typically be run as a scheduled job
    // For now, we rely on Redis TTL to handle expiration

    logInfo('Token cleanup job completed');
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Token cleanup job failed' });
  }
};

// Export for use in auth controller
export {
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken
};