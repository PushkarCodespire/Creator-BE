// ===========================================
// NOTIFICATION CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import * as notificationService from '../services/notification.service';
// @ts-ignore
import { NotificationType } from '@prisma/client';

// ===========================================
// GET NOTIFICATIONS
// ===========================================

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const isReadQuery = req.query.isRead as string | undefined;
  const isRead = isReadQuery === 'true' ? true : isReadQuery === 'false' ? false : undefined;
  const type = req.query.type as NotificationType | undefined;

  const result = await notificationService.getByUser(userId, {
    page,
    limit,
    isRead,
    type
  });

  res.json({
    success: true,
    data: result
  });
});

// ===========================================
// GET UNREAD COUNT
// ===========================================

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const count = await notificationService.getUnreadCount(userId);

  res.json({
    success: true,
    data: { count }
  });
});

// ===========================================
// MARK AS READ
// ===========================================

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    const notification = await notificationService.markAsRead(id as string, userId);

    res.json({
      success: true,
      data: notification
    });
  } catch (error: unknown) {
    throw new AppError(error instanceof Error ? error.message : String(error), 404);
  }
});

// ===========================================
// MARK ALL AS READ
// ===========================================

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await notificationService.markAllAsRead(userId);

  res.json({
    success: true,
    message: 'All notifications marked as read'
  });
});

// ===========================================
// DELETE NOTIFICATION
// ===========================================

export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  try {
    await notificationService.deleteNotification(id as string, userId);

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error: unknown) {
    throw new AppError(error instanceof Error ? error.message : String(error), 404);
  }
});

// ===========================================
// GET SETTINGS
// ===========================================

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const settings = await notificationService.getSettings(userId);

  res.json({
    success: true,
    data: settings
  });
});

// ===========================================
// UPDATE SETTINGS
// ===========================================

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    emailEnabled,
    emailChat,
    emailDeals,
    emailPayments,
    emailModeration,
    pushEnabled,
    soundEnabled
  } = req.body;

  const settings = await notificationService.updateSettings(userId, {
    emailEnabled,
    emailChat,
    emailDeals,
    emailPayments,
    emailModeration,
    pushEnabled,
    soundEnabled
  });

  res.json({
    success: true,
    data: settings,
    message: 'Notification settings updated'
  });
});
