// ===========================================
// CREATOR CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import { MessageRole } from '@prisma/client';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { invalidateCache } from '../middleware/cache';
import * as analyticsService from '../services/analytics.service';
import { emitToConversation, emitToUser } from '../sockets';
import { generateEmbedding, generateCreatorResponse, generateChatCompletion, isOpenAIConfigured } from '../utils/openai';
import { hybridSearch } from '../utils/vectorStore';
import { buildEnhancedContext } from '../utils/contextBuilder';
import { config } from '../config';
import { logError } from '../utils/logger';

type ReviewSort = 'newest' | 'oldest' | 'highest' | 'lowest';

// Shared review fetcher used by multiple endpoints to keep logic in one place
const getReviewData = async (
  creatorId: string,
  page = 1,
  limit = 10,
  sort: ReviewSort = 'newest'
) => {
  const pageNum = Math.max(1, page);
  const limitNum = Math.min(Math.max(1, limit), 50); // cap to avoid huge payloads
  const skip = (pageNum - 1) * limitNum;

  const [aggregate, breakdown, reviews] = await Promise.all([
    prisma.creatorReview.aggregate({
      where: { creatorId },
      _avg: { rating: true },
      _count: { rating: true }
    }),
    prisma.creatorReview.groupBy({
      by: ['rating'],
      where: { creatorId },
      _count: { rating: true }
    }),
    prisma.creatorReview.findMany({
      where: { creatorId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatar: true }
        }
      },
      orderBy: (() => {
        switch (sort) {
          case 'oldest':
            return { createdAt: 'asc' } as const;
          case 'highest':
            return [{ rating: 'desc' } as const, { createdAt: 'desc' } as const];
          case 'lowest':
            return [{ rating: 'asc' } as const, { createdAt: 'desc' } as const];
          case 'newest':
          default:
            return { createdAt: 'desc' } as const;
        }
      })(),
      skip,
      take: limitNum
    })
  ]);

  const breakdownMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  breakdown.forEach(item => {
    breakdownMap[item.rating] = item._count.rating;
  });

  const totalReviews = aggregate._count.rating || 0;
  const totalPages = totalReviews > 0 ? Math.ceil(totalReviews / limitNum) : 1;

  return {
    summary: {
      averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(1)) : 0,
      totalReviews,
      breakdown: breakdownMap
    },
    reviews: reviews.map(r => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment || '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: {
        id: r.user.id,
        name: r.user.name,
        email: r.user.email,
        avatar: r.user.avatar
      }
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalPages
    }
  };
};

// Graceful wrapper to avoid hard-failing if review table isn't present in some envs
const getReviewDataSafe = async (
  creatorId: string,
  page = 1,
  limit = 10,
  sort: ReviewSort = 'newest'
) => {
  try {
    return await getReviewData(creatorId, page, limit, sort);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Review data unavailable, returning empty fallback' });
    return {
      summary: {
        averageRating: 0,
        totalReviews: 0,
        breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      },
      reviews: [] as unknown[],
      pagination: {
        page: 1,
        limit,
        totalPages: 1
      }
    };
  }
};

// ===========================================
// GET ALL CREATORS (Public Gallery)
// ===========================================

export const getCreators = asyncHandler(async (req: Request, res: Response) => {
  const {
    category,
    search,
    page = '1',
    limit = '12',
    verified,
    minRating,
    priceFilter,
    sortBy = 'popular'
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    isActive: true
  };

  // Verified filter
  if (verified === 'true') {
    where.isVerified = true;
  }

  // Category filter
  if (category) {
    where.category = category as string;
  }

  // Rating filter
  if (minRating) {
    const rating = parseFloat(minRating as string);
    if (!isNaN(rating)) {
      where.rating = { gte: rating };
    }
  }

  // Price filter (for now, all creators are free - can be enhanced later)
  // This can be used when premium creators are introduced
  if (priceFilter === 'premium') {
    // Future: filter by subscription tier
  }

  // Search filter — matches name, bio, tagline, category, or any tag
  if (search) {
    where.OR = [
      { displayName: { contains: search as string, mode: 'insensitive' } },
      { bio: { contains: search as string, mode: 'insensitive' } },
      { tagline: { contains: search as string, mode: 'insensitive' } },
      { category: { contains: search as string, mode: 'insensitive' } },
      { tags: { has: search as string } },
    ];
  }

  // Build orderBy clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any[] = [];
  switch (sortBy) {
    case 'rating':
      orderBy = [{ rating: 'desc' }, { totalChats: 'desc' }];
      break;
    case 'newest':
      orderBy = [{ createdAt: 'desc' }];
      break;
    case 'alphabetical':
      orderBy = [{ displayName: 'asc' }];
      break;
    case 'popular':
    default:
      orderBy = [{ isVerified: 'desc' }, { totalChats: 'desc' }];
      break;
  }

  // Get creators with count
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
        suggestedQuestions: true,
        isVerified: true,
        isFeatured: true,
        totalChats: true,
        rating: true
      },
      orderBy,
      skip,
      take: limitNum
    }),
    prisma.creator.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      creators,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
});

// ===========================================
// GET SINGLE CREATOR (Public Profile)
// ===========================================

