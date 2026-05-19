// ===========================================
// OPPORTUNITY ROUTES
// ===========================================

import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireCompany, requireCreator } from '../middleware/auth';
import prisma from '../../prisma/client';
import { Prisma } from '@prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { validate } from '../middleware/validation';
import { cacheMiddleware, invalidateCache } from '../middleware/cache';
import { distributeEarnings } from '../utils/earnings';
import * as notificationService from '../services/notification.service';
import type { Server } from 'socket.io';
import { logError, logDebug } from '../utils/logger';

const router = Router();

// Validation rules
const listOpportunitiesValidation = [
  query('category').optional().trim().isLength({ max: 100 }),
  query('type').optional().isIn(['SPONSORED_POST', 'BRAND_AMBASSADOR', 'PRODUCT_REVIEW', 'AFFILIATE', 'COLLABORATION', 'OTHER']),
  query('status').optional().isIn(['OPEN', 'CLOSED', 'FILLED', 'CANCELLED']),
];

const createOpportunityValidation = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 20, max: 5000 })
    .withMessage('Description must be between 20 and 5000 characters'),
  body('type')
    .isIn(['SPONSORED_POST', 'BRAND_AMBASSADOR', 'PRODUCT_REVIEW', 'AFFILIATE', 'COLLABORATION', 'OTHER'])
    .withMessage('Valid opportunity type is required'),
  body('budget')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Budget must be a positive number'),
  body('budgetType')
    .optional()
    .isIn(['FIXED', 'NEGOTIABLE', 'PER_POST', 'MONTHLY'])
    .withMessage('Budget type must be FIXED, NEGOTIABLE, PER_POST, or MONTHLY'),
  body('category')
    .optional()
    .trim()
    .isLength({ max: 100 }),
  body('minFollowers')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Minimum followers must be a positive integer'),
  body('requirements')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Requirements must not exceed 2000 characters'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Deadline must be a valid date'),
];

const opportunityIdValidation = [
  param('id').isUUID().withMessage('Valid opportunity ID is required'),
];

// Update opportunity — same fields as create, but all optional (partial update)
// and `type` / `status` are NOT editable once created.
const updateOpportunityValidation = [
  param('id').isUUID().withMessage('Valid opportunity ID is required'),
  body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be between 1 and 200 characters'),
  body('description').optional().trim().isLength({ min: 20, max: 5000 }).withMessage('Description must be between 20 and 5000 characters'),
  body('budget').optional().isFloat({ min: 0 }).withMessage('Budget must be a positive number'),
  body('budgetType').optional().isIn(['FIXED', 'NEGOTIABLE', 'PER_POST', 'MONTHLY']).withMessage('Invalid budget type'),
  body('category').optional().trim().isLength({ max: 100 }),
  body('minFollowers').optional().isInt({ min: 0 }).withMessage('Minimum followers must be a positive integer'),
  body('requirements').optional().trim().isLength({ max: 2000 }).withMessage('Requirements must not exceed 2000 characters'),
  body('deadline').optional().isISO8601().withMessage('Deadline must be a valid date'),
];

const applyOpportunityValidation = [
  param('id').isUUID().withMessage('Valid opportunity ID is required'),
  body('pitch')
    .trim()
    .notEmpty()
    .withMessage('Pitch is required')
    .isLength({ min: 50, max: 2000 })
    .withMessage('Pitch must be between 50 and 2000 characters'),
  body('proposedBudget')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Proposed budget must be a positive number'),
];

const applicationIdValidation = [
  param('applicationId').isUUID().withMessage('Valid application ID is required'),
];

const dealIdValidation = [
  param('dealId').isUUID().withMessage('Valid deal ID is required'),
];

// ===========================================
// GET ALL OPPORTUNITIES (Public for creators)
// ===========================================

