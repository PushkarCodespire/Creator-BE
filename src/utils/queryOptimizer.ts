// ===========================================
// QUERY OPTIMIZER
// Database query optimization utilities
// ===========================================
import prisma from '../../prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Optimized query for fetching creators with pagination
 * Includes only necessary fields and proper indexing hints
 */
export async function getCreatorsOptimized(params: {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  verified?: boolean;
}) {
  const { page = 1, limit = 12, category, search, verified } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.CreatorWhereInput = {
    isActive: true,
    ...(verified && { isVerified: true }),
    ...(category && { category }),
    ...(search && {
      OR: [
        { displayName: { contains: search, mode: 'insensitive' } },
        { bio: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ],
    }),
  };

  // Use select to fetch only needed fields
  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        bio: true,
        tagline: true,
        profileImage: true,
        category: true,
        tags: true,
        isVerified: true,
        totalChats: true,
        rating: true,

        createdAt: true,
      },
      orderBy: [
        { isVerified: 'desc' },
        { totalChats: 'desc' },
      ],
      skip,
      take: limit,
    }),
    prisma.creator.count({ where }),
  ]);

  return {
    creators,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Optimized query for fetching conversations with messages
 * Uses include strategically to avoid N+1 queries
 */
export async function getConversationWithMessagesOptimized(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
      messages: {
        take: 50, // Limit messages to avoid large payloads
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          role: true,
          content: true,
          media: true,
          createdAt: true,
          userId: true,
          reactions: {
            select: {
              id: true,
              emoji: true,
              userId: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Batch fetch user conversations to avoid N+1
 */
export async function getUserConversationsBatch(userId: string, limit = 10) {
  return prisma.conversation.findMany({
    where: { userId },
    take: limit,
    orderBy: { lastMessageAt: 'desc' },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
      messages: {
        take: 1, // Only last message
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });
}

/**
 * Optimized analytics query with aggregation
 */
export async function getCreatorAnalyticsOptimized(creatorId: string, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [overview, chatsByDate, messagesByDate] = await Promise.all([
    // Overview stats
    prisma.$transaction([
      prisma.conversation.count({
        where: { creatorId },
      }),
      prisma.message.count({
        where: {
          conversation: { creatorId },
        },
      }),
      prisma.message.aggregate({
        where: {
          conversation: { creatorId },
          createdAt: { gte: startDate },
        },
        _count: true,
      }),
    ]),
    // Chats by date
    prisma.conversation.groupBy({
      by: ['createdAt'],
      where: {
        creatorId,
        createdAt: { gte: startDate },
      },
      _count: true,
    }),
    // Messages by date
    prisma.message.groupBy({
      by: ['createdAt'],
      where: {
        conversation: { creatorId },
        createdAt: { gte: startDate },
      },
      _count: true,
    }),
  ]);

  return {
    overview: {
      totalChats: overview[0],
      totalMessages: overview[1],
      messagesLast30Days: overview[2]._count,
    },
    chatsByDate,
    messagesByDate,
  };
}

/**
 * Optimized content search with vector similarity
 * Combines database query with vector search efficiently
 */
export async function searchContentOptimized(
  creatorId: string,
  query: string,
  limit = 5
) {
  // First, get all content chunks for the creator
  const chunks = await prisma.contentChunk.findMany({
    where: {
      content: {
        creatorId,
        status: 'COMPLETED',
      },
    },
    select: {
      id: true,
      text: true,
      chunkIndex: true,
      contentId: true,
      content: {
        select: {
          id: true,
          title: true,
          type: true,
        },
      },
    },
    take: 100, // Limit initial fetch
  });

  // Then perform vector similarity search (would use vector store)
  // This is a placeholder - actual implementation would use the vector store
  return chunks.slice(0, limit);
}



