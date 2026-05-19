// ===========================================
// ANALYTICS WORKER
// ===========================================
// Background job for processing analytics data
// Aggregates metrics, generates reports, and updates statistics

import prisma from '../../prisma/client';
import { getRedisClient, isRedisConnected } from '../utils/redis';
import { logInfo, logError } from '../utils/logger';

interface AnalyticsJob {
  type: 'daily_report' | 'weekly_report' | 'monthly_report' | 'aggregate_metrics';
  date?: Date;
  userId?: string;
}

export class AnalyticsWorker {
  /**
   * Process analytics job
   */
  static async processJob(job: AnalyticsJob): Promise<void> {
    logInfo(`[AnalyticsWorker] Processing job: ${job.type}`);
    
    try {
      switch (job.type) {
        case 'daily_report':
          await this.generateDailyReport(job.date);
          break;
          
        case 'weekly_report':
          await this.generateWeeklyReport(job.date);
          break;
          
        case 'monthly_report':
          await this.generateMonthlyReport(job.date);
          break;
          
        case 'aggregate_metrics':
          await this.aggregateMetrics();
          break;
          
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }
      
      logInfo(`[AnalyticsWorker] Job completed: ${job.type}`);
      
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[AnalyticsWorker] Error processing job ${job.type}` });
      throw error;
    }
  }

  /**
   * Generate daily analytics report
   */
  private static async generateDailyReport(date?: Date): Promise<void> {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get daily metrics
    const [
      newUserCount,
      newCreatorCount,
      newCompanyCount,
      totalMessages,
      totalConversations,
      totalEarnings,
      activeUsers
    ] = await Promise.all([
      prisma.user.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay }
        }
      }),
      
      prisma.creator.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay }
        }
      }),
      
      prisma.company.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay }
        }
      }),
      
      prisma.message.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay }
        }
      }),
      
      prisma.conversation.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay }
        }
      }),
      
      prisma.payout.aggregate({
        _sum: {
          amount: true
        },
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED'
        }
      }),
      
      prisma.analyticsEvent.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          eventType: 'user_active'
        }
      })
    ]);

    // Store report
    const report = {
      date: startOfDay,
      period: 'daily',
      metrics: {
        newUserCount,
        newCreatorCount,
        newCompanyCount,
        totalMessages,
        totalConversations,
        totalEarnings: totalEarnings._sum.amount || 0,
        activeUsers
      }
    };

    // Save to database
    await prisma.analyticsEvent.create({
      data: {
        eventType: 'daily_report',
        eventName: 'daily_metrics',
        properties: report
      }
    });

    // Cache in Redis
    const redisClient = getRedisClient();
    if (redisClient && isRedisConnected()) {
      const key = `analytics:daily:${startOfDay.toISOString().split('T')[0]}`;
      await redisClient.setEx(key, 86400, JSON.stringify(report)); // 24 hours
    }

    logInfo(`[AnalyticsWorker] Daily report generated for ${startOfDay.toDateString()}`);
  }

  /**
   * Generate weekly analytics report
   */
  private static async generateWeeklyReport(date?: Date): Promise<void> {
    const targetDate = date || new Date();
    const startOfWeek = new Date(targetDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Get top creators by engagement
    const topCreators = await prisma.creator.findMany({
      where: {
        conversations: {
          some: {
            createdAt: { gte: startOfWeek, lte: endOfWeek }
          }
        }
      },
      select: {
        id: true,
        displayName: true,
        _count: {
          select: {
            conversations: {
              where: {
                createdAt: { gte: startOfWeek, lte: endOfWeek }
              }
            }
          }
        }
      },
      orderBy: {
        conversations: {
          _count: 'desc'
        }
      },
      take: 10
    });

    // Get popular content categories
    const categoryStats = await prisma.creator.groupBy({
      by: ['category'],
      where: {
        createdAt: { gte: startOfWeek, lte: endOfWeek },
        category: { not: null }
      },
      _count: true,
      orderBy: {
        _count: {
          category: 'desc'
        }
      }
    });

    const report = {
      date: startOfWeek,
      period: 'weekly',
      metrics: {
        topCreators: topCreators.map(c => ({
          id: c.id,
          name: c.displayName,
          conversationCount: c._count.conversations
        })),
        popularCategories: categoryStats.map(c => ({
          category: c.category,
          count: c._count
        }))
      }
    };

    // Save report
    await prisma.analyticsEvent.create({
      data: {
        eventType: 'weekly_report',
        eventName: 'weekly_insights',
        properties: report
      }
    });

    logInfo(`[AnalyticsWorker] Weekly report generated for week of ${startOfWeek.toDateString()}`);
  }

  /**
   * Generate monthly analytics report
   */
  private static async generateMonthlyReport(date?: Date): Promise<void> {
    const targetDate = date || new Date();
    const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    // Get monthly revenue
    const revenueStats = await prisma.payout.aggregate({
      _sum: {
        amount: true,
        fee: true
      },
      where: {
        createdAt: { gte: startOfMonth, lte: endOfMonth },
        status: 'COMPLETED'
      }
    });

    // Get user growth
    const userGrowth = await prisma.user.count({
      where: {
        createdAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    // Get content growth
    const contentGrowth = await prisma.creatorContent.count({
      where: {
        createdAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const report = {
      date: startOfMonth,
      period: 'monthly',
      metrics: {
        totalRevenue: revenueStats._sum.amount || 0,
        platformFees: revenueStats._sum.fee || 0,
        newUserCount: userGrowth,
        newContentCount: contentGrowth
      }
    };

    // Save report
    await prisma.analyticsEvent.create({
      data: {
        eventType: 'monthly_report',
        eventName: 'monthly_summary',
        properties: report
      }
    });

    logInfo(`[AnalyticsWorker] Monthly report generated for ${startOfMonth.toDateString()}`);
  }

  /**
   * Aggregate metrics from Redis to database
   */
  private static async aggregateMetrics(): Promise<void> {
    const redisClient = getRedisClient();
    if (!redisClient || !isRedisConnected()) {
      logInfo('[AnalyticsWorker] Redis not available, skipping aggregation');
      return;
    }

    // Aggregate user events
    const userEvents = await redisClient.keys('event:user:*');
    for (const key of userEvents) {
      const count = await redisClient.get(key);
      if (count) {
        const [_, eventType, eventName] = key.split(':');
        await prisma.analyticsEvent.create({
          data: {
            eventType,
            eventName,
            properties: { count: parseInt(count as string) }
          }
        });
        await redisClient.del(key);
      }
    }

    // Aggregate performance metrics
    const perfKeys = await redisClient.keys('perf:*');
    for (const key of perfKeys) {
      const metrics = await redisClient.lRange(key, 0, -1);
      for (const metric of metrics) {
        try {
          const parsed = JSON.parse(metric);
          await prisma.analyticsEvent.create({
            data: {
              eventType: 'api_performance',
              eventName: `${parsed.method} ${parsed.endpoint}`,
              properties: {
                responseTime: parsed.responseTime,
                statusCode: parsed.statusCode
              }
            }
          });
        } catch (e) {
          logError(e instanceof Error ? e : new Error(String(e)), { context: '[AnalyticsWorker] Error parsing performance metric' });
        }
      }
      await redisClient.del(key);
    }

    logInfo('[AnalyticsWorker] Metrics aggregation completed');
  }

  /**
   * Schedule regular analytics jobs
   */
  static async scheduleJobs(): Promise<void> {
    // Run daily report at midnight
    setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        await this.processJob({ type: 'daily_report' });
      }
    }, 60000); // Check every minute

    // Run weekly report every Monday at 1 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getDay() === 1 && now.getHours() === 1 && now.getMinutes() === 0) {
        await this.processJob({ type: 'weekly_report' });
      }
    }, 60000);

    // Run monthly report on 1st of month at 2 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 2 && now.getMinutes() === 0) {
        await this.processJob({ type: 'monthly_report' });
      }
    }, 60000);

    // Aggregate metrics every hour
    setInterval(async () => {
      await this.processJob({ type: 'aggregate_metrics' });
    }, 3600000); // 1 hour
  }
}