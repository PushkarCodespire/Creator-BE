// ===========================================
// REPORT CONTROLLER (USER-FACING)
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { createReport } from '../services/moderation.service';
import prisma from '../../prisma/client';
import { ReportType, ReportReason } from '@prisma/client';

// Valid report reasons
const VALID_REASONS: string[] = [
  'SPAM',
  'HARASSMENT',
  'HATE_SPEECH',
  'SEXUAL_CONTENT',
  'VIOLENCE',
  'MISINFORMATION',
  'IMPERSONATION',
  'SCAM',
  'COPYRIGHT',
  'OTHER'
];

// Reasons that require a description
const SERIOUS_REASONS: string[] = [
  'HATE_SPEECH',
  'SEXUAL_CONTENT',
  'VIOLENCE'
];

// ===========================================
// REPORT MESSAGE
// ===========================================

export const reportMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id || null;
    const { messageId, reason, description, reporterEmail } = req.body;

    // Validate input
    if (!messageId) {
      res.status(400).json({ success: false, error: 'Message ID and reason are required' });
      return;
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      res.status(400).json({ success: false, error: 'Invalid report reason' });
      return;
    }

    // Sanitize description - strip HTML/script tags
    const sanitizedDescription = description
      ? description.replace(/<[^>]*>/g, '').trim()
      : undefined;

    // Verify message exists
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    // Create report
    const report = await createReport({
      reporterId: userId,
      reporterEmail: reporterEmail || req.user?.email,
      targetType: ReportType.MESSAGE,
      targetId: messageId,
      reason: reason as ReportReason,
      description: sanitizedDescription
    });

    res.json({
      success: true,
      message: 'Report submitted successfully',
      data: report
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('already reported') || err.message.includes('already reported'))) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    if (err.message && err.message.includes('Rate limit')) {
      res.status(429).json({ success: false, error: err.message });
      return;
    }
    res.status(400).json({ success: false, error: err.message || 'Failed to submit report' });
  }
};

// ===========================================
// REPORT USER
// ===========================================

export const reportUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { userId: targetUserId, reason, description } = req.body;

    // Validate input
    if (!targetUserId || !reason) {
      res.status(400).json({ success: false, error: 'User ID and reason are required' });
      return;
    }

    // Cannot report yourself
    if (userId && userId === targetUserId) {
      res.status(400).json({ success: false, error: 'You cannot report yourself' });
      return;
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId }
    });

    if (!targetUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Create report
    const report = await createReport({
      reporterId: userId,
      reporterEmail: req.user?.email,
      targetType: ReportType.USER,
      targetId: targetUserId,
      reason: reason as ReportReason,
      description
    });

    res.json({
      success: true,
      message: 'User reported successfully',
      data: report
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to submit report' });
  }
};

// ===========================================
// REPORT CREATOR
// ===========================================

export const reportCreator = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { creatorId, reason, description } = req.body;

    // Validate input
    if (!creatorId || !reason) {
      res.status(400).json({ success: false, error: 'Creator ID and reason are required' });
      return;
    }

    // Cannot report yourself
    if (req.user?.creator?.id && req.user.creator.id === creatorId) {
      res.status(400).json({ success: false, error: 'You cannot report yourself' });
      return;
    }

    // Require description for serious violations
    if (SERIOUS_REASONS.includes(reason) && !description) {
      res.status(400).json({ success: false, error: 'A description is required for this type of report' });
      return;
    }

    // Verify creator exists
    const creator = await prisma.creator.findUnique({
      where: { id: creatorId }
    });

    if (!creator) {
      res.status(404).json({ success: false, error: 'Creator not found' });
      return;
    }

    // Create report
    const report = await createReport({
      reporterId: userId,
      reporterEmail: req.user?.email,
      targetType: ReportType.CREATOR,
      targetId: creatorId,
      reason: reason as ReportReason,
      description
    });

    res.json({
      success: true,
      message: 'Creator reported successfully',
      data: report
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to submit report' });
  }
};

// ===========================================
// GET MY REPORTS
// ===========================================

export const getMyReports = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { page = '1', limit = '20', status, targetType } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { reporterId: userId };
    if (status) where.status = status;
    if (targetType) where.targetType = targetType;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.report.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch reports' });
  }
};