router.get('/', authenticate, cacheMiddleware(300), validate(listOpportunitiesValidation), asyncHandler(async (req: Request, res: Response) => {
  const {
    category,
    type,
    status = 'OPEN',
    search,
    minBudget,
    maxBudget,
    sortBy = 'createdAt',
    page = '1',
    limit = '20'
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    status: status as string
  };

  if (category) {
    where.category = category;
  }

  if (type) {
    where.type = type;
  }

  // Search in title and description
  if (search) {
    where.OR = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } }
    ];
  }

  // Budget filters
  if (minBudget || maxBudget) {
    where.budget = {};
    if (minBudget) {
      where.budget.gte = parseFloat(minBudget as string);
    }
    if (maxBudget) {
      where.budget.lte = parseFloat(maxBudget as string);
    }
  }

  const userRole = req.user?.role;
  let creatorId: string | null = null;

  if (userRole === 'CREATOR') {
    const creator = await prisma.creator.findUnique({
      where: { userId: req.user!.id },
      select: { id: true }
    });
    creatorId = creator?.id ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunitySelect: any = {
    id: true,
    title: true,
    description: true,
    type: true,
    budget: true,
    budgetType: true,
    category: true,
    minFollowers: true,
    deadline: true,
    createdAt: true,
    company: {
      select: {
        companyName: true,
        logo: true,
        isVerified: true
      }
    },
    _count: {
      select: { applications: true }
    },
    ...(creatorId
      ? {
          applications: {
            where: { creatorId },
            select: { id: true, status: true }
          }
        }
      : {})
  };

  const [opportunities, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      select: opportunitySelect,
      orderBy: { [sortBy as string]: 'desc' },
      skip,
      take: limitNum
    }),
    prisma.opportunity.count({ where })
  ]);

  const opportunitiesWithApplied = creatorId
    ? opportunities.map((op) => {
        const { applications, ...rest } = op;
        const first = applications?.[0];
        return {
          ...rest,
          hasApplied: !!first,
          myApplicationStatus: first?.status ?? null
        };
      })
    : opportunities;

  res.json({
    success: true,
    data: {
      opportunities: opportunitiesWithApplied,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
}));

// ===========================================
// CREATE OPPORTUNITY (Company only)
// ===========================================

router.post('/', authenticate, requireCompany, validate(createOpportunityValidation), asyncHandler(async (req: Request, res: Response) => {
  const {
    title,
    description,
    type,
    budget,
    budgetType,
    category,
    minFollowers,
    requirements,
    deadline
  } = req.body;

  if (!title || !description || !type) {
    throw new AppError('Title, description, and type are required', 400);
  }

  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  const opportunity = await prisma.opportunity.create({
    data: {
      companyId: company.id,
      title,
      description,
      type,
      budget: budget ? parseFloat(budget) : null,
      budgetType,
      category,
      minFollowers: minFollowers ? parseInt(minFollowers) : null,
      requirements,
      deadline: deadline ? new Date(deadline) : null
    }
  });

  // Invalidate opportunity list caches
  await invalidateCache('cache:/api/opportunities?*');
  await invalidateCache(`cache:/api/opportunities/${opportunity.id}*`);

  // Notify all creators about the new opportunity
  const io: Server | undefined = req.app.get('io');
  const createNotification = io
    ? (params: notificationService.CreateNotificationParams) => notificationService.createAndEmit(io, params)
    : (params: notificationService.CreateNotificationParams) => notificationService.create(params);

  // Fetch active creators with linked users
  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: { userId: true, displayName: true }
  });

  await Promise.all(
    creators
      .filter(c => !!c.userId)
      .map(c =>
        createNotification({
          userId: c.userId!,
          type: 'SYSTEM_ANNOUNCEMENT',
          title: 'New Opportunity Posted',
          message: `${title} — ${description.substring(0, 120)}${description.length > 120 ? '…' : ''}`,
          actionUrl: `/opportunities/${opportunity.id}`,
          data: {
            opportunityId: opportunity.id,
            companyId: company.id,
            opportunityType: type,
            category,
            budget,
            minFollowers
          },
          priority: 'NORMAL'
        }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to create opportunity notification' }))
      )
  );

  res.status(201).json({
    success: true,
    data: opportunity
  });
}));

// ===========================================
// GET SINGLE OPPORTUNITY
// ===========================================

