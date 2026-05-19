// ===========================================
// PAYMENT CONTROLLER - Razorpay Integration
// ===========================================

import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { sendEmail, paymentReceiptEmail } from '../utils/email';
import { logInfo, logError } from '../utils/logger';

// Payment mode flags
const isRazorpayConfigured = !!(config.razorpay.keyId && config.razorpay.keySecret);
const paymentsEnabled =
  isRazorpayConfigured &&
  process.env.DISABLE_PAYMENTS !== 'true' &&
  process.env.DEMO_MODE !== 'true';

// Initialize Razorpay instance (only if configured and enabled)
let razorpay: Razorpay | null = null;
if (paymentsEnabled) {
  razorpay = new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret
  });
}

logInfo(`[payment] Mode: ${paymentsEnabled ? 'LIVE (Razorpay)' : 'BYPASS (no external payment)'}`);


// ===========================================
// CREATE PAYMENT ORDER
// ===========================================

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { plan } = req.body;
  const amountPaise = config.subscription.premiumPrice; // e.g. 79900
  const amountRupees = amountPaise / 100;

  // Validate plan
  if (plan !== 'PREMIUM') {
    throw new AppError('Invalid plan selected', 400);
  }

  // Get or create user's subscription
  await prisma.subscription.upsert({
    where: { userId },
    update: {},
    create: { userId, plan: 'FREE', status: 'ACTIVE' }
  });
  const subscription = (await prisma.subscription.findUnique({
    where: { userId },
    include: { user: true }
  }))!;

  // Check if already premium
  if (subscription.plan === 'PREMIUM' && subscription.status === 'ACTIVE') {
    throw new AppError('Already subscribed to Premium', 400);
  }

  // If payments are disabled (no Razorpay keys, demo mode, or flag), auto-upgrade the user
  if (!paymentsEnabled) {
    const upgradedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: 'PREMIUM',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        tokenBalance: { increment: config.subscription.tokenGrant },
        tokenGrant: config.subscription.tokenGrant,
        tokenGrantedAt: new Date()
      },
      include: {
        user: {
          select: { email: true, name: true }
        }
      }
    });

    const transaction = await prisma.transaction.create({
      data: {
        subscriptionId: upgradedSubscription.id,
        amount: 0,
        currency: 'INR',
        status: 'COMPLETED',
        description: `${plan} subscription (payment bypassed)`,
        metadata: {
          bypassed: true,
          reason: process.env.DEMO_MODE === 'true' ? 'demo_mode' : 'payments_disabled',
          razorpayConfigured: isRazorpayConfigured
        }
      }
    });

    return res.json({
      success: true,
      message: 'Subscription upgraded without payment',
      data: {
        subscription: {
          id: upgradedSubscription.id,
          plan: upgradedSubscription.plan,
          status: upgradedSubscription.status,
          currentPeriodStart: upgradedSubscription.currentPeriodStart,
          currentPeriodEnd: upgradedSubscription.currentPeriodEnd
        },
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          status: transaction.status
        },
        paymentRequired: false,
        demoMode: true
      }
    });
  }

  // LIVE MODE: Create Razorpay order
  const order = await razorpay!.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `order_${userId}_${Date.now()}`,
    notes: {
      userId: userId,
      plan: plan,
      userEmail: subscription.user.email
    }
  });
  logInfo(`[payment] Live Razorpay order created: ${order.id}`);

  // Create pending transaction in database
  const transaction = await prisma.transaction.create({
    data: {
      subscriptionId: subscription.id,
      razorpayOrderId: order.id,
      amount: amountRupees, // Store in rupees
      currency: 'INR',
      status: 'PENDING',
      description: `${plan} subscription payment`
    }
  });

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay.keyId,
      transactionId: transaction.id,
      demoMode: false,
      paymentRequired: true
    }
  });
});

// ===========================================
// VERIFY PAYMENT SIGNATURE
// ===========================================

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!paymentsEnabled) {
    return res.json({
      success: true,
      message: 'Payment verification skipped (payments disabled)'
    });
  }

  // Validate input
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError('Missing payment verification data', 400);
  }

  // LIVE MODE: Verify Razorpay signature
  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(sign.toString())
    .digest('hex');

  if (razorpay_signature !== expectedSign) {
    // Mark transaction as failed
    await prisma.transaction.updateMany({
      where: { razorpayOrderId: razorpay_order_id },
      data: {
        status: 'FAILED',
        metadata: { error: 'Invalid signature' }
      }
    });

    throw new AppError('Invalid payment signature', 400);
  }
  logInfo(`[payment] Payment signature verified: ${razorpay_payment_id}`);

  // Find transaction
  const transaction = await prisma.transaction.findFirst({
    where: { razorpayOrderId: razorpay_order_id },
    include: { subscription: true }
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  // Verify transaction belongs to user
  if (transaction.subscription.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }

  // Update transaction with payment details
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      status: 'COMPLETED'
    }
  });

  // Update subscription to PREMIUM
  const subscription = await prisma.subscription.update({
    where: { id: transaction.subscriptionId },
    data: {
      plan: 'PREMIUM',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      tokenBalance: { increment: config.subscription.tokenGrant },
      tokenGrant: config.subscription.tokenGrant,
      tokenGrantedAt: new Date()
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true
        }
      }
    }
  });

  // Send payment receipt email (non-blocking)
  const receiptTemplate = paymentReceiptEmail(
    subscription.user.name,
    Number(transaction.amount),
    razorpay_payment_id,
    'PREMIUM'
  );
  sendEmail({
    to: subscription.user.email,
    subject: receiptTemplate.subject,
    html: receiptTemplate.html,
    text: receiptTemplate.text
  }).catch((err) => {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Payment receipt email failed' });
  });

  res.json({
    success: true,
    message: 'Payment verified and subscription activated',
    data: {
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd
      },
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        status: 'COMPLETED'
      }
    }
  });
});

// ===========================================
// RAZORPAY WEBHOOK HANDLER
// ===========================================

export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'] as string;

  if (!webhookSecret) {
    logError(new Error('Razorpay webhook secret not configured'));
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    logError(new Error('Invalid webhook signature'));
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body.event;
  const payload = req.body.payload.payment.entity;

  logInfo(`Razorpay webhook event: ${event}`);

  try {
    if (event === 'payment.captured') {
      // Payment successful
      await prisma.transaction.updateMany({
        where: { razorpayPaymentId: payload.id },
        data: {
          status: 'COMPLETED',
          metadata: payload
        }
      });

      logInfo(`Payment captured: ${payload.id}`);
    } else if (event === 'payment.failed') {
      // Payment failed
      await prisma.transaction.updateMany({
        where: { razorpayPaymentId: payload.id },
        data: {
          status: 'FAILED',
          metadata: payload
        }
      });

      logInfo(`Payment failed: ${payload.id}`);
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Webhook processing error' });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ status: 'ok' });
});

// ===========================================
// GET PAYMENT STATUS
// ===========================================

export const getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId } = req.params as { orderId: string };

  const transaction = await prisma.transaction.findFirst({
    where: {
      razorpayOrderId: orderId,
      subscription: {
        userId: userId
      }
    },
    include: {
      subscription: {
        select: {
          plan: true,
          status: true
        }
      }
    }
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  res.json({
    success: true,
    data: {
      orderId: transaction.razorpayOrderId,
      paymentId: transaction.razorpayPaymentId,
      status: transaction.status,
      amount: transaction.amount,
      subscription: transaction.subscription
    }
  });
});
