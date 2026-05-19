
// ===========================================
// CREATOR MANAGEMENT (ADMIN)
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../../prisma/client';
import { asyncHandler, AppError } from '../../middleware/errorHandler';
import { buildEnhancedContext } from '../../utils/contextBuilder';
import { generateCreatorResponse, isOpenAIConfigured } from '../../utils/openai';
import {
  completePayoutEntry,
  createPayoutEntry,
  getEarningsBreakdown
} from '../../utils/earnings';
import { EarningsType, PayoutStatus } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

const toNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return undefined;
};

const formatDate = (date: Date) => date.toISOString().split('T')[0];

const parseTimeframe = (timeframe?: string) => {
  const now = new Date();
  if (!timeframe) {
    return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, days: 7, label: '7d' };
  }

  const normalized = timeframe.toLowerCase();
  if (normalized === 'week' || normalized === '7d') {
    return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, days: 7, label: '7d' };
  }
  if (normalized === '30d' || normalized === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, days: 30, label: 'month' };
  }
  if (normalized === '90d' || normalized === 'quarter') {
    return { start: new Date(now.getTime() - 90 * DAY_MS), end: now, days: 90, label: '90d' };
  }
  if (normalized === 'year' || normalized === '365d') {
    return { start: new Date(now.getFullYear(), 0, 1), end: now, days: 365, label: 'year' };
  }
  if (/^\d+d$/.test(normalized)) {
    const days = parseInt(normalized.replace('d', ''), 10);
    return { start: new Date(now.getTime() - days * DAY_MS), end: now, days, label: normalized };
  }
  if (/^\d+m$/.test(normalized)) {
    const months = parseInt(normalized.replace('m', ''), 10);
    return { start: new Date(now.getFullYear(), now.getMonth() - months, now.getDate()), end: now, days: months * 30, label: normalized };
  }

  return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, days: 7, label: '7d' };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildCreatorUpdateData = (body: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};

  if (body.displayName !== undefined) data.displayName = body.displayName;
  if (body.category !== undefined) data.category = body.category;
  if (body.bio !== undefined) data.bio = body.bio;
  if (body.tagline !== undefined) data.tagline = body.tagline;
  if (body.profileImage !== undefined) data.profileImage = body.profileImage;
  if (body.coverImage !== undefined) data.coverImage = body.coverImage;
  if (body.tags !== undefined) data.tags = body.tags;

  if (body.youtubeUrl !== undefined) data.youtubeUrl = body.youtubeUrl;
  if (body.instagramUrl !== undefined) data.instagramUrl = body.instagramUrl;
  if (body.twitterUrl !== undefined) data.twitterUrl = body.twitterUrl;
  if (body.websiteUrl !== undefined) data.websiteUrl = body.websiteUrl;

  if (body.aiPersonality !== undefined) data.aiPersonality = body.aiPersonality;
  if (body.aiTone !== undefined) data.aiTone = body.aiTone;
  if (body.responseStyle !== undefined) data.responseStyle = body.responseStyle;
  if (body.welcomeMessage !== undefined) data.welcomeMessage = body.welcomeMessage;

  if (body.pricePerMessage !== undefined) data.pricePerMessage = toNumber(body.pricePerMessage);
  if (body.firstMessageFree !== undefined) data.firstMessageFree = Boolean(body.firstMessageFree);
  if (body.discountFirstFive !== undefined) data.discountFirstFive = toNumber(body.discountFirstFive);

  if (body.maxMessagesPerDay !== undefined) data.maxMessagesPerDay = toNumber(body.maxMessagesPerDay);

  const allowNewConversations = parseBoolean(body.allowNewConversations);
  if (allowNewConversations !== undefined) data.allowNewConversations = allowNewConversations;

  const isEnabled = parseBoolean(body.isEnabled);
  const isActive = parseBoolean(body.isActive);
  if (isEnabled !== undefined) data.isActive = isEnabled;
  if (isActive !== undefined) data.isActive = isActive;

  const isVerified = parseBoolean(body.isVerified);
  if (isVerified !== undefined) {
    data.isVerified = isVerified;
    data.verifiedAt = isVerified ? new Date() : null;
  }

  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod;
  if (body.bankDetails !== undefined) data.bankDetails = body.bankDetails;
  if (body.payoutSchedule !== undefined) data.payoutSchedule = body.payoutSchedule;
  if (body.minimumPayout !== undefined) data.minimumPayout = toNumber(body.minimumPayout);
  if (body.taxInfo !== undefined) data.taxInfo = body.taxInfo;

  return data;
};

