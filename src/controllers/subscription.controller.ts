// ===========================================
// SUBSCRIPTION CONTROLLER
// Manage user subscriptions and billing
// ===========================================

import { Response } from 'express';
import prisma from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { config } from '../config';

// ===========================================
// GET SUBSCRIPTION DETAILS
// GET /api/user/subscription/details
// ===========================================
export const getSubscriptionDetails = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    await prisma.subscription.upsert({
        where: { userId },
        update: {},
        create: { userId, plan: 'FREE', status: 'ACTIVE' }
    });
    const subscription = (await prisma.subscription.findUnique({
        where: { userId },
        include: {
            user: {
                select: {
                    name: true,
                    email: true
                }
            }
        }
    }))!;

    // Calculate usage statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [messagesToday, messagesThisMonth, totalMessages] = await Promise.all([
        prisma.message.count({
            where: {
                userId,
                role: 'USER',
                createdAt: { gte: today }
            }
        }),
        prisma.message.count({
            where: {
                userId,
                role: 'USER',
                createdAt: {
                    gte: new Date(today.getFullYear(), today.getMonth(), 1)
                }
            }
        }),
        prisma.message.count({
            where: { userId, role: 'USER' }
        })
    ]);

    // Message quotas
    const isPremium = subscription.plan === 'PREMIUM';
    const dailyQuota = isPremium ? 999999 : 5;
    const monthlyQuota = isPremium ? 999999 : 150;

    res.json({
        success: true,
        data: {
            subscription: {
                id: subscription.id,
                plan: subscription.plan,
                status: subscription.status,
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                razorpaySubId: subscription.razorpaySubId,
                tokenBalance: subscription.tokenBalance,
                tokenGrant: subscription.tokenGrant,
                tokenGrantedAt: subscription.tokenGrantedAt
            },
            usage: {
                messagesToday,
                messagesThisMonth,
                totalMessages,
                dailyQuota,
                monthlyQuota,
                dailyUsagePercentage: isPremium ? 0 : Math.round((messagesToday / dailyQuota) * 100),
                monthlyUsagePercentage: isPremium ? 0 : Math.round((messagesThisMonth / monthlyQuota) * 100),
                tokens: {
                    balance: subscription.tokenBalance,
                    grant: subscription.tokenGrant,
                    grantedAt: subscription.tokenGrantedAt,
                    perMessage: config.subscription.tokensPerMessage
                }
            },
            user: {
                name: subscription.user.name,
                email: subscription.user.email
            }
        }
    });
});

// ===========================================
// GET PLAN FEATURES
// GET /api/user/subscription/features
// ===========================================
export const getPlanFeatures = asyncHandler(async (req: AuthRequest, res: Response) => {
    const features = {
        plans: [
            {
                name: 'FREE',
                price: 0,
                currency: 'INR',
                billingPeriod: null,
                features: [
                    { name: 'Daily Messages', value: '5 per day', available: true },
                    { name: 'Chat with AI Creators', value: 'Limited', available: true },
                    { name: 'Access to All Creators', value: 'Yes', available: true },
                    { name: 'Chat History', value: '7 days', available: true },
                    { name: 'Bookmarks', value: 'No', available: false },
                    { name: 'Priority Support', value: 'No', available: false },
                    { name: 'Advanced Analytics', value: 'No', available: false },
                    { name: 'Unlimited Messages', value: 'No', available: false }
                ],
                limitations: [
                    '5 messages per day limit',
                    'Chat history limited to 7 days',
                    'No bookmarking feature',
                    'Standard support only'
                ]
            },
            {
                name: 'PREMIUM',
                price: 799,
                currency: 'INR',
                billingPeriod: 'month',
                popular: true,
                features: [
                    { name: 'Unlimited Messages', value: 'Unlimited', available: true },
                    { name: 'Chat with AI Creators', value: 'Unlimited', available: true },
                    { name: 'Access to All Creators', value: 'Yes', available: true },
                    { name: 'Full Chat History', value: 'Forever', available: true },
                    { name: 'Bookmarks', value: 'Unlimited', available: true },
                    { name: 'Priority Support', value: 'Yes', available: true },
                    { name: 'Advanced Analytics', value: 'Yes', available: true },
                    { name: 'Early Access to Features', value: 'Yes', available: true }
                ],
                benefits: [
                    'Unlimited daily messages',
                    'Full access to all creators',
                    'Complete chat history',
                    'Message bookmarking',
                    '86% direct support to creators',
                    'Priority customer support',
                    'Usage analytics dashboard',
                    'Early access to new features'
                ]
            }
        ]
    };

    res.json({
        success: true,
        data: features
    });
});

