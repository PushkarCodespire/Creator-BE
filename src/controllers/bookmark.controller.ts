// ===========================================
// MESSAGE BOOKMARK CONTROLLER
// ===========================================

import { Response } from 'express';
import prisma from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

// ===========================================
// ADD BOOKMARK
// ===========================================
export const addBookmark = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { messageId } = req.params;
  const { note } = req.body;

  // Check if message exists
  const message = await prisma.message.findUnique({
    where: { id: messageId as string },
    include: { conversation: true },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Check if user has access to this conversation
  const conversation = message.conversation;
  if (conversation.userId && conversation.userId !== userId) {
    throw new AppError('Access denied', 403);
  }

  // Check if bookmark already exists
  const existingBookmark = await prisma.messageBookmark.findUnique({
    where: {
      messageId_userId: {
        messageId: messageId as string,
        userId,
      },
    },
  });

  if (existingBookmark) {
    // Update existing bookmark note
    const updatedBookmark = await prisma.messageBookmark.update({
      where: { id: existingBookmark.id },
      data: { note: note || null },
    });

    res.json({
      success: true,
      data: updatedBookmark,
      message: 'Bookmark updated',
    });
    return;
  }

  // Create new bookmark
  const bookmark = await prisma.messageBookmark.create({
    data: {
      messageId: messageId as string,
      userId,
      note: note || null,
    },
  });

  res.status(201).json({
    success: true,
    data: bookmark,
  });
});

// ===========================================
// REMOVE BOOKMARK
// ===========================================
export const removeBookmark = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { messageId } = req.params;

  // Check if bookmark exists
  const bookmark = await prisma.messageBookmark.findUnique({
    where: {
      messageId_userId: {
        messageId: messageId as string,
        userId,
      },
    },
  });

  if (!bookmark) {
    throw new AppError('Bookmark not found', 404);
  }

  // Delete bookmark
  await prisma.messageBookmark.delete({
    where: { id: bookmark.id },
  });

  res.json({
    success: true,
    message: 'Bookmark removed',
  });
});

// ===========================================
// GET USER BOOKMARKS
// ===========================================
export const getUserBookmarks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const {
    page = '1',
    limit = '20',
    creatorId,
    from,
    to,
    search
  } = req.query;
  const conversationId = req.query.conversationId as string;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause with advanced filtering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messageWhere: any = {};

  if (conversationId) {
    messageWhere.conversationId = conversationId;
  }

  if (creatorId) {
    messageWhere.conversation = {
      creatorId: creatorId as string
    };
  }

  if (search) {
    messageWhere.content = {
      contains: search as string,
      mode: 'insensitive'
    };
  }

  if (Object.keys(messageWhere).length > 0) {
    where.message = messageWhere;
  }

  // Date range filtering
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from as string);
    if (to) where.createdAt.lte = new Date(to as string);
  }

  const [bookmarks, total] = await Promise.all([
    prisma.messageBookmark.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        message: {
          include: {
            conversation: {
              select: {
                id: true,
                creatorId: true,
                creator: {
                  select: {
                    id: true,
                    displayName: true,
                    profileImage: true,
                    category: true,
                    isVerified: true
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.messageBookmark.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      bookmarks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      filters: {
        creatorId: creatorId || null,
        dateRange: { from: from || null, to: to || null },
        search: search || null
      }
    },
  });
});

// ===========================================
// GET BOOKMARK RECOMMENDATIONS
// ===========================================
export const getBookmarkRecommendations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const limit = parseInt(req.query.limit as string) || 10;

  // Get user's conversations
  const conversations = await prisma.conversation.findMany({
    where: { userId, isActive: true },
    select: { id: true }
  });

  const conversationIds = conversations.map(c => c.id);

  // Get existing bookmarks to exclude
  const existingBookmarks = await prisma.messageBookmark.findMany({
    where: { userId },
    select: { messageId: true }
  });

  const bookmarkedMessageIds = existingBookmarks.map(b => b.messageId);

  // Find valuable messages to recommend for bookmarking
  // Criteria: Long responses (detailed), assistant messages, from active conversations
  const recommendations = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      role: 'ASSISTANT',
      id: { notIn: bookmarkedMessageIds },
      content: {
        // Messages with substantial content (longer than 200 chars)
        not: ''
      }
    },
    take: limit * 2, // Get extra to filter
    orderBy: { createdAt: 'desc' },
    include: {
      conversation: {
        select: {
          id: true,
          creator: {
            select: {
              id: true,
              displayName: true,
              profileImage: true,
              category: true
            }
          }
        }
      }
    }
  });

  // Filter by content length and sort by relevance
  const worthwhileMessages = recommendations
    .filter(msg => msg.content.length > 200)
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, limit);

  res.json({
    success: true,
    data: {
      recommendations: worthwhileMessages.map(msg => ({
        messageId: msg.id,
        content: msg.content.substring(0, 200) + '...',
        fullContent: msg.content,
        creator: msg.conversation.creator,
        conversationId: msg.conversation.id,
        createdAt: msg.createdAt,
        reason: 'Detailed response worth saving'
      }))
    }
  });
});