export const getCreator = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const creator = await prisma.creator.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true, // exposed so the fan client can listen for the creator's user_presence
      displayName: true,
      bio: true,
      tagline: true,
      profileImage: true,
      coverImage: true,
      category: true,
      tags: true,
      suggestedQuestions: true,
      youtubeUrl: true,
      instagramUrl: true,
      twitterUrl: true,
      websiteUrl: true,
      isVerified: true,
      isFeatured: true,
      totalChats: true,
      rating: true,
      welcomeMessage: true,
      followersCount: true,
      pricePerMessage: true,
      firstMessageFree: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // ===========================================
  // Enhanced public profile payload for landing page
  // ===========================================

  // 4 parallel queries — combined message counts, avg response, FAQs, trend data
  const [
    messageCounts,
    avgResponseAgg,
    faqItems,
    recentAssistantMessages,
  ] = await Promise.all([
    // Single groupBy replaces two separate count() calls
    prisma.message.groupBy({
      by: ['role'],
      where: { conversation: { creatorId: id } },
      _count: { _all: true }
    }),
    prisma.message.aggregate({
      _avg: { responseTimeMs: true },
      where: {
        conversation: { creatorId: id },
        role: MessageRole.ASSISTANT,
        responseTimeMs: { not: null }
      }
    }),
    prisma.creatorContent.findMany({
      where: {
        creatorId: id,
        type: 'FAQ',
        status: 'COMPLETED'
      },
      select: {
        id: true,
        title: true,
        rawText: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    }),
    // Capped at 200 rows — enough for 6-month trend without a full table scan
    prisma.message.findMany({
      where: {
        conversation: { creatorId: id },
        role: MessageRole.ASSISTANT,
        createdAt: {
          gte: (() => {
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
            sixMonthsAgo.setDate(1);
            return sixMonthsAgo;
          })()
        },
        responseTimeMs: { not: null }
      },
      select: { createdAt: true, responseTimeMs: true },
      orderBy: { createdAt: 'desc' },
      take: 200
    }),
  ]);

  const userMessageCount = messageCounts.find(m => m.role === MessageRole.USER)?._count._all ?? 0;
  const assistantMessageCount = messageCounts.find(m => m.role === MessageRole.ASSISTANT)?._count._all ?? 0;

  // Response rate: percentage of user messages that received an assistant reply (proxy)
  const responseRate = userMessageCount > 0
    ? Math.min(100, Math.round((assistantMessageCount / userMessageCount) * 100))
    : 0;

  const avgResponseTimeMs = avgResponseAgg._avg.responseTimeMs
    ? Math.round(Number(avgResponseAgg._avg.responseTimeMs))
    : null;

  // Topic expertise: derive from tags (preferred) or category, evenly distributed
  const topicsSource = creator.tags?.length ? creator.tags : (creator.category ? [creator.category] : ['General']);
  const baseShare = Math.floor(100 / topicsSource.length);
  const topicExpertise = topicsSource.map((topic, index) => ({
    topic,
    percentage: index === topicsSource.length - 1
      ? 100 - baseShare * (topicsSource.length - 1)
      : baseShare
  }));

  // Satisfaction trend: map average assistant response time to a 1-5 score for the last 6 months
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const responseTimeByMonth: Record<string, number[]> = {};

  recentAssistantMessages.forEach(msg => {
    const monthKey = `${msg.createdAt.getFullYear()}-${msg.createdAt.getMonth()}`;
    if (!responseTimeByMonth[monthKey]) responseTimeByMonth[monthKey] = [];
    if (msg.responseTimeMs !== null) {
      responseTimeByMonth[monthKey].push(msg.responseTimeMs);
    }
  });

  const satisfactionTrend = Array.from({ length: 6 }).map((_, idx) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - idx));
    date.setDate(1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const times = responseTimeByMonth[key] || [];
    const avgMs = times.length > 0
      ? times.reduce((acc, cur) => acc + cur, 0) / times.length
      : null;

    // Convert response time to a simple 1-5 score (faster responses -> higher score)
    const score = avgMs === null
      ? 0
      : Math.max(1, Math.min(5, Math.round(5 - (avgMs / 2000))));

    return {
      month: monthLabels[date.getMonth()],
      score
    };
  });

  // FAQs from processed creator content (FAQ type). If none exist, return an empty array for UI empty state.
  const parseFaqItem = (item: typeof faqItems[number]) => {
    const entries: {
      id: string;
      question: string;
      answer: string;
      createdAt: Date;
    }[] = [];

    const text = item.rawText || '';
    const qaRegex = /Q:\s*([\s\S]*?)\s*A:\s*([\s\S]*?)(?=\nQ:|$)/g;
    let match: RegExpExecArray | null;
    let idx = 1;

    while ((match = qaRegex.exec(text)) !== null) {
      entries.push({
        id: `${item.id}-${idx}`,
        question: match[1].trim(),
        answer: match[2].trim(),
        createdAt: item.createdAt
      });
      idx += 1;
    }

    // Fallback to single entry if no structured Q/A detected
    if (entries.length === 0) {
      entries.push({
        id: item.id,
        question: item.title || 'FAQ',
        answer: text.trim(),
        createdAt: item.createdAt
      });
    }

    return entries;
  };

  // Expand each FAQ content blob into individual Q/A pairs to keep UI tidy
  const faqs = faqItems.flatMap(parseFaqItem);

  // Online presence — derived from the in-memory userSockets map
  const { isUserOnline } = await import('../sockets');
  const isOnline = creator.userId ? isUserOnline(creator.userId) : false;

  res.json({
    success: true,
    data: {
      ...creator,
      isOnline,
      rating: creator.rating ? Number(creator.rating) : null,
      followers: {
        count: creator.followersCount ?? 0,
      },
      totalAiAnswers: assistantMessageCount,
      performance: {
        responseRate,
        avgResponseTimeMs,
        avgResponseTimeSeconds: avgResponseTimeMs !== null ? Number((avgResponseTimeMs / 1000).toFixed(2)) : null,
        totalChats: assistantMessageCount,
        rating: creator.rating ? Number(creator.rating) : null
      },
      topicExpertise,
      satisfactionTrend,
      faqs
    }
  });
});

