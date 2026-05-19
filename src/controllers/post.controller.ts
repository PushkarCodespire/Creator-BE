// ===========================================
// POST CONTROLLER
// Handle creator posts, likes, and feed
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { rankPosts, mixFeedContent, getDefaultFeedQuery } from '../services/feedAlgorithm.service';
import { logError } from '../utils/logger';

// ===========================================
// CREATE POST
// POST /api/posts
// ===========================================

export const createPost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { content, media, type = 'TEXT', publishedAt } = req.body;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Check if user is a creator
  const creator = await prisma.creator.findUnique({
    where: { userId },
  });

  if (!creator) {
    throw new AppError('Only creators can create posts', 403);
  }

  // Validate content
  if (!content || content.trim().length === 0) {
    throw new AppError('Post content is required', 400);
  }

  // Create post
  const post = await prisma.post.create({
    data: {
      creatorId: creator.id,
      content,
      media: media || null,
      type,
      isPublished: publishedAt ? false : true,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
    },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: post,
    message: 'Post created successfully',
  });
});

// ===========================================
// GET CREATOR POST STATS (for dashboard side panel)
// GET /api/posts/stats/overview
// ===========================================

export const getCreatorPostStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Only creators can view post stats', 403);
  }

  const [
    followerCount,
    totalPosts,
    totalComments,
    topPost,
    recentComments
  ] = await Promise.all([
    prisma.follow.count({ where: { followingId: creator.id } }),
    prisma.post.count({ where: { creatorId: creator.id } }),
    prisma.comment.count({ where: { post: { creatorId: creator.id } } }),
    prisma.post.findFirst({
      where: { creatorId: creator.id, isPublished: true },
      orderBy: [
        { likesCount: 'desc' },
        { commentsCount: 'desc' },
        { publishedAt: 'desc' }
      ],
      select: {
        id: true,
        content: true,
        media: true,
        likesCount: true,
        commentsCount: true,
        createdAt: true,
        publishedAt: true
      }
    }),
    prisma.comment.findMany({
      where: { post: { creatorId: creator.id } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        content: true,
        createdAt: true,
        post: {
          select: {
            id: true,
            content: true,
            media: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    })
  ]);

  const formatPreview = (text: string, limit: number) => {
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  };

  res.json({
    success: true,
    data: {
      totals: {
        followers: followerCount,
        posts: totalPosts,
        comments: totalComments
      },
      topPost: topPost
        ? {
            id: topPost.id,
            contentPreview: formatPreview(topPost.content, 160),
            likes: topPost.likesCount,
            comments: topPost.commentsCount,
            media: topPost.media,
            publishedAt: topPost.publishedAt || topPost.createdAt
          }
        : null,
      recentComments: recentComments.map(c => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        user: c.user,
        post: {
          id: c.post.id,
          contentPreview: formatPreview(c.post.content, 140),
          media: c.post.media
        }
      }))
    }
  });
});

// ===========================================
// GET FEED (Personalized with Ranking)
// GET /api/posts
// ===========================================

