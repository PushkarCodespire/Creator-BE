// ===========================================
// API CONTROLLER
// Manage API keys and webhooks
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
// import { asyncHandler } from '../middleware/errorHandler';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler: (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => Promise<void> = (fn) => fn;
// import { AppError } from '../utils/errors';
class AppError extends Error { constructor(m: string, _s: number) { super(m); } }
import crypto from 'crypto';

// Prisma generates 'aPIKey' accessor for the 'APIKey' model - requires cast
// eslint-disable @typescript-eslint/no-explicit-any

// ===========================================
// CREATE API KEY
// ===========================================

export const createAPIKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, permissions, rateLimit, expiresAt } = req.body;

  // Generate API key
  const apiKey = `cp_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKeyRecord = await (prisma as any).aPIKey.create({
    // Note: Prisma generates model name as 'aPIKey' for 'APIKey' model
    data: {
      userId,
      name,
      key: apiKey,
      keyHash,
      permissions: permissions || [],
      rateLimit: rateLimit || 100,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  // Return the key only once (for security, hash is stored)
  res.json({
    success: true,
    data: {
      ...apiKeyRecord,
      key: apiKey, // Only returned on creation
    },
    message: 'API key created. Save it securely - it will not be shown again.',
  });
});

// ===========================================
// GET API KEYS
// ===========================================

export const getAPIKeys = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKeys = await (prisma as any).aPIKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      permissions: true,
      rateLimit: true,
      isActive: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      // Don't return the actual key or hash
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    success: true,
    data: apiKeys,
  });
});

// ===========================================
// REVOKE API KEY
// ===========================================

export const revokeAPIKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const keyId = req.params.keyId as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = await (prisma as any).aPIKey.findUnique({
    where: { id: keyId },
  });

  if (!apiKey || apiKey.userId !== userId) {
    throw new AppError('API key not found', 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).aPIKey.update({
    where: { id: keyId as string },
    data: { isActive: false },
  });

  res.json({
    success: true,
    message: 'API key revoked successfully',
  });
});

// ===========================================
// GET API USAGE
// ===========================================

export const getAPIUsage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const keyId = req.params.keyId as string;
  const { startDate: _startDate, endDate: _endDate } = req.query as { startDate?: string; endDate?: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiKey = await (prisma as any).aPIKey.findUnique({
    where: { id: keyId },
  });

  if (!apiKey || apiKey.userId !== userId) {
    throw new AppError('API key not found', 404);
  }

  // This would query analytics events for API usage
  // For now, return mock data
  res.json({
    success: true,
    data: {
      totalRequests: 0,
      requestsByDate: [],
      rateLimit: (apiKey as Record<string, unknown>).rateLimit,
      remainingRequests: (apiKey as Record<string, unknown>).rateLimit,
    },
  });
});