// ===========================================
// GET CREATOR CONTENT (Public)
// ===========================================

export const getCreatorContent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  // Verify creator exists
  const creator = await prisma.creator.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // Get creator's content
  const contents = await prisma.creatorContent.findMany({
    where: {
      creatorId: id,
      status: 'COMPLETED'
    },
    select: {
      id: true,
      title: true,
      type: true,
      sourceUrl: true,
      createdAt: true
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  // Format content items
  const contentItems = contents.map(content => ({
    id: content.id,
    title: content.title,
    type: content.type,
    url: content.sourceUrl,
    publishedAt: content.createdAt.toISOString(),
  }));

  res.json({
    success: true,
    data: contentItems
  });
});

// ===========================================
// GET ONBOARDING STATUS
// ===========================================

export const getOnboardingStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: {
      id: true,
      bio: true,
      category: true,
      profileImage: true,
      aiPersonality: true,
      aiTone: true,
      contents: {
        select: {
          status: true
        }
      }
    }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Calculate onboarding status
  const profileSetup = !!(creator.bio && creator.category && creator.profileImage);
  const contentUploaded = creator.contents.length > 0;
  const contentProcessed = creator.contents.some(c => c.status === 'COMPLETED');
  const aiConfigured = !!(creator.aiPersonality && creator.aiTone);

  const isComplete = profileSetup && contentProcessed && aiConfigured;

  res.json({
    success: true,
    data: {
      isComplete,
      stepsCompleted: {
        profileSetup,
        contentUploaded,
        contentProcessed,
        aiConfigured
      },
      progress: {
        total: 4,
        completed: [profileSetup, contentProcessed, aiConfigured].filter(Boolean).length,
        percentage: Math.round(([profileSetup, contentProcessed, aiConfigured].filter(Boolean).length / 3) * 100)
      }
    }
  });
});

// ===========================================
// GET CREATOR DASHBOARD (Own Profile)
// ===========================================