export const getFeed = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { page = '1', limit = '10', creatorId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Base where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = {
    isPublished: true,
    publishedAt: {
      lte: new Date(), // Only show published posts
    },
  };

  // If filtering by specific creator, use simple chronological feed
  if (creatorId) {
    const where = { ...baseWhere, creatorId: creatorId as string };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { publishedAt: 'desc' },
        include: {
          creator: {
            select: {
              id: true,
              displayName: true,
              profileImage: true,
              isVerified: true,
              category: true,
            },
          },
          _count: {
            select: { likes: true, comments: true },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    const postsWithLikeStatus = await addLikeStatus(posts, userId);

    return res.json({
      success: true,
      data: {
        posts: postsWithLikeStatus,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  }

  // PERSONALIZED FEED: Apply ranking algorithm

  // Get user's following list
  let followingIds: string[] = [];
  if (userId) {
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    followingIds = following.map(f => f.followingId);
  }

  // If user has follows, show mixed feed (70% followed + 30% discovery)
  if (followingIds.length > 0) {
    // Fetch more posts than needed for better ranking results
    const fetchLimit = limitNum * 3;

    // Fetch posts from followed creators
    const followedPosts = await prisma.post.findMany({
      where: {
        ...baseWhere,
        creatorId: { in: followingIds },
      },
      take: fetchLimit,
      orderBy: { publishedAt: 'desc' },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            isVerified: true,
            category: true,
            userId: true,
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    });

    // Fetch discovery posts (non-followed creators)
    const discoveryPosts = await prisma.post.findMany({
      where: {
        ...baseWhere,
        creatorId: { notIn: followingIds },
      },
      take: fetchLimit,
      orderBy: { likesCount: 'desc' }, // Start with popular posts for discovery
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            isVerified: true,
            category: true,
            userId: true,
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    });

    // Map posts to include counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapPostsWithCounts = (posts: any[]) => posts.map((post: any) => ({
      ...post,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      sharesCount: 0, // TODO: Add shares when implemented
    }));

    const followedWithCounts = mapPostsWithCounts(followedPosts);
    const discoveryWithCounts = mapPostsWithCounts(discoveryPosts);

    // Apply ranking algorithm
    const rankedFollowed = rankPosts(followedWithCounts, userId, followingIds);
    const rankedDiscovery = rankPosts(discoveryWithCounts, userId, followingIds);

    // Mix content (70% followed, 30% discovery)
    const mixedPosts = mixFeedContent(rankedFollowed, rankedDiscovery, limitNum);

    // Apply pagination
    const paginatedPosts = mixedPosts.slice(skip, skip + limitNum);

    // Add like status
    const postsWithLikeStatus = await addLikeStatus(paginatedPosts, userId);

    return res.json({
      success: true,
      data: {
        posts: postsWithLikeStatus,
        pagination: {
          total: mixedPosts.length,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(mixedPosts.length / limitNum),
        },
      },
    });
  }

  // No follows: Show trending/popular content
  const defaultQuery = getDefaultFeedQuery();

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: baseWhere,
      skip,
      take: limitNum,
      orderBy: defaultQuery.orderBy,
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            isVerified: true,
            category: true,
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    }),
    prisma.post.count({ where: baseWhere }),
  ]);

  const postsWithLikeStatus = await addLikeStatus(posts, userId);

  res.json({
    success: true,
    data: {
      posts: postsWithLikeStatus,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});

// Helper function to add like status to posts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addLikeStatus(posts: any[], userId: string | undefined) {
  if (userId) {
    const userLikes = await prisma.like.findMany({
      where: {
        userId,
        postId: {
          in: posts.map(p => p.id),
        },
      },
      select: { postId: true },
    });

    const likedPostIds = new Set(userLikes.map(l => l.postId));

    return posts.map(post => ({
      ...post,
      isLiked: likedPostIds.has(post.id),
      likesCount: post._count?.likes || post.likesCount || 0,
      commentsCount: post._count?.comments || post.commentsCount || 0,
    }));
  }

  return posts.map(post => ({
    ...post,
    isLiked: false,
    likesCount: post._count?.likes || post.likesCount || 0,
    commentsCount: post._count?.comments || post.commentsCount || 0,
  }));
}

// ===========================================
// GET SINGLE POST
// GET /api/posts/:id
// ===========================================

export const getPost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;

  const post = await prisma.post.findUnique({
    where: { id: id as string },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
          category: true,
          bio: true,
        },
      },
      _count: {
        select: {
          likes: true,
        },
      },
    },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // Check if user liked this post
  let isLiked = false;
  if (userId) {
    const like = await prisma.like.findUnique({
      where: {
        userId_postId: {
          userId,
          postId: id as string,
        },
      },
    });
    isLiked = !!like;
  }

  res.json({
    success: true,
    data: {
      ...post,
      isLiked,
      likesCount: post._count.likes,
    },
  });
});

