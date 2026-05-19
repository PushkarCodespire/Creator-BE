// ===========================================
// PAYOUT CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  createPayoutEntry,
  completePayoutEntry,
  refundPayoutEntry,
  getEarningsBreakdown
} from '../utils/earnings';
import {
  createContact,
  createFundAccount,
  createPayout as createRazorpayPayout,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPayoutStatus,
  verifyPayoutWebhook,
  determinePayoutMode,
  calculatePayoutFee,
  mockPayout,
  isRazorpayXConfigured
} from '../utils/razorpayPayouts';
// @ts-ignore
import { PayoutStatus } from '@prisma/client';
import { logError } from '../utils/logger';

// Minimum payout amount (in rupees)
const MIN_PAYOUT_AMOUNT = Number(process.env.MIN_PAYOUT_AMOUNT) || 1000;

// ===========================================
// ADD/UPDATE BANK ACCOUNT
// ===========================================

export const addBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can add bank accounts', 403);
  }

  const {
    accountHolderName,
    accountNumber,
    ifscCode,
    bankName,
    accountType,
    panNumber,
    aadharLast4
  } = req.body;

  // Validate required fields
  if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
    throw new AppError('All bank details are required', 400);
  }

  // Validate IFSC code format
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  if (!ifscRegex.test(ifscCode)) {
    throw new AppError('Invalid IFSC code format', 400);
  }

  // Validate account number (basic check)
  if (accountNumber.length < 9 || accountNumber.length > 18) {
    throw new AppError('Invalid account number', 400);
  }

  // Encrypt sensitive data (in production, use proper encryption library)
  // For now, we'll store as-is but in production use crypto.encrypt
  const encryptedAccountNumber = accountNumber; // TODO: Encrypt in production
  const encryptedPanNumber = panNumber; // TODO: Encrypt in production

  // Check if bank account already exists
  const existingAccount = await prisma.bankAccount.findUnique({
    where: { creatorId }
  });

  let bankAccount;
  let razorpayContactId = existingAccount?.razorpayContactId;
  let razorpayFundAccountId = existingAccount?.razorpayFundAccountId;

  // Create Razorpay contact if not exists
  if (!razorpayContactId && isRazorpayXConfigured()) {
    try {
      const creator = await prisma.creator.findUnique({
        where: { id: creatorId },
        include: { user: true }
      });

      const contact = await createContact({
        name: accountHolderName,
        email: creator!.user.email,
        type: 'vendor',
        reference_id: creatorId
      });

      razorpayContactId = contact.id;
    } catch (error: unknown) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Failed to create Razorpay contact' });
      throw new AppError('Failed to create payout account. Please try again.', 500);
    }
  }

  // Create Razorpay fund account
  if (razorpayContactId && isRazorpayXConfigured()) {
    try {
      const fundAccount = await createFundAccount({
        contact_id: razorpayContactId,
        account_type: 'bank_account',
        bank_account: {
          name: accountHolderName,
          ifsc: ifscCode,
          account_number: accountNumber
        }
      });

      razorpayFundAccountId = fundAccount.id;
    } catch (error: unknown) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Failed to create Razorpay fund account' });
      throw new AppError('Failed to link bank account. Please verify your details.', 500);
    }
  }

  if (existingAccount) {
    // Update existing account
    bankAccount = await prisma.bankAccount.update({
      where: { creatorId },
      data: {
        accountHolderName,
        accountNumber: encryptedAccountNumber,
        ifscCode,
        bankName,
        accountType: accountType || 'SAVINGS',
        panNumber: encryptedPanNumber,
        aadharLast4,
        razorpayContactId,
        razorpayFundAccountId,
        kycStatus: panNumber ? 'SUBMITTED' : 'PENDING'
      }
    });
  } else {
    // Create new account
    bankAccount = await prisma.bankAccount.create({
      data: {
        creatorId,
        accountHolderName,
        accountNumber: encryptedAccountNumber,
        ifscCode,
        bankName,
        accountType: accountType || 'SAVINGS',
        panNumber: encryptedPanNumber,
        aadharLast4,
        razorpayContactId,
        razorpayFundAccountId,
        kycStatus: panNumber ? 'SUBMITTED' : 'PENDING'
      }
    });
  }

  // Return masked account number
  const maskedAccountNumber = accountNumber.slice(-4).padStart(accountNumber.length, '*');

  res.json({
    success: true,
    data: {
      ...bankAccount,
      accountNumber: maskedAccountNumber,
      panNumber: panNumber ? '******' + panNumber.slice(-4) : null
    }
  });
});