router.get('/:id', authenticate, validate(opportunityIdValidation), asyncHandler(async (req: Request, res: Response) => {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: req.params.id as string },
    include: {
      company: {
        select: {
          companyName: true,
          logo: true,
          website: true,
          industry: true,
          isVerified: true
        }
      },
      applications: {
        select: {
          id: true,
          status: true,
          pitch: true,
          proposedBudget: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              displayName: true,
              profileImage: true,
              instagramUrl: true,
              twitterUrl: true,
              youtubeUrl: true,
              websiteUrl: true,
              user: {
                select: {
                  email: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!opportunity) {
    throw new AppError('Opportunity not found', 404);
  }

  // Debug log to verify fields
  logDebug('Fetched Opportunity: ' + opportunity?.id);

  res.json({
    success: true,
    data: opportunity
  });
}));

// ===========================================
// UPDATE OPPORTUNITY (Company only, OPEN status only)
// Partial update — any field not sent is left unchanged.
// `type` and `status` are deliberately NOT editable.
// ===========================================

router.put('/:id', authenticate, requireCompany, validate(updateOpportunityValidation), asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: req.params.id as string },
    select: { id: true, companyId: true, status: true }
  });

  if (!opportunity || opportunity.companyId !== company.id) {
    throw new AppError('Opportunity not found', 404);
  }

  if (opportunity.status !== 'OPEN') {
    throw new AppError(
      `Cannot edit an opportunity that is ${opportunity.status}. Only OPEN opportunities can be edited.`,
      400
    );
  }

  // Whitelist editable fields. Silently ignore anything else (including
  // type/status/companyId) even if the client tries to send them.
  const allowedFields = [
    'title',
    'description',
    'budget',
    'budgetType',
    'category',
    'minFollowers',
    'requirements',
    'deadline'
  ] as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === 'deadline' && req.body.deadline) {
        data[field] = new Date(req.body.deadline);
      } else {
        data[field] = req.body[field];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const updated = await prisma.opportunity.update({
    where: { id: opportunity.id },
    data,
    include: {
      company: { select: { id: true, companyName: true, logo: true, isVerified: true } },
      _count: { select: { applications: true } }
    }
  });

  // Invalidate list and detail caches
  await invalidateCache('cache:/api/opportunities?*').catch(() => {});
  await invalidateCache(`cache:/api/opportunities/${opportunity.id}*`).catch(() => {});

  res.json({
    success: true,
    data: updated,
    meta: {
      applicationsCount: updated._count.applications
    }
  });
}));

// ===========================================
// CANCEL OPPORTUNITY (Company only, OPEN status only)
// Marks the opportunity as CANCELLED, auto-rejects all PENDING applications,
// and notifies every applicant with a LOW-priority notification.
// ===========================================

router.post('/:id/cancel', authenticate, requireCompany, validate(opportunityIdValidation), asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: req.params.id as string },
    select: { id: true, companyId: true, status: true, title: true }
  });

  if (!opportunity || opportunity.companyId !== company.id) {
    throw new AppError('Opportunity not found', 404);
  }

  if (opportunity.status !== 'OPEN') {
    throw new AppError(
      `Cannot cancel an opportunity that is ${opportunity.status}.`,
      400
    );
  }

  // Atomic: mark opportunity CANCELLED + reject all pending applications
  const { rejectedApplicationIds } = await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: { status: 'CANCELLED' }
    });

    const losers = await tx.application.findMany({
      where: { opportunityId: opportunity.id, status: 'PENDING' },
      select: { id: true }
    });

    if (losers.length > 0) {
      await tx.application.updateMany({
        where: { opportunityId: opportunity.id, status: 'PENDING' },
        data: { status: 'REJECTED' }
      });
    }

    return { rejectedApplicationIds: losers.map(l => l.id) };
  });

  // Invalidate caches
  await invalidateCache('cache:/api/opportunities?*').catch(() => {});
  await invalidateCache(`cache:/api/opportunities/${opportunity.id}*`).catch(() => {});

  // Notify all auto-rejected applicants (fire-and-forget)
  if (rejectedApplicationIds.length > 0) {
    const io: Server | undefined = req.app.get('io');
    const createNotification = io
      ? (params: notificationService.CreateNotificationParams) => notificationService.createAndEmit(io, params)
      : (params: notificationService.CreateNotificationParams) => notificationService.create(params);

    const losingApps = await prisma.application.findMany({
      where: { id: { in: rejectedApplicationIds } },
      include: { creator: { select: { userId: true } } }
    });

    for (const loser of losingApps) {
      if (!loser.creator.userId) continue;
      createNotification({
        userId: loser.creator.userId,
        type: 'DEAL_APPLICATION',
        title: 'Opportunity cancelled',
        message: `${company.companyName} cancelled "${opportunity.title}". Your application was withdrawn automatically — keep an eye out for new opportunities.`,
        actionUrl: `/creator-dashboard/opportunities`,
        priority: 'LOW',
        data: {
          applicationId: loser.id,
          opportunityId: opportunity.id,
          companyId: company.id
        }
      }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send cancel notification' }));
    }
  }

  res.json({
    success: true,
    data: {
      opportunityId: opportunity.id,
      status: 'CANCELLED',
      autoRejectedCount: rejectedApplicationIds.length
    }
  });
}));

// ===========================================
// APPLY TO OPPORTUNITY (Creator only)
// ===========================================