export const getCreatorDashboard = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    include: {
      contents: {
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          errorMessage: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      },
      applications: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          opportunity: {
            select: {
              id: true,
              title: true,
              company: {
                select: {
                  companyName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      },
      deals: {
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          company: {
            select: {
              companyName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Get recent chat stats
  const recentChats = await prisma.conversation.count({
    where: {
      creatorId: creator.id,
      createdAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    }
  });

  // Count total AI responses for this creator
  const totalAiAnswers = await prisma.message.count({
    where: {
      role: 'ASSISTANT',
      conversation: { creatorId: creator.id },
    },
  });

  // Count AI answers today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const aiAnswersToday = await prisma.message.count({
    where: {
      role: 'ASSISTANT',
      conversation: { creatorId: creator.id },
      createdAt: { gte: todayStart },
    },
  });

  // Top questions this week — get recent USER messages from this creator's conversations
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentUserMessages = await prisma.message.findMany({
    where: {
      role: 'USER',
      conversation: { creatorId: creator.id },
      createdAt: { gte: oneWeekAgo },
    },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // Group by similar questions (simple: take first 50 chars as key)
  const questionMap = new Map<string, { question: string; count: number }>();
  for (const msg of recentUserMessages) {
    const text = msg.content.trim();
    if (text.length < 3) continue;
    const key = text.substring(0, 60).toLowerCase();
    const existing = questionMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      questionMap.set(key, { question: text.length > 80 ? text.substring(0, 80) + '...' : text, count: 1 });
    }
  }
  const topQuestions = Array.from(questionMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Demographics — get DOBs and locations of users who chatted with this creator
  const chatUsers = await prisma.conversation.findMany({
    where: { creatorId: creator.id, userId: { not: null } },
    select: { user: { select: { dateOfBirth: true, location: true } } },
    distinct: ['userId'],
  });

  const ageBuckets: Record<string, number> = { '13-17': 0, '18-24': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55+': 0 };
  const now = new Date();
  let usersWithAge = 0;
  for (const c of chatUsers) {
    if (!c.user?.dateOfBirth) continue;
    const age = Math.floor((now.getTime() - new Date(c.user.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    usersWithAge++;
    if (age < 18) ageBuckets['13-17']++;
    else if (age < 25) ageBuckets['18-24']++;
    else if (age < 35) ageBuckets['25-34']++;
    else if (age < 45) ageBuckets['35-44']++;
    else if (age < 55) ageBuckets['45-54']++;
    else ageBuckets['55+']++;
  }
  const ageBreakdown = Object.entries(ageBuckets).map(([label, count]) => ({
    label,
    count,
    percentage: usersWithAge > 0 ? Math.round((count / usersWithAge) * 100) : 0,
  }));

  // Location breakdown
  const locationMap = new Map<string, number>();
  for (const c of chatUsers) {
    const loc = c.user?.location?.trim();
    if (!loc) continue;
    locationMap.set(loc, (locationMap.get(loc) || 0) + 1);
  }
  const locationBreakdown = Array.from(locationMap.entries())
    .map(([location, count]) => ({
      location,
      count,
      percentage: chatUsers.length > 0 ? Math.round((count / chatUsers.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const [followersCount, topFollowers] = await Promise.all([
    prisma.follow.count({ where: { followingId: creator.id } }).catch(() => 0),
    prisma.follow.findMany({
      where: { followingId: creator.id },
      include: {
        follower: {
          select: { id: true, name: true, email: true, avatar: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    }).catch(() => [])
  ]);

  const reviewData = await getReviewDataSafe(creator.id, 1, 10, 'newest');

  res.json({
    success: true,
    data: {
      ...creator,
      rejected: Boolean(creator.isRejected),
      rejectionReason: creator.rejectionReason ?? null,
      stats: {
        recentChats,
        totalContents: creator.contents.length,
        totalAiAnswers,
        aiAnswersToday,
      },
      topQuestions,
      ageBreakdown,
      locationBreakdown,
      followers: {
        count: followersCount,
        top: topFollowers.map(f => ({
          followId: f.id,
          followerId: f.followerId,
          name: f.follower?.name,
          email: f.follower?.email,
          avatar: f.follower?.avatar,
          followedAt: f.createdAt
        }))
      },
      reviews: reviewData
    }
  });
});

// ===========================================
// UPDATE CREATOR PROFILE
// ===========================================

export const updateCreatorProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  // Safely handle cases where req.body might be undefined (e.g. unsupported content-type like raw multipart without parser)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (req.body || {}) as any;
  const {
    displayName,
    bio,
    tagline,
    profileImage,
    coverImage,
    category,
    tags,
    youtubeUrl,
    instagramUrl,
    twitterUrl,
    websiteUrl,
    aiPersonality,
    aiTone,
    welcomeMessage,
    personaConfig,
    fewShotQA,
    pricePerMessage,
    firstMessageFree,
    discountFirstFive
  } = body;

  const creator = await prisma.creator.update({
    where: { userId },
    data: {
      ...(displayName && { displayName }),
      ...(bio !== undefined && { bio }),
      ...(tagline !== undefined && { tagline }),
      ...(profileImage && { profileImage }),
      ...(coverImage && { coverImage }),
      ...(category && { category }),
      ...(tags && { tags }),
      ...(youtubeUrl !== undefined && { youtubeUrl }),
      ...(instagramUrl !== undefined && { instagramUrl }),
      ...(twitterUrl !== undefined && { twitterUrl }),
      ...(websiteUrl !== undefined && { websiteUrl }),
      ...(aiPersonality !== undefined && { aiPersonality }),
      ...(aiTone !== undefined && { aiTone }),
      ...(welcomeMessage !== undefined && { welcomeMessage }),
      ...(personaConfig !== undefined && { personaConfig }),
      ...(fewShotQA !== undefined && { fewShotQA }),
      ...(pricePerMessage !== undefined && { pricePerMessage: Number(pricePerMessage) }),
      ...(firstMessageFree !== undefined && { firstMessageFree: Boolean(firstMessageFree) }),
      ...(discountFirstFive !== undefined && { discountFirstFive: Number(discountFirstFive) }),
      ...(body.bankAccount && {
        bankAccount: {
          upsert: {
            create: {
              accountHolderName: body.bankAccount.accountHolderName,
              accountNumber: body.bankAccount.accountNumber,
              ifscCode: body.bankAccount.ifscCode,
              bankName: body.bankAccount.bankName,
            },
            update: {
              accountHolderName: body.bankAccount.accountHolderName,
              accountNumber: body.bankAccount.accountNumber,
              ifscCode: body.bankAccount.ifscCode,
              bankName: body.bankAccount.bankName,
            }
          }
        }
      })
    }
  });

  // Invalidate creator caches
  await invalidateCache(`cache:/api/creators/${creator.id}*`); // Specific creator
  await invalidateCache('cache:/api/creators?*'); // Creator list
  await invalidateCache('cache:/api/creators/categories*'); // Categories

  // Calculate if profile is complete (bio, category, and profileImage are required)
  const isProfileComplete = !!(creator.bio && creator.category && creator.profileImage);

  res.json({
    success: true,
    data: {
      ...creator,
      isProfileComplete
    }
  });
});

// ===========================================
// GET CREATOR ANALYTICS
// ===========================================

export const getCreatorAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: {
      id: true,
      totalChats: true,
      totalMessages: true,
      totalEarnings: true,
      rating: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // Get daily chat counts for last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    where: {
      creatorId: creator.id,
      createdAt: { gte: thirtyDaysAgo }
    },
    select: {
      createdAt: true
    }
  });

  // Group by date
  const chatsByDate: Record<string, number> = {};
  conversations.forEach(conv => {
    const date = conv.createdAt.toISOString().split('T')[0];
    chatsByDate[date] = (chatsByDate[date] || 0) + 1;
  });

  // Get top topics (simplified - based on message count)
  const messageStats = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversation: { creatorId: creator.id }
    },
    _count: { id: true }
  });

  res.json({
    success: true,
    data: {
      overview: {
        totalChats: creator.totalChats,
        totalMessages: creator.totalMessages,
        totalEarnings: creator.totalEarnings,
        rating: creator.rating
      },
      chatsByDate,
      totalConversationsLast30Days: conversations.length,
      avgMessagesPerConversation: messageStats.length > 0
        ? messageStats.reduce((acc, m) => acc + m._count.id, 0) / messageStats.length
        : 0
    }
  });
});

// ===========================================
// GET ENGAGEMENT TREND (Creator only)
// Returns chats per day for last N days (default 7)
// ===========================================

export const getEngagementTrend = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const days = Math.min(Math.max(parseInt((req.query.days as string) || '7', 10), 1), 90); // clamp 1-90

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const isHourly = days <= 1;
  const since = new Date();

  if (isHourly) {
    // Last 24 hours
    since.setHours(since.getHours() - 23, 0, 0, 0);
  } else {
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);
  }

  // Count messages (ASSISTANT role = AI answers)
  const messages = await prisma.message.findMany({
    where: {
      role: 'ASSISTANT',
      conversation: { creatorId: creator.id },
      createdAt: { gte: since },
    },
    select: { createdAt: true },
  });

  const counts: Record<string, number> = {};

  if (isHourly) {
    // 24 hourly buckets
    for (let i = 0; i < 24; i++) {
      const d = new Date(since);
      d.setHours(since.getHours() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
      counts[key] = 0;
    }
    messages.forEach(msg => {
      const d = msg.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
      if (counts[key] !== undefined) {
        counts[key] += 1;
      }
    });
  } else {
    // Daily buckets
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().split('T')[0];
      counts[key] = 0;
    }
    messages.forEach(msg => {
      const key = msg.createdAt.toISOString().split('T')[0];
      if (counts[key] !== undefined) {
        counts[key] += 1;
      }
    });
  }

  const trend = Object.entries(counts).map(([date, count]) => ({ date, count }));

  res.json({
    success: true,
    data: {
      days,
      trend
    }
  });
});

// ===========================================
// GET USER RETENTION ANALYTICS
// ===========================================

export const getUserRetentionAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const retentionData = await analyticsService.getUserRetention(creator.id);

  res.json({
    success: true,
    data: retentionData
  });
});

// ===========================================
// GET REVENUE FORECAST
// ===========================================

export const getRevenueForecast = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const forecastData = await analyticsService.getRevenueForecast(creator.id);

  res.json({
    success: true,
    data: forecastData
  });
});

// ===========================================
// GET ACTIVITY HEATMAP
// ===========================================

export const getActivityHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const heatmapData = await analyticsService.getPeakActivityHours(creator.id);

  res.json({
    success: true,
    data: heatmapData
  });
});

