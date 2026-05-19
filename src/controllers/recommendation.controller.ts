// ===========================================
// RECOMMENDATION CONTROLLER
// Handle personalized creator and post recommendations
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import {
  buildUserProfile,
  getContentBasedRecommendations,
  getCollaborativeRecommendations,
  getSimilarCreators,
  getRecommendedPosts,
  diversifyRecommendations,
} from '../services/recommendation.service';

// ===========================================
// GET RECOMMENDED CREATORS
// GET /api/recommendations/creators
// ===========================================

export const getRecommendedCreators = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { limit = '10', method = 'hybrid' } = req.query;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const limitNum = parseInt(limit as string);

  // Build user profile from activity
  const userProfile = await buildUserProfile(prisma, userId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recommendations: any[] = [];

  // Get all active creators
  const creators = await prisma.creator.findMany({
    where: {
      isActive: true,
      id: { notIn: userProfile.followingIds }, // Exclude already followed
    },
    include: {
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  const creatorsWithCounts = creators.map((creator) => ({
    ...creator,
    followersCount: creator._count.followers,
    postsCount: creator._count.posts,
  }));

  if (method === 'content' || method === 'hybrid') {
    // Content-based filtering
    const contentRecs = getContentBasedRecommendations(
      creatorsWithCounts,
      userProfile,
      method === 'hybrid' ? limitNum * 2 : limitNum
    );
    recommendations.push(...contentRecs);
  }

  if (method === 'collaborative' || method === 'hybrid') {
    // Collaborative filtering
    const collaborativeIds = await getCollaborativeRecommendations(prisma, userId, limitNum);

    const collaborativeCreators = await prisma.creator.findMany({
      where: {
        id: { in: collaborativeIds },
      },
      include: {
        _count: {
          select: {
            followers: true,
            posts: true,
          },
        },
      },
    });

    const formattedCollaborative = collaborativeCreators.map((creator) => ({
      ...creator,
      followersCount: creator._count.followers,
      postsCount: creator._count.posts,
      _recommendationScore: 50, // Base score for collaborative
      _reasons: ['Users like you also follow this creator'],
    }));

    recommendations.push(...formattedCollaborative);
  }

  // Remove duplicates and diversify
  const uniqueRecs = Array.from(
    new Map(recommendations.map(rec => [rec.id, rec])).values()
  );

  const diversified = diversifyRecommendations(uniqueRecs, 0.2);

  // Limit results
  const finalRecs = diversified.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      recommendations: finalRecs,
      count: finalRecs.length,
      method,
      userProfile: {
        followingCount: userProfile.followingIds.length,
        topCategories: userProfile.likedPostCategories,
      },
    },
  });
});

// ===========================================
// GET SIMILAR CREATORS
// GET /api/recommendations/creators/:creatorId/similar
// ===========================================

export const getSimilarCreatorsController = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params;
  const { limit = '5' } = req.query;

  const limitNum = parseInt(limit as string);

  // Get target creator
  const targetCreator = await prisma.creator.findUnique({
    where: { id: creatorId as string },
    include: {
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  if (!targetCreator) {
    throw new AppError('Creator not found', 404);
  }

  // Get all creators
  const allCreators = await prisma.creator.findMany({
    where: {
      isActive: true,
      id: { not: creatorId as string },
    },
    include: {
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creatorsWithCounts = allCreators.map((creator: any) => ({
    ...creator,
    followersCount: creator._count.followers,
    postsCount: creator._count.posts,
  }));

  const targetWithCounts = {
    ...targetCreator,
    followersCount: targetCreator._count.followers,
    postsCount: targetCreator._count.posts,
  };

  // Find similar creators
  const similar = getSimilarCreators(targetWithCounts, creatorsWithCounts, limitNum);

  res.json({
    success: true,
    data: {
      similar,
      count: similar.length,
      targetCreator: {
        id: targetCreator.id,
        displayName: targetCreator.displayName,
        category: targetCreator.category,
      },
    },
  });
});

// ===========================================
// GET RECOMMENDED POSTS
// GET /api/recommendations/posts
// ===========================================

export const getRecommendedPostsController = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { limit = '20', page = '1' } = req.query;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const limitNum = parseInt(limit as string);
  const pageNum = parseInt(page as string);
  const skip = (pageNum - 1) * limitNum;

  // Build user profile
  const userProfile = await buildUserProfile(prisma, userId);

  // Get recent posts
  const posts = await prisma.post.findMany({
    where: {
      isPublished: true,
      publishedAt: { lte: new Date() },
    },
    take: limitNum * 3, // Get more for better ranking
    skip,
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
        select: {
          likes: true,
          comments: true,
        },
      },
    },
    orderBy: { publishedAt: 'desc' },
  });

  const postsWithCounts = posts.map((post) => ({
    ...post,
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
  }));

  // Apply recommendation algorithm
  const recommended = getRecommendedPosts(postsWithCounts, userProfile);

  // Limit results
  const finalPosts = recommended.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      posts: finalPosts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: finalPosts.length,
      },
    },
  });
});

