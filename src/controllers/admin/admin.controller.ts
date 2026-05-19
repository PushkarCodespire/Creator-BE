// ===========================================
// ADMIN MANAGEMENT CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../../prisma/client';
import { asyncHandler, AppError } from '../../middleware/errorHandler';
import { config } from '../../config';
import {
  ContentStatus,
  DealStatus,
  UserRole
} from '@prisma/client';
import {
  welcomeEmail,
  emailVerificationEmail,
  passwordResetEmail,
  passwordChangedEmail,
  paymentReceiptEmail,
  creatorVerificationEmail
} from '../../utils/email';

// ===========================================
// USERS
// ===========================================

export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      isVerified: true,
      createdAt: true,
      lastLoginAt: true,
      isSuspended: true,
      suspendedUntil: true,
      suspensionReason: true,
      isBanned: true,
      bannedAt: true,
      banReason: true,
      warningCount: true,
      creator: { select: { id: true } },
      company: { select: { id: true } },
      subscription: {
        select: {
          plan: true,
          status: true,
          messagesUsedToday: true,
          currentPeriodEnd: true
        }
      }
    }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const [conversationCount, messageCount, reportsMade] = await Promise.all([
    prisma.conversation.count({ where: { userId } }),
    prisma.message.count({ where: { userId } }),
    prisma.report.count({ where: { reporterId: userId } })
  ]);

  res.json({
    success: true,
    data: {
      user,
      analytics: {
        conversationCount,
        messageCount,
        reportsMade
      }
    }
  });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { email, name, avatar, isVerified } = req.body;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (email !== undefined) data.email = email;
  if (name !== undefined) data.name = name;
  if (avatar !== undefined) data.avatar = avatar;
  if (isVerified !== undefined) data.isVerified = Boolean(isVerified);

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      isVerified: true
    }
  });

  res.json({ success: true, data: user });
});

export const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { role } = req.body as { role?: UserRole };

  if (!role || !Object.values(UserRole).includes(role)) {
    throw new AppError('Invalid role', 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role },
    select: {
      id: true,
      email: true,
      name: true,
      role: true
    }
  });

  res.json({ success: true, data: user });
});

export const suspendUserAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { days = 7, reason = 'Admin suspension' } = req.body as { days?: number; reason?: string };

  const suspendedUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isSuspended: true,
      suspendedAt: new Date(),
      suspendedUntil,
      suspensionReason: reason
    }
  });

  res.json({
    success: true,
    message: 'User suspended',
    data: {
      id: user.id,
      isSuspended: user.isSuspended,
      suspendedUntil: user.suspendedUntil,
      suspensionReason: user.suspensionReason
    }
  });
});

export const unsuspendUserAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isSuspended: false,
      suspendedAt: null,
      suspendedUntil: null,
      suspensionReason: null
    }
  });

  res.json({
    success: true,
    message: 'User unsuspended',
    data: {
      id: user.id,
      isSuspended: user.isSuspended
    }
  });
});

export const banUserAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  const { reason = 'Admin ban' } = req.body as { reason?: string };

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isBanned: true,
      bannedAt: new Date(),
      banReason: reason,
      isSuspended: false,
      suspendedAt: null,
      suspendedUntil: null,
      suspensionReason: null
    }
  });

  res.json({
    success: true,
    message: 'User banned',
    data: {
      id: user.id,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt,
      banReason: user.banReason
    }
  });
});

export const unbanUserAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      isBanned: false,
      bannedAt: null,
      banReason: null
    }
  });

  res.json({
    success: true,
    message: 'User unbanned',
    data: {
      id: user.id,
      isBanned: user.isBanned
    }
  });
});

export const deleteUserAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.role === 'ADMIN') {
    throw new AppError('Admin accounts cannot be deleted', 403);
  }

  await prisma.user.delete({ where: { id: userId } });

  res.json({
    success: true,
    message: `User ${user.email} has been permanently deleted`
  });
});

// ===========================================
// CREATORS
// ===========================================

