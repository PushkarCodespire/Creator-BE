import { ModerationAction, ReportPriority, ReportReason, ReportStatus, ReportType } from '@prisma/client';
import prisma from '../../../prisma/client';
import { ModerationResult, SeverityLevel } from '../../types/moderation.types';
import { logError, logWarning, logInfo } from '../../utils/logger';

class ModerationActionsService {
  /**
   * Create auto-generated report when AI flags content
   */
  async createAIReport(
    targetType: ReportType,
    targetId: string,
    userId: string | null,
    moderationResult: ModerationResult
  ) {
    try {
      const reason = this.mapCategoriesToReason(moderationResult.violatedCategories);
      const priority = this.determinePriority(moderationResult.severity);

      const report = await prisma.report.create({
        data: {
          targetType,
          targetId,
          reason,
          description: `AI Moderation: ${moderationResult.reason}`,
          status: ReportStatus.PENDING,
          priority,
          reporterId: null, // System-generated report
          reporterEmail: 'ai-moderator@system',
          metadata: {
            aiGenerated: true,
            userId: userId || undefined,
            moderationScores: moderationResult.scores,
            violatedCategories: moderationResult.violatedCategories,
            severity: moderationResult.severity,
            highestScore: moderationResult.highestScore,
            highestCategory: moderationResult.highestCategory,
            autoAction: moderationResult.shouldBlock ? 'BLOCKED' : 'FLAGGED',
          },
        },
      });

      return report;
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error creating AI report' });
      throw error;
    }
  }

  /**
   * Auto-block content (mark as hidden/unpublished where possible)
   */
  async autoBlockContent(
    targetType: string,
    targetId: string,
    moderationResult: ModerationResult
  ) {
    try {
      let didBlock = true;
      switch (targetType) {
        case 'MESSAGE':
          await prisma.message.update({
            where: { id: targetId },
            data: {
              isHidden: true,
              hiddenReason: moderationResult.reason,
              hiddenAt: new Date(),
              hiddenBy: null
            },
          });
          break;

        case 'POST':
          await prisma.post.update({
            where: { id: targetId },
            data: {
              isPublished: false,
              isHidden: true,
              hiddenReason: moderationResult.reason
            },
          });
          break;

        case 'COMMENT':
          await prisma.comment.update({
            where: { id: targetId },
            data: {
              content: '[removed by moderation]'
            },
          });
          break;

        case 'CREATOR_CONTENT':
          await prisma.creatorContent.update({
            where: { id: targetId },
            data: {
              status: 'FAILED',
              errorMessage: `AI Moderation: ${moderationResult.reason}`,
            },
          });
          break;

        default:
          logWarning(`Auto-block skipped for unsupported target type: ${targetType}`);
          didBlock = false;
      }

      if (didBlock) {
        logInfo(`Auto-blocked ${targetType} ${targetId}`);
      }
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error auto-blocking content' });
      throw error;
    }
  }

  /**
   * Map AI categories to report reasons
   */
  private mapCategoriesToReason(categories: string[]): ReportReason {
    const categoryMap: Record<string, ReportReason> = {
      'hate': ReportReason.HATE_SPEECH,
      'hate/threatening': ReportReason.HATE_SPEECH,
      'harassment': ReportReason.HARASSMENT,
      'harassment/threatening': ReportReason.HARASSMENT,
      'sexual': ReportReason.SEXUAL_CONTENT,
      'sexual/minors': ReportReason.SEXUAL_CONTENT,
      'violence': ReportReason.VIOLENCE,
      'violence/graphic': ReportReason.VIOLENCE,
      'self-harm': ReportReason.OTHER,
      'self-harm/intent': ReportReason.OTHER,
      'self-harm/instructions': ReportReason.OTHER,
    };

    for (const category of categories) {
      if (categoryMap[category]) {
        return categoryMap[category];
      }
    }

    return ReportReason.OTHER;
  }

  /**
   * Determine priority based on severity
   */
  private determinePriority(severity: SeverityLevel): ReportPriority {
    switch (severity) {
      case SeverityLevel.CRITICAL:
        return ReportPriority.URGENT;
      case SeverityLevel.HIGH:
        return ReportPriority.HIGH;
      case SeverityLevel.MEDIUM:
        return ReportPriority.MEDIUM;
      default:
        return ReportPriority.LOW;
    }
  }

  /**
   * Log AI moderation action
   */
  async logModerationAction(
    targetType: string,
    targetId: string,
    action: ModerationAction,
    moderationResult: ModerationResult
  ) {
    try {
      await prisma.moderationLog.create({
        data: {
          action,
          targetType,
          targetId,
          moderatorId: null,
          reason: `AI Moderation: ${moderationResult.reason}`,
          metadata: {
            aiGenerated: true,
            scores: moderationResult.scores,
            severity: moderationResult.severity,
            highestScore: moderationResult.highestScore,
            highestCategory: moderationResult.highestCategory
          },
        },
      });
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error logging moderation action' });
    }
  }
}

export default new ModerationActionsService();
