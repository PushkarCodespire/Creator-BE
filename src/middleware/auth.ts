// ===========================================
// AUTHENTICATION MIDDLEWARE
// ===========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../../prisma/client';
import { UserRole } from '@prisma/client';
import { sendError } from '../utils/apiResponse';

// Extend Express Request type
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
    }
  }
}

export interface AuthRequest extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    creator?: { id: string } | null;
    company?: { id: string } | null;
  };
  // Explicit re-declaration prevents TypeScript from losing these through generic
  // interface inheritance when @types/express uses multi-level generic chains.
  params: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: Record<string, any>;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
}

const getCookieValue = (cookieHeader: string, name: string) => {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }
  return undefined;
};

const getTokenFromCookies = (req: Request) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  return (
    getCookieValue(cookieHeader, 'accessToken') ||
    getCookieValue(cookieHeader, 'token') ||
    getCookieValue(cookieHeader, 'authToken') ||
    null
  );
};

const clearAuthCookies = (res: Response) => {
  const baseOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const
  };

  res.clearCookie('accessToken', { ...baseOptions, path: '/' });
  res.clearCookie('token', { ...baseOptions, path: '/' });
  res.clearCookie('authToken', { ...baseOptions, path: '/' });
  res.clearCookie('refreshToken', { ...baseOptions, path: '/api/auth/refresh' });
  res.clearCookie('refreshToken', { ...baseOptions, path: '/' });
};

// ===========================================
// VERIFY JWT TOKEN
// ===========================================

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header or fallback to cookies
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = getTokenFromCookies(req);
    }

    if (!token) {
      clearAuthCookies(res);
      return sendError(res, 401, 'TOKEN_MISSING', 'No token provided');
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        creator: {
          select: { id: true }
        },
        company: {
          select: { id: true }
        }
      }
    });

    if (!user) {
      return sendError(res, 401, 'USER_NOT_FOUND', 'User not found');
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (_error) {
    clearAuthCookies(res);
    return sendError(res, 401, 'TOKEN_INVALID', 'Invalid token');
  }
};

// ===========================================
// OPTIONAL AUTH (for guest users)
// ===========================================

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = getTokenFromCookies(req);
    }

    if (!token) {
      return next(); // Continue without user
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        creator: {
          select: { id: true }
        },
        company: {
          select: { id: true }
        }
      }
    });

    if (user) {
      req.user = user;
    }

    next();
  } catch {
    clearAuthCookies(res);
    next(); // Continue without user on error
  }
};

// ===========================================
// ROLE-BASED ACCESS CONTROL
// ===========================================

export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, 401, 'AUTH_REQUIRED', 'Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    }

    next();
  };
};

// Shorthand role checks
export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireCreator = requireRole(UserRole.CREATOR, UserRole.ADMIN);
export const requireCompany = requireRole(UserRole.COMPANY, UserRole.ADMIN);
export const requireUser = requireRole(UserRole.USER, UserRole.CREATOR, UserRole.COMPANY, UserRole.ADMIN);

// ===========================================
// GENERATE JWT TOKEN
// ===========================================

export const generateToken = (user: { id: string; email: string; role: UserRole }) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role
    },
    config.jwt.secret as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn: config.jwt.expiresIn as any } as jwt.SignOptions
  );
};