// ===========================================
// UPDATE POST
// PUT /api/posts/:id
// ===========================================

export const updatePost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const { content, media, type, isPublished } = req.body;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Find post
  const existingPost = await prisma.post.findUnique({
    where: { id: id as string },
    include: {
      creator: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!existingPost) {
    throw new AppError('Post not found', 404);
  }

  // Check if user owns this post
  if (existingPost.creator.userId !== userId) {
    throw new AppError('You can only edit your own posts', 403);
  }

  // Update post
  const updatedPost = await prisma.post.update({
    where: { id: id as string },
    data: {
      ...(content && { content }),
      ...(media !== undefined && { media }),
      ...(type && { type }),
      ...(isPublished !== undefined && { isPublished }),
    },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: updatedPost,
    message: 'Post updated successfully',
  });
});

// ===========================================
// DELETE POST
// DELETE /api/posts/:id
// ===========================================

export const deletePost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Find post
  const post = await prisma.post.findUnique({
    where: { id: id as string },
    include: {
      creator: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // Check if user owns this post
  if (post.creator.userId !== userId) {
    throw new AppError('You can only delete your own posts', 403);
  }

  // Delete post (likes will cascade delete)
  await prisma.post.delete({
    where: { id: id as string },
  });

  res.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

// ===========================================
// LIKE POST
// POST /api/posts/:id/like
// ===========================================

export const likePost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: id as string },
    include: {
      creator: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // Check if already liked
  const existingLike = await prisma.like.findUnique({
    where: {
      userId_postId: {
        userId,
        postId: id as string,
      },
    },
  });

  if (existingLike) {
    throw new AppError('Post already liked', 400);
  }

  // Create like
  const like = await prisma.like.create({
    data: {
      userId,
      postId: id as string,
    },
  });

  // Update likes count
  const updatedPost = await prisma.post.update({
    where: { id: id as string },
    data: {
      likesCount: {
        increment: 1,
      },
    },
  });

  // Create notification for creator (if not liking own post)
  if (post.creator.userId !== userId) {
    await prisma.notification.create({
      data: {
        userId: post.creator.userId,
        type: 'CHAT_MESSAGE', // We'll add LIKE type later
        title: 'New Like',
        message: 'Someone liked your post!',
        actionUrl: `/posts/${id}`,
        priority: 'LOW',
      },
    }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to create notification' }));
  }

  res.status(201).json({
    success: true,
    data: {
      like,
      likesCount: updatedPost.likesCount,
    },
    message: 'Post liked successfully',
  });
});

// ===========================================
// UNLIKE POST
// DELETE /api/posts/:id/like
// ===========================================

export const unlikePost = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // Check if liked
  const existingLike = await prisma.like.findUnique({
    where: {
      userId_postId: {
        userId,
        postId: id as string,
      },
    },
  });

  if (!existingLike) {
    throw new AppError('Post not liked', 400);
  }

  // Delete like
  await prisma.like.delete({
    where: {
      userId_postId: {
        userId,
        postId: id as string,
      },
    },
  });

  // Update likes count
  const updatedPost = await prisma.post.update({
    where: { id: id as string },
    data: {
      likesCount: {
        decrement: 1,
      },
    },
  });

  res.json({
    success: true,
    data: {
      likesCount: updatedPost.likesCount,
    },
    message: 'Post unliked successfully',
  });
});

// ===========================================
// GET POST LIKES
// GET /api/posts/:id/likes
// ===========================================

export const getPostLikes = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { page = '1', limit = '20' } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const [likes, total] = await Promise.all([
    prisma.like.findMany({
      where: { postId: id as string },
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
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
    prisma.like.count({
      where: { postId: id as string },
    }),
  ]);

  res.json({
    success: true,
    data: {
      likes: likes.map(l => l.user),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});
