// ===========================================
// USER ROUTES
// ===========================================

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import {
  getUserProfile,
  updateUserInterests,
  getUserInterests,
  getAvailableCategories,
  updateUserProfile,
  completeOnboarding,
} from '../controllers/user.controller';

const router = Router();

// User profile management
router.get('/profile', authenticate, getUserProfile);
router.put('/profile', authenticate, updateUserProfile);

// Fitness onboarding
router.patch('/onboarding', authenticate, completeOnboarding);

// User interests management
router.get('/interests', authenticate, getUserInterests);
router.put('/interests', authenticate, updateUserInterests);

// Get available categories (public)
router.get('/categories', getAvailableCategories);

// Get user's favorite creators
router.get('/favorites', authenticate, asyncHandler(async (req: Request, res: Response) => {
  // Placeholder - implement favorites table if needed
  res.json({ success: true, data: [] });
}));

// Get user's chat history summary (enhanced)
router.get('/chats', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    page = '1',
    limit = '20',
    search,
    category,
    timeFilter,
    sort = 'recent'
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId, isActive: true };

  // Search by creator name
  if (search) {
    where.creator = {
      displayName: {
        contains: search as string,
        mode: 'insensitive'
      }
    };
  }

  // Filter by category
  if (category) {
    where.creator = {
      ...where.creator,
      category: category as string
    };
  }

  // Time-based filtering
  if (timeFilter) {
    const now = new Date();
    let since: Date;

    switch (timeFilter) {
      case 'today':
        since = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(0);
    }

    where.lastMessageAt = { gte: since };
  }

  // Sort options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = { lastMessageAt: 'desc' };
  if (sort === 'alphabetical') {
    orderBy = { creator: { displayName: 'asc' } };
  } else if (sort === 'oldest') {
    orderBy = { createdAt: 'asc' };
  }

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: limitNum,
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            category: true,
            isVerified: true,
            rating: true,
            tagline: true
          }
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            content: true,
            createdAt: true,
            role: true
          }
        },
        _count: {
          select: { messages: true }
        }
      },
      orderBy
    }),
    prisma.conversation.count({ where })
  ]);

  // Format response with preview
  const formattedConversations = conversations.map(conv => ({
    id: conv.id,
    creator: conv.creator,
    lastMessage: conv.messages[0] ? {
      preview: conv.messages[0].content.substring(0, 100) + (conv.messages[0].content.length > 100 ? '...' : ''),
      timestamp: conv.messages[0].createdAt,
      role: conv.messages[0].role
    } : null,
    totalMessages: conv._count.messages,
    lastActive: conv.lastMessageAt,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt
  }));

  res.json({
    success: true,
    data: {
      conversations: formattedConversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      filters: {
        search: search || null,
        category: category || null,
        timeFilter: timeFilter || null,
        sort: sort || 'recent'
      }
    }
  });
}));

export default router;
