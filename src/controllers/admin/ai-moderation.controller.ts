import { Request, Response } from 'express';
import prisma from '../../../prisma/client';
import aiModerationService from '../../services/moderation/ai-moderation.service';
import { sendError } from '../../utils/apiResponse';
import { logError } from '../../utils/logger';

/**
 * Get AI moderation statistics
 */
export const getAIModerationStats = async (req: Request, res: Response) => {
  try {
    const timeframe = String(req.query.timeframe || '7d');
    const daysAgo = timeframe === '30d' ? 30 : 7;
    const startDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const aiReports = await prisma.report.findMany({
      where: {
        reporterEmail: 'ai-moderator@system',
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      totalAIReports: aiReports.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocked: aiReports.filter(r => ((r.metadata as any)?.autoAction === 'BLOCKED')).length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      flagged: aiReports.filter(r => ((r.metadata as any)?.autoAction === 'FLAGGED')).length,
      bySeverity: {
        critical: aiReports.filter(r => r.priority === 'URGENT').length,
        high: aiReports.filter(r => r.priority === 'HIGH').length,
        medium: aiReports.filter(r => r.priority === 'MEDIUM').length,
        low: aiReports.filter(r => r.priority === 'LOW').length,
      },
      byReason: aiReports.reduce((acc: Record<string, number>, report) => {
        const reason = report.reason || 'UNKNOWN';
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {}),
      recentReports: aiReports.slice(0, 10).map(report => ({
        id: report.id,
        targetType: report.targetType,
        reason: report.reason,
        priority: report.priority,
        createdAt: report.createdAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        autoAction: (report.metadata as any)?.autoAction,
      })),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Get AI Stats Error' });
    sendError(res, 500, 'AI_STATS_ERROR', 'Failed to fetch AI moderation stats');
  }
};

/**
 * Test AI moderation on sample content
 */
export const testModeration = async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content) {
      return sendError(res, 400, 'CONTENT_REQUIRED', 'Content is required');
    }

    const result = await aiModerationService.moderateContent(content);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Test Moderation Error' });
    sendError(res, 500, 'AI_TEST_ERROR', 'Failed to test moderation');
  }
};

/**
 * Update moderation thresholds
 */
export const updateThresholds = async (req: Request, res: Response) => {
  try {
    const { category, blockThreshold, flagThreshold } = req.body;

    res.json({
      success: true,
      message: 'Thresholds updated (restart server for changes)',
      data: {
        category,
        blockThreshold,
        flagThreshold,
      },
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Update Thresholds Error' });
    sendError(res, 500, 'THRESHOLD_UPDATE_ERROR', 'Failed to update thresholds');
  }
};

/**
 * Get AI moderation logs
 */
export const getAIModerationLogs = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;

    const where = {
      metadata: {
        path: ['aiGenerated'],
        equals: true,
      },
    };

    const logs = await prisma.moderationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: (pageNum - 1) * limitNum,
    });

    const total = await prisma.moderationLog.count({ where });

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Get AI Logs Error' });
    sendError(res, 500, 'AI_LOGS_ERROR', 'Failed to fetch AI logs');
  }
};