// ===========================================
// GET BANK ACCOUNT
// ===========================================

export const getBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can view bank accounts', 403);
  }

  const bankAccount = await prisma.bankAccount.findUnique({
    where: { creatorId }
  });

  if (!bankAccount) {
    return res.json({
      success: true,
      data: null
    });
  }

  // Mask sensitive data
  const maskedAccountNumber = bankAccount.accountNumber.slice(-4).padStart(bankAccount.accountNumber.length, '*');
  const maskedPanNumber = bankAccount.panNumber ? '******' + bankAccount.panNumber.slice(-4) : null;

  res.json({
    success: true,
    data: {
      ...bankAccount,
      accountNumber: maskedAccountNumber,
      panNumber: maskedPanNumber
    }
  });
});

// ===========================================
// REQUEST PAYOUT
// ===========================================

export const requestPayout = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can request payouts', 403);
  }

  const { amount } = req.body;

  // Validate amount
  if (!amount || amount < MIN_PAYOUT_AMOUNT) {
    throw new AppError(`Minimum payout amount is ₹${MIN_PAYOUT_AMOUNT}`, 400);
  }

  // Get creator with bank account
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: {
      bankAccount: true,
      user: true
    }
  });

  if (!creator) {
    throw new AppError('Creator not found', 404);
  }

  // Check bank account
  if (!creator.bankAccount) {
    throw new AppError('Please add your bank account details first', 400);
  }

  // Check KYC status
  if (creator.bankAccount.kycStatus !== 'VERIFIED') {
    throw new AppError('Please complete KYC verification first', 400);
  }

  // Check available balance
  const availableBalance = Number(creator.availableBalance);
  if (availableBalance < amount) {
    throw new AppError(`Insufficient balance. Available: ₹${availableBalance}`, 400);
  }

  // Get earnings breakdown
  const breakdown = await getEarningsBreakdown(creatorId);

  // Calculate fee
  const amountInPaise = amount * 100;
  const fee = calculatePayoutFee(amountInPaise);
  const netAmount = amount - (fee / 100);

  // Create payout record
  const payout = await prisma.payout.create({
    data: {
      creatorId,
      amount,
      fee: fee / 100,
      netAmount,
      currency: 'INR',
      subscriptionEarnings: breakdown.subscriptionEarnings,
      brandDealEarnings: breakdown.brandDealEarnings,
      status: PayoutStatus.PENDING,
      bankAccountId: creator.bankAccount.id
    }
  });

  // Deduct from available balance and add to pending
  await createPayoutEntry({
    creatorId,
    payoutId: payout.id,
    amount
  });

  // Process payout with Razorpay
  try {
    if (!creator.bankAccount.razorpayFundAccountId) {
      throw new Error('Bank account not linked with payment provider');
    }

    const mode = determinePayoutMode(amountInPaise);

    let razorpayPayout;
    if (isRazorpayXConfigured()) {
      razorpayPayout = await createRazorpayPayout({
        fund_account_id: creator.bankAccount.razorpayFundAccountId,
        amount: Math.floor(netAmount * 100), // Convert to paise
        currency: 'INR',
        mode,
        purpose: 'payout',
        reference_id: payout.id,
        narration: `Payout for creator ${creator.displayName}`
      });
    } else {
      // Mock mode for development
      razorpayPayout = await mockPayout({
        fund_account_id: creator.bankAccount.razorpayFundAccountId,
        amount: Math.floor(netAmount * 100),
        currency: 'INR',
        mode,
        purpose: 'payout',
        reference_id: payout.id,
        narration: `Payout for creator ${creator.displayName}`
      });
    }

    // Update payout with Razorpay ID
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        razorpayPayoutId: razorpayPayout.id,
        status: PayoutStatus.PROCESSING,
        processedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: payout,
      message: 'Payout request submitted successfully'
    });
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Payout processing failed' });

    // Refund the amount
    await refundPayoutEntry({
      creatorId,
      payoutId: payout.id,
      amount
    });

    // Update payout status
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });

    throw new AppError('Failed to process payout. Please try again later.', 500);
  }
});

