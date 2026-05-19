// ===========================================
// TRENDING CONTROLLER
// Handle trending creators, posts, and hashtags
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  getTrendingPosts,
  getTrendingCreators,
  getTrendingHashtags,
  getCategoryTrending,
} from '../services/trending.service';

// ===========================================
// GET TRENDING POSTS
// GET /api/trending/posts
// ===========================================

export const getTrendingPostsController = asyncHandler(async (req: Request, res: Response) => {
  const { timeWindow = '24', limit = '20', category } = req.query;

  const windowHours = parseInt(timeWindow as string);
  const limitNum = parseInt(limit as string);

  // Validate time window
  const validWindows = [1, 24, 168, 720]; // hourly, daily, weekly, monthly
  if (!validWindows.includes(windowHours)) {
    throw new AppError('Invalid time window. Use 1, 24, 168, or 720', 400);
  }

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    isPublished: true,
    publishedAt: {
      lte: new Date(),
      gte: new Date(Date.now() - windowHours * 60 * 60 * 1000),
    },
  };

  // Fetch posts within time window
  const posts = await prisma.post.findMany({
    where,
    take: limitNum * 2, // Fetch more for better ranking
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
  });

  // Map posts with counts
  const postsWithCounts = posts.map((post) => ({
    ...post,
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
    sharesCount: 0, // TODO: Add shares when implemented
  }));

  // Apply trending algorithm
  let trendingPosts;
  if (category) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trendingPosts = getCategoryTrending(postsWithCounts as any, category as string);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trendingPosts = getTrendingPosts(postsWithCounts as any, windowHours);
  }

  // Limit results
  const limitedPosts = trendingPosts.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      posts: limitedPosts,
      timeWindow: windowHours,
      count: limitedPosts.length,
    },
  });
});

// ===========================================
// GET TRENDING CREATORS
// GET /api/trending/creators
// ===========================================

export const getTrendingCreatorsController = asyncHandler(async (req: Request, res: Response) => {
  const { timeWindow = '168', limit = '20', category } = req.query;

  const windowHours = parseInt(timeWindow as string);
  const limitNum = parseInt(limit as string);

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    isActive: true,
  };

  if (category) {
    where.category = category;
  }

  // Fetch creators
  const creators = await prisma.creator.findMany({
    where,
    take: limitNum * 2, // Fetch more for better ranking
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      _count: {
        select: {
          followers: true,
          posts: true,
        },
      },
    },
  });

  // Map creators with follower counts
  const creatorsWithCounts = creators.map((creator) => ({
    ...creator,
    followersCount: creator._count.followers,
    postsCount: creator._count.posts,
  }));

  // Apply trending algorithm
  const trendingCreators = getTrendingCreators(creatorsWithCounts, windowHours);

  // Limit results
  const limitedCreators = trendingCreators.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      creators: limitedCreators,
      timeWindow: windowHours,
      count: limitedCreators.length,
    },
  });
});

// ===========================================
// GET TRENDING HASHTAGS
// GET /api/trending/hashtags
// ===========================================

export const getTrendingHashtagsController = asyncHandler(async (req: Request, res: Response) => {
  const { timeWindow = '24', limit = '20' } = req.query;

  const windowHours = parseInt(timeWindow as string);
  const limitNum = parseInt(limit as string);

  // Fetch recent posts with hashtags
  const posts = await prisma.post.findMany({
    where: {
      isPublished: true,
      publishedAt: {
        gte: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      },
      content: {
        contains: '#', // Only posts with hashtags
      },
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
    },
  });

  // Extract trending hashtags
  const trendingHashtags = getTrendingHashtags(posts);

  // Limit results
  const limitedHashtags = trendingHashtags.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      hashtags: limitedHashtags,
      timeWindow: windowHours,
      count: limitedHashtags.length,
    },
  });
});

// ===========================================
// GET CATEGORY TRENDING
// GET /api/trending/category/:category
// ===========================================

export const getCategoryTrendingController = asyncHandler(async (req: Request, res: Response) => {
  const { category } = req.params;
  const { timeWindow = '168', limit = '20' } = req.query;

  const windowHours = parseInt(timeWindow as string);
  const limitNum = parseInt(limit as string);

  if (!category) {
    throw new AppError('Category is required', 400);
  }

  // Fetch posts in category
  const posts = await prisma.post.findMany({
    where: {
      isPublished: true,
      publishedAt: {
        gte: new Date(Date.now() - windowHours * 60 * 60 * 1000),
      },
      creator: {
        category: category as string,
      },
    },
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
  });

  // Map posts with counts
  const postsWithCounts = posts.map((post) => ({
    ...post,
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
    sharesCount: 0,
  }));

  // Apply trending algorithm
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendingPosts = getCategoryTrending(postsWithCounts as any, category as string);

  // Limit results
  const limitedPosts = trendingPosts.slice(0, limitNum);

  res.json({
    success: true,
    data: {
      category,
      posts: limitedPosts,
      timeWindow: windowHours,
      count: limitedPosts.length,
    },
  });
});

// ===========================================
// GET TRENDING STATS (Overview)
// GET /api/trending/stats
// ===========================================

export const getTrendingStatsController = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 168 * 60 * 60 * 1000);

  // Get counts for different time windows
  const [dailyPosts, weeklyPosts, dailyCreators, weeklyCreators] = await Promise.all([
    prisma.post.count({
      where: {
        isPublished: true,
        publishedAt: { gte: oneDayAgo },
      },
    }),
    prisma.post.count({
      where: {
        isPublished: true,
        publishedAt: { gte: oneWeekAgo },
      },
    }),
    prisma.creator.count({
      where: {
        isActive: true,
        createdAt: { gte: oneDayAgo },
      },
    }),
    prisma.creator.count({
      where: {
        isActive: true,
        createdAt: { gte: oneWeekAgo },
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      daily: {
        posts: dailyPosts,
        newCreators: dailyCreators,
      },
      weekly: {
        posts: weeklyPosts,
        newCreators: weeklyCreators,
      },
    },
  });
});
