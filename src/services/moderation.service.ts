// ===========================================
// MODERATION SERVICE
// ===========================================

import prisma from '../../prisma/client';
import { ReportType, ReportReason, ReportStatus, ReportPriority, ModerationAction } from '@prisma/client';
import { sendEmail } from '../utils/email';
import { logError } from '../utils/logger';

// ===========================================
// CREATE REPORT
// ===========================================

interface CreateReportParams {
  reporterId?: string;
  reporterEmail?: string;
  targetType: ReportType;
  targetId: string;
  reason: ReportReason;
  description?: string;
  priority?: ReportPriority;
}

export const createReport = async (params: CreateReportParams) => {
  const {
    reporterId,
    reporterEmail,
    targetType,
    targetId,
    reason,
    description,
    priority = ReportPriority.MEDIUM
  } = params;

  // Check for duplicate reports (same reporter, target, reason within 24 hours)
  if (reporterId) {
    const existingReport = await prisma.report.findFirst({
      where: {
        reporterId,
        targetType,
        targetId,
        reason,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    });

    if (existingReport) {
      throw new Error('You have already reported this content recently');
    }
  }

  // Auto-escalate priority for severe reasons
  let finalPriority = priority;
  if (
    reason === ReportReason.HATE_SPEECH ||
    reason === ReportReason.VIOLENCE ||
    reason === ReportReason.SEXUAL_CONTENT
  ) {
    finalPriority = ReportPriority.HIGH;
  }

  // Create report
  const report = await prisma.report.create({
    data: {
      reporterId,
      reporterEmail,
      targetType,
      targetId,
      reason,
      description,
      priority: finalPriority,
      status: ReportStatus.PENDING
    }
  });

  return report;
};

// ===========================================
// GET REPORTS (ADMIN QUEUE)
// ===========================================

interface GetReportsParams {
  status?: ReportStatus;
  priority?: ReportPriority;
  targetType?: ReportType;
  page?: number;
  limit?: number;
}

export const getReports = async (params: GetReportsParams) => {
  const {
    status,
    priority,
    targetType,
    page = 1,
    limit = 20
  } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (targetType) where.targetType = targetType;

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ],
      take: limit,
      skip: (page - 1) * limit,
      include: {
        reporter: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    }),
    prisma.report.count({ where })
  ]);

  return {
    reports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

// ===========================================
// RESOLVE REPORT (TAKE ACTION)
// ===========================================

interface ResolveReportParams {
  reportId: string;
  moderatorId: string;
  action: ModerationAction;
  reviewNotes?: string;
  suspensionDays?: number;
}

export const resolveReport = async (params: ResolveReportParams) => {
  const { reportId, moderatorId, action, reviewNotes, suspensionDays } = params;

  // Get report
  const report = await prisma.report.findUnique({
    where: { id: reportId }
  });

  if (!report) {
    throw new Error('Report not found');
  }

  // Update report status
  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: ReportStatus.RESOLVED,
      reviewedBy: moderatorId,
      reviewedAt: new Date(),
      reviewNotes,
      actionTaken: action
    }
  });

  // Take moderation action
  switch (action) {
    case ModerationAction.WARNING_SENT:
      await issueWarning(report.targetId, moderatorId, reportId, reviewNotes || 'Violated community guidelines');
      break;

    case ModerationAction.CONTENT_HIDDEN:
      if (report.targetType === ReportType.MESSAGE) {
        await hideMessage(report.targetId, moderatorId, reviewNotes || 'Content violation');
      }
      break;

    case ModerationAction.USER_SUSPENDED:
      await suspendUser(report.targetId, moderatorId, reportId, suspensionDays || 7, reviewNotes || 'Community guidelines violation');
      break;

    case ModerationAction.USER_BANNED:
      await banUser(report.targetId, moderatorId, reportId, reviewNotes || 'Severe violation of community guidelines');
      break;

    case ModerationAction.CREATOR_SUSPENDED:
      await suspendCreator(report.targetId, moderatorId, reportId, reviewNotes || 'Creator policy violation');
      break;

    case ModerationAction.NO_ACTION:
      // Log only, no action taken
      break;
  }

  // Create moderation log
  await prisma.moderationLog.create({
    data: {
      targetType: report.targetType,
      targetId: report.targetId,
      action,
      reason: reviewNotes || `Report resolved: ${report.reason}`,
      moderatorId,
      reportId,
      metadata: { reportReason: report.reason }
    }
  });

  return report;
};

// ===========================================
// ISSUE WARNING TO USER
// ===========================================

