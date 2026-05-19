// ===========================================
// ADMIN ROUTES
// ===========================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getVectorCount, getOnlineUserCount } from '../sockets';
import { logError } from '../utils/logger';
import {
  getModerationQueue,
  getReportDetails,
  resolveReportAction,
  dismissReport,
  getModerationStatsController,
  getModerationLog,
  getUserModerationHistory
} from '../controllers/admin/moderation.controller';
import {
  getUserDetail,
  updateUser,
  updateUserRole,
  suspendUserAdmin,
  unsuspendUserAdmin,
  banUserAdmin,
  unbanUserAdmin,
  deleteUserAdmin,
  listCompanies,
  getCompanyDetail,
  updateCompany,
  updateContentStatus,
  deleteContent,
  getDealDetail,
  updateDealStatus,
  getSystemConfig,
  getEmailPreview
} from '../controllers/admin/admin.controller';
import creatorManagementRoutes from './admin/creator-management.routes';

const router = Router();

// All routes require admin authentication
router.use(authenticate, requireAdmin);

// Creator management (dashboard, analytics, pricing, payouts, etc.)
router.use('/', creatorManagementRoutes);

// ===========================================
// DASHBOARD STATS
// ===========================================

router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const warnings: string[] = [];
  const safeDb = async (
    label: string,
    fallback: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        warnings.push(label);
        logError(error, { context: `[AdminStats] ${label} failed` });
        return fallback;
      }
      throw error;
    }
  };

  // ===================================
  // 1. BASIC OVERVIEW STATS
  // ===================================
  const [
    totalUsers,
    totalCreators,
    totalCompanies,
    totalConversations,
    totalMessages,
    pendingVerifications,
    activeDeals
  ] = await Promise.all([
    safeDb('overview.totalUsers', 0, () => prisma.user.count()),
    safeDb('overview.totalCreators', 0, () => prisma.creator.count()),
    safeDb('overview.totalCompanies', 0, () => prisma.company.count()),
    safeDb('overview.totalConversations', 0, () => prisma.conversation.count()),
    safeDb('overview.totalMessages', 0, () => prisma.message.count()),
    safeDb('overview.pendingVerifications', 0, () => prisma.creator.count({ where: { isVerified: false } })),
    safeDb('overview.activeDeals', 0, () => prisma.deal.count({ where: { status: 'IN_PROGRESS' } }))
  ]);

  // ===================================
  // 2. GROWTH TRENDS (Last 8 Weeks)
  // ===================================
  const growthData = [];
  const now = new Date();

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (i * 7) - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [users, creators, companies, deals] = await Promise.all([
      safeDb(`growth.users.${i}`, 0, () => prisma.user.count({ where: { createdAt: { gte: weekStart, lt: weekEnd } } })),
      safeDb(`growth.creators.${i}`, 0, () => prisma.creator.count({ where: { createdAt: { gte: weekStart, lt: weekEnd } } })),
      safeDb(`growth.companies.${i}`, 0, () => prisma.company.count({ where: { createdAt: { gte: weekStart, lt: weekEnd } } })),
      safeDb(`growth.deals.${i}`, 0, () => prisma.deal.count({ where: { status: 'COMPLETED', completedAt: { gte: weekStart, lt: weekEnd } } }))
    ]);

    const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    growthData.push({ week: weekLabel, users, creators, companies, deals });
  }

  // ===================================
  // 3. REVENUE INSIGHTS
  // ===================================
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [totalRevenue, thisMonthRevenue, lastMonthRevenue] = await Promise.all([
    safeDb('revenue.total', { _sum: { platformFee: null } }, () => prisma.deal.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { platformFee: true }
    })),
    safeDb('revenue.thisMonth', { _sum: { platformFee: null } }, () => prisma.deal.aggregate({
      where: { status: 'COMPLETED', completedAt: { gte: thisMonthStart } },
      _sum: { platformFee: true }
    })),
    safeDb('revenue.lastMonth', { _sum: { platformFee: null } }, () => prisma.deal.aggregate({
      where: { status: 'COMPLETED', completedAt: { gte: lastMonthStart, lte: lastMonthEnd } },
      _sum: { platformFee: true }
    }))
  ]);

  const totalRev = Number(totalRevenue._sum.platformFee || 0);
  const thisMonth = Number(thisMonthRevenue._sum.platformFee || 0);
  const lastMonth = Number(lastMonthRevenue._sum.platformFee || 0);
  const growthPercentage = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth * 100).toFixed(2) : '0.00';

  // Revenue breakdown
  const subscriptionRevenue = await safeDb('revenue.subscriptions', { _sum: { amount: null } }, () => prisma.transaction.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { amount: true }
  }));

  // ===================================
  // 4. TOP PERFORMERS
  // ===================================
  const [topCreatorsData, topCompaniesData, topActiveUsersData] = await Promise.all([
    safeDb('topPerformers.creators', [], async () => {
      const result = await prisma.deal.groupBy({
        by: ['creatorId'],
        _sum: { creatorEarnings: true },
        _count: { id: true },
        orderBy: { _sum: { creatorEarnings: 'desc' } },
        take: 5
      });
      return result;
    }),
    safeDb('topPerformers.companies', [], async () => {
      const result = await prisma.deal.groupBy({
        by: ['companyId'],
        _count: { id: true },
        _sum: { amount: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      });
      return result;
    }),
    safeDb('topPerformers.activeUsers', [], async () => {
      const result = await prisma.message.groupBy({
        by: ['userId'],
        where: { NOT: { userId: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      });
      return result;
    })
  ]);

  // Fetch names for top performers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creatorIds = topCreatorsData.map((c: any) => c.creatorId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyIds = topCompaniesData.map((c: any) => c.companyId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userIds = topActiveUsersData.map((u: any) => u.userId).filter((id: any): id is string => id !== null);

  const [creators, companies, users] = await Promise.all([
    safeDb('topPerformers.creatorNames', [], () => prisma.creator.findMany({ where: { id: { in: creatorIds } }, select: { id: true, displayName: true } })),
    safeDb('topPerformers.companyNames', [], () => prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, companyName: true } })),
    safeDb('topPerformers.userNames', [], () => prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }))
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creatorMap = new Map(creators.map((c: any) => [c.id, c.displayName]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyMap = new Map(companies.map((c: any) => [c.id, c.companyName]));
  const userMap = new Map<string, { name: string | null; email: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    users.map((u: any) => [u.id, { name: u.name, email: u.email }])
  );

  const topPerformers = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    creators: topCreatorsData.map((c: any) => ({
      name: creatorMap.get(c.creatorId) || 'Unknown',
      earnings: c._sum.creatorEarnings,
      dealCount: c._count.id
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    companies: topCompaniesData.map((c: any) => ({
      name: companyMap.get(c.companyId) || 'Unknown',
      dealCount: c._count.id,
      totalValue: c._sum.amount
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activeUsers: topActiveUsersData.map((u: any) => {
      const userData = u.userId ? userMap.get(u.userId) : null;
      return {
        name: userData?.name || 'Unknown',
        email: userData?.email || 'Unknown',
        messageCount: u._count.id
      };
    })
  };

  // ===================================
  // 5. ENGAGEMENT METRICS
  // ===================================
  const avgMessagesPerConversation = totalConversations > 0
    ? (totalMessages / totalConversations).toFixed(1)
    : '0.0';

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const dailyActiveUsers = await safeDb('engagement.dailyActiveUsers', 0, () => prisma.user.count({
    where: { lastLoginAt: { gte: sevenDaysAgo } }
  }));

  const verifiedCreators = await safeDb('engagement.verifiedCreators', 0, () => prisma.creator.count({ where: { isVerified: true } }));
  const creatorEngagementRate = totalCreators > 0
    ? ((verifiedCreators / totalCreators) * 100).toFixed(1)
    : '0.0';

  // ===================================
  // 6. RECENT ACTIVITY
  // ===================================
  const [recentDeals, recentUsers, recentVerifications, recentTransactions] = await Promise.all([
    safeDb('recent.deals', [], () => prisma.deal.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { displayName: true } },
        company: { select: { companyName: true } }
      }
    })),
    safeDb('recent.users', [], () => prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    })),
    safeDb('recent.verifications', [], () => prisma.creator.findMany({
      where: { isVerified: true },
      take: 5,
      orderBy: { verifiedAt: 'desc' },
      select: { id: true, displayName: true, verifiedAt: true }
    })),
    safeDb('recent.transactions', [], () => prisma.transaction.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            user: { select: { email: true } }
          }
        }
      }
    }))
  ]);

  // ===================================
  // 7. KEY PERFORMANCE INDICATORS
  // ===================================
  const avgDealValue = await safeDb('kpis.avgDealValue', { _avg: { amount: null } }, () => prisma.deal.aggregate({
    where: { status: 'COMPLETED' },
    _avg: { amount: true }
  }));

  const creatorToCompanyRatio = totalCompanies > 0
    ? (totalCreators / totalCompanies).toFixed(2)
    : '0.00';

  // Platform health score (0-100) based on multiple factors
  const healthFactors = [
    dailyActiveUsers > 0 ? 25 : 0,
    activeDeals > 0 ? 25 : 0,
    Number(creatorEngagementRate) > 50 ? 25 : Number(creatorEngagementRate) / 2,
    totalMessages > 1000 ? 25 : (totalMessages / 1000) * 25
  ];
  const platformHealthScore = Math.round(healthFactors.reduce((a, b) => a + b, 0));

  const responsePayload = {
    success: true,
    data: {
      overview: {
        totalUsers,
        totalCreators,
        totalCompanies,
        totalConversations,
        totalMessages,
        pendingVerifications,
        activeDeals,
        vectorCount: getVectorCount(),
        onlineUsers: getOnlineUserCount()
      },
      growth: {
        weekly: growthData
      },
      revenue: {
        total: totalRev,
        thisMonth,
        lastMonth,
        growthPercentage: Number(growthPercentage),
        breakdown: {
          subscriptions: Number(subscriptionRevenue._sum.amount || 0),
          deals: totalRev
        }
      },
      topPerformers,
      engagement: {
        avgMessagesPerConversation: Number(avgMessagesPerConversation),
        dailyActiveUsers,
        creatorEngagementRate: Number(creatorEngagementRate),
        totalEngagedCreators: verifiedCreators
      },
      recentActivity: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deals: recentDeals.map((d: any) => ({
          id: d.id,
          creator: d.creator.displayName,
          company: d.company.companyName,
          amount: d.amount,
          status: d.status,
          createdAt: d.createdAt
        })),
        users: recentUsers,
        verifications: recentVerifications,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transactions: recentTransactions.map((t: any) => ({
          id: t.id,
          user: t.subscription.user.email,
          amount: t.amount,
          status: t.status,
          createdAt: t.createdAt
        }))
      },
      kpis: {
        platformHealthScore,
        creatorToCompanyRatio: Number(creatorToCompanyRatio),
        avgDealValue: avgDealValue._avg.amount ? Math.round(Number(avgDealValue._avg.amount)) : 0,
        totalRevenue: totalRev
      }
    }
  };

  if (warnings.length > 0 && process.env.NODE_ENV === 'development') {
    res.json({
      ...responsePayload,
      warnings
    });
    return;
  }

  res.json(responsePayload);
}));

// ===========================================
// GET USERS
// ===========================================

router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20', role, search } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (role) {
    where.role = role;
  }
  if (search) {
    const term = String(search);
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } }
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
        createdAt: true,
        lastLoginAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    }),
    prisma.user.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
}));

// Get user detail
router.get('/users/:userId', getUserDetail);

// Update user profile
router.put('/users/:userId', updateUser);

// Update user role
router.put('/users/:userId/role', updateUserRole);

// Suspend / unsuspend user
router.post('/users/:userId/suspend', suspendUserAdmin);
router.post('/users/:userId/unsuspend', unsuspendUserAdmin);

// Ban / unban user
router.post('/users/:userId/ban', banUserAdmin);
router.post('/users/:userId/unban', unbanUserAdmin);

// Permanently delete user and all associated data
router.delete('/users/:userId', deleteUserAdmin);


// ===========================================
// VERIFY COMPANY
// ===========================================

router.post('/companies/:companyId/verify', asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.update({
    where: { id: req.params.companyId as string },
    data: {
      isVerified: true
    }
  });

  res.json({
    success: true,
    data: company
  });
}));

// List companies with filters
router.get('/companies', listCompanies);

// Company detail & updates
router.get('/companies/:companyId', getCompanyDetail);
router.put('/companies/:companyId', updateCompany);

// ===========================================
// GET ALL DEALS
// ===========================================

router.get('/deals', asyncHandler(async (req: Request, res: Response) => {
  const { status, page = '1', limit = '20' } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status) {
    where.status = status;
  }

  // 1. Fetch Paginated Deals
  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        creator: {
          select: {
            displayName: true
          }
        },
        company: {
          select: {
            companyName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum
    }),
    prisma.deal.count({ where })
  ]);

  // 2. Performance Metrics (Total, Overall)
  const [dealAggregates, completedDealCount] = await Promise.all([
    prisma.deal.aggregate({
      _sum: { amount: true, platformFee: true },
      _avg: { amount: true }
    }),
    prisma.deal.count({ where: { status: 'COMPLETED' } })
  ]);

  // 3. Average Completion Time (for completed deals)
  const completedDealsWithDates = await prisma.deal.findMany({
    where: { status: 'COMPLETED', NOT: { completedAt: null, startDate: null } },
    select: { startDate: true, completedAt: true }
  });

  let totalCompletionDays = 0;
  completedDealsWithDates.forEach(d => {
    if (d.completedAt && d.startDate) {
      const diffTime = Math.abs(d.completedAt.getTime() - d.startDate.getTime());
      totalCompletionDays += Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  });
  const avgCompletionDays = completedDealsWithDates.length > 0
    ? Math.round(totalCompletionDays / completedDealsWithDates.length)
    : 0;

  // 4. Status Distribution
  const statusCounts = await prisma.deal.groupBy({
    by: ['status'],
    _count: { id: true }
  });

  const totalAllDeals = statusCounts.reduce((acc, curr) => acc + curr._count.id, 0);
  const statusDistribution = {
    IN_PROGRESS: { count: 0, percentage: '0.00' },
    COMPLETED: { count: 0, percentage: '0.00' },
    CANCELLED: { count: 0, percentage: '0.00' },
    DISPUTED: { count: 0, percentage: '0.00' }
  };

  statusCounts.forEach(sc => {
    statusDistribution[sc.status as keyof typeof statusDistribution] = {
      count: sc._count.id,
      percentage: ((sc._count.id / totalAllDeals) * 100).toFixed(2)
    };
  });

  // 5. Top Performers (Companies & Creators)
  const [topCompaniesData, topCreatorsByEarningsData, topCreatorsByDealsData] = await Promise.all([
    prisma.deal.groupBy({
      by: ['companyId'],
      _count: { id: true },
      _sum: { amount: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    }),
    prisma.deal.groupBy({
      by: ['creatorId'],
      _sum: { creatorEarnings: true },
      _count: { id: true },
      orderBy: { _sum: { creatorEarnings: 'desc' } },
      take: 5
    }),
    prisma.deal.groupBy({
      by: ['creatorId'],
      _count: { id: true },
      _sum: { creatorEarnings: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    })
  ]);

  // Fetch names for top performers
  const topCompanyIds = topCompaniesData.map(c => c.companyId);
  const topCreatorIds = [...new Set([...topCreatorsByEarningsData.map(c => c.creatorId), ...topCreatorsByDealsData.map(c => c.creatorId)])];

  const [companies, creators] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: topCompanyIds } }, select: { id: true, companyName: true } }),
    prisma.creator.findMany({ where: { id: { in: topCreatorIds } }, select: { id: true, displayName: true } })
  ]);

  const companyMap = new Map(companies.map(c => [c.id, c.companyName]));
  const creatorMap = new Map(creators.map(c => [c.id, c.displayName]));

  const topPerformers = {
    companies: topCompaniesData.map(c => ({
      name: companyMap.get(c.companyId) || 'Unknown',
      dealCount: c._count.id,
      totalValue: c._sum.amount
    })),
    creatorsByEarnings: topCreatorsByEarningsData.map(c => ({
      name: creatorMap.get(c.creatorId) || 'Unknown',
      earnings: c._sum.creatorEarnings,
      dealCount: c._count.id
    })),
    creatorsByDeals: topCreatorsByDealsData.map(c => ({
      name: creatorMap.get(c.creatorId) || 'Unknown',
      dealCount: c._count.id,
      totalEarnings: c._sum.creatorEarnings
    }))
  };

  // 6. Monthly Trends (Last 6 Months)
  const trendsData = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = d;
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthLabel = d.toLocaleString('default', { month: 'short' });

    const [created, completed, revenue] = await Promise.all([
      prisma.deal.count({ where: { createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.deal.count({ where: { completedAt: { gte: monthStart, lte: monthEnd }, status: 'COMPLETED' } }),
      prisma.deal.aggregate({
        where: { completedAt: { gte: monthStart, lte: monthEnd }, status: 'COMPLETED' },
        _sum: { platformFee: true }
      })
    ]);

    trendsData.push({
      month: monthLabel,
      created,
      completed,
      revenue: revenue._sum.platformFee || 0
    });
  }

  // 7. Platform Analytics
  const [activeCompanies, activeCreators] = await Promise.all([
    prisma.company.count({ where: { deals: { some: {} } } }),
    prisma.creator.count({ where: { deals: { some: {} } } })
  ]);

  res.json({
    success: true,
    data: {
      deals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      metrics: {
        totalDealValue: dealAggregates._sum.amount || 0,
        totalPlatformRevenue: dealAggregates._sum.platformFee || 0,
        averageDealSize: dealAggregates._avg.amount ? Math.round(Number(dealAggregates._avg.amount)) : 0,
        averageCompletionDays: avgCompletionDays,
        successRate: totalAllDeals > 0 ? Number(((completedDealCount / totalAllDeals) * 100).toFixed(2)) : 0
      },
      statusDistribution,
      topPerformers,
      trends: {
        monthly: trendsData
      },
      analytics: {
        activeCompanies,
        activeCreators,
        avgDealsPerCompany: activeCompanies > 0 ? Number((totalAllDeals / activeCompanies).toFixed(1)) : 0,
        avgEarningsPerCreator: activeCreators > 0 ? Math.round(Number(dealAggregates._sum.amount || 0) * 0.9 / activeCreators) : 0
      }
    }
  });
}));

// Deal detail & status update
router.get('/deals/:dealId', getDealDetail);
router.patch('/deals/:dealId/status', updateDealStatus);

// ===========================================
// PLATFORM REVENUE
// ===========================================

router.get('/revenue', asyncHandler(async (req: Request, res: Response) => {
  const warnings = new Set<string>();
  const safeDb = async (
    label: string,
    fallback: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: () => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        warnings.add(label);
        logError(error, { context: `[AdminRevenue] ${label} failed` });
        return fallback;
      }
      throw error;
    }
  };

  // Subscription revenue
  const subscriptionRevenue = await safeDb(
    'revenueTotals.subscriptions',
    { _sum: { amount: null } },
    () => prisma.transaction.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true }
    })
  );

  // Deal commission revenue
  const dealRevenue = await safeDb(
    'revenueTotals.deals',
    { _sum: { platformFee: null } },
    () => prisma.deal.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { platformFee: true }
    })
  );

  // Subscription breakdown by plan
  const [freeSubscriptions, premiumSubscriptions] = await Promise.all([
    safeDb('subscriptions.plan.free', 0, () => prisma.subscription.count({ where: { plan: 'FREE' } })),
    safeDb('subscriptions.plan.premium', 0, () => prisma.subscription.count({ where: { plan: 'PREMIUM' } }))
  ]);

  // Premium subscription revenue (only PREMIUM plans generate revenue)
  const premiumRevenue = await safeDb(
    'subscriptions.premiumRevenue',
    { _sum: { amount: null } },
    () => prisma.transaction.aggregate({
      where: {
        status: 'COMPLETED',
        subscription: {
          plan: 'PREMIUM'
        }
      },
      _sum: { amount: true }
    })
  );

  // Subscription status breakdown
  const [activeSubscriptions, cancelledSubscriptions, expiredSubscriptions, pastDueSubscriptions] = await Promise.all([
    safeDb('subscriptions.status.active', 0, () => prisma.subscription.count({ where: { status: 'ACTIVE' } })),
    safeDb('subscriptions.status.cancelled', 0, () => prisma.subscription.count({ where: { status: 'CANCELLED' } })),
    safeDb('subscriptions.status.expired', 0, () => prisma.subscription.count({ where: { status: 'EXPIRED' } })),
    safeDb('subscriptions.status.pastDue', 0, () => prisma.subscription.count({ where: { status: 'PAST_DUE' } }))
  ]);

  // Transaction status breakdown
  const [completedTransactions, pendingTransactions, failedTransactions, refundedTransactions] = await Promise.all([
    safeDb('transactions.status.completed', 0, () => prisma.transaction.count({ where: { status: 'COMPLETED' } })),
    safeDb('transactions.status.pending', 0, () => prisma.transaction.count({ where: { status: 'PENDING' } })),
    safeDb('transactions.status.failed', 0, () => prisma.transaction.count({ where: { status: 'FAILED' } })),
    safeDb('transactions.status.refunded', 0, () => prisma.transaction.count({ where: { status: 'REFUNDED' } }))
  ]);

  // Recent transactions (last 20)
  const recentTransactions = await safeDb(
    'transactions.recent',
    [],
    () => prisma.transaction.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            user: {
              select: {
                email: true,
                name: true
              }
            }
          }
        }
      }
    })
  );

  // Format recent transactions for response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedTransactions = recentTransactions.map((tx: any) => ({
    id: tx.id,
    date: tx.createdAt,
    user: tx.subscription.user.email,
    plan: tx.subscription.plan,
    amount: tx.amount,
    status: tx.status,
    paymentId: tx.razorpayPaymentId || 'N/A'
  }));

  // Revenue Trend - Last 8 weeks of data
  const weeksAgo = 8;
  const revenueTrendData = [];
  const now = new Date();

  for (let i = weeksAgo - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (i * 7) - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    // Get subscription revenue for this week
    const weekSubscriptionRevenue = await safeDb(
      `revenueTrend.subscriptions.${i}`,
      { _sum: { amount: null } },
      () => prisma.transaction.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: weekStart,
            lt: weekEnd
          }
        },
        _sum: { amount: true }
      })
    );

    // Get deal commission for this week
    const weekDealRevenue = await safeDb(
      `revenueTrend.deals.${i}`,
      { _sum: { platformFee: null } },
      () => prisma.deal.aggregate({
        where: {
          status: 'COMPLETED',
          completedAt: {
            gte: weekStart,
            lt: weekEnd
          }
        },
        _sum: { platformFee: true }
      })
    );

    const weekTotal =
      (Number(weekSubscriptionRevenue._sum.amount) || 0) +
      (Number(weekDealRevenue._sum.platformFee) || 0);

    // Format date as "Jan 1", "Jan 8", etc.
    const dateLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    revenueTrendData.push({
      date: dateLabel,
      revenue: weekTotal,
      subscriptionRevenue: Number(weekSubscriptionRevenue._sum.amount) || 0,
      dealRevenue: Number(weekDealRevenue._sum.platformFee) || 0
    });
  }

  // Revenue Breakdown - Percentage split
  const totalRev =
    (Number(subscriptionRevenue._sum.amount) || 0) +
    (Number(dealRevenue._sum.platformFee) || 0);

  const revenueBreakdown = {
    dealCommission: {
      amount: Number(dealRevenue._sum.platformFee) || 0,
      percentage: totalRev > 0
        ? ((Number(dealRevenue._sum.platformFee) || 0) / totalRev * 100).toFixed(2)
        : 0
    },
    subscriptions: {
      amount: Number(subscriptionRevenue._sum.amount) || 0,
      percentage: totalRev > 0
        ? ((Number(subscriptionRevenue._sum.amount) || 0) / totalRev * 100).toFixed(2)
        : 0
    }
  };

  const responsePayload = {
    success: true,
    data: {
      // Revenue totals
      subscriptionRevenue: subscriptionRevenue._sum.amount || 0,
      dealCommissionRevenue: dealRevenue._sum.platformFee || 0,
      totalRevenue:
        (Number(subscriptionRevenue._sum.amount) || 0) +
        (Number(dealRevenue._sum.platformFee) || 0),

      // Subscription breakdown
      subscriptions: {
        byPlan: {
          FREE: {
            count: freeSubscriptions,
            revenue: 0
          },
          PREMIUM: {
            count: premiumSubscriptions,
            revenue: Number(premiumRevenue._sum.amount) || 0
          }
        },
        byStatus: {
          ACTIVE: activeSubscriptions,
          CANCELLED: cancelledSubscriptions,
          EXPIRED: expiredSubscriptions,
          PAST_DUE: pastDueSubscriptions
        },
        totalSubscribers: freeSubscriptions + premiumSubscriptions
      },

      // Transaction details
      transactions: {
        recent: formattedTransactions,
        byStatus: {
          COMPLETED: completedTransactions,
          PENDING: pendingTransactions,
          FAILED: failedTransactions,
          REFUNDED: refundedTransactions
        },
        totalCount: completedTransactions + pendingTransactions + failedTransactions + refundedTransactions
      },

      // Revenue Trend (for line chart)
      revenueTrend: revenueTrendData,

      // Revenue Breakdown (for pie chart)
      revenueBreakdown: revenueBreakdown
    }
  };

  if (warnings.size > 0 && process.env.NODE_ENV === 'development') {
    res.json({
      ...responsePayload,
      warnings: Array.from(warnings)
    });
    return;
  }

  res.json(responsePayload);
}));

router.patch('/contents/:contentId', updateContentStatus);
router.delete('/contents/:contentId', deleteContent);

// System config (safe)
router.get('/config', getSystemConfig);

// Email template preview
router.get('/email-preview', getEmailPreview);

// ===========================================
// MODERATION ROUTES
// ===========================================

// Get moderation queue (reports)
router.get('/moderation/reports', getModerationQueue);

// Get report details with context
router.get('/moderation/reports/:id', getReportDetails);

// Resolve report (take action)
router.post('/moderation/reports/:id/resolve', resolveReportAction);

// Dismiss report
router.post('/moderation/reports/:id/dismiss', dismissReport);

// Get moderation statistics
router.get('/moderation/stats', getModerationStatsController);

// Get moderation log (audit trail)
router.get('/moderation/logs', getModerationLog);

// Get user moderation history
router.get('/moderation/users/:userId/history', getUserModerationHistory);

export default router;