export const listCreators = asyncHandler(async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search,
    verified,
    active,
    category
  } = req.query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (category) where.category = category;
  if (verified !== undefined) where.isVerified = String(verified) === 'true';
  if (active !== undefined) where.isActive = String(active) === 'true';
  if (search) {
    where.OR = [
      { displayName: { contains: String(search), mode: 'insensitive' } },
      { user: { name: { contains: String(search), mode: 'insensitive' } } },
      { user: { email: { contains: String(search), mode: 'insensitive' } } }
    ];
  }

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isVerified: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit)
    }),
    prisma.creator.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      creators,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

export const getCreatorDetail = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isVerified: true,
          createdAt: true,
          lastLoginAt: true
        }
      }
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  const [contentCount, conversationCount, messageCount] = await Promise.all([
    prisma.creatorContent.count({ where: { creatorId } }),
    prisma.conversation.count({ where: { creatorId } }),
    prisma.message.count({ where: { conversation: { creatorId } } })
  ]);

  res.json({
    success: true,
    data: {
      creator,
      analytics: {
        contentCount,
        conversationCount,
        messageCount
      }
    }
  });
});

export const updateCreator = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const {
    displayName,
    bio,
    tagline,
    category,
    tags,
    profileImage,
    coverImage,
    youtubeUrl,
    instagramUrl,
    twitterUrl,
    websiteUrl,
    isVerified,
    isActive
  } = req.body;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (displayName !== undefined) data.displayName = displayName;
  if (bio !== undefined) data.bio = bio;
  if (tagline !== undefined) data.tagline = tagline;
  if (category !== undefined) data.category = category;
  if (tags !== undefined) data.tags = tags;
  if (profileImage !== undefined) data.profileImage = profileImage;
  if (coverImage !== undefined) data.coverImage = coverImage;
  if (youtubeUrl !== undefined) data.youtubeUrl = youtubeUrl;
  if (instagramUrl !== undefined) data.instagramUrl = instagramUrl;
  if (twitterUrl !== undefined) data.twitterUrl = twitterUrl;
  if (websiteUrl !== undefined) data.websiteUrl = websiteUrl;
  if (isVerified !== undefined) {
    data.isVerified = Boolean(isVerified);
    data.verifiedAt = isVerified ? new Date() : null;
  }
  if (isActive !== undefined) data.isActive = Boolean(isActive);

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data
  });

  res.json({ success: true, data: creator });
});

export const setCreatorActive = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { isActive } = req.body as { isActive?: boolean };

  if (isActive === undefined) {
    throw new AppError('isActive is required', 400);
  }

  const creator = await prisma.creator.update({
    where: { id: creatorId },
    data: { isActive: Boolean(isActive) }
  });

  res.json({ success: true, data: creator });
});

// ===========================================
// COMPANIES
// ===========================================

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search, verified, industry } = req.query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (industry) where.industry = industry;
  if (verified !== undefined) where.isVerified = String(verified) === 'true';
  if (search) {
    where.OR = [
      { companyName: { contains: String(search), mode: 'insensitive' } },
      { user: { email: { contains: String(search), mode: 'insensitive' } } }
    ];
  }

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit)
    }),
    prisma.company.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      companies,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

export const getCompanyDetail = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.params as { companyId: string };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true
        }
      }
    }
  });

  if (!company) {
    throw new AppError('Company not found', 404);
  }

  const [opportunityCount, dealCount] = await Promise.all([
    prisma.opportunity.count({ where: { companyId } }),
    prisma.deal.count({ where: { companyId } })
  ]);

  res.json({
    success: true,
    data: {
      company,
      analytics: {
        opportunityCount,
        dealCount
      }
    }
  });
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.params as { companyId: string };
  const {
    companyName,
    logo,
    website,
    industry,
    description,
    isVerified
  } = req.body;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (companyName !== undefined) data.companyName = companyName;
  if (logo !== undefined) data.logo = logo;
  if (website !== undefined) data.website = website;
  if (industry !== undefined) data.industry = industry;
  if (description !== undefined) data.description = description;
  if (isVerified !== undefined) data.isVerified = Boolean(isVerified);

  const company = await prisma.company.update({
    where: { id: companyId },
    data
  });

  res.json({ success: true, data: company });
});

// ===========================================
// CREATOR CONTENT MODERATION
// ===========================================

export const listCreatorContents = asyncHandler(async (req: Request, res: Response) => {
  const { creatorId } = req.params as { creatorId: string };
  const { page = 1, limit = 20, status } = req.query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { creatorId };
  if (status) where.status = status;

  const [contents, total] = await Promise.all([
    prisma.creatorContent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit)
    }),
    prisma.creatorContent.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      contents,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

export const updateContentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { contentId } = req.params as { contentId: string };
  const { status, errorMessage } = req.body as { status?: ContentStatus; errorMessage?: string };

  if (!status || !Object.values(ContentStatus).includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { status };
  if (errorMessage !== undefined) data.errorMessage = errorMessage;
  if (status === ContentStatus.COMPLETED) data.processedAt = new Date();

  const content = await prisma.creatorContent.update({
    where: { id: contentId },
    data
  });

  res.json({ success: true, data: content });
});

export const deleteContent = asyncHandler(async (req: Request, res: Response) => {
  const { contentId } = req.params as { contentId: string };

  await prisma.creatorContent.delete({ where: { id: contentId } });

  res.json({ success: true, message: 'Content deleted' });
});

// ===========================================
// DEALS
// ===========================================

export const getDealDetail = asyncHandler(async (req: Request, res: Response) => {
  const { dealId } = req.params as { dealId: string };

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      application: true,
      creator: { select: { id: true, displayName: true } },
      company: { select: { id: true, companyName: true } },
      milestones: true
    }
  });

  if (!deal) {
    throw new AppError('Deal not found', 404);
  }

  res.json({ success: true, data: deal });
});

export const updateDealStatus = asyncHandler(async (req: Request, res: Response) => {
  const { dealId } = req.params as { dealId: string };
  const { status } = req.body as { status?: DealStatus };

  if (!status || !Object.values(DealStatus).includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { status };
  if (status === DealStatus.COMPLETED) data.completedAt = new Date();

  const deal = await prisma.deal.update({
    where: { id: dealId },
    data
  });

  res.json({ success: true, data: deal });
});

// ===========================================
// SYSTEM CONFIG (SAFE VIEW)
// ===========================================

export const getSystemConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      nodeEnv: config.nodeEnv,
      frontendUrl: config.frontendUrl,
      upload: {
        maxSize: config.upload.maxSize
      },
      rateLimit: config.rateLimit,
      subscription: config.subscription,
      brandDeal: config.brandDeal,
      emailEnabled: process.env.EMAIL_ENABLED !== 'false'
    }
  });
});

// ===========================================
// EMAIL TEMPLATE PREVIEW
// ===========================================

export const getEmailPreview = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.query as { type?: string };

  if (!type) {
    throw new AppError('Email type is required', 400);
  }

  const name = String(req.query.name || 'User');
  const role = String(req.query.role || 'USER');
  const verifyUrl = String(req.query.verifyUrl || `${config.frontendUrl}/verify-email?token=demo`);
  const resetUrl = String(req.query.resetUrl || `${config.frontendUrl}/reset-password?token=demo`);
  const amount = Number(req.query.amount || 799);
  const transactionId = String(req.query.transactionId || 'TXN_DEMO');
  const plan = String(req.query.plan || 'PREMIUM');
  const verified = String(req.query.verified || 'true') === 'true';

  let template: { subject: string; html: string; text?: string };

  switch (type) {
    case 'welcome':
      template = welcomeEmail(name, role);
      break;
    case 'verification':
      template = emailVerificationEmail(name, verifyUrl);
      break;
    case 'password-reset':
      template = passwordResetEmail(name, resetUrl);
      break;
    case 'password-changed':
      template = passwordChangedEmail(name);
      break;
    case 'payment-receipt':
      template = paymentReceiptEmail(name, amount, transactionId, plan);
      break;
    case 'creator-verification':
      template = creatorVerificationEmail(name, verified);
      break;
    default:
      throw new AppError('Unknown email type', 400);
  }

  res.json({
    success: true,
    data: {
      type,
      subject: template.subject,
      html: template.html,
      text: template.text || ''
    }
  });
});
