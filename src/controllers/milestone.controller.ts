// ===========================================
// MILESTONE CONTROLLER
// ===========================================
// Milestones are deliverables attached to a brand deal.
// Both the creator and company can view + add milestones, but only the
// paying company can mark one as COMPLETED (sign-off). Only the company
// can delete a PENDING milestone.
//
// Earnings release is NOT tied to individual milestones in v1 — creators
// are paid on full deal completion (POST /opportunities/deals/:dealId/complete).
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import * as notificationService from '../services/notification.service';
import type { Server } from 'socket.io';
import { logError } from '../utils/logger';

type Role = 'CREATOR' | 'COMPANY';

/**
 * Load a deal and verify the authenticated user is either its creator or its
 * company. Returns which side they are on so handlers can enforce role-specific
 * rules (e.g. only company can mark complete).
 */
async function loadDealWithAuth(
  userId: string,
  dealId: string
): Promise<{
  deal: {
    id: string;
    companyId: string;
    creatorId: string;
    status: string;
    company: { id: string; userId: string; companyName: string } | null;
    creator: { id: string; userId: string | null; displayName: string } | null;
  };
  role: Role;
}> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      company: { select: { id: true, userId: true, companyName: true } },
      creator: { select: { id: true, userId: true, displayName: true } }
    }
  });

  if (!deal) {
    throw new AppError('Deal not found', 404);
  }

  let role: Role | null = null;
  if (deal.company && deal.company.userId === userId) role = 'COMPANY';
  else if (deal.creator && deal.creator.userId === userId) role = 'CREATOR';

  if (!role) {
    throw new AppError('You are not authorized to view this deal', 403);
  }

  return {
    deal: {
      id: deal.id,
      companyId: deal.companyId,
      creatorId: deal.creatorId,
      status: deal.status,
      company: deal.company,
      creator: deal.creator
    },
    role
  };
}

// ===========================================
// LIST MILESTONES FOR A DEAL
// GET /api/deals/:dealId/milestones
// ===========================================
export const listMilestones = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { dealId } = req.params as { dealId: string };

  const { deal, role } = await loadDealWithAuth(userId, dealId);

  const milestones = await prisma.milestone.findMany({
    where: { dealId: deal.id },
    orderBy: { createdAt: 'asc' }
  });

  res.json({
    success: true,
    data: {
      dealId: deal.id,
      role,
      milestones
    }
  });
});

// ===========================================
// CREATE MILESTONE
// POST /api/deals/:dealId/milestones
// Body: { title, description?, dueDate? }
// Both creator and company can add milestones.
// ===========================================
export const createMilestone = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { dealId } = req.params as { dealId: string };
  const { title, description, dueDate } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
  };

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new AppError('Milestone title is required', 400);
  }
  if (title.length > 200) {
    throw new AppError('Milestone title must be 200 characters or fewer', 400);
  }
  if (description && description.length > 2000) {
    throw new AppError('Description must be 2000 characters or fewer', 400);
  }

  const { deal, role } = await loadDealWithAuth(userId, dealId);

  if (deal.status !== 'IN_PROGRESS') {
    throw new AppError(
      `Cannot add milestones to a deal that is ${deal.status}`,
      400
    );
  }

  const milestone = await prisma.milestone.create({
    data: {
      dealId: deal.id,
      title: title.trim(),
      description: description?.trim() || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: 'PENDING'
    }
  });

  // Notify the OTHER party so they see the new deliverable
  try {
    const io: Server | undefined = req.app.get('io');
    const createNotification = io
      ? (params: notificationService.CreateNotificationParams) =>
          notificationService.createAndEmit(io, params)
      : (params: notificationService.CreateNotificationParams) =>
          notificationService.create(params);

    if (role === 'COMPANY' && deal.creator?.userId) {
      await createNotification({
        userId: deal.creator.userId,
        type: 'DEAL_APPLICATION',
        title: 'New milestone added to your deal',
        message: `${deal.company?.companyName || 'The company'} added a new milestone: "${milestone.title}".`,
        actionUrl: `/creator-dashboard/opportunities`,
        priority: 'NORMAL',
        data: { dealId: deal.id, milestoneId: milestone.id }
      });
    } else if (role === 'CREATOR' && deal.company?.userId) {
      await createNotification({
        userId: deal.company.userId,
        type: 'DEAL_APPLICATION',
        title: 'Creator added a milestone',
        message: `${deal.creator?.displayName || 'The creator'} added a new milestone: "${milestone.title}".`,
        actionUrl: `/company-dashboard/deals`,
        priority: 'NORMAL',
        data: { dealId: deal.id, milestoneId: milestone.id }
      });
    }
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send milestone notification' });
  }

  res.status(201).json({
    success: true,
    data: milestone
  });
});