// ===========================================
// GET TRANSACTION HISTORY
// GET /api/user/subscription/transactions
// ===========================================
export const getTransactionHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { page = '1', limit = '10', status } = req.query;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Get or create user's subscription
    const subscription = await prisma.subscription.upsert({
        where: { userId },
        update: {},
        create: { userId, plan: 'FREE', status: 'ACTIVE' }
    });

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { subscriptionId: subscription.id };
    if (status) {
        where.status = status;
    }

    const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                amount: true,
                currency: true,
                status: true,
                razorpayPaymentId: true,
                razorpayOrderId: true,
                description: true,
                metadata: true,
                createdAt: true
            }
        }),
        prisma.transaction.count({ where })
    ]);

    res.json({
        success: true,
        data: {
            transactions,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            },
            summary: {
                totalSpent: transactions
                    .filter(t => t.status === 'COMPLETED')
                    .reduce((sum, t) => sum + Number(t.amount), 0),
                successfulTransactions: transactions.filter(t => t.status === 'COMPLETED').length,
                failedTransactions: transactions.filter(t => t.status === 'FAILED').length
            }
        }
    });
});

// ===========================================
// GET USAGE ANALYTICS
// GET /api/user/subscription/usage-analytics
// ===========================================
export const getUsageAnalytics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { period = '30' } = req.query; // days

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    const days = parseInt(period as string);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get subscription
    const subscription = await prisma.subscription.findUnique({
        where: { userId },
        select: { plan: true, createdAt: true }
    });

    // Get messages grouped by day
    const messages = await prisma.message.findMany({
        where: {
            userId,
            role: 'USER',
            createdAt: { gte: since }
        },
        select: {
            createdAt: true,
            conversation: {
                select: {
                    creatorId: true,
                    creator: {
                        select: {
                            displayName: true,
                            category: true
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    });

    // Group by day
    const dailyUsage: { [key: string]: number } = {};
    const creatorInteractions: { [key: string]: { name: string; count: number; category: string } } = {};

    messages.forEach(msg => {
        const date = new Date(msg.createdAt);
        const dateKey = date.toISOString().split('T')[0];

        dailyUsage[dateKey] = (dailyUsage[dateKey] || 0) + 1;

        // Track creator interactions
        const creatorId = msg.conversation.creatorId;
        if (!creatorInteractions[creatorId]) {
            creatorInteractions[creatorId] = {
                name: msg.conversation.creator.displayName,
                count: 0,
                category: msg.conversation.creator.category || 'Uncategorized'
            };
        }
        creatorInteractions[creatorId].count++;
    });

    // Format daily usage for charts
    const usageChart = Object.entries(dailyUsage).map(([date, count]) => ({
        date,
        messages: count
    }));

    // Top creators by interaction
    const topCreators = Object.values(creatorInteractions)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Calculate value metrics
    const totalMessages = messages.length;
    const isPremium = subscription?.plan === 'PREMIUM';
    const monthlyPrice = isPremium ? 799 : 0;
    const messagesPerRupee = isPremium && monthlyPrice > 0 ? totalMessages / monthlyPrice : 0;

    // Peak usage time analysis
    const hourlyUsage: { [key: number]: number } = {};
    messages.forEach(msg => {
        const hour = new Date(msg.createdAt).getHours();
        hourlyUsage[hour] = (hourlyUsage[hour] || 0) + 1;
    });

    const peakHour = Object.entries(hourlyUsage)
        .sort((a, b) => b[1] - a[1])[0];

    res.json({
        success: true,
        data: {
            period: {
                days,
                start: since,
                end: new Date()
            },
            summary: {
                totalMessages,
                averagePerDay: Math.round(totalMessages / days * 10) / 10,
                peakUsageHour: peakHour ? `${peakHour[0]}:00` : null,
                messagesPerRupee: isPremium ? Math.round(messagesPerRupee * 10) / 10 : null
            },
            charts: {
                dailyUsage: usageChart,
                topCreators,
                hourlyDistribution: Object.entries(hourlyUsage).map(([hour, count]) => ({
                    hour: parseInt(hour),
                    messages: count
                }))
            },
            subscription: {
                plan: subscription?.plan || 'FREE',
                memberSince: subscription?.createdAt
            }
        }
    });
});