// ===========================================
// DASHBOARD
// ===========================================

export const getCreatorDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const [
    totalCreators,
    activeCreators,
    pendingReviews,
    rejectedCreators,
    totalConversations,
    totalMessages,
    avgRatingAgg,
    revenueAgg
  ] = await Promise.all([
    prisma.creator.count(),
    prisma.creator.count({ where: { isActive: true } }),
    prisma.creator.count({ where: { isVerified: false, isActive: true } }),
    prisma.creator.count({ where: { isActive: false } }),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.creator.aggregate({ _avg: { rating: true } }),
    prisma.creator.aggregate({ _sum: { lifetimeEarnings: true } })
  ]);

  const recentCreators = await prisma.creator.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      displayName: true,
      category: true,
      isVerified: true,
      isActive: true,
      createdAt: true
    }
  });

  const topPerformingCreators = await prisma.creator.findMany({
    take: 5,
    orderBy: [
      { totalEarnings: 'desc' },
      { totalMessages: 'desc' }
    ],
    select: {
      id: true,
      displayName: true,
      totalEarnings: true,
      totalMessages: true,
      rating: true
    }
  });

  const categoryCounts = await prisma.creator.groupBy({
    by: ['category'],
    where: { category: { not: null } },
    _count: { id: true }
  });

  const categoryDistribution = categoryCounts.reduce<Record<string, number>>((acc, item) => {
    if (item.category) acc[item.category] = item._count.id;
    return acc;
  }, {});

  const growthTrend: Array<{ period: string; count: number }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const periodStart = new Date(now.getTime() - (i + 1) * 7 * DAY_MS);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart.getTime() + 7 * DAY_MS);

    const count = await prisma.creator.count({
      where: { createdAt: { gte: periodStart, lt: periodEnd } }
    });

    growthTrend.push({
      period: `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      count
    });
  }

  res.json({
    success: true,
    data: {
      stats: {
        totalCreators,
        activeCreators,
        pendingReviews,
        rejectedCreators,
        totalConversations,
        totalMessages,
        avgResponseQuality: Number((avgRatingAgg._avg.rating || 0).toFixed(1)),
        totalRevenue: Number(revenueAgg._sum.lifetimeEarnings || 0)
      },
      recentCreators,
      topPerformingCreators: topPerformingCreators.map((creator) => ({
        id: creator.id,
        name: creator.displayName,
        totalMessages: creator.totalMessages,
        totalEarnings: Number(creator.totalEarnings || 0),
        rating: creator.rating ? Number(creator.rating) : null
      })),
      categoryDistribution,
      growthTrend
    }
  });
});
// ===========================================
// CREATOR LISTING & DETAILS
// ===========================================

export const listCreators = asyncHandler(async (req: Request, res: Response) => {
  const {
    page = '1',
    limit = '20',
    search,
    verified,
    active,
    category
  } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (category) where.category = category;
  if (verified !== undefined) where.isVerified = String(verified) === 'true';
  if (active !== undefined) where.isActive = String(active) === 'true';
  if (search) {
    const term = String(search);
    where.OR = [
      { displayName: { contains: term, mode: 'insensitive' } },
      { user: { name: { contains: term, mode: 'insensitive' } } },
      { user: { email: { contains: term, mode: 'insensitive' } } }
    ];
  }

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isVerified: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: (pageNum - 1) * limitNum
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

export const getPendingCreators = asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20' } = req.query;
  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where: { isVerified: false },
      include: {
        user: {
          select: {
            email: true,
            createdAt: true
          }
        },
        _count: {
          select: { contents: true }
        }
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: limitNum
    }),
    prisma.creator.count({ where: { isVerified: false } })
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

export const getCreatorDetails = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isVerified: true,
          createdAt: true,
          lastLoginAt: true
        }
      },
      bankAccount: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  let bankAccount = null;
  if (creator.bankAccount) {
    const maskedAccountNumber = creator.bankAccount.accountNumber
      ? creator.bankAccount.accountNumber.slice(-4).padStart(creator.bankAccount.accountNumber.length, '*')
      : null;

    bankAccount = {
      ...creator.bankAccount,
      accountNumber: maskedAccountNumber,
      panNumber: creator.bankAccount.panNumber ? '******' + creator.bankAccount.panNumber.slice(-4) : null
    };
  }

  res.json({
    success: true,
    data: {
      creator: {
        ...creator,
        bankAccount: undefined
      },
      bankAccount
    }
  });
});

export const updateCreator = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const data = buildCreatorUpdateData(req.body);

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data
  });

  res.json({ success: true, data: creator });
});

export const updateCreatorProfile = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const profileData = buildCreatorUpdateData({
    displayName: req.body.displayName,
    category: req.body.category,
    bio: req.body.bio,
    tagline: req.body.tagline,
    profileImage: req.body.profileImage,
    coverImage: req.body.coverImage,
    tags: req.body.tags,
    youtubeUrl: req.body.youtubeUrl,
    instagramUrl: req.body.instagramUrl,
    twitterUrl: req.body.twitterUrl,
    websiteUrl: req.body.websiteUrl
  });

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: profileData
  });

  res.json({ success: true, data: creator });
});

export const updateCreatorAIConfig = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const aiData = buildCreatorUpdateData({
    aiPersonality: req.body.aiPersonality,
    aiTone: req.body.aiTone,
    responseStyle: req.body.responseStyle,
    welcomeMessage: req.body.welcomeMessage,
    pricePerMessage: req.body.pricePerMessage,
    firstMessageFree: req.body.firstMessageFree,
    discountFirstFive: req.body.discountFirstFive,
    maxMessagesPerDay: req.body.maxMessagesPerDay,
    allowNewConversations: req.body.allowNewConversations
  });

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: aiData
  });

  res.json({ success: true, data: creator });
});

export const toggleCreatorVerification = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const isVerified = parseBoolean(req.body?.isVerified);

  if (isVerified === undefined) {
    throw new AppError('isVerified is required', 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    isVerified,
    verifiedAt: isVerified ? new Date() : null
  };

  if (isVerified) {
    updateData.isRejected = false;
    updateData.rejectedAt = null;
    updateData.rejectionReason = null;
  }

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: updateData
  });

  res.json({ success: true, data: creator });
});

export const verifyCreator = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: {
      isVerified: true,
      verifiedAt: new Date(),
      isRejected: false,
      rejectedAt: null,
      rejectionReason: null
    }
  });

  res.json({ success: true, data: creator });
});

export const toggleCreatorStatus = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const isEnabled = parseBoolean(req.body?.isEnabled);
  const isActive = parseBoolean(req.body?.isActive);

  const nextStatus = isEnabled ?? isActive;
  if (nextStatus === undefined) {
    throw new AppError('isEnabled or isActive is required', 400);
  }

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: { isActive: nextStatus }
  });

  res.json({ success: true, data: creator });
});

export const rejectCreator = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { reason } = (req.body || {}) as { reason?: string };

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: {
      isActive: false,
      isVerified: false,
      verifiedAt: null,
      isRejected: true,
      rejectedAt: new Date(),
      rejectionReason: reason || null
    }
  });

  res.json({
    success: true,
    message: 'Creator application rejected',
    data: creator
  });
});
// ===========================================
// ANALYTICS
// ===========================================

export const getCreatorAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { timeframe = '7d' } = req.query as { timeframe?: string };
  const { start, end } = parseTimeframe(timeframe);

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { id: true, pricePerMessage: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const [
    totalConversations,
    totalMessages,
    conversationDurations,
    uniqueUserGroups,
    contentCount
  ] = await Promise.all([
    prisma.conversation.count({
      where: { creatorId, createdAt: { gte: start, lte: end } }
    }),
    prisma.message.count({
      where: { conversation: { creatorId }, createdAt: { gte: start, lte: end } }
    }),
    prisma.conversation.findMany({
      where: { creatorId, createdAt: { gte: start, lte: end } },
      select: { createdAt: true, lastMessageAt: true }
    }),
    prisma.conversation.groupBy({
      by: ['userId'],
      where: { creatorId, userId: { not: null }, createdAt: { gte: start, lte: end } },
      _count: { id: true }
    }),
    prisma.creatorContent.count({
      where: { creatorId, createdAt: { gte: start, lte: end } }
    })
  ]);

  const uniqueUsers = uniqueUserGroups.length;
  const repeatUsers = uniqueUserGroups.filter(u => u._count.id > 1).length;

  const avgSessionDuration = conversationDurations.length > 0
    ? Math.round(
      conversationDurations.reduce((acc, conv) => {
        const endAt = conv.lastMessageAt || conv.createdAt;
        return acc + (endAt.getTime() - conv.createdAt.getTime());
      }, 0) / conversationDurations.length / 1000
    )
    : 0;

  const earningsAgg = await prisma.earningsLedger.aggregate({
    where: {
      creatorId,
      type: EarningsType.CREDIT,
      createdAt: { gte: start, lte: end }
    },
    _sum: { amount: true }
  });

  const totalEarnings = Number(earningsAgg._sum.amount || 0);

  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  const thisMonthAgg = await prisma.earningsLedger.aggregate({
    where: {
      creatorId,
      type: EarningsType.CREDIT,
      createdAt: { gte: thisMonthStart }
    },
    _sum: { amount: true }
  });

  const revenueEntries = await prisma.earningsLedger.findMany({
    where: {
      creatorId,
      type: EarningsType.CREDIT,
      createdAt: { gte: start, lte: end }
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, amount: true }
  });

  const revenueOverTime: Array<{ date: string; amount: number }> = [];
  const revenueMap = new Map<string, number>();
  revenueEntries.forEach(entry => {
    const dateKey = formatDate(entry.createdAt);
    revenueMap.set(dateKey, (revenueMap.get(dateKey) || 0) + Number(entry.amount));
  });
  Array.from(revenueMap.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, amount]) => {
    revenueOverTime.push({ date, amount });
  });

  const conversationEntries = await prisma.conversation.findMany({
    where: { creatorId, createdAt: { gte: start, lte: end } },
    select: { createdAt: true }
  });

  const conversationMap = new Map<string, number>();
  conversationEntries.forEach(conv => {
    const dateKey = formatDate(conv.createdAt);
    conversationMap.set(dateKey, (conversationMap.get(dateKey) || 0) + 1);
  });

  const conversationsOverTime = Array.from(conversationMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const messagesByDayOfWeek = Array(7).fill(0);
  const messages = await prisma.message.findMany({
    where: { conversation: { creatorId }, createdAt: { gte: start, lte: end } },
    select: { createdAt: true }
  });
  messages.forEach(msg => {
    messagesByDayOfWeek[msg.createdAt.getDay()] += 1;
  });

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const messagesByDay = messagesByDayOfWeek.map((count, index) => ({
    day: dayLabels[index],
    count
  }));

  const topUsersStats = await prisma.message.groupBy({
    by: ['userId'],
    where: { conversation: { creatorId }, userId: { not: null }, createdAt: { gte: start, lte: end } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5
  });

  const topUserIds = topUsersStats.map(u => u.userId).filter((id): id is string => !!id);
  type TopUserRecord = { id: string; name: string | null; email: string | null };
  const users = await prisma.user.findMany({
    where: { id: { in: topUserIds } },
    select: { id: true, name: true, email: true }
  }) as TopUserRecord[];
  const userMap = new Map<string, TopUserRecord>(users.map(u => [u.id, u]));

  const topUsers = topUsersStats.map(stat => {
    const user = stat.userId ? userMap.get(stat.userId) : undefined;
    const estimatedSpend = creator.pricePerMessage * stat._count.id;
    return {
      id: stat.userId,
      name: user?.name || 'Unknown',
      email: user?.email || 'Unknown',
      totalMessages: stat._count.id,
      estimatedSpend
    };
  });

  const topContent = await prisma.creatorContent.findMany({
    where: { creatorId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, type: true, createdAt: true }
  });

  res.json({
    success: true,
    data: {
      engagement: {
        totalConversations,
        totalMessages,
        uniqueUsers,
        avgMessagesPerConversation: totalConversations > 0 ? Math.round(totalMessages / totalConversations) : 0,
        avgSessionDuration,
        retentionRate: uniqueUsers > 0 ? Number((repeatUsers / uniqueUsers).toFixed(2)) : 0,
        repeatUserRate: uniqueUsers > 0 ? Number((repeatUsers / uniqueUsers).toFixed(2)) : 0
      },
      revenue: {
        totalEarnings,
        thisMonth: Number(thisMonthAgg._sum.amount || 0),
        avgPerConversation: totalConversations > 0 ? Math.round(totalEarnings / totalConversations) : 0,
        trend: revenueOverTime
      },
      content: {
        totalUploaded: contentCount,
        topContent: topContent.map(item => ({
          id: item.id,
          title: item.title,
          type: item.type,
          references: 0,
          createdAt: item.createdAt
        }))
      },
      trends: {
        conversationsOverTime,
        revenueOverTime,
        messagesByDayOfWeek: messagesByDay
      },
      topUsers
    }
  });
});

// ===========================================
// SUBSCRIBERS
// ===========================================

export const getCreatorSubscribers = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { page = '1', limit = '20', search, status } = req.query as {
    page?: string;
    limit?: string;
    search?: string;
    status?: string;
  };

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { followingId: creatorId };
  if (search) {
    const term = String(search);
    where.follower = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } }
      ]
    };
  }

  const [followers, totalFollowers] = await Promise.all([
    prisma.follow.findMany({
      where,
      include: {
        follower: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    }),
    prisma.follow.count({ where: { followingId: creatorId } })
  ]);

  const followerIds = followers.map(f => f.followerId);
  const messageStats = await prisma.message.groupBy({
    by: ['userId'],
    where: {
      userId: { in: followerIds },
      conversation: { creatorId }
    },
    _count: { id: true },
    _max: { createdAt: true }
  });

  const statsMap = new Map<string, { totalMessages: number; lastMessageAt: Date | null }>();
  messageStats.forEach(stat => {
    if (stat.userId) {
      statsMap.set(stat.userId, {
        totalMessages: stat._count.id,
        lastMessageAt: stat._max.createdAt || null
      });
    }
  });

  const activeSince = new Date(Date.now() - 30 * DAY_MS);

  const allFollowerIds = await prisma.follow.findMany({
    where: { followingId: creatorId },
    select: { followerId: true }
  });
  const followerIdList = allFollowerIds.map(item => item.followerId);
  const activeChatterGroups = followerIdList.length > 0
    ? await prisma.message.groupBy({
      by: ['userId'],
      where: {
        userId: { in: followerIdList },
        conversation: { creatorId },
        createdAt: { gte: activeSince }
      }
    })
    : [];
  let activeChatters = activeChatterGroups.length;

  const subscribers = followers.map((follow) => {
    const stats = statsMap.get(follow.followerId);
    const lastMessageAt = stats?.lastMessageAt || null;
    const isActive = lastMessageAt ? lastMessageAt >= activeSince : false;
    if (isActive) activeChatters += 1;
    return {
      id: follow.follower.id,
      name: follow.follower.name,
      email: follow.follower.email,
      followedAt: follow.createdAt,
      totalMessages: stats?.totalMessages || 0,
      lastMessageAt,
      isActive
    };
  }).filter((subscriber) => {
    if (!status || status === 'all') return true;
    if (status === 'active') return subscriber.isActive;
    if (status === 'inactive') return !subscriber.isActive;
    return true;
  });

  res.json({
    success: true,
    data: {
      stats: {
        totalFollowers,
        activeChatters
      },
      subscribers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalFollowers,
        totalPages: Math.ceil(totalFollowers / limitNum)
      }
    }
  });
});
// ===========================================
// REVENUE
// ===========================================

export const getCreatorRevenue = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { timeframe = 'month' } = req.query as { timeframe?: string };
  const { start, end } = parseTimeframe(timeframe);

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { availableBalance: true, pendingBalance: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const earningsAgg = await prisma.earningsLedger.aggregate({
    where: { creatorId, type: EarningsType.CREDIT, createdAt: { gte: start, lte: end } },
    _sum: { amount: true }
  });
  const grossRevenue = Number(earningsAgg._sum.amount || 0);
  const platformFee = Math.round(grossRevenue * 0.2);
  const creatorShare = grossRevenue - platformFee;

  const trendEntries = await prisma.earningsLedger.findMany({
    where: { creatorId, type: EarningsType.CREDIT, createdAt: { gte: start, lte: end } },
    select: { createdAt: true, amount: true }
  });
  const trendMap = new Map<string, number>();
  trendEntries.forEach(entry => {
    const dateKey = formatDate(entry.createdAt);
    trendMap.set(dateKey, (trendMap.get(dateKey) || 0) + Number(entry.amount));
  });
  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));

  const transactions = await prisma.earningsLedger.findMany({
    where: { creatorId, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const payouts = await prisma.payout.findMany({
    where: { creatorId, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const latestPayout = payouts[0];
  const payoutStatus = latestPayout?.status === PayoutStatus.COMPLETED
    ? 'PAID'
    : latestPayout?.status || 'NONE';

  res.json({
    success: true,
    data: {
      summary: {
        grossRevenue,
        platformFee,
        creatorShare,
        payoutStatus
      },
      trend,
      transactions: transactions.map(tx => ({
        id: tx.id,
        date: tx.createdAt,
        type: tx.sourceType,
        amount: Number(tx.amount),
        status: tx.type,
        description: tx.description
      })),
      payouts: payouts.map(payout => ({
        id: payout.id,
        date: payout.createdAt,
        amount: Number(payout.amount),
        method: 'BANK_TRANSFER',
        status: payout.status
      })),
      balances: {
        availableBalance: Number(creator.availableBalance || 0),
        pendingBalance: Number(creator.pendingBalance || 0)
      }
    }
  });
});

// ===========================================
// PAYOUT CONFIGURATION
// ===========================================

export const getPayoutConfig = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: { bankAccount: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const bankAccount = creator.bankAccount
    ? {
      accountHolderName: creator.bankAccount.accountHolderName,
      accountNumber: creator.bankAccount.accountNumber
        ? creator.bankAccount.accountNumber.slice(-4).padStart(creator.bankAccount.accountNumber.length, '*')
        : null,
      bankName: creator.bankAccount.bankName,
      ifscCode: creator.bankAccount.ifscCode,
      isVerified: creator.bankAccount.isVerified,
      kycStatus: creator.bankAccount.kycStatus
    }
    : null;

  res.json({
    success: true,
    data: {
      paymentMethod: creator.paymentMethod,
      bankDetails: bankAccount || creator.bankDetails,
      schedule: creator.payoutSchedule,
      minimumPayout: creator.minimumPayout,
      taxInfo: creator.taxInfo,
      currentBalance: Number(creator.availableBalance || 0)
    }
  });
});

export const updatePayoutConfig = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const {
    paymentMethod,
    bankDetails,
    schedule,
    payoutSchedule,
    minimumPayout,
    taxInfo
  } = req.body;

  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const updatedCreator = await prisma.creator.update({
    where: { id: creatorId },
    data: {
      ...(paymentMethod !== undefined && { paymentMethod }),
      ...(bankDetails !== undefined && { bankDetails }),
      ...(schedule !== undefined && { payoutSchedule: schedule }),
      ...(payoutSchedule !== undefined && { payoutSchedule }),
      ...(minimumPayout !== undefined && { minimumPayout: toNumber(minimumPayout) }),
      ...(taxInfo !== undefined && { taxInfo })
    }
  });

  if (paymentMethod === 'BANK_TRANSFER' && bankDetails) {
    const accountHolderName = bankDetails.accountHolderName || bankDetails.accountName;
    const accountNumber = bankDetails.accountNumber;
    const ifscCode = bankDetails.ifscCode;
    const bankName = bankDetails.bankName;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      throw new AppError('Bank details are incomplete', 400);
    }

    await prisma.bankAccount.upsert({
      where: { creatorId },
      create: {
        creatorId,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        accountType: bankDetails.accountType || 'SAVINGS',
        isVerified: Boolean(bankDetails.isVerified),
        verifiedAt: bankDetails.isVerified ? new Date() : null,
        panNumber: bankDetails.panNumber || null,
        aadharLast4: bankDetails.aadharLast4 || null,
        kycStatus: bankDetails.isVerified ? 'VERIFIED' : 'PENDING'
      },
      update: {
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        accountType: bankDetails.accountType || 'SAVINGS',
        isVerified: Boolean(bankDetails.isVerified),
        verifiedAt: bankDetails.isVerified ? new Date() : null,
        panNumber: bankDetails.panNumber || null,
        aadharLast4: bankDetails.aadharLast4 || null,
        kycStatus: bankDetails.isVerified ? 'VERIFIED' : 'PENDING'
      }
    });
  }

  res.json({ success: true, data: updatedCreator });
});

export const processManualPayout = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { amount, notes } = req.body as { amount?: number; notes?: string };

  if (!amount || amount <= 0) {
    throw new AppError('Amount is required', 400);
  }

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: { bankAccount: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  if (!creator.bankAccount) {
    throw new AppError('Creator has no bank account on file', 400);
  }

  const availableBalance = Number(creator.availableBalance || 0);
  if (availableBalance < amount) {
    throw new AppError(`Insufficient balance. Available: INR ${availableBalance}`, 400);
  }

  const breakdown = await getEarningsBreakdown(creatorId);

  const payout = await prisma.payout.create({
    data: {
      creatorId,
      amount,
      fee: 0,
      netAmount: amount,
      currency: 'INR',
      subscriptionEarnings: breakdown.subscriptionEarnings,
      brandDealEarnings: breakdown.brandDealEarnings,
      status: PayoutStatus.PENDING,
      bankAccountId: creator.bankAccount.id,
      reviewedBy: req.user?.id,
      reviewedAt: new Date(),
      notes: notes || null
    }
  });

  await createPayoutEntry({
    creatorId,
    payoutId: payout.id,
    amount
  });

  await completePayoutEntry({
    creatorId,
    payoutId: payout.id,
    amount
  });

  const updatedPayout = await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status: PayoutStatus.COMPLETED,
      processedAt: new Date(),
      completedAt: new Date()
    }
  });

  res.json({
    success: true,
    data: updatedPayout
  });
});
// ===========================================
// CONVERSATION MONITORING
// ===========================================

export const getCreatorConversations = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { status = 'all', page = '1', limit = '20' } = req.query as {
    status?: string;
    page?: string;
    limit?: string;
  };

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  const flaggedCondition = {
    OR: [
      { isHidden: true },
      { flaggedKeywords: { isEmpty: false } },
      { toxicityScore: { gte: 0.7 } }
    ]
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = { creatorId };
  if (status === 'active') baseWhere.isActive = true;
  if (status === 'ended') baseWhere.isActive = false;
  if (status === 'flagged') baseWhere.messages = { some: flaggedCondition };

  const [conversations, total, activeCount, flaggedCount] = await Promise.all([
    prisma.conversation.findMany({
      where: baseWhere,
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    }),
    prisma.conversation.count({ where: { creatorId } }),
    prisma.conversation.count({ where: { creatorId, isActive: true } }),
    prisma.conversation.count({ where: { creatorId, messages: { some: flaggedCondition } } })
  ]);

  const flaggedMessages = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversation: { creatorId },
      ...flaggedCondition
    },
    _count: { id: true }
  });
  const flaggedMap = new Set(flaggedMessages.map(item => item.conversationId));

  res.json({
    success: true,
    data: {
      stats: {
        total,
        active: activeCount,
        flagged: flaggedCount
      },
      conversations: conversations.map(conv => ({
        id: conv.id,
        userId: conv.userId,
        userName: conv.user?.name || 'Guest',
        startedAt: conv.createdAt,
        messageCount: conv._count.messages,
        status: conv.isActive ? 'ACTIVE' : 'ENDED',
        isFlagged: flaggedMap.has(conv.id)
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

export const getConversationDetails = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params as { conversationId: string };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, displayName: true } },
      messages: { orderBy: { createdAt: 'asc' } }
    }
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 404);
  }

  res.json({
    success: true,
    data: {
      conversation: {
        id: conversation.id,
        creator: conversation.creator,
        user: conversation.user,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        isActive: conversation.isActive
      },
      messages: conversation.messages
    }
  });
});

// ===========================================
// ASSISTANT TESTING
// ===========================================

export const testCreatorAI = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { message, tone, responseStyle } = req.body as {
    message?: string;
    tone?: string;
    responseStyle?: string;
  };

  if (!message || !message.trim()) {
    throw new AppError('Message is required', 400);
  }

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      displayName: true,
      aiPersonality: true,
      aiTone: true,
      responseStyle: true,
      welcomeMessage: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  if (!isOpenAIConfigured()) {
    return res.json({
      success: true,
      data: {
        message: 'AI responses are currently disabled. Configure OPENAI_API_KEY to enable testing.',
        metadata: {
          responseTime: 0,
          tokensUsed: 0,
          relevanceScore: 0,
          contentSources: []
        }
      }
    });
  }

  const startTime = Date.now();
  const context = await buildEnhancedContext({
    creatorId: creator.id,
    userMessage: message,
    conversationHistory: [],
    maxChunks: 5,
    minScore: 0.7,
    useHybridSearch: true,
    includeConversationSummary: false
  });

  const aiResponse = await generateCreatorResponse(
    message,
    {
      creatorName: creator.displayName,
      personality: creator.aiPersonality || undefined,
      tone: tone || creator.aiTone || undefined,
      responseStyle: responseStyle || creator.responseStyle || undefined,
      welcomeMessage: creator.welcomeMessage || undefined,
      relevantChunks: context.relevantChunks.map(chunk => chunk.text),
      conversationSummary: context.conversationSummary
    },
    []
  );

  const responseTime = Date.now() - startTime;

  res.json({
    success: true,
    data: {
      message: aiResponse.content,
      metadata: {
        responseTime,
        tokensUsed: aiResponse.tokensUsed,
        relevanceScore: aiResponse.qualityScore ?? 0,
        contentSources: context.relevantChunks.map(chunk => ({
          title: chunk.source || 'Content',
          type: chunk.metadata?.contentType || null,
          score: chunk.score
        })),
        citations: aiResponse.citations || []
      }
    }
  });
});

// ===========================================
// PRICING CONFIGURATION
// ===========================================

export const getPricingConfig = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      pricePerMessage: true,
      firstMessageFree: true,
      discountFirstFive: true,
      updatedAt: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  res.json({
    success: true,
    data: {
      pricePerMessage: creator.pricePerMessage,
      firstMessageFree: creator.firstMessageFree,
      discountFirstFive: creator.discountFirstFive,
      updatedAt: creator.updatedAt
    }
  });
});

export const updatePricingConfig = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const {
    pricePerMessage,
    firstMessageFree,
    discountFirstFive,
    reason
  } = req.body as {
    pricePerMessage?: number;
    firstMessageFree?: boolean;
    discountFirstFive?: number;
    reason?: string;
  };

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { id: true }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  if (pricePerMessage !== undefined) updateData.pricePerMessage = toNumber(pricePerMessage);
  if (firstMessageFree !== undefined) updateData.firstMessageFree = Boolean(firstMessageFree);
  if (discountFirstFive !== undefined) {
    const discount = toNumber(discountFirstFive);
    if (discount < 0 || discount > 1) {
      throw new AppError('discountFirstFive must be between 0 and 1', 400);
    }
    updateData.discountFirstFive = discount;
  }

  const updatedCreator = await prisma.creator.update({
    where: { id: creatorId },
    data: updateData
  });

  await prisma.pricingHistory.create({
    data: {
      creatorId,
      pricePerMessage: updatedCreator.pricePerMessage,
      firstMessageFree: updatedCreator.firstMessageFree,
      discountFirstFive: updatedCreator.discountFirstFive,
      changedBy: req.user?.id || 'system',
      reason: reason || null
    }
  });

  res.json({ success: true, data: updatedCreator });
});

export const getPricingHistory = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const history = await prisma.pricingHistory.findMany({
    where: { creatorId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  res.json({
    success: true,
    data: history
  });
});

// ===========================================
// CREATOR CONTENT
// ===========================================

export const getCreatorContent = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { page = '1', limit = '20', status } = req.query as {
    page?: string;
    limit?: string;
    status?: string;
  };

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { creatorId };
  if (status) where.status = status;

  const [contents, total] = await Promise.all([
    prisma.creatorContent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: (pageNum - 1) * limitNum
    }),
    prisma.creatorContent.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      contents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
});

export const deleteCreatorContent = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId, contentId } = req.params as { creatorId: string; contentId: string };

  const content = await prisma.creatorContent.findFirst({
    where: { id: contentId, creatorId }
  });

  if (!content) {
    throw new AppError('Content not found', 404);
  }

  await prisma.creatorContent.delete({ where: { id: contentId } });

  res.json({ success: true, message: 'Content deleted' });
});