// ===========================================
// GET CONVERSION FUNNEL
// ===========================================

export const getConversionFunnel = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const funnelData = await analyticsService.getConversionFunnel(creator.id);

  res.json({
    success: true,
    data: funnelData
  });
});

// ===========================================
// GET COMPARATIVE ANALYTICS
// ===========================================

export const getComparativeAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { days = '30' } = req.query;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const comparisonData = await analyticsService.getComparativeAnalytics(
    creator.id,
    parseInt(days as string)
  );

  res.json({
    success: true,
    data: comparisonData
  });
});

// ===========================================
// GET CREATOR APPLICATIONS
// ===========================================

export const getCreatorApplications = asyncHandler(async (req: Request, res: Response) => {
  // Clear any potential bad cache hitting this endpoint mistakenly
  await invalidateCache('cache:/api/creators/applications*');

  const userId = req.user!.id;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const applications = await prisma.application.findMany({
    where: { creatorId: creator.id },
    include: {
      opportunity: {
        select: {
          id: true,
          title: true,
          status: true,
          deadline: true,
          company: {
            select: {
              companyName: true,
              logo: true
            }
          }
        }
      },
      deal: {
        select: {
          id: true,
          status: true,
          amount: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    success: true,
    data: applications
  });
});

// ===========================================
// GET CREATOR REVIEWS (Public, paginated)
// ===========================================

export const getCreatorReviews = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { page = '1', limit = '10', sort = 'newest' } = req.query;

  const creator = await prisma.creator.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const sortValue: ReviewSort = ['newest', 'oldest', 'highest', 'lowest'].includes(sort as string)
    ? (sort as ReviewSort)
    : 'newest';

  const data = await getReviewData(
    id,
    parseInt(page as string, 10),
    parseInt(limit as string, 10),
    sortValue
  );

  res.json({
    success: true,
    data
  });
});

// ===========================================
// ADD / UPDATE CREATOR REVIEW (Public, auth)
// ===========================================

export const addCreatorReview = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params as { id: string };
  const { rating, comment } = req.body as { rating: number; comment?: string };

  const creator = await prisma.creator.findUnique({
    where: { id },
    select: { id: true, userId: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  if (creator.userId === userId) {
    throw new AppError('Creators cannot review themselves', 400);
  }

  const ratingValue = Number(rating);

  const review = await prisma.creatorReview.create({
    data: {
      creatorId: id,
      userId,
      rating: ratingValue,
      comment
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    }
  });

  const aggregate = await prisma.creatorReview.aggregate({
    where: { creatorId: id },
    _avg: { rating: true },
    _count: { rating: true }
  });

  await prisma.creator.update({
    where: { id },
    data: {
      rating: aggregate._avg.rating || null
    }
  });

  // Invalidate caches to reflect new rating and review list
  await invalidateCache(`cache:/api/creators/${id}*`);
  await invalidateCache('cache:/api/creators?*');

  res.json({
    success: true,
    data: {
      review: {
        id: review.id,
        rating: review.rating,
        comment: review.comment || '',
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        user: review.user
      },
      summary: {
        averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(1)) : 0,
        totalReviews: aggregate._count.rating || 0
      }
    }
  });
});

// ===========================================
// UPDATE A REVIEW (must be owner)
// ===========================================

export const updateCreatorReview = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id, reviewId } = req.params as { id: string; reviewId: string };
  const { rating, comment } = req.body as { rating: number; comment?: string };

  const existing = await prisma.creatorReview.findUnique({
    where: { id: reviewId }
  });

  if (!existing || existing.creatorId !== id) {
    throw new AppError('Review not found', 404);
  }

  if (existing.userId !== userId) {
    throw new AppError('You can only edit your own reviews', 403);
  }

  const review = await prisma.creatorReview.update({
    where: { id: reviewId },
    data: { rating: Number(rating), comment },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true }
      }
    }
  });

  const aggregate = await prisma.creatorReview.aggregate({
    where: { creatorId: id },
    _avg: { rating: true },
    _count: { rating: true }
  });

  await prisma.creator.update({
    where: { id },
    data: { rating: aggregate._avg.rating || null }
  });

  await invalidateCache(`cache:/api/creators/${id}*`);
  await invalidateCache('cache:/api/creators?*');

  res.json({
    success: true,
    data: {
      review: {
        id: review.id,
        rating: review.rating,
        comment: review.comment || '',
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        user: review.user
      },
      summary: {
        averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(1)) : 0,
        totalReviews: aggregate._count.rating || 0
      }
    }
  });
});