// ===========================================
// UPDATE MILESTONE
// PATCH /api/milestones/:id
// Body: { title?, description?, dueDate?, status? }
// Only COMPANY can change status to COMPLETED (sign-off).
// Either party can edit fields before completion.
// ===========================================
export const updateMilestone = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params as { id: string };
  const { title, description, dueDate, status } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string | null;
    status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';
  };

  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: {
      deal: {
        select: {
          id: true,
          companyId: true,
          creatorId: true,
          status: true,
          company: { select: { userId: true, companyName: true } },
          creator: { select: { userId: true, displayName: true } }
        }
      }
    }
  });

  if (!milestone) {
    throw new AppError('Milestone not found', 404);
  }

  const isCompany = milestone.deal.company?.userId === userId;
  const isCreator = milestone.deal.creator?.userId === userId;

  if (!isCompany && !isCreator) {
    throw new AppError('You are not authorized to edit this milestone', 403);
  }

  if (milestone.deal.status !== 'IN_PROGRESS') {
    throw new AppError(
      `Cannot edit milestones on a deal that is ${milestone.deal.status}`,
      400
    );
  }

  if (milestone.status === 'COMPLETED') {
    throw new AppError('Completed milestones cannot be edited', 400);
  }

  // Only COMPANY can mark COMPLETED
  if (status === 'COMPLETED' && !isCompany) {
    throw new AppError(
      'Only the paying company can mark a milestone as completed',
      403
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (title !== undefined) {
    if (!title || !title.trim()) throw new AppError('Title cannot be empty', 400);
    if (title.length > 200) throw new AppError('Title too long', 400);
    data.title = title.trim();
  }
  if (description !== undefined) {
    if (description && description.length > 2000)
      throw new AppError('Description too long', 400);
    data.description = description?.trim() || null;
  }
  if (dueDate !== undefined) {
    data.dueDate = dueDate ? new Date(dueDate) : null;
  }
  if (status !== undefined) {
    if (!['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'].includes(status)) {
      throw new AppError('Invalid status', 400);
    }
    data.status = status;
    if (status === 'COMPLETED') {
      data.completedAt = new Date();
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const updated = await prisma.milestone.update({
    where: { id },
    data
  });

  // On completion, notify the creator so they know the company has signed off
  if (status === 'COMPLETED' && milestone.deal.creator?.userId) {
    try {
      const io: Server | undefined = req.app.get('io');
      const createNotification = io
        ? (params: notificationService.CreateNotificationParams) =>
            notificationService.createAndEmit(io, params)
        : (params: notificationService.CreateNotificationParams) =>
            notificationService.create(params);
      await createNotification({
        userId: milestone.deal.creator.userId,
        type: 'DEAL_COMPLETED',
        title: 'Milestone completed',
        message: `${milestone.deal.company?.companyName || 'The company'} marked "${updated.title}" as completed.`,
        actionUrl: `/creator-dashboard/opportunities`,
        priority: 'NORMAL',
        data: { dealId: milestone.deal.id, milestoneId: updated.id }
      });
    } catch (err) {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send milestone completion notification' });
    }
  }

  res.json({
    success: true,
    data: updated
  });
});

// ===========================================
// DELETE MILESTONE
// DELETE /api/milestones/:id
// Only the COMPANY can delete, and only if status === PENDING.
// ===========================================
export const deleteMilestone = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params as { id: string };

  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: {
      deal: {
        select: {
          id: true,
          status: true,
          company: { select: { userId: true } }
        }
      }
    }
  });

  if (!milestone) {
    throw new AppError('Milestone not found', 404);
  }

  if (milestone.deal.company?.userId !== userId) {
    throw new AppError('Only the company can delete milestones', 403);
  }

  if (milestone.status !== 'PENDING') {
    throw new AppError(
      `Cannot delete a milestone that is ${milestone.status}. Only PENDING milestones can be deleted.`,
      400
    );
  }

  await prisma.milestone.delete({ where: { id } });

  res.json({
    success: true,
    data: { deletedId: id }
  });
});
