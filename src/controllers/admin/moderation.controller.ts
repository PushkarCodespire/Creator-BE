// ===========================================
// ADMIN MODERATION CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../../middleware/errorHandler';
import {
  getReports,
  resolveReport,
  getModerationStats
} from '../../services/moderation.service';
import prisma from '../../../prisma/client';
import { ReportStatus, ReportPriority, ReportType, ModerationAction } from '@prisma/client';

// ===========================================
// GET MODERATION QUEUE (REPORTS)
// ===========================================

export const getModerationQueue = asyncHandler(async (req: Request, res: Response) => {
  const {
    status,
    priority,
    targetType,
    page = 1,
    limit = 20
  } = req.query;

  const result = await getReports({
    status: status as ReportStatus,
    priority: priority as ReportPriority,
    targetType: targetType as ReportType,
    page: Number(page),
    limit: Number(limit)
  });

  res.json({
    success: true,
    data: result
  });
});

// ===========================================
// GET REPORT DETAILS WITH CONTEXT
// ===========================================

export const getReportDetails = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  // Get report
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      reporter: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          warningCount: true,
          isSuspended: true,
          isBanned: true
        }
      }
    }
  });

  if (!report) {
    throw new AppError('Report not found', 404);
  }

  // Get target context based on type
  let targetContext: unknown = null;

  switch (report.targetType) {
    case ReportType.MESSAGE:
      // Get message with surrounding context
      const message = await prisma.message.findUnique({
        where: { id: report.targetId },
        include: {
          conversation: {
            include: {
              creator: {
                select: {
                  id: true,
                  displayName: true
                }
              },
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              warningCount: true
            }
          }
        }
      });

      if (message) {
        // Get surrounding messages for context
        const contextMessages = await prisma.message.findMany({
          where: {
            conversationId: message.conversationId,
            createdAt: {
              gte: new Date(message.createdAt.getTime() - 5 * 60 * 1000), // 5 min before
              lte: new Date(message.createdAt.getTime() + 5 * 60 * 1000)  // 5 min after
            }
          },
          orderBy: { createdAt: 'asc' },
          take: 10
        });

        targetContext = {
          message,
          contextMessages
        };
      }
      break;

    case ReportType.USER:
      targetContext = await prisma.user.findUnique({
        where: { id: report.targetId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          warningCount: true,
          isSuspended: true,
          isBanned: true,
          createdAt: true,
          lastLoginAt: true
        }
      });
      break;

    case ReportType.CREATOR:
      targetContext = await prisma.creator.findUnique({
        where: { id: report.targetId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              warningCount: true
            }
          }
        }
      });
      break;

    case ReportType.CONVERSATION:
      targetContext = await prisma.conversation.findUnique({
        where: { id: report.targetId },
        include: {
          creator: {
            select: {
              id: true,
              displayName: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          messages: {
            take: 20,
            orderBy: { createdAt: 'desc' }
          }
        }
      });
      break;
  }

  // Get moderation history for this target
  const moderationHistory = await prisma.moderationLog.findMany({
    where: {
      targetType: report.targetType,
      targetId: report.targetId
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      moderator: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  res.json({
    success: true,
    data: {
      report,
      targetContext,
      moderationHistory
    }
  });
});

// ===========================================
// RESOLVE REPORT (TAKE ACTION)
// ===========================================

export const resolveReportAction = asyncHandler(async (req: Request, res: Response) => {
  const moderatorId = req.user!.id;
  const { id } = req.params as { id: string };
  const { action, reviewNotes, suspensionDays } = req.body;

  // Validate action
  if (!action) {
    throw new AppError('Action is required', 400);
  }

  if (!Object.values(ModerationAction).includes(action)) {
    throw new AppError('Invalid action', 400);
  }

  // Resolve report
  const report = await resolveReport({
    reportId: id,
    moderatorId,
    action: action as ModerationAction,
    reviewNotes,
    suspensionDays: suspensionDays ? Number(suspensionDays) : undefined
  });

  res.json({
    success: true,
    message: 'Report resolved successfully',
    data: report
  });
});

// ===========================================
// DISMISS REPORT (NO ACTION)
// ===========================================

export const dismissReport = asyncHandler(async (req: Request, res: Response) => {
  const moderatorId = req.user!.id;
  const { id } = req.params as { id: string };
  const { reason } = req.body;

  await prisma.report.update({
    where: { id },
    data: {
      status: ReportStatus.DISMISSED,
      reviewedBy: moderatorId,
      reviewedAt: new Date(),
      reviewNotes: reason || 'Report dismissed - no violation found',
      actionTaken: ModerationAction.NO_ACTION
    }
  });

  res.json({
    success: true,
    message: 'Report dismissed'
  });
});

// ===========================================
// GET MODERATION STATISTICS
// ===========================================

export const getModerationStatsController = asyncHandler(async (req: Request, res: Response) => {
  const stats = await getModerationStats();

  res.json({
    success: true,
    data: stats
  });
});

// ===========================================
// GET MODERATION LOG (AUDIT TRAIL)
// ===========================================

export const getModerationLog = asyncHandler(async (req: Request, res: Response) => {
  const {
    action,
    moderatorId,
    page = 1,
    limit = 50
  } = req.query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (action) where.action = action;
  if (moderatorId) where.moderatorId = moderatorId;

  const [logs, total] = await Promise.all([
    prisma.moderationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
      include: {
        moderator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    }),
    prisma.moderationLog.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

// ===========================================
// GET USER MODERATION HISTORY
// ===========================================

export const getUserModerationHistory = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  // Get user reports (as target)
  const reportsAgainst = await prisma.report.findMany({
    where: {
      targetType: ReportType.USER,
      targetId: userId
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get moderation logs
  const moderationLogs = await prisma.moderationLog.findMany({
    where: {
      targetType: 'User',
      targetId: userId
    },
    orderBy: { createdAt: 'desc' },
    include: {
      moderator: {
        select: {
          name: true
        }
      }
    }
  });

  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      warningCount: true,
      isSuspended: true,
      suspendedUntil: true,
      isBanned: true,
      bannedAt: true
    }
  });

  res.json({
    success: true,
    data: {
      user,
      reportsAgainst,
      moderationLogs
    }
  });
});