// ===========================================
// DELETE A REVIEW (must be owner)
// ===========================================

export const deleteCreatorReview = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id, reviewId } = req.params as { id: string; reviewId: string };

  const existing = await prisma.creatorReview.findUnique({
    where: { id: reviewId }
  });

  if (!existing || existing.creatorId !== id) {
    throw new AppError('Review not found', 404);
  }

  if (existing.userId !== userId) {
    throw new AppError('You can only delete your own reviews', 403);
  }

  await prisma.creatorReview.delete({
    where: { id: reviewId }
  });

  const aggregate = await prisma.creatorReview.aggregate({
    where: { creatorId: id },
    _avg: { rating: true },
    _count: { rating: true }
  });

  await prisma.creator.update({
    where: { id },
    data: { rating: aggregate._avg.rating || null }
  });

  await invalidateCache(`cache:/api/creators/${id}*`);
  await invalidateCache('cache:/api/creators?*');

  res.json({
    success: true,
    data: {
      summary: {
        averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(1)) : 0,
        totalReviews: aggregate._count.rating || 0
      }
    }
  });
});

// ===========================================
// GET CREATOR FOLLOWERS (Creator dashboard)
// ===========================================

export const getFollowers = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page = '1', limit = '20' } = req.query;

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true, followersCount: true }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [followers, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: creator.id },
      include: {
        follower: { select: { id: true, name: true, email: true, avatar: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    }),
    prisma.follow.count({ where: { followingId: creator.id } })
  ]);

  res.json({
    success: true,
    data: {
      followers: followers.map(f => ({
        followId: f.id,
        followerId: f.followerId,
        name: f.follower.name,
        email: f.follower.email,
        avatar: f.follower.avatar,
        followedAt: f.createdAt
      })),
      totals: {
        followersCount: creator.followersCount,
        total
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalPages: total > 0 ? Math.ceil(total / limitNum) : 1
      }
    }
  });
});

// ===========================================
// REMOVE FOLLOWER (Creator dashboard)
// ===========================================

export const removeFollower = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { followerId } = req.params as { followerId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true, followersCount: true }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const existing = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId,
        followingId: creator.id
      }
    }
  });

  if (!existing) {
    throw new AppError('Follower not found', 404);
  }

  await prisma.follow.delete({
    where: {
      followerId_followingId: {
        followerId,
        followingId: creator.id
      }
    }
  });

  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      followersCount: { decrement: creator.followersCount > 0 ? 1 : 0 }
    }
  });

  // Invalidate caches for public creator profile
  await invalidateCache(`cache:/api/creators/${creator.id}*`);
  await invalidateCache('cache:/api/creators?*');

  res.json({
    success: true,
    message: 'Follower removed successfully'
  });
});

// ===========================================
// GET CATEGORIES
// ===========================================

export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = await prisma.creator.groupBy({
    by: ['category'],
    where: {
      category: { not: null },
      isActive: true,
      isVerified: true
    },
    _count: { id: true }
  });

  res.json({
    success: true,
    data: categories
      .filter(c => c.category)
      .map(c => ({
        name: c.category,
        count: c._count.id
      }))
  });
});

// ===========================================
// CREATOR CHAT INBOX (read-only view of
// conversations happening with the creator's AI clone)
// ===========================================

