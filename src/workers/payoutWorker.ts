// ===========================================
// PAYOUT WORKER
// ===========================================
// Background job for processing creator payouts
// Handles payment processing, fund transfers, and payout notifications

import prisma from '../../prisma/client';
import { PayoutStatus, EarningsType } from '@prisma/client';
import { createPayout, mockPayout, isRazorpayXConfigured, determinePayoutMode, calculatePayoutFee } from '../utils/razorpayPayouts';
import { EmailWorker } from './emailWorker';
import { logInfo, logError } from '../utils/logger';

interface PayoutJob {
  payoutId: string;
  type: 'process' | 'retry' | 'cancel';
}

export class PayoutWorker {
  /**
   * Process payout job
   */
  static async processJob(job: PayoutJob): Promise<void> {
    logInfo(`[PayoutWorker] Processing job: ${job.type} for payout ${job.payoutId}`);
    
    try {
      switch (job.type) {
        case 'process':
          await this.processPayout(job.payoutId);
          break;
          
        case 'retry':
          await this.retryPayout(job.payoutId);
          break;
          
        case 'cancel':
          await this.cancelPayout(job.payoutId);
          break;
          
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }
      
      logInfo(`[PayoutWorker] Job completed: ${job.type} for payout ${job.payoutId}`);
      
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[PayoutWorker] Error processing job ${job.type} for payout ${job.payoutId}` });
      throw error;
    }
  }

  /**
   * Process a payout
   */
  private static async processPayout(payoutId: string): Promise<void> {
    // Get payout details
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        creator: {
          include: {
            user: true,
            bankAccount: true
          }
        }
      }
    });

    if (!payout) {
      throw new Error(`Payout not found: ${payoutId}`);
    }

    if (payout.status !== PayoutStatus.PENDING) {
      throw new Error(`Payout is not in pending status: ${payout.status}`);
    }

    if (!payout.creator.bankAccount) {
      throw new Error(`Creator has no bank account: ${payout.creatorId}`);
    }

    if (!payout.creator.bankAccount.isVerified) {
      throw new Error(`Bank account is not verified for creator: ${payout.creatorId}`);
    }

    // Update status to processing
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: PayoutStatus.PROCESSING }
    });

    try {
      // Process payout through Razorpay
      const result = await this.processRazorpayPayout(
        payout.creator.bankAccount,
        payout.netAmount.toNumber(),
        payoutId
      );

      // Update payout with result
      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.COMPLETED,
          razorpayPayoutId: result.payoutId,
          utr: result.utr,
          processedAt: new Date(),
          completedAt: new Date()
        }
      });

      // Update creator's available balance
      await prisma.creator.update({
        where: { id: payout.creatorId },
        data: {
          availableBalance: {
            decrement: payout.amount
          }
        }
      });

      // Record earnings debit
      await prisma.earningsLedger.create({
        data: {
          creatorId: payout.creatorId,
          type: EarningsType.DEBIT,
          amount: payout.amount,
          description: `Payout processed - UTR: ${result.utr}`,
          sourceType: 'payout',
          sourceId: payoutId,
          balanceBefore: payout.creator.availableBalance,
          balanceAfter: payout.creator.availableBalance.minus(payout.amount)
        }
      });

      // Send notification email
      await EmailWorker.sendNotificationEmail(
        payout.creator.userId,
        'PAYOUT_COMPLETED',
        {
          amount: payout.netAmount.toString(),
          utr: result.utr
        }
      );

      logInfo(`[PayoutWorker] Payout processed successfully: ${payoutId}`);

    } catch (error) {
      // Update status to failed
      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date()
        }
      });

      logError(error instanceof Error ? error : new Error(String(error)), { context: `[PayoutWorker] Payout failed: ${payoutId}` });
      throw error;
    }
  }

  /**
   * Retry a failed payout
   */
  private static async retryPayout(payoutId: string): Promise<void> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId }
    });

    if (!payout) {
      throw new Error(`Payout not found: ${payoutId}`);
    }

    if (payout.status !== PayoutStatus.FAILED) {
      throw new Error(`Payout is not in failed status: ${payout.status}`);
    }

    // Reset status and retry
    await prisma.payout.update({
      where: { id: payoutId },
      data: { 
        status: PayoutStatus.PENDING,
        errorMessage: null
      }
    });

    await this.processPayout(payoutId);
  }

  /**
   * Cancel a payout
   */
  private static async cancelPayout(payoutId: string): Promise<void> {
    const payout = await prisma.payout.findUnique({
      where: { id: payoutId }
    });

    if (!payout) {
      throw new Error(`Payout not found: ${payoutId}`);
    }

    if (payout.status !== PayoutStatus.PENDING && payout.status !== PayoutStatus.FAILED) {
      throw new Error(`Cannot cancel payout in status: ${payout.status}`);
    }

    // Update status to cancelled
    await prisma.payout.update({
      where: { id: payoutId },
      data: { 
        status: PayoutStatus.CANCELLED,
        processedAt: new Date()
      }
    });

    // Return funds to creator's available balance
    await prisma.creator.update({
      where: { id: payout.creatorId },
      data: {
        availableBalance: {
          increment: payout.amount
        }
      }
    });

    logInfo(`[PayoutWorker] Payout cancelled: ${payoutId}`);
  }

  /**
   * Process all pending payouts
   */
  static async processPendingPayouts(): Promise<void> {
    const pendingPayouts = await prisma.payout.findMany({
      where: { 
        status: PayoutStatus.PENDING,
        requestedAt: {
          lte: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours old
        }
      },
      take: 5 // Process 5 at a time
    });

    logInfo(`[PayoutWorker] Found ${pendingPayouts.length} pending payouts`);
    
    for (const payout of pendingPayouts) {
      try {
        await this.processJob({
          payoutId: payout.id,
          type: 'process'
        });
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[PayoutWorker] Failed to process payout ${payout.id}` });
        // Continue processing other payouts
      }
    }
  }

  /**
   * Retry failed payouts
   */
  static async retryFailedPayouts(): Promise<void> {
    const failedPayouts = await prisma.payout.findMany({
      where: { 
        status: PayoutStatus.FAILED,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      take: 3
    });

    logInfo(`[PayoutWorker] Retrying ${failedPayouts.length} failed payouts`);
    
    for (const payout of failedPayouts) {
      try {
        await this.processJob({
          payoutId: payout.id,
          type: 'retry'
        });
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[PayoutWorker] Retry failed for payout ${payout.id}` });
      }
    }
  }

  /**
   * Generate payout reports
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static async generatePayoutReport(period: 'daily' | 'weekly' | 'monthly'): Promise<any> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'daily':
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'monthly':
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    const stats = await prisma.payout.aggregate({
      _count: true,
      _sum: {
        amount: true,
        fee: true,
        netAmount: true
      },
      where: {
        createdAt: { gte: startDate },
        status: PayoutStatus.COMPLETED
      }
    });

    const report = {
      period,
      startDate,
      endDate: now,
      totalPayouts: stats._count,
      totalAmount: stats._sum.amount || 0,
      totalFees: stats._sum.fee || 0,
      totalNetAmount: stats._sum.netAmount || 0
    };

    // Save report
    await prisma.analyticsEvent.create({
      data: {
        eventType: 'payout_report',
        eventName: `${period}_summary`,
        properties: report
      }
    });

    return report;
  }

  /**
   * Schedule regular payout jobs
   */
  static async scheduleJobs(): Promise<void> {
    // Process pending payouts every 30 minutes
    setInterval(async () => {
      await this.processPendingPayouts();
    }, 30 * 60 * 1000);

    // Retry failed payouts every 2 hours
    setInterval(async () => {
      await this.retryFailedPayouts();
    }, 2 * 60 * 60 * 1000);

    // Generate daily reports at midnight
    setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        await this.generatePayoutReport('daily');
      }
    }, 60000);
  }

  /**
   * Process payout through Razorpay
   */
  private static async processRazorpayPayout(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bankAccount: any,
    amount: number,
    payoutId: string
  ): Promise<{ payoutId: string; utr?: string }> {
    const isConfigured = isRazorpayXConfigured();
    
    if (!isConfigured) {
      // Mock mode for development
      logInfo('[PayoutWorker] Razorpay X not configured, using mock payout');
      
      const mockResult = await mockPayout({
        fund_account_id: bankAccount.razorpayFundAccountId,
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR',
        mode: determinePayoutMode(Math.round(amount * 100)),
        purpose: 'payout',
        reference_id: payoutId,
        narration: `Creator payout ${payoutId}`
      });
      
      return {
        payoutId: mockResult.id,
        utr: `MOCK_UTR_${Date.now()}`
      };
    }
    
    // Real Razorpay processing
    const payoutResult = await createPayout({
      fund_account_id: bankAccount.razorpayFundAccountId,
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      mode: determinePayoutMode(Math.round(amount * 100)),
      purpose: 'payout',
      reference_id: payoutId,
      narration: `Creator payout ${payoutId}`
    });
    
    return {
      payoutId: payoutResult.id,
      utr: payoutResult.utr // This might be in the response, depends on Razorpay API
    };
  }
}