// ===========================================
// ANALYTICS SERVICE
// Advanced analytics calculations
// ===========================================

import prisma from '../../prisma/client';

// ===========================================
// USER RETENTION ANALYSIS
// ===========================================

export interface RetentionCohort {
  cohortMonth: string;
  cohortSize: number;
  retention: {
    week1: number;
    week2: number;
    week4: number;
    week8: number;
  };
}

export const getUserRetention = async (creatorId: string): Promise<RetentionCohort[]> => {
  // Get all conversations for this creator
  const conversations = await prisma.conversation.findMany({
    where: { creatorId },
    include: {
      messages: {
        select: {
          createdAt: true,
          userId: true
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  // Build cohorts by month
  const cohorts = new Map<string, Set<string>>();
  const userFirstMessage = new Map<string, Date>();

  // Identify first message date for each user
  conversations.forEach(conv => {
    conv.messages.forEach(msg => {
      if (msg.userId) {
        if (!userFirstMessage.has(msg.userId)) {
          userFirstMessage.set(msg.userId, msg.createdAt);
        }
      }
    });
  });

  // Group users by cohort month
  userFirstMessage.forEach((firstDate, userId) => {
    const cohortKey = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, '0')}`;
    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, new Set());
    }
    cohorts.get(cohortKey)!.add(userId);
  });

  // Calculate retention for each cohort
  const results: RetentionCohort[] = [];

  cohorts.forEach((users, cohortKey) => {
    const cohortSize = users.size;
    const retention = {
      week1: 0,
      week2: 0,
      week4: 0,
      week8: 0
    };

    // Check retention for each user
    users.forEach(userId => {
      const firstDate = userFirstMessage.get(userId)!;
      const userMessages = conversations
        .flatMap(c => c.messages)
        .filter(m => m.userId === userId)
        .map(m => m.createdAt);

      // Check if user returned in each time window
      const hasMessageInWindow = (days: number) => {
        const windowStart = new Date(firstDate.getTime() + days * 24 * 60 * 60 * 1000);
        const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        return userMessages.some(d => d >= windowStart && d < windowEnd);
      };

      if (hasMessageInWindow(7)) retention.week1++;
      if (hasMessageInWindow(14)) retention.week2++;
      if (hasMessageInWindow(28)) retention.week4++;
      if (hasMessageInWindow(56)) retention.week8++;
    });

    results.push({
      cohortMonth: cohortKey,
      cohortSize,
      retention: {
        week1: cohortSize > 0 ? Math.round((retention.week1 / cohortSize) * 100) : 0,
        week2: cohortSize > 0 ? Math.round((retention.week2 / cohortSize) * 100) : 0,
        week4: cohortSize > 0 ? Math.round((retention.week4 / cohortSize) * 100) : 0,
        week8: cohortSize > 0 ? Math.round((retention.week8 / cohortSize) * 100) : 0
      }
    });
  });

  return results.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
};

// ===========================================
// REVENUE FORECASTING
// ===========================================

export interface RevenueForecast {
  historical: Array<{ month: string; revenue: number }>;
  forecast: Array<{ month: string; revenue: number; confidence: { low: number; high: number } }>;
  trend: 'increasing' | 'stable' | 'decreasing';
  growthRate: number;
}

export const getRevenueForecast = async (creatorId: string): Promise<RevenueForecast> => {
  // Get historical revenue data (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const payouts = await prisma.payout.findMany({
    where: {
      creatorId,
      status: 'COMPLETED',
      completedAt: { gte: sixMonthsAgo }
    },
    orderBy: { completedAt: 'asc' }
  });

  // Group by month
  const monthlyRevenue = new Map<string, number>();

  payouts.forEach(payout => {
    if (payout.completedAt) {
      const monthKey = `${payout.completedAt.getFullYear()}-${String(payout.completedAt.getMonth() + 1).padStart(2, '0')}`;
      monthlyRevenue.set(monthKey, (monthlyRevenue.get(monthKey) || 0) + Number(payout.amount));
    }
  });

  // Build historical data
  const historical = Array.from(monthlyRevenue.entries()).map(([month, revenue]) => ({
    month,
    revenue: Math.round(revenue)
  }));

  // Simple linear regression for forecasting
  const revenues = Array.from(monthlyRevenue.values());
  const n = revenues.length;

  if (n < 2) {
    return {
      historical,
      forecast: [],
      trend: 'stable',
      growthRate: 0
    };
  }

  // Calculate trend
  const xMean = (n - 1) / 2;
  const yMean = revenues.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;

  revenues.forEach((y, x) => {
    numerator += (x - xMean) * (y - yMean);
    denominator += Math.pow(x - xMean, 2);
  });

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;

  // Forecast next 3 months
  const forecast: Array<{ month: string; revenue: number; confidence: { low: number; high: number } }> = [];
  const lastMonth = new Date(Array.from(monthlyRevenue.keys()).pop()!);

  for (let i = 1; i <= 3; i++) {
    const forecastMonth = new Date(lastMonth);
    forecastMonth.setMonth(forecastMonth.getMonth() + i);
    const monthKey = `${forecastMonth.getFullYear()}-${String(forecastMonth.getMonth() + 1).padStart(2, '0')}`;

    const predictedRevenue = intercept + slope * (n + i - 1);
    const margin = predictedRevenue * 0.15; // 15% confidence interval

    forecast.push({
      month: monthKey,
      revenue: Math.max(0, Math.round(predictedRevenue)),
      confidence: {
        low: Math.max(0, Math.round(predictedRevenue - margin)),
        high: Math.round(predictedRevenue + margin)
      }
    });
  }

  // Determine trend
  const growthRate = revenues.length > 1
    ? ((revenues[revenues.length - 1] - revenues[0]) / revenues[0]) * 100
    : 0;

  let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  if (growthRate > 10) trend = 'increasing';
  else if (growthRate < -10) trend = 'decreasing';

  return {
    historical,
    forecast,
    trend,
    growthRate: Math.round(growthRate)
  };
};

// ===========================================
// ACTIVITY HEATMAP
// ===========================================

export interface ActivityHeatmap {
  hourly: number[][]; // [dayOfWeek][hour] = message count
  peakHour: { day: string; hour: number; count: number };
  totalMessages: number;
}

export const getPeakActivityHours = async (creatorId: string): Promise<ActivityHeatmap> => {
  // Get messages from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const messages = await prisma.message.findMany({
    where: {
      conversation: { creatorId },
      createdAt: { gte: thirtyDaysAgo }
    },
    select: {
      createdAt: true
    }
  });

  // Initialize 7x24 grid (7 days, 24 hours)
  const hourly: number[][] = Array(7).fill(0).map(() => Array(24).fill(0));

  // Count messages by day of week and hour
  messages.forEach(msg => {
    const date = new Date(msg.createdAt);
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = date.getHours(); // 0-23
    hourly[day][hour]++;
  });

  // Find peak hour
  let peakHour = { day: 'Sunday', hour: 0, count: 0 };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  hourly.forEach((dayData, dayIndex) => {
    dayData.forEach((count, hour) => {
      if (count > peakHour.count) {
        peakHour = {
          day: dayNames[dayIndex],
          hour,
          count
        };
      }
    });
  });

  return {
    hourly,
    peakHour,
    totalMessages: messages.length
  };
};

// ===========================================
// CONVERSION FUNNEL
// ===========================================

export interface ConversionFunnel {
  profileViews: number;
  chatStarts: number;
  returning: number;
  subscribed: number;
  conversionRate: {
    viewToChat: number;
    chatToReturn: number;
    returnToSubscribe: number;
  };
}

export const getConversionFunnel = async (creatorId: string): Promise<ConversionFunnel> => {
  // Get profile views (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { profileViews: true }
  });

  // Count unique users who started chats
  const conversations = await prisma.conversation.findMany({
    where: {
      creatorId,
      createdAt: { gte: thirtyDaysAgo }
    },
    select: {
      userId: true
    }
  });

  const uniqueChatters = new Set(conversations.filter(c => c.userId).map(c => c.userId)).size;

  // Count returning users (users with more than 1 conversation)
  const userMessageCounts = await prisma.message.groupBy({
    by: ['userId'],
    where: {
      conversation: { creatorId },
      userId: { not: null },
      createdAt: { gte: thirtyDaysAgo }
    },
    _count: true
  });

  const returningUsers = userMessageCounts.filter(u => u._count > 1).length;

  // Count subscribed users (this is a simplified metric)
  const subscribedUsers = await prisma.subscription.count({
    where: {
      plan: 'PREMIUM',
      updatedAt: { gte: thirtyDaysAgo }
    }
  });

  const profileViews = creator?.profileViews || 0;

  return {
    profileViews,
    chatStarts: uniqueChatters,
    returning: returningUsers,
    subscribed: subscribedUsers,
    conversionRate: {
      viewToChat: profileViews > 0 ? Math.round((uniqueChatters / profileViews) * 100) : 0,
      chatToReturn: uniqueChatters > 0 ? Math.round((returningUsers / uniqueChatters) * 100) : 0,
      returnToSubscribe: returningUsers > 0 ? Math.round((subscribedUsers / returningUsers) * 100) : 0
    }
  };
};

// ===========================================
// COMPARATIVE ANALYTICS
// ===========================================

export interface ComparativeAnalytics {
  currentPeriod: {
    messages: number;
    revenue: number;
    newUsers: number;
  };
  previousPeriod: {
    messages: number;
    revenue: number;
    newUsers: number;
  };
  change: {
    messages: number;
    revenue: number;
    newUsers: number;
  };
}

export const getComparativeAnalytics = async (
  creatorId: string,
  days: number = 30
): Promise<ComparativeAnalytics> => {
  const now = new Date();
  const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = new Date(currentStart.getTime() - days * 24 * 60 * 60 * 1000);

  // Current period
  const [currentMessages, currentPayouts, currentConversations] = await Promise.all([
    prisma.message.count({
      where: {
        conversation: { creatorId },
        createdAt: { gte: currentStart }
      }
    }),
    prisma.payout.aggregate({
      where: {
        creatorId,
        status: 'COMPLETED',
        completedAt: { gte: currentStart }
      },
      _sum: { amount: true }
    }),
    prisma.conversation.count({
      where: {
        creatorId,
        createdAt: { gte: currentStart }
      }
    })
  ]);

  // Previous period
  const [previousMessages, previousPayouts, previousConversations] = await Promise.all([
    prisma.message.count({
      where: {
        conversation: { creatorId },
        createdAt: { gte: previousStart, lt: currentStart }
      }
    }),
    prisma.payout.aggregate({
      where: {
        creatorId,
        status: 'COMPLETED',
        completedAt: { gte: previousStart, lt: currentStart }
      },
      _sum: { amount: true }
    }),
    prisma.conversation.count({
      where: {
        creatorId,
        createdAt: { gte: previousStart, lt: currentStart }
      }
    })
  ]);

  const currentRevenue = Number(currentPayouts._sum.amount || 0);
  const previousRevenue = Number(previousPayouts._sum.amount || 0);

  return {
    currentPeriod: {
      messages: currentMessages,
      revenue: currentRevenue,
      newUsers: currentConversations
    },
    previousPeriod: {
      messages: previousMessages,
      revenue: previousRevenue,
      newUsers: previousConversations
    },
    change: {
      messages: previousMessages > 0
        ? Math.round(((currentMessages - previousMessages) / previousMessages) * 100)
        : 0,
      revenue: previousRevenue > 0
        ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
        : 0,
      newUsers: previousConversations > 0
        ? Math.round(((currentConversations - previousConversations) / previousConversations) * 100)
        : 0
    }
  };
};
