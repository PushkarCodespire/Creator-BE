// ===========================================
// HOME PAGE CONTROLLER
// Public endpoint for homepage data + admin endpoint to manage it
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const publicSelect = {
  id: true,
  displayName: true,
  category: true,
  tagline: true,
  bio: true,
  profileImage: true,
  tags: true,
  suggestedQuestions: true,
  totalChats: true,
  isFeatured: true,
  featuredOrder: true,
  isMainHighlight: true,
} as const;

// GET /home/featured — public homepage data
export const getHomeFeatured = asyncHandler(async (_req: Request, res: Response) => {
  const [featured, mainHighlight] = await Promise.all([
    prisma.creator.findMany({
      where: { isFeatured: true, isActive: true },
      select: publicSelect,
      orderBy: [{ featuredOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.creator.findFirst({
      where: { isMainHighlight: true, isActive: true },
      select: publicSelect,
    }),
  ]);

  res.json({ success: true, data: { featured, mainHighlight } });
});

// GET /admin/home/creators — list ALL active creators for admin selection
export const getAllCreatorsForHome = asyncHandler(async (_req: Request, res: Response) => {
  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: publicSelect,
    orderBy: [{ isFeatured: 'desc' }, { featuredOrder: 'asc' }, { displayName: 'asc' }],
  });

  res.json({ success: true, data: creators });
});

// PUT /admin/home/featured — set featured list + main highlight
// Body: { featured: Array<{ creatorId: string, order: number }>, mainHighlightId: string | null }
export const updateHomeFeatured = asyncHandler(async (req: Request, res: Response) => {
  const { featured, mainHighlightId } = req.body as {
    featured?: Array<{ creatorId: string; order: number }>;
    mainHighlightId?: string | null;
  };

  if (!Array.isArray(featured)) {
    throw new AppError('featured must be an array of { creatorId, order }', 400);
  }

  // Validate all creator IDs exist
  const ids = featured.map(f => f.creatorId);
  if (mainHighlightId && !ids.includes(mainHighlightId)) ids.push(mainHighlightId);
  if (ids.length > 0) {
    const existing = await prisma.creator.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== new Set(ids).size) {
      throw new AppError('One or more creator IDs are invalid', 400);
    }
  }

  // Validate orders are unique positive integers
  const orders = featured.map(f => f.order);
  if (orders.some(o => !Number.isInteger(o) || o < 1)) {
    throw new AppError('order must be a positive integer', 400);
  }
  if (new Set(orders).size !== orders.length) {
    throw new AppError('featured orders must be unique', 400);
  }

  // Transaction: clear all flags, then set the selected ones
  await prisma.$transaction([
    prisma.creator.updateMany({
      data: { isFeatured: false, featuredOrder: null, isMainHighlight: false },
    }),
    ...featured.map(f =>
      prisma.creator.update({
        where: { id: f.creatorId },
        data: { isFeatured: true, featuredOrder: f.order },
      })
    ),
    ...(mainHighlightId
      ? [
          prisma.creator.update({
            where: { id: mainHighlightId },
            data: { isMainHighlight: true },
          }),
        ]
      : []),
  ]);

  // Return the new config
  const [featuredList, mainHighlight] = await Promise.all([
    prisma.creator.findMany({
      where: { isFeatured: true },
      select: publicSelect,
      orderBy: { featuredOrder: 'asc' },
    }),
    prisma.creator.findFirst({
      where: { isMainHighlight: true },
      select: publicSelect,
    }),
  ]);

  res.json({ success: true, data: { featured: featuredList, mainHighlight } });
});