// ===========================================
// GET CREATORS YOU MIGHT LIKE
// GET /api/recommendations/for-you
// ===========================================

export const getForYouRecommendations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { limit = '6' } = req.query;

  const limitNum = parseInt(limit as string);

  // For non-authenticated users, show popular creators
  if (!userId) {
    const popular = await prisma.creator.findMany({
      where: { isActive: true },
      take: limitNum,
      orderBy: [
        { followersCount: 'desc' },
        { isVerified: 'desc' },
      ],
      include: {
        _count: {
          select: {
            followers: true,
            posts: true,
          },
        },
      },
    });

    return res.json({
      success: true,
      data: {
        recommendations: popular.map((creator) => ({
          ...creator,
          _reasons: ['Popular creator'],
        })),
      },
    });
  }

  // For authenticated users, use personalized recommendations
  const userProfile = await buildUserProfile(prisma, userId);

  // Combine collaborative and content-based
  const collaborativeIds = await getCollaborativeRecommendations(prisma, userId, limitNum);

  const creators = await prisma.creator.findMany({
    where: {
      isActive: true,
      id: { notIn: userProfile.followingIds },
    },
    include: {
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  const creatorsWithCounts = creators.map((creator) => ({
    ...creator,
    followersCount: creator._count.followers,
    postsCount: creator._count.posts,
  }));

  // Content-based recommendations
  const contentRecs = getContentBasedRecommendations(creatorsWithCounts, userProfile, limitNum);

  // Collaborative recommendations
  const collaborativeRecs = creators
    .filter((c) => collaborativeIds.includes(c.id))
    .map((creator) => ({
      ...creator,
      followersCount: creator._count.followers,
      postsCount: creator._count.posts,
      _recommendationScore: 60,
      _reasons: ['Similar users follow this creator'],
    }));

  // Combine and deduplicate
  const combined = [...contentRecs, ...collaborativeRecs];
  const unique = Array.from(new Map(combined.map(rec => [rec.id, rec])).values());

  // Sort and limit
  const sorted = unique
    .sort((a, b) => b._recommendationScore - a._recommendationScore)
    .slice(0, limitNum);

  res.json({
    success: true,
    data: {
      recommendations: sorted,
      count: sorted.length,
    },
  });
});

// ===========================================
// GET CATEGORY RECOMMENDATIONS
// GET /api/recommendations/category/:category
// ===========================================

export const getCategoryRecommendations = asyncHandler(async (req: Request, res: Response) => {
  const { category } = req.params;
  const { limit = '10' } = req.query;

  const limitNum = parseInt(limit as string);

  const creators = await prisma.creator.findMany({
    where: {
      isActive: true,
      category: category as string,
    },
    take: limitNum,
    orderBy: [
      { followersCount: 'desc' },
      { isVerified: 'desc' },
    ],
    include: {
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: {
      category: category as string,
      creators: creators.map((creator) => ({
        ...creator,
        followersCount: creator._count.followers,
        postsCount: creator._count.posts,
      })),
      count: creators.length,
    },
  });
});