router.post('/:id/apply', authenticate, requireCreator, validate(applyOpportunityValidation), asyncHandler(async (req: Request, res: Response) => {
  const { pitch, proposedBudget } = req.body;

  if (!pitch) {
    throw new AppError('Pitch is required', 400);
  }

  const creator = await prisma.creator.findUnique({
    where: { userId: req.user!.id }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Check if opportunity exists and is open
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: req.params.id as string }
  });

  if (!opportunity || opportunity.status !== 'OPEN') {
    throw new AppError('Opportunity not found or closed', 404);
  }

  // Check for existing application
  const existing = await prisma.application.findUnique({
    where: {
      opportunityId_creatorId: {
        opportunityId: req.params.id as string,
        creatorId: creator.id
      }
    }
  });

  if (existing) {
    throw new AppError('You have already applied to this opportunity', 400);
  }

  let application;

  try {
    application = await prisma.application.create({
      data: {
        opportunityId: req.params.id as string,
        creatorId: creator.id,
        pitch,
        proposedBudget: proposedBudget ? parseFloat(proposedBudget) : null
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('You have already applied to this opportunity', 400);
    }
    throw error;
  }

  // Invalidate opportunity cache to reflect new application
  await invalidateCache(`cache:/api/opportunities/${req.params.id}*`);

  res.status(201).json({
    success: true,
    data: application
  });
}));

// ===========================================
// ACCEPT APPLICATION (Company only)
// ===========================================

router.post('/applications/:applicationId/accept', authenticate, requireCompany, validate(applicationIdValidation), asyncHandler(async (req: Request, res: Response) => {
  const { amount } = req.body;

  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  // Get application + opportunity + creator (with userId for notifications)
  const application = await prisma.application.findUnique({
    where: { id: req.params.applicationId as string },
    include: {
      opportunity: true,
      creator: {
        select: { id: true, userId: true, displayName: true }
      }
    }
  });

  if (!application || application.opportunity.companyId !== company.id) {
    throw new AppError('Application not found', 404);
  }

  if (application.status !== 'PENDING') {
    throw new AppError('Application already processed', 400);
  }

  if (application.opportunity.status !== 'OPEN') {
    throw new AppError('This opportunity is no longer open', 400);
  }

  const dealAmount = parseFloat(amount) || Number(application.proposedBudget) || 0;
  const platformFee = dealAmount * config.brandDeal.platformCommission;
  const creatorEarnings = dealAmount - platformFee;

  // Atomic: accept this application, create the deal, mark the opportunity
  // as FILLED, and auto-reject every other pending application on the same
  // opportunity. Returning the IDs of the losing applications so we can
  // notify them afterwards.
  const { deal, rejectedApplicationIds } = await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: application.id },
      data: { status: 'ACCEPTED' }
    });

    const createdDeal = await tx.deal.create({
      data: {
        applicationId: application.id,
        companyId: company.id,
        creatorId: application.creatorId,
        amount: dealAmount,
        platformFee,
        creatorEarnings,
        startDate: new Date()
      }
    });

    // Auto-create a default "Deliverable handoff" milestone so the deal
    // has something visible in the milestone timeline from day one. Either
    // party can edit it or add more milestones later.
    await tx.milestone.create({
      data: {
        dealId: createdDeal.id,
        title: 'Deliverable handoff',
        description: `Default milestone auto-created when "${application.opportunity.title}" was accepted. Edit or add more milestones as the deal progresses.`,
        status: 'PENDING'
      }
    });

    await tx.opportunity.update({
      where: { id: application.opportunityId },
      data: { status: 'FILLED' }
    });

    // Collect the pending losers before rejecting them (for notifications)
    const losers = await tx.application.findMany({
      where: {
        opportunityId: application.opportunityId,
        id: { not: application.id },
        status: 'PENDING'
      },
      select: { id: true }
    });

    if (losers.length > 0) {
      await tx.application.updateMany({
        where: {
          opportunityId: application.opportunityId,
          id: { not: application.id },
          status: 'PENDING'
        },
        data: { status: 'REJECTED' }
      });
    }

    return { deal: createdDeal, rejectedApplicationIds: losers.map(l => l.id) };
  });

  // Invalidate caches so the opportunity list / detail reflect the new state
  await invalidateCache('cache:/api/opportunities?*').catch(() => {});
  await invalidateCache(`cache:/api/opportunities/${application.opportunityId}*`).catch(() => {});

  // Fire-and-forget notifications. Don't let a notification failure fail the
  // accept request — the DB state is already committed.
  const io: Server | undefined = req.app.get('io');
  const createNotification = io
    ? (params: notificationService.CreateNotificationParams) => notificationService.createAndEmit(io, params)
    : (params: notificationService.CreateNotificationParams) => notificationService.create(params);

  // Notify the accepted creator (HIGH priority)
  if (application.creator.userId) {
    createNotification({
      userId: application.creator.userId,
      type: 'DEAL_ACCEPTED',
      title: 'Your application was accepted!',
      message: `${company.companyName} accepted your application to "${application.opportunity.title}". A new deal worth ₹${dealAmount.toLocaleString('en-IN')} has been created.`,
      actionUrl: `/creator-dashboard/opportunities`,
      priority: 'HIGH',
      data: {
        dealId: deal.id,
        opportunityId: application.opportunityId,
        companyId: company.id,
        amount: dealAmount,
        creatorEarnings
      }
    }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send DEAL_ACCEPTED notification' }));
  }

  // Notify the creators whose applications were auto-rejected (LOW priority)
  if (rejectedApplicationIds.length > 0) {
    const losingApps = await prisma.application.findMany({
      where: { id: { in: rejectedApplicationIds } },
      include: { creator: { select: { userId: true } } }
    });

    for (const loser of losingApps) {
      if (!loser.creator.userId) continue;
      createNotification({
        userId: loser.creator.userId,
        type: 'DEAL_APPLICATION',
        title: 'Your application was not selected',
        message: `${company.companyName} chose another creator for "${application.opportunity.title}". Thanks for applying — keep an eye out for new opportunities.`,
        actionUrl: `/creator-dashboard/opportunities`,
        priority: 'LOW',
        data: {
          applicationId: loser.id,
          opportunityId: application.opportunityId,
          companyId: company.id
        }
      }).catch(err => logError(err instanceof Error ? err : new Error(String(err)), { context: 'Failed to send auto-reject notification' }));
    }
  }

  res.json({
    success: true,
    data: {
      deal,
      opportunityStatus: 'FILLED',
      autoRejectedCount: rejectedApplicationIds.length
    }
  });
}));