export const getMyConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const where = { creatorId: creator.id };

  const [conversations, total, activeCount] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, role: true, createdAt: true }
        }
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    }),
    prisma.conversation.count({ where }),
    prisma.conversation.count({ where: { ...where, isActive: true } })
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        total,
        active: activeCount
      },
      conversations: conversations.map(conv => ({
        id: conv.id,
        user: conv.user
          ? { id: conv.user.id, name: conv.user.name, avatar: conv.user.avatar }
          : { id: null, name: 'Guest', avatar: null },
        isGuest: !conv.userId,
        isActive: conv.isActive,
        mode: (conv as unknown as { chatMode?: string }).chatMode || 'AI',
        messageCount: conv._count.messages,
        lastMessage: conv.messages[0] ?? null,
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
});

export const getMyConversationDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { conversationId } = req.params as { conversationId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true, displayName: true }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { id: true, name: true, email: true, avatar: true } },
      messages: { orderBy: { createdAt: 'asc' } }
    }
  });

  if (!conversation || conversation.creatorId !== creator.id) {
    throw new AppError('Conversation not found', 404);
  }

  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation.id,
        isActive: conversation.isActive,
        mode: (conversation as unknown as { chatMode?: string }).chatMode || 'AI',
        takenOverAt: (conversation as unknown as { takenOverAt?: Date | null }).takenOverAt || null,
        releasedAt: (conversation as unknown as { releasedAt?: Date | null }).releasedAt || null,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        user: conversation.user
          ? { id: conversation.user.id, name: conversation.user.name, avatar: conversation.user.avatar }
          : { id: null, name: 'Guest', avatar: null },
        isGuest: !conversation.userId,
        creator: { id: creator.id, displayName: creator.displayName }
      },
      messages: conversation.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        media: m.media,
        createdAt: m.createdAt
      }))
    }
  });
});

// ===========================================
// MANUAL TAKEOVER
// Toggle a conversation between AI mode (auto-replies) and MANUAL mode
// (creator types replies by hand). Per-conversation, creator-owned.
// ===========================================

export const setConversationMode = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { conversationId } = req.params as { conversationId: string };
  const { mode } = req.body as { mode?: 'AI' | 'MANUAL' };

  if (mode !== 'AI' && mode !== 'MANUAL') {
    throw new AppError('mode must be either AI or MANUAL', 400);
  }

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true, displayName: true }
  });
  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, creatorId: true, chatMode: true }
  });
  if (!conversation || conversation.creatorId !== creator.id) {
    throw new AppError('Conversation not found', 404);
  }

  if (conversation.chatMode === mode) {
    res.json({ success: true, data: { conversationId, mode, unchanged: true } });
    return;
  }

  const now = new Date();
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      chatMode: mode as 'AI' | 'MANUAL',
      ...(mode === 'MANUAL' ? { takenOverAt: now } : { releasedAt: now })
    },
    select: { id: true, chatMode: true, takenOverAt: true, releasedAt: true }
  });

  // Notify the conversation room (fan sees the badge change live)
  emitToConversation(conversationId, 'conversation:mode-changed', {
    conversationId,
    mode: updated.chatMode,
    creatorDisplayName: creator.displayName
  });

  // Notify the creator's other tabs/sessions so the inbox stays in sync
  emitToUser(userId, 'conversation:mode-changed', {
    conversationId,
    mode: updated.chatMode
  });

  res.json({
    success: true,
    data: {
      conversationId,
      mode: updated.chatMode,
      takenOverAt: updated.takenOverAt,
      releasedAt: updated.releasedAt
    }
  });
});

export const replyAsCreator = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { conversationId } = req.params as { conversationId: string };
  const { content } = req.body as { content?: string };

  if (!content || !content.trim()) {
    throw new AppError('Message content is required', 400);
  }
  if (content.length > 2000) {
    throw new AppError('Message must be less than 2000 characters', 400);
  }

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { id: true, displayName: true }
  });
  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, creatorId: true, chatMode: true }
  });
  if (!conversation || conversation.creatorId !== creator.id) {
    throw new AppError('Conversation not found', 404);
  }
  if (conversation.chatMode !== 'MANUAL') {
    throw new AppError('Conversation is not in manual mode. Take over first.', 400);
  }

  // Save the manual creator reply
  const message = await prisma.message.create({
    data: {
      conversationId,
      userId, // The creator's user account is the author
      role: 'CREATOR',
      content: content.trim()
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });

  // Emit to the conversation room (fan sees it instantly)
  emitToConversation(conversationId, 'message:new', { message });

  // Also push to the creator's own user room (for other open creator tabs)
  emitToUser(userId, 'creator:message:new', {
    conversationId,
    message,
    creatorId: creator.id
  });

  res.status(201).json({
    success: true,
    data: { message }
  });
});

