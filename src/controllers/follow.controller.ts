// ===========================================
// FOLLOW CONTROLLER
// Handle follow/unfollow functionality
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { logError } from '../utils/logger';

// ===========================================
// FOLLOW A CREATOR
// POST /api/follow/:creatorId
// ===========================================

export const followCreator = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { creatorId } = req.params as { creatorId: string };

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Check if creator exists
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // Check if already following
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: creatorId,
      },
    },
  });

  if (existingFollow) {
    throw new AppError('Already following this creator', 400);
  }

  // Create follow relationship
  const follow = await prisma.follow.create({
    data: {
      followerId: userId,
      followingId: creatorId,
    },
    include: {
      following: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
    },
  });

  // Create notification for creator
  await prisma.notification.create({
    data: {
      userId: creator.userId,
      type: 'CHAT_MESSAGE', // We'll create a FOLLOW type later
      title: 'New Follower',
      message: `You have a new follower!`,
      actionUrl: `/user/${userId}`,
      priority: 'NORMAL',
    },
  }).catch((err: unknown) => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to create notification' }));

  res.status(201).json({
    success: true,
    data: follow,
    message: 'Successfully followed creator',
  });
});

// ===========================================
// UNFOLLOW A CREATOR
// DELETE /api/follow/:creatorId
// ===========================================

export const unfollowCreator = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { creatorId } = req.params as { creatorId: string };

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Check if following
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: creatorId,
      },
    },
  });

  if (!existingFollow) {
    throw new AppError('Not following this creator', 400);
  }

  // Delete follow relationship
  await prisma.follow.delete({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: creatorId,
      },
    },
  });

  res.json({
    success: true,
    message: 'Successfully unfollowed creator',
  });
});

// ===========================================
// GET FOLLOWERS LIST
// GET /api/users/:userId/followers
// ===========================================

export const getFollowers = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { page = '1', limit = '20' } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Check if user is a creator
  const creator = await prisma.creator.findUnique({
    where: { userId },
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // Get followers
  const [followers, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: creator.id },
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        follower: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
            creator: {
              select: {
                id: true,
                displayName: true,
                isVerified: true,
              },
            },
          },
        },
      },
    }),
    prisma.follow.count({
      where: { followingId: creator.id },
    }),
  ]);

  res.json({
    success: true,
    data: {
      followers: followers.map((f) => f.follower),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});

// ===========================================
// GET FOLLOWING LIST
// GET /api/users/:userId/following
// ===========================================

export const getFollowing = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const {
    page = '1',
    limit = '20',
    category,
    sort = 'recent'
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { followerId: userId };

  if (category) {
    where.following = {
      category: category as string
    };
  }

  // Determine sort order
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = { createdAt: 'desc' };
  if (sort === 'alphabetical') {
    orderBy = { following: { displayName: 'asc' } };
  } else if (sort === 'popular') {
    orderBy = { following: { followersCount: 'desc' } };
  }

  // Get following with last interaction time
  const [following, total] = await Promise.all([
    prisma.follow.findMany({
      where,
      skip,
      take: limitNum,
      orderBy,
      include: {
        following: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            isVerified: true,
            category: true,
            tagline: true,
            totalChats: true,
            rating: true,
            followersCount: true,
            isActive: true
          },
        },
      },
    }),
    prisma.follow.count({ where }),
  ]);

  // Get last interaction time for each creator
  const enrichedFollowing = await Promise.all(
    following.map(async (f) => {
      const lastConversation = await prisma.conversation.findFirst({
        where: {
          userId,
          creatorId: f.following.id
        },
        orderBy: { lastMessageAt: 'desc' },
        select: {
          lastMessageAt: true,
          _count: { select: { messages: true } }
        }
      });

      return {
        ...f.following,
        followedAt: f.createdAt,
        lastInteraction: lastConversation?.lastMessageAt || null,
        totalMessages: lastConversation?._count.messages || 0
      };
    })
  );

  res.json({
    success: true,
    data: {
      following: enrichedFollowing,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
      filters: {
        category: category || null,
        sort: sort || 'recent'
      }
    },
  });
});

// ===========================================
// GET FOLLOW STATS
// GET /api/users/:userId/stats
// ===========================================

export const getFollowStats = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId },
  });

  const [followersCount, followingCount] = await Promise.all([
    // Followers count (if user is a creator)
    creator
      ? prisma.follow.count({
        where: { followingId: creator.id },
      })
      : 0,
    // Following count
    prisma.follow.count({
      where: { followerId: userId },
    }),
  ]);

  res.json({
    success: true,
    data: {
      followers: followersCount,
      following: followingCount,
    },
  });
});

// ===========================================
// CHECK IF FOLLOWING
// GET /api/follow/check/:creatorId
// ===========================================

export const checkFollowing = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { creatorId } = req.params as { creatorId: string };

  if (!userId) {
    return res.json({
      success: true,
      data: { isFollowing: false },
    });
  }

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: creatorId,
      },
    },
  });

  res.json({
    success: true,
    data: {
      isFollowing: !!follow,
    },
  });
});

// ===========================================
// GET CREATOR SUGGESTIONS
// GET /api/follow/suggestions
// ===========================================
export const getCreatorSuggestions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const limit = parseInt(req.query.limit as string) || 10;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Get user's interests and current following
  const [user, following] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { interests: true }
    }),
    prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true, following: { select: { category: true } } }
    })
  ]);

  const followingIds = following.map(f => f.followingId);
  const followedCategories = following.map(f => f.following.category).filter(Boolean) as string[];
  const userInterests = user?.interests || [];

  // Combine categories from interests and followed creators
  const relevantCategories = [...new Set([...userInterests, ...followedCategories])];

  // Get suggested creators
  const suggestions = await prisma.creator.findMany({
    where: {
      id: { notIn: followingIds },
      isActive: true,
      isVerified: true,
      OR: [
        { category: { in: relevantCategories } },
        { tags: { hasSome: userInterests } }
      ]
    },
    take: limit,
    orderBy: [
      { followersCount: 'desc' },
      { rating: 'desc' }
    ],
    select: {
      id: true,
      displayName: true,
      profileImage: true,
      category: true,
      tagline: true,
      isVerified: true,
      followersCount: true,
      rating: true,
      totalChats: true,
      tags: true
    }
  });

  // Add reasons for suggestions
  const enrichedSuggestions = suggestions.map(creator => {
    const reasons = [];

    if (userInterests.includes(creator.category || '')) {
      reasons.push('Matches your interests');
    }

    if (followedCategories.includes(creator.category || '')) {
      reasons.push('Similar to creators you follow');
    }

    if (creator.followersCount && creator.followersCount > 100) {
      reasons.push('Popular creator');
    }

    if (creator.rating && Number(creator.rating) >= 4.5) {
      reasons.push('Highly rated');
    }

    return {
      ...creator,
      suggestedReasons: reasons
    };
  });

  res.json({
    success: true,
    data: {
      suggestions: enrichedSuggestions,
      basedOn: {
        interests: userInterests,
        followedCategories: [...new Set(followedCategories)]
      }
    }
  });
});
