// ===========================================
// NOTIFICATION SERVICE
// ===========================================
// Business logic for notifications

import prisma from '../../prisma/client';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { Server } from 'socket.io';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
  priority?: NotificationPriority;
  expiresAt?: Date;
}

/**
 * Create a new notification
 */
export const create = async (params: CreateNotificationParams) => {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      actionUrl: params.actionUrl,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: params.data as any,
      priority: params.priority || 'NORMAL',
      expiresAt: params.expiresAt
    }
  });

  return notification;
};

/**
 * Create and emit notification in real-time
 */
export const createAndEmit = async (
  io: Server,
  params: CreateNotificationParams
) => {
  const notification = await create(params);

  // Emit via Socket.io
  // Support both room naming conventions used across sockets
  io.to(`user_${params.userId}`).emit('notification:new', notification);
  io.to(`user:${params.userId}`).emit('notification:new', notification);

  return notification;
};

/**
 * Mark notification as read
 */
export const markAsRead = async (notificationId: string, userId: string) => {
  // Verify ownership
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.userId !== userId) {
    throw new Error('Notification not found');
  }

  return await prisma.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });
};

/**
 * Mark all notifications as read for a user
 */
export const markAllAsRead = async (userId: string) => {
  return await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });
};

/**
 * Get notifications for a user
 */
export const getByUser = async (
  userId: string,
  options: {
    page?: number;
    limit?: number;
    isRead?: boolean;
    type?: NotificationType;
  } = {}
) => {
  const { page = 1, limit = 20, isRead, type } = options;
  const skip = (page - 1) * limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId };

  if (isRead !== undefined) {
    where.isRead = isRead;
  }

  if (type) {
    where.type = type;
  }

  // Delete expired notifications first
  await prisma.notification.deleteMany({
    where: {
      userId,
      expiresAt: {
        lt: new Date()
      }
    }
  });

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [
        { isRead: 'asc' }, // Unread first
        { createdAt: 'desc' }
      ],
      skip,
      take: limit
    }),
    prisma.notification.count({ where })
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get unread count for a user
 */
export const getUnreadCount = async (userId: string) => {
  return await prisma.notification.count({
    where: {
      userId,
      isRead: false,
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } }
      ]
    }
  });
};

/**
 * Delete a notification
 */
export const deleteNotification = async (
  notificationId: string,
  userId: string
) => {
  // Verify ownership
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.userId !== userId) {
    throw new Error('Notification not found');
  }

  return await prisma.notification.delete({
    where: { id: notificationId }
  });
};

/**
 * Delete old read notifications (cleanup)
 */
export const deleteOldNotifications = async (daysOld = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  return await prisma.notification.deleteMany({
    where: {
      isRead: true,
      createdAt: {
        lt: cutoffDate
      }
    }
  });
};

/**
 * Get or create notification settings for a user
 */
export const getSettings = async (userId: string) => {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId }
  });

  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: { userId }
    });
  }

  return settings;
};

/**
 * Update notification settings
 */
export const updateSettings = async (
  userId: string,
  data: {
    emailEnabled?: boolean;
    emailChat?: boolean;
    emailDeals?: boolean;
    emailPayments?: boolean;
    emailModeration?: boolean;
    pushEnabled?: boolean;
    soundEnabled?: boolean;
  }
) => {
  return await prisma.notificationSettings.upsert({
    where: { userId },
    create: {
      userId,
      ...data
    },
    update: data
  });
};

/**
 * Check if user should receive notification based on settings
 */
export const shouldNotify = async (
  userId: string,
  type: NotificationType
): Promise<{ email: boolean; push: boolean }> => {
  const settings = await getSettings(userId);

  // Map notification types to settings
  const emailMapping: Record<string, keyof typeof settings> = {
    CHAT_MESSAGE: 'emailChat',
    DEAL_APPLICATION: 'emailDeals',
    DEAL_ACCEPTED: 'emailDeals',
    DEAL_COMPLETED: 'emailDeals',
    PAYMENT_SUCCESS: 'emailPayments',
    PAYMENT_FAILED: 'emailPayments',
    SUBSCRIPTION_UPGRADED: 'emailPayments',
    PAYOUT_COMPLETED: 'emailPayments',
    PAYOUT_FAILED: 'emailPayments',
    MODERATION_WARNING: 'emailModeration',
    MODERATION_SUSPENSION: 'emailModeration'
  };

  const emailKey = emailMapping[type];
  const shouldSendEmail = settings.emailEnabled && (emailKey ? settings[emailKey as keyof typeof settings] as boolean : true);

  return {
    email: shouldSendEmail,
    push: settings.pushEnabled
  };
};