// Generate an AI reply for a queued fan message — used when a fan message
// arrived during MANUAL mode and got stranded with no response. The creator
// can click a button in the UI to ask the AI to reply now.
export const generateAiReplyForLastMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { conversationId } = req.params as { conversationId: string };

  if (!isOpenAIConfigured()) {
    throw new AppError('AI is not configured on the server', 503);
  }

  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: {
      id: true,
      displayName: true,
      aiPersonality: true,
      aiTone: true,
      responseStyle: true,
      welcomeMessage: true,
      personaConfig: true,
      fewShotQA: true
    }
  });
  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, creatorId: true }
  });
  if (!conversation || conversation.creatorId !== creator.id) {
    throw new AppError('Conversation not found', 404);
  }

  // The latest message must be from USER (otherwise there's nothing to reply to).
  const latest = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, role: true, content: true }
  });
  if (!latest || latest.role !== 'USER') {
    throw new AppError('No unanswered fan message to reply to', 400);
  }

  // Build conversation history (last 10 messages, oldest first)
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  const conversationHistory = recent
    .reverse()
    .map((m) => ({
      role: m.role === 'ASSISTANT' || m.role === 'CREATOR' ? 'assistant' : 'user',
      content: m.content
    })) as { role: 'user' | 'assistant'; content: string }[];

  const userPrompt = latest.content;

  // Build context the same way sendMessage does
  await generateEmbedding(userPrompt); // primes any caches; result not directly used because hybridSearch handles it
  const context = await buildEnhancedContext({
    creatorId: creator.id,
    userMessage: userPrompt,
    conversationHistory,
    maxChunks: 3,
    minScore: 0.7,
    useHybridSearch: true,
    includeConversationSummary: conversationHistory.length > 10
  });

  const startTime = Date.now();
  const aiResponse = await generateCreatorResponse(
    userPrompt,
    {
      creatorName: creator.displayName,
      personality: creator.aiPersonality || undefined,
      tone: creator.aiTone || undefined,
      responseStyle: creator.responseStyle || undefined,
      welcomeMessage: creator.welcomeMessage || undefined,
      personaConfig: (creator.personaConfig as import('../utils/openai').PersonaConfig | null) || null,
      fewShotQA: (creator.fewShotQA as unknown as import('../utils/openai').FewShotQA[] | null) || null,
      relevantChunks: context.relevantChunks.map((c) => c.text),
      conversationSummary: context.conversationSummary
    },
    context.enhancedHistory,
    context.conversationSummary
  );
  const responseTimeMs = Date.now() - startTime;

  const aiMessage = await prisma.message.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      content: aiResponse.content,
      tokensUsed: aiResponse.tokensUsed,
      modelUsed: config.openai.model,
      responseTimeMs
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });

  // Emit to conversation room (fan sees it instantly) and to creator inbox
  emitToConversation(conversationId, 'message:new', { message: aiMessage });
  emitToUser(userId, 'creator:message:new', {
    conversationId,
    message: aiMessage,
    creatorId: creator.id
  });

  res.status(201).json({
    success: true,
    data: { message: aiMessage }
  });
});

// ===========================================
// AI GENERATION HELPERS (Onboarding)
// ===========================================

export const generateBio = asyncHandler(async (req: Request, res: Response) => {
  if (!isOpenAIConfigured()) {
    throw new AppError('OpenAI is not configured', 503);
  }

  const userId = req.user!.id;
  const creator = await prisma.creator.findUnique({ where: { userId } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const { tagline, displayName, category, tags } = req.body;
  const finalTagline = tagline || creator.tagline;
  if (!finalTagline) throw new AppError('Tagline is required to generate a bio', 400);

  const finalName = displayName || creator.displayName || 'Creator';
  const finalCategory = category || creator.category || '';
  const finalTags = (tags || creator.tags || []).join(', ');

  const { content } = await generateChatCompletion([
    {
      role: 'system',
      content: 'You are a creative copywriter for a creator platform. Write a compelling, authentic 2-3 sentence bio for a creator based on the provided information. The bio should be written in first person, feel personal and engaging, and reflect the creator\'s expertise. Keep it under 200 words.'
    },
    {
      role: 'user',
      content: `Creator Name: ${finalName}\nTagline: ${finalTagline}${finalCategory ? `\nCategory: ${finalCategory}` : ''}${finalTags ? `\nTags: ${finalTags}` : ''}\n\nWrite a bio that introduces this creator, highlights their expertise, and invites fans to engage.`
    }
  ], { maxTokens: 300, temperature: 0.8 });

  res.json({ success: true, data: { bio: content.trim() } });
});

export const generateAiPersonality = asyncHandler(async (req: Request, res: Response) => {
  if (!isOpenAIConfigured()) {
    throw new AppError('OpenAI is not configured', 503);
  }

  const userId = req.user!.id;
  const creator = await prisma.creator.findUnique({ where: { userId } });
  if (!creator) throw new AppError('Creator profile not found', 404);

  const { displayName, category, tagline, bio, aiTone, tags } = req.body;
  const finalName = displayName || creator.displayName || 'Creator';
  const finalCategory = category || creator.category || '';
  const finalTagline = tagline || creator.tagline || '';
  const finalBio = bio || creator.bio || '';
  const finalTone = aiTone || creator.aiTone || 'friendly';
  const finalTags = (tags || creator.tags || []).join(', ');

  const { content } = await generateChatCompletion([
    {
      role: 'system',
      content: 'You are an expert at crafting AI chatbot system prompts. Create a detailed personality/system prompt for an AI clone of a content creator on a platform where fans can chat with the creator\'s AI. Write the personality prompt in 150-250 words as direct instructions to the AI, not as a description about the AI.'
    },
    {
      role: 'user',
      content: `Creator Name: ${finalName}${finalCategory ? `\nCategory: ${finalCategory}` : ''}${finalTagline ? `\nTagline: ${finalTagline}` : ''}${finalBio ? `\nBio: ${finalBio}` : ''}\nCommunication Tone: ${finalTone}${finalTags ? `\nExpertise Tags: ${finalTags}` : ''}\n\nGenerate a system prompt that will guide this AI to:\n1. Respond as this creator in first person\n2. Match their communication tone (${finalTone})\n3. Stay focused on their expertise areas\n4. Be warm, helpful, and authentic\n5. Know when to admit limitations`
    }
  ], { maxTokens: 500, temperature: 0.7 });

  res.json({ success: true, data: { aiPersonality: content.trim() } });
});
