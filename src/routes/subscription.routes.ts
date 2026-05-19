// ===========================================
// SUBSCRIPTION ROUTES
// ===========================================

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { config } from '../config';

const router = Router();

/**
 * Ensure a subscription record exists for the user.
 * Returns existing or creates a default FREE one.
 */
async function ensureSubscription(userId: string) {
  return prisma.subscription.upsert({
    where: { userId },
    update: {},
    create: { userId, plan: 'FREE', status: 'ACTIVE' }
  });
}

// ===========================================
// GET CURRENT SUBSCRIPTION
// ===========================================

router.get('/current', authenticate, asyncHandler(async (req: Request, res: Response) => {
  await ensureSubscription(req.user!.id);
  const subscription = (await prisma.subscription.findUnique({
    where: { userId: req.user!.id },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    }
  }))!;

  res.json({
    success: true,
    data: {
      ...subscription,
      limits: {
        messagesPerDay: subscription.plan === 'PREMIUM'
          ? 'Unlimited'
          : config.rateLimit.freeMessagesPerDay,
        messagesUsedToday: subscription.messagesUsedToday
      }
    }
  });
}));

// ===========================================
// GET PRICING PLANS
// ===========================================

router.get('/plans', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        currency: 'INR',
        features: [
          `${config.rateLimit.freeMessagesPerDay} messages per day`,
          'Access to all creators',
          'Basic chat history'
        ]
      },
      {
        id: 'premium',
        name: 'Premium',
        price: config.subscription.premiumPrice / 100,
        currency: 'INR',
        features: [
          'Unlimited messages',
          'Access to all creators',
          'Full chat history',
          'Priority support',
          'Early access to new features'
        ]
      }
    ]
  });
}));

// ===========================================
// FEATURE ACCESS (per user subscription)
// ===========================================

router.get('/features', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const subscription = await ensureSubscription(req.user!.id);

  const isPremium = subscription.plan === 'PREMIUM';
  const dailyMessages = isPremium ? null : config.rateLimit.freeMessagesPerDay;

  const features = {
    chat: {
      allowed: true,
      unlimited: isPremium,
      dailyLimit: dailyMessages,
      history: true,
      bookmarkMessages: true,
      editDeleteOwn: true
    },
    social: {
      followCreators: true,
      likePostsComments: true,
      commentOnPosts: true,
      shareContent: true,
      bookmarkPosts: true
    },
    account: {
      dashboard: true,
      chatHistoryManagement: true,
      subscriptionManagement: true,
      personalAnalytics: true,
      recommendations: true
    },
    content: {
      viewCreatorProfiles: true,
      browseGallery: true,
      searchCreatorsContent: true,
      viewTrending: true,
      participateCommunity: true
    }
  };

  res.json({
    success: true,
    data: {
      plan: subscription.plan,
      features
    }
  });
}));

// ===========================================
// UPGRADE TO PREMIUM (Mock - Razorpay not configured)
// ===========================================

router.post('/upgrade', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Check if Razorpay is configured
  if (!config.razorpay.keyId) {
    // Mock upgrade for testing
    const subscription = await prisma.subscription.upsert({
      where: { userId },
      update: {
        plan: 'PREMIUM',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        tokenBalance: { increment: config.subscription.tokenGrant },
        tokenGrant: config.subscription.tokenGrant,
        tokenGrantedAt: new Date()
      },
      create: {
        userId,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        tokenBalance: config.subscription.tokenGrant,
        tokenGrant: config.subscription.tokenGrant,
        tokenGrantedAt: new Date()
      }
    });

    // Create mock transaction
    await prisma.transaction.create({
      data: {
        subscriptionId: subscription.id,
        amount: config.subscription.premiumPrice / 100,
        status: 'COMPLETED',
        description: 'Premium subscription (Test Mode)'
      }
    });

    return res.json({
      success: true,
      message: 'Upgraded to Premium (Test Mode - Razorpay not configured)',
      data: subscription
    });
  }

  // TODO: Implement actual Razorpay integration
  // For now, return instructions
  res.json({
    success: true,
    message: 'Razorpay integration pending',
    razorpay: {
      keyId: config.razorpay.keyId,
      amount: config.subscription.premiumPrice,
      currency: 'INR'
    }
  });
}));

// ===========================================
// CANCEL SUBSCRIPTION
// ===========================================

router.post('/cancel', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const subscription = await prisma.subscription.upsert({
    where: { userId },
    update: { status: 'CANCELLED', plan: 'FREE' },
    create: { userId, status: 'CANCELLED', plan: 'FREE' }
  });

  res.json({
    success: true,
    message: 'Subscription cancelled',
    data: subscription
  });
}));

// ===========================================
// GET TRANSACTION HISTORY
// ===========================================

router.get('/transactions', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const subscription = await ensureSubscription(req.user!.id);

  const transactions = await prisma.transaction.findMany({
    where: { subscriptionId: subscription.id },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    success: true,
    data: transactions
  });
}));

export default router;
