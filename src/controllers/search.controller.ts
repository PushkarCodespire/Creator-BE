// ===========================================
// SEARCH CONTROLLER
// Handle global search across all content types
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import {
  formatSearchResults,
  getAutocompleteSuggestions,
  trackSearch,
  getPopularSearches,
} from '../services/search.service';

// ===========================================
// GLOBAL SEARCH
// GET /api/search
// ===========================================

export const globalSearch = asyncHandler(async (req: Request, res: Response) => {
  const {
    q,
    type = 'all',
    category,
    limit = '20',
    page = '1',
    verified,
    dateFrom,
    dateTo,
  } = req.query;

  if (!q || typeof q !== 'string') {
    throw new AppError('Search query is required', 400);
  }

  const query = q.trim();
  if (query.length < 2) {
    throw new AppError('Search query must be at least 2 characters', 400);
  }

  const limitNum = parseInt(limit as string);
  const pageNum = parseInt(page as string);
  const skip = (pageNum - 1) * limitNum;

  // Track search for analytics
  trackSearch(query);

  const results: Record<string, unknown[]> = {
    creators: [],
    posts: [],
    users: [],
    hashtags: [],
  };

  // Search creators
  if (type === 'all' || type === 'creator') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creatorWhere: any = {
      status: 'ACTIVE',
      OR: [
        { displayName: { contains: query, mode: 'insensitive' } },
        { bio: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
      ],
    };

    if (category) creatorWhere.category = category;
    if (verified !== undefined) creatorWhere.isVerified = verified === 'true';

    const creators = await prisma.creator.findMany({
      where: creatorWhere,
      take: type === 'all' ? 5 : limitNum,
      skip: type === 'all' ? 0 : skip,
      include: {
        _count: {
          select: {
            followers: true,
            posts: true,
          },
        },
      },
    });

    results.creators = formatSearchResults(creators, query, 'creator');
  }

  // Search posts
  if (type === 'all' || type === 'post') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postWhere: any = {
      isPublished: true,
      content: { contains: query, mode: 'insensitive' },
    };

    if (dateFrom) {
      postWhere.publishedAt = { ...postWhere.publishedAt, gte: new Date(dateFrom as string) };
    }
    if (dateTo) {
      postWhere.publishedAt = { ...postWhere.publishedAt, lte: new Date(dateTo as string) };
    }
    if (category) {
      postWhere.creator = { category };
    }

    const posts = await prisma.post.findMany({
      where: postWhere,
      take: type === 'all' ? 5 : limitNum,
      skip: type === 'all' ? 0 : skip,
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

    results.posts = formatSearchResults(posts, query, 'post');
  }

  // Search users (only if searching for users specifically)
  if (type === 'user') {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limitNum,
      skip,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        creator: {
          select: {
            id: true,
            displayName: true,
            isVerified: true,
          },
        },
      },
    });

    results.users = formatSearchResults(users, query, 'user');
  }

  // Search hashtags (extract from posts)
  if (type === 'all' || type === 'hashtag') {
    if (query.startsWith('#')) {
      const tag = query.substring(1);
      const postsWithTag = await prisma.post.findMany({
        where: {
          isPublished: true,
          content: { contains: `#${tag}`, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (postsWithTag.length > 0) {
        results.hashtags = [{
          type: 'hashtag',
          id: query,
          title: query,
          subtitle: `${postsWithTag.length} posts`,
          url: `/search?q=${encodeURIComponent(query)}`,
          relevance: 100,
        }];
      }
    }
  }

  // Calculate totals
  const totals = {
    creators: results.creators.length,
    posts: results.posts.length,
    users: results.users.length,
    hashtags: results.hashtags.length,
  };

  return res.json({
    success: true,
    data: {
      query,
      type,
      results,
      totals,
      pagination: {
        page: pageNum,
        limit: limitNum,
      },
    },
  });
});

// ===========================================
// AUTOCOMPLETE SEARCH
// GET /api/search/autocomplete
// ===========================================

export const autocompleteSearch = asyncHandler(async (req: Request, res: Response) => {
  const { q, limit = '10' } = req.query;

  if (!q || typeof q !== 'string') {
    throw new AppError('Search query is required', 400);
  }

  const query = q.trim();
  if (query.length < 2) {
    return res.json({
      success: true,
      data: { suggestions: [] },
    });
  }

  const limitNum = parseInt(limit as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allResults: any[] = [];

  // Quick searches with small limits for autocomplete
  const [creators, posts] = await Promise.all([
    prisma.creator.findMany({
      where: {
        isActive: true,
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 5,
      select: {
        id: true,
        displayName: true,
        profileImage: true,
        isVerified: true,
        category: true,
        bio: true,
      },
    }),
    prisma.post.findMany({
      where: {
        isPublished: true,
        content: { contains: query, mode: 'insensitive' },
      },
      take: 5,
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    }),
  ]);

  // Format and combine results
  const formattedCreators = formatSearchResults(creators, query, 'creator');
  const formattedPosts = formatSearchResults(posts, query, 'post');

  allResults.push(...formattedCreators, ...formattedPosts);

  // Get top suggestions
  const suggestions = getAutocompleteSuggestions(allResults, limitNum);

  return res.json({
    success: true,
    data: { suggestions },
  });
});

// ===========================================
// GET POPULAR SEARCHES
// GET /api/search/popular
// ===========================================

export const getPopularSearchesController = asyncHandler(async (req: Request, res: Response) => {
  const { limit = '10' } = req.query;
  const limitNum = parseInt(limit as string);

  const popularQueries = getPopularSearches(limitNum);

  return res.json({
    success: true,
    data: { popular: popularQueries },
  });
});

// ===========================================
// SEARCH SUGGESTIONS (Based on user activity)
// GET /api/search/suggestions
// ===========================================

export const getSearchSuggestions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  // Get suggestions based on user's interests and activity
  const suggestions: string[] = [];

  if (userId) {
    // Get user's followed creators categories
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: { category: true },
        },
      },
      take: 10,
    });

    const categories = following
      .map((f) => f.following.category)
      .filter((c): c is string => c !== null);
    suggestions.push(...categories);
  }

  // Add popular searches
  const popular = getPopularSearches(5);
  suggestions.push(...popular);

  // Remove duplicates and limit
  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 10);

  return res.json({
    success: true,
    data: { suggestions: uniqueSuggestions },
  });
});
