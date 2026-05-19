// ===========================================
// EARNINGS MANAGEMENT UTILITY
// ===========================================

import prisma from '../../prisma/client';
import { EarningsType } from '@prisma/client';

// ===========================================
// DISTRIBUTE EARNINGS TO CREATOR
// ===========================================

interface DistributeEarningsParams {
  creatorId: string;
  amount: number;
  sourceType: 'subscription' | 'brand_deal' | 'adjustment';
  sourceId?: string;
  description: string;
}

export const distributeEarnings = async ({
  creatorId,
  amount,
  sourceType,
  sourceId,
  description
}: DistributeEarningsParams) => {
  // Get current creator balance
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      availableBalance: true,
      lifetimeEarnings: true
    }
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const balanceBefore = Number(creator.availableBalance);
  const balanceAfter = balanceBefore + amount;

  // Update creator balances
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      availableBalance: balanceAfter,
      lifetimeEarnings: {
        increment: amount
      },
      totalEarnings: {
        increment: amount
      }
    }
  });

  // Create ledger entry
  await prisma.earningsLedger.create({
    data: {
      creatorId,
      type: EarningsType.CREDIT,
      amount,
      description,
      sourceType,
      sourceId,
      balanceBefore,
      balanceAfter
    }
  });

  return { balanceBefore, balanceAfter };
};

// ===========================================
// CREATE PAYOUT ENTRY (DEDUCT FROM AVAILABLE)
// ===========================================

interface CreatePayoutEntryParams {
  creatorId: string;
  payoutId: string;
  amount: number;
}

export const createPayoutEntry = async ({
  creatorId,
  payoutId,
  amount
}: CreatePayoutEntryParams) => {
  // Get current creator balance
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      availableBalance: true,
      pendingBalance: true
    }
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const availableBalance = Number(creator.availableBalance);
  const pendingBalance = Number(creator.pendingBalance);

  if (availableBalance < amount) {
    throw new Error('Insufficient available balance');
  }

  const newAvailableBalance = availableBalance - amount;
  const newPendingBalance = pendingBalance + amount;

  // Update creator balances
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      availableBalance: newAvailableBalance,
      pendingBalance: newPendingBalance
    }
  });

  // Create ledger entry (deduct from available)
  await prisma.earningsLedger.create({
    data: {
      creatorId,
      type: EarningsType.DEBIT,
      amount,
      description: 'Payout requested',
      sourceType: 'payout',
      sourceId: payoutId,
      balanceBefore: availableBalance,
      balanceAfter: newAvailableBalance
    }
  });

  return { availableBalance: newAvailableBalance, pendingBalance: newPendingBalance };
};

// ===========================================
// COMPLETE PAYOUT ENTRY (DEDUCT FROM PENDING)
// ===========================================

export const completePayoutEntry = async ({
  creatorId,
  payoutId,
  amount
}: CreatePayoutEntryParams) => {
  // Get current creator balance
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      pendingBalance: true
    }
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const pendingBalance = Number(creator.pendingBalance);
  const newPendingBalance = pendingBalance - amount;

  // Update creator balances
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      pendingBalance: newPendingBalance
    }
  });

  // Create ledger entry (deduct from pending)
  await prisma.earningsLedger.create({
    data: {
      creatorId,
      type: EarningsType.DEBIT,
      amount,
      description: 'Payout completed',
      sourceType: 'payout',
      sourceId: payoutId,
      balanceBefore: pendingBalance,
      balanceAfter: newPendingBalance
    }
  });

  return { pendingBalance: newPendingBalance };
};

// ===========================================
// REFUND PAYOUT ENTRY (FAILED/CANCELLED)
// ===========================================

export const refundPayoutEntry = async ({
  creatorId,
  payoutId,
  amount
}: CreatePayoutEntryParams) => {
  // Get current creator balance
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      availableBalance: true,
      pendingBalance: true
    }
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  const availableBalance = Number(creator.availableBalance);
  const pendingBalance = Number(creator.pendingBalance);

  const newAvailableBalance = availableBalance + amount;
  const newPendingBalance = pendingBalance - amount;

  // Update creator balances
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      availableBalance: newAvailableBalance,
      pendingBalance: newPendingBalance
    }
  });

  // Create ledger entry (refund to available)
  await prisma.earningsLedger.create({
    data: {
      creatorId,
      type: EarningsType.REFUND,
      amount,
      description: 'Payout refunded (failed/cancelled)',
      sourceType: 'payout',
      sourceId: payoutId,
      balanceBefore: availableBalance,
      balanceAfter: newAvailableBalance
    }
  });

  return { availableBalance: newAvailableBalance, pendingBalance: newPendingBalance };
};

// ===========================================
// GET EARNINGS BREAKDOWN
// ===========================================

export const getEarningsBreakdown = async (creatorId: string) => {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      availableBalance: true,
      pendingBalance: true,
      lifetimeEarnings: true
    }
  });

  if (!creator) {
    throw new Error('Creator not found');
  }

  // Get earnings by source type
  const ledgerSummary = await prisma.earningsLedger.groupBy({
    by: ['sourceType'],
    where: {
      creatorId,
      type: EarningsType.CREDIT
    },
    _sum: {
      amount: true
    }
  });

  const earningsBySource: Record<string, number> = {};
  ledgerSummary.forEach((item) => {
    earningsBySource[item.sourceType] = Number(item._sum.amount || 0);
  });

  return {
    availableBalance: Number(creator.availableBalance),
    pendingBalance: Number(creator.pendingBalance),
    lifetimeEarnings: Number(creator.lifetimeEarnings),
    subscriptionEarnings: earningsBySource.subscription || 0,
    brandDealEarnings: earningsBySource.brand_deal || 0
  };
};
