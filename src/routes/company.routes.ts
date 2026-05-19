// ===========================================
// COMPANY ROUTES
// ===========================================

import { Router, Request, Response } from 'express';
import { body, query } from 'express-validator';
import { authenticate, requireCompany } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';

const router = Router();

// Validation rules
const updateProfileValidation = [
  body('companyName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Company name must be between 2 and 200 characters'),
  body('logo')
    .optional()
    .isURL()
    .withMessage('Logo must be a valid URL'),
  body('website')
    .optional()
    .isURL()
    .withMessage('Website must be a valid URL'),
  body('industry')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Industry must not exceed 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must not exceed 2000 characters'),
];

const discoverCreatorsValidation = [
  query('category').optional().trim().isLength({ max: 100 }),
  query('minChats').optional().isInt({ min: 0 }),
  query('verified').optional().isBoolean(),
];

// ===========================================
// GET COMPANY DASHBOARD
// ===========================================

router.get('/dashboard', authenticate, requireCompany, asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.findUnique({
    where: { userId: req.user!.id },
    include: {
      opportunities: {
        // Return the full row so the CompanyOpportunities table can render
        // budget, category, etc. AND the Edit modal can pre-fill every field.
        // Previously only 5 columns were selected, which made edits appear
        // to not persist (the payload simply didn't include the new values).
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          budget: true,
          budgetType: true,
          category: true,
          minFollowers: true,
          requirements: true,
          status: true,
          deadline: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { applications: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      },
      deals: {
        select: {
          id: true,
          amount: true,
          status: true,
          creator: {
            select: {
              displayName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    }
  });

  if (!company) {
    throw new AppError('Company profile not found', 404);
  }

  res.json({
    success: true,
    data: company
  });
}));

// ===========================================
// GET COMPANY DEALS
// ===========================================

router.get('/deals', authenticate, requireCompany, asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '10', status } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    company: { userId: req.user!.id }
  };

  if (status) {
    where.status = status;
  }

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            profileImage: true,
            category: true
          }
        },
        application: {
          select: {
            opportunity: {
              select: {
                title: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    }),
    prisma.deal.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      deals,
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
// UPDATE COMPANY PROFILE
// ===========================================

router.put('/profile', authenticate, requireCompany, validate(updateProfileValidation), asyncHandler(async (req: Request, res: Response) => {
  const { companyName, logo, website, industry, description } = req.body;

  const company = await prisma.company.update({
    where: { userId: req.user!.id },
    data: {
      ...(companyName && { companyName }),
      ...(logo && { logo }),
      ...(website && { website }),
      ...(industry && { industry }),
      ...(description !== undefined && { description })
    }
  });

  res.json({
    success: true,
    data: company
  });
}));

// ===========================================
// DISCOVER CREATORS
// ===========================================

router.get('/discover-creators', authenticate, requireCompany, validate(discoverCreatorsValidation), asyncHandler(async (req: Request, res: Response) => {
  const {
    category,
    minChats,
    verified = 'true',
    page = '1',
    limit = '24'
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    isActive: true
  };

  if (verified === 'true') {
    where.isVerified = true;
  }

  if (category) {
    where.category = category;
  }

  if (minChats) {
    where.totalChats = { gte: parseInt(minChats as string) };
  }

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        bio: true,
        profileImage: true,
        category: true,
        tags: true,
        totalChats: true,
        rating: true,
        isVerified: true
      },
      orderBy: { totalChats: 'desc' },
      skip,
      take: limitNum
    }),
    prisma.creator.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      creators,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }
  });
}));

export default router;
