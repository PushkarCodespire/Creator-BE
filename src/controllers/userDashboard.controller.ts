// ===========================================
// USER DASHBOARD CONTROLLER
// Comprehensive user panel data and statistics
// ===========================================

import { Response } from 'express';
import prisma from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getRecommendedCreatorsForUser } from '../services/recommendation.service';

// ===========================================
// GET DASHBOARD STATS
// GET /api/user/dashboard/stats
// ===========================================
export const getDashboardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    // Fetch all stats in parallel for performance
    const [
        totalChats,
        totalMessages,
        messagesToday,
        messagesThisWeek,
        followingCount,
        unreadNotifications,
        subscription,
        recentActivity
    ] = await Promise.all([
        // Total conversations count
        prisma.conversation.count({
            where: { userId, isActive: true }
        }),

        // Total messages sent by user
        prisma.message.count({
            where: { userId, role: 'USER' }
        }),

        // Messages sent today
        prisma.message.count({
            where: {
                userId,
                role: 'USER',
                createdAt: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
            }
        }),

        // Messages sent this week
        prisma.message.count({
            where: {
                userId,
                role: 'USER',
                createdAt: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                }
            }
        }),

        // Following count
        prisma.follow.count({
            where: { followerId: userId }
        }),

        // Unread notifications
        prisma.notification.count({
            where: { userId, isRead: false }
        }),

        // Subscription details
        prisma.subscription.findUnique({
            where: { userId },
            select: {
                plan: true,
                status: true,
                messagesUsedToday: true,
                currentPeriodEnd: true
            }
        }),

        // Recent activity (last 7 days)
        prisma.conversation.findMany({
            where: {
                userId,
                lastMessageAt: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                }
            },
            select: { id: true }
        })
    ]);

    // Calculate active streak (days with at least one message in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const messagesLast30Days = await prisma.message.findMany({
        where: {
            userId,
            role: 'USER',
            createdAt: { gte: thirtyDaysAgo }
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' }
    });

    // Calculate streak
    let activeStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const uniqueDays = new Set<number>(
        messagesLast30Days.map(m => {
            const date = new Date(m.createdAt);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        })
    );

    const sortedDays = Array.from(uniqueDays).sort((a, b) => b - a);
    let currentDay = today.getTime();

    for (const day of sortedDays) {
        if (day === currentDay || day === currentDay - 24 * 60 * 60 * 1000) {
            activeStreak++;
            currentDay = day - 24 * 60 * 60 * 1000;
        } else {
            break;
        }
    }

    // Message quota based on plan
    const messageQuota = subscription?.plan === 'PREMIUM' ? 999999 : 5;
    const messagesUsed = subscription?.messagesUsedToday || 0;
    const quotaPercentage = messageQuota === 999999 ? 0 : (messagesUsed / messageQuota) * 100;

    res.json({
        success: true,
        data: {
            stats: {
                totalChats,
                totalMessages,
                messagesToday,
                messagesThisWeek,
                followingCount,
                unreadAlerts: unreadNotifications,
                activeStreak,
                activeConversationsThisWeek: recentActivity.length
            },
            subscription: {
                plan: subscription?.plan || 'FREE',
                status: subscription?.status || 'ACTIVE',
                messagesUsedToday: messagesUsed,
                messageQuota,
                quotaPercentage: Math.round(quotaPercentage),
                renewalDate: subscription?.currentPeriodEnd || null
            }
        }
    });
});

// ===========================================
// GET RECENT CONVERSATIONS
// GET /api/user/dashboard/conversations/recent
// ===========================================
export const getRecentConversations = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit as string) || 5;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    const conversations = await prisma.conversation.findMany({
        where: { userId, isActive: true },
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
        include: {
            creator: {
                select: {
                    id: true,
                    displayName: true,
                    profileImage: true,
                    category: true,
                    isVerified: true,
                    rating: true,
                    tagline: true
                }
            },
            messages: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: {
                    content: true,
                    createdAt: true,
                    role: true
                }
            },
            _count: {
                select: { messages: true }
            }
        }
    });

    // Format response
    const formattedConversations = conversations.map(conv => ({
        id: conv.id,
        creator: conv.creator,
        lastMessage: conv.messages[0] ? {
            content: conv.messages[0].content.substring(0, 100) + (conv.messages[0].content.length > 100 ? '...' : ''),
            timestamp: conv.messages[0].createdAt,
            role: conv.messages[0].role
        } : null,
        totalMessages: conv._count.messages,
        lastActive: conv.lastMessageAt,
        createdAt: conv.createdAt
    }));

    res.json({
        success: true,
        data: {
            conversations: formattedConversations
        }
    });
});

// ===========================================
// GET RECOMMENDED CREATORS
// GET /api/user/dashboard/recommendations/creators
// ===========================================
export const getRecommendedCreators = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    // Get user's interests and following list
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { interests: true }
    });

    // Get creators user is already following
    const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true }
    });

    const followingIds = following.map(f => f.followingId);

    // Get recommended creators using the recommendation service
    const recommendations = await getRecommendedCreatorsForUser({
        userId,
        interests: user?.interests || [],
        followingIds,
        limit
    });

    res.json({
        success: true,
        data: {
            recommendations
        }
    });
});

// ===========================================
// GET ACTIVITY FEED
// GET /api/user/dashboard/activity-feed
// ===========================================
export const getActivityFeed = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const days = parseInt(req.query.days as string) || 7;

    if (!userId) {
        throw new AppError('Authentication required', 401);
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch recent activities in parallel
    const [notifications, recentFollows, recentConversations] = await Promise.all([
        // Recent notifications
        prisma.notification.findMany({
            where: {
                userId,
                createdAt: { gte: since }
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                type: true,
                title: true,
                message: true,
                actionUrl: true,
                isRead: true,
                createdAt: true,
                priority: true
            }
        }),

        // Recent follows
        prisma.follow.findMany({
            where: {
                followerId: userId,
                createdAt: { gte: since }
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
                following: {
                    select: {
                        id: true,
                        displayName: true,
                        profileImage: true,
                        category: true
                    }
                }
            }
        }),

        // New conversations started
        prisma.conversation.findMany({
            where: {
                userId,
                createdAt: { gte: since }
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
                creator: {
                    select: {
                        id: true,
                        displayName: true,
                        profileImage: true,
                        category: true
                    }
                }
            }
        })
    ]);

    // Combine and format activities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activities: any[] = [];

    // Add notifications
    notifications.forEach(notif => {
        activities.push({
            type: 'notification',
            id: notif.id,
            title: notif.title,
            message: notif.message,
            actionUrl: notif.actionUrl,
            isRead: notif.isRead,
            priority: notif.priority,
            timestamp: notif.createdAt
        });
    });

    // Add follows
    recentFollows.forEach(follow => {
        activities.push({
            type: 'follow',
            id: follow.id,
            title: 'New Follow',
            message: `You started following ${follow.following.displayName}`,
            creator: follow.following,
            timestamp: follow.createdAt
        });
    });

    // Add new conversations
    recentConversations.forEach(conv => {
        activities.push({
            type: 'conversation',
            id: conv.id,
            title: 'New Conversation',
            message: `Started chatting with ${conv.creator.displayName}`,
            creator: conv.creator,
            timestamp: conv.createdAt
        });
    });

    // Sort by timestamp
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
        success: true,
        data: {
            activities: activities.slice(0, limit),
            total: activities.length
        }
    });
});