// ===========================================
// GET PAYOUT HISTORY
// ===========================================

export const getPayoutHistory = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can view payout history', 403);
  }

  const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip
    }),
    prisma.payout.count({ where: { creatorId } })
  ]);

  res.json({
    success: true,
    data: {
      payouts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

// ===========================================
// GET SINGLE PAYOUT
// ===========================================

export const getPayoutDetails = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;
  const id = req.params.id as string;

  if (!creatorId) {
    throw new AppError('Only creators can view payout details', 403);
  }

  const payout = await prisma.payout.findFirst({
    where: {
      id,
      creatorId
    }
  });

  if (!payout) {
    throw new AppError('Payout not found', 404);
  }

  res.json({
    success: true,
    data: payout
  });
});

// ===========================================
// CANCEL PAYOUT (PENDING ONLY)
// ===========================================

export const cancelPayout = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;
  const id = req.params.id as string;

  if (!creatorId) {
    throw new AppError('Only creators can cancel payouts', 403);
  }

  const payout = await prisma.payout.findFirst({
    where: {
      id,
      creatorId
    }
  });

  if (!payout) {
    throw new AppError('Payout not found', 404);
  }

  if (payout.status !== PayoutStatus.PENDING) {
    throw new AppError('Only pending payouts can be cancelled', 400);
  }

  // Refund the amount
  await refundPayoutEntry({
    creatorId,
    payoutId: payout.id,
    amount: Number(payout.amount)
  });

  // Update payout status
  await prisma.payout.update({
    where: { id },
    data: {
      status: PayoutStatus.CANCELLED
    }
  });

  res.json({
    success: true,
    message: 'Payout cancelled successfully'
  });
});

// ===========================================
// GET EARNINGS
// ===========================================

export const getEarnings = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can view earnings', 403);
  }

  const breakdown = await getEarningsBreakdown(creatorId);

  res.json({
    success: true,
    data: breakdown
  });
});

// ===========================================
// GET EARNINGS LEDGER
// ===========================================

export const getEarningsLedger = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = req.user!.creator?.id;

  if (!creatorId) {
    throw new AppError('Only creators can view earnings ledger', 403);
  }

  const { page = '1', limit = '50' } = req.query as { page?: string; limit?: string };
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [entries, total] = await Promise.all([
    prisma.earningsLedger.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip
    }),
    prisma.earningsLedger.count({ where: { creatorId } })
  ]);

  res.json({
    success: true,
    data: {
      entries,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    }
  });
});

// ===========================================
// HANDLE PAYOUT WEBHOOK (RAZORPAY X)
// ===========================================

export const handlePayoutWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const secret = process.env.RAZORPAY_X_WEBHOOK_SECRET || '';

  // Ensure body is a string for signature verification if it's not already
  const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  // Verify webhook signature
  const isValid = verifyPayoutWebhook(bodyString, signature, secret);

  if (!isValid) {
    throw new AppError('Invalid webhook signature', 401);
  }

  const { event, payload } = req.body;

  // Handle payout status updates
  if (event === 'payout.processed' || event === 'payout.reversed' || event === 'payout.failed') {
    const razorpayPayout = payload.payout.entity;
    const payoutId = razorpayPayout.reference_id;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId }
    });

    if (!payout) {
      logError(new Error(`Payout not found for ID: ${payoutId}`));
      return res.json({ success: true });
    }

    if (event === 'payout.processed') {
      // Payout completed successfully
      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.COMPLETED,
          utr: razorpayPayout.utr,
          completedAt: new Date()
        }
      });

      // Deduct from pending balance
      await completePayoutEntry({
        creatorId: payout.creatorId,
        payoutId: payout.id,
        amount: Number(payout.amount)
      });
    } else if (event === 'payout.reversed' || event === 'payout.failed') {
      // Payout failed or reversed
      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.FAILED,
          errorMessage: razorpayPayout.failure_reason || 'Payout failed'
        }
      });

      // Refund to available balance
      await refundPayoutEntry({
        creatorId: payout.creatorId,
        payoutId: payout.id,
        amount: Number(payout.amount)
      });
    }
  }

  res.json({ success: true });
});