// ===========================================
// REJECT APPLICATION (Company only)
// ===========================================

router.post('/applications/:applicationId/reject', authenticate, requireCompany, validate(applicationIdValidation), asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  const application = await prisma.application.findUnique({
    where: { id: req.params.applicationId as string },
    include: {
      opportunity: true
    }
  });

  if (!application || application.opportunity.companyId !== company.id) {
    throw new AppError('Application not found', 404);
  }

  const updated = await prisma.application.update({
    where: { id: req.params.applicationId as string },
    data: { status: 'REJECTED' }
  });

  res.json({
    success: true,
    data: updated
  });
}));

// ===========================================
// COMPLETE DEAL (Company only)
// Mark deal as completed and distribute earnings to creator
// ===========================================

router.post('/deals/:dealId/complete', authenticate, requireCompany, validate(dealIdValidation), asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  // Get deal with full details
  const deal = await prisma.deal.findUnique({
    where: { id: req.params.dealId as string },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true
        }
      }
    }
  });

  if (!deal || deal.companyId !== company.id) {
    throw new AppError('Deal not found or unauthorized', 404);
  }

  if (deal.status === 'COMPLETED') {
    throw new AppError('Deal already completed', 400);
  }

  if (deal.status === 'CANCELLED') {
    throw new AppError('Cannot complete a cancelled deal', 400);
  }

  // Update deal status to COMPLETED
  const completedDeal = await prisma.deal.update({
    where: { id: req.params.dealId as string },
    data: {
      status: 'COMPLETED',
      completedAt: new Date()
    }
  });

  // Distribute earnings to creator (90% of deal amount)
  try {
    const creatorEarnings = Number(deal.creatorEarnings);

    await distributeEarnings({
      creatorId: deal.creatorId,
      amount: creatorEarnings,
      sourceType: 'brand_deal',
      sourceId: deal.id,
      description: `Brand deal earnings: ${(deal as unknown as { creator: { displayName: string } }).creator.displayName} × ${company.companyName}`
    });

    logDebug(`Distributed earnings to creator ${(deal as unknown as { creator: { displayName: string } }).creator.displayName} for completed brand deal`);

    // Update creator's totalEarnings (already done in distributeEarnings, but update deal count)
    await prisma.creator.update({
      where: { id: deal.creatorId },
      data: {
        totalChats: { increment: 1 } // Using totalChats as a proxy for completed deals
      }
    });

  } catch (earningsError) {
    logError(earningsError instanceof Error ? earningsError : new Error(String(earningsError)), { context: 'Failed to distribute brand deal earnings' });
    throw new AppError('Deal marked as completed but earnings distribution failed. Please contact support.', 500);
  }

  res.json({
    success: true,
    message: 'Deal completed and earnings distributed to creator',
    data: {
      deal: completedDeal,
      earningsDistributed: Number(deal.creatorEarnings)
    }
  });
}));

export default router;
