import { Request, Response, NextFunction } from 'express';
import aiModerationService from '../services/moderation/ai-moderation.service';
import prisma from '../../prisma/client';
import { config } from '../config';
import { sendError } from '../utils/apiResponse';
import { logInfo, logError } from '../utils/logger';

/**
 * Middleware to auto-moderate content
 */
export const autoModerateContent = (
  contentField: string = 'content',
  contentType: string = 'MESSAGE'
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = req.body?.[contentField];

      if (!content) {
        return next();
      }

      if (!config.aiModeration.enabled) {
        return next();
      }

      const moderationResult = await aiModerationService.moderateContent(
        content,
        contentType
      );

      (req as unknown as { moderationResult: typeof moderationResult }).moderationResult = moderationResult;

      if (moderationResult.shouldBlock) {
        return sendError(
          res,
          403,
          'CONTENT_BLOCKED',
          'Your content violates our community guidelines',
          {
            reason: moderationResult.reason,
            severity: moderationResult.severity,
            categories: moderationResult.violatedCategories
          }
        );
      }

      if (moderationResult.shouldFlag) {
        logInfo(`Content flagged for review: ${contentType}`);
      }

      next();
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'AI Moderation Middleware Error' });
      if (config.aiModeration.failOpen) {
        return next();
      }

      return sendError(
        res,
        503,
        'MODERATION_UNAVAILABLE',
        'AI moderation service is temporarily unavailable'
      );
    }
  };
};

/**
 * Middleware to check if user is suspended/banned
 */
export const checkUserModeration = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const reqUser = req.user;

    if (!reqUser) {
      return next();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqUserAny = reqUser as any;
    const user = (reqUserAny.isBanned === undefined || reqUserAny.isSuspended === undefined)
      ? await prisma.user.findUnique({
          where: { id: reqUser.id },
          select: {
            id: true,
            isBanned: true,
            isSuspended: true,
            suspendedUntil: true
          }
        })
      : reqUserAny as { id: string; isBanned: boolean; isSuspended: boolean; suspendedUntil: Date | null };

    if (!user) {
      return next();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = user as any;
    if (u.isBanned) {
      return sendError(res, 403, 'USER_BANNED', 'Your account has been permanently banned');
    }

    if (u.isSuspended && u.suspendedUntil) {
      const now = new Date();
      if (now < new Date(u.suspendedUntil)) {
        return sendError(
          res,
          403,
          'USER_SUSPENDED',
          `Your account is suspended until ${u.suspendedUntil}`,
          { suspendedUntil: u.suspendedUntil }
        );
      }
    }

    next();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Check User Moderation Error' });
    next();
  }
};