export const issueWarning = async (
  userId: string,
  moderatorId: string,
  reportId: string,
  reason: string
) => {
  // Get user
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Update warning count
  await prisma.user.update({
    where: { id: userId },
    data: {
      warningCount: { increment: 1 },
      lastWarningAt: new Date()
    }
  });

  // Send warning email
  const warningEmail = {
    subject: 'Warning: Community Guidelines Violation',
    html: `
      <h2>Community Guidelines Warning</h2>
      <p>Hello ${user.name},</p>
      <p>You have received a warning for violating our community guidelines.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please review our <a href="${process.env.FRONTEND_URL}/content-policy">Content Policy</a>.</p>
      <p>Repeated violations may result in account suspension or termination.</p>
      <p>Warning count: ${user.warningCount + 1}</p>
    `,
    text: `You have received a warning for violating our community guidelines. Reason: ${reason}`
  };

  await sendEmail({
    to: user.email,
    subject: warningEmail.subject,
    html: warningEmail.html,
    text: warningEmail.text
  }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Warning email failed' }));

  return { warningCount: user.warningCount + 1 };
};

// ===========================================
// SUSPEND USER (TEMPORARY)
// ===========================================

export const suspendUser = async (
  userId: string,
  moderatorId: string,
  reportId: string,
  days: number,
  reason: string
) => {
  const suspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isSuspended: true,
      suspendedAt: new Date(),
      suspendedUntil,
      suspensionReason: reason
    }
  });

  // Send suspension email
  const suspensionEmail = {
    subject: 'Account Suspended',
    html: `
      <h2>Account Suspension Notice</h2>
      <p>Hello ${user.name},</p>
      <p>Your account has been suspended for ${days} days.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Suspension Period:</strong> Until ${suspendedUntil.toLocaleDateString()}</p>
      <p>If you believe this is a mistake, please contact support.</p>
    `,
    text: `Your account has been suspended for ${days} days. Reason: ${reason}`
  };

  await sendEmail({
    to: user.email,
    subject: suspensionEmail.subject,
    html: suspensionEmail.html,
    text: suspensionEmail.text
  }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Suspension email failed' }));

  return user;
};

// ===========================================
// BAN USER (PERMANENT)
// ===========================================

export const banUser = async (
  userId: string,
  moderatorId: string,
  reportId: string,
  reason: string
) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isBanned: true,
      bannedAt: new Date(),
      banReason: reason,
      isSuspended: false // Clear suspension if any
    }
  });

  // Send ban email
  const banEmail = {
    subject: 'Account Permanently Banned',
    html: `
      <h2>Account Termination Notice</h2>
      <p>Hello ${user.name},</p>
      <p>Your account has been permanently banned from our platform.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>This decision is final. If you have questions, contact support.</p>
    `,
    text: `Your account has been permanently banned. Reason: ${reason}`
  };

  await sendEmail({
    to: user.email,
    subject: banEmail.subject,
    html: banEmail.html,
    text: banEmail.text
  }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Ban email failed' }));

  return user;
};

// ===========================================
// HIDE MESSAGE
// ===========================================

export const hideMessage = async (
  messageId: string,
  moderatorId: string,
  reason: string
) => {
  const message = await prisma.message.update({
    where: { id: messageId },
    data: {
      isHidden: true,
      hiddenAt: new Date(),
      hiddenBy: moderatorId,
      hiddenReason: reason
    }
  });

  return message;
};

// ===========================================
// SUSPEND CREATOR
// ===========================================

export const suspendCreator = async (
  creatorId: string,
  moderatorId: string,
  reportId: string,
  reason: string
) => {
  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: {
      isActive: false
    },
    include: {
      user: true
    }
  });

  // Send email
  const email = {
    subject: 'Creator Account Suspended',
    html: `
      <h2>Creator Suspension Notice</h2>
      <p>Hello ${creator.displayName},</p>
      <p>Your creator account has been suspended.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Your profile is no longer visible to users. Contact support for more information.</p>
    `,
    text: `Your creator account has been suspended. Reason: ${reason}`
  };

  await sendEmail({
    to: creator.user.email,
    subject: email.subject,
    html: email.html,
    text: email.text
  }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Creator suspension email failed' }));

  return creator;
};

// ===========================================
// GET MODERATION STATS
// ===========================================

export const getModerationStats = async () => {
  const [
    totalReports,
    pendingReports,
    resolvedToday,
    bannedUsers,
    suspendedUsers
  ] = await Promise.all([
    prisma.report.count(),
    prisma.report.count({ where: { status: ReportStatus.PENDING } }),
    prisma.report.count({
      where: {
        status: ReportStatus.RESOLVED,
        reviewedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    }),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.user.count({ where: { isSuspended: true } })
  ]);

  // Get reports by reason
  const reportsByReason = await prisma.report.groupBy({
    by: ['reason'],
    _count: true
  });

  // Get actions taken
  const actionsTaken = await prisma.moderationLog.groupBy({
    by: ['action'],
    _count: true
  });

  return {
    totalReports,
    pendingReports,
    resolvedToday,
    bannedUsers,
    suspendedUsers,
    reportsByReason,
    actionsTaken
  };
};
