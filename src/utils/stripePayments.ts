// ===========================================
// STRIPE PAYMENT INTEGRATION
// ===========================================
// Alternative payment gateway to Razorpay
// Supports cards, bank transfers, and digital wallets

import Stripe from 'stripe';
import { PayoutStatus, PaymentStatus } from '@prisma/client';
import prisma from '../../prisma/client';
import { logInfo, logError } from './logger';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  clientSecret: string;
}

export interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
}

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PUBLISHABLE_KEY;
}

/**
 * Create payment intent for subscription
 */
export async function createStripePaymentIntent(
  amount: number,
  currency: string = 'usd',
  metadata?: Record<string, string>
): Promise<StripePaymentIntent> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: metadata || {},
    });

    return {
      id: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret || '',
    };
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe payment intent error' });
    throw new Error(`Payment intent creation failed: ${(error as Error).message}`);
  }
}

/**
 * Confirm payment intent
 */
export async function confirmStripePayment(paymentIntentId: string): Promise<StripePaymentIntent> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    return {
      id: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret || '',
    };
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe payment confirmation error' });
    throw new Error(`Payment confirmation failed: ${(error as Error).message}`);
  }
}

/**
 * Create payout (transfer money to creator)
 */
export async function createStripePayout(
  amount: number,
  destinationAccountId: string,
  currency: string = 'usd'
): Promise<StripePayout> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    // Create a transfer to the connected account
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      destination: destinationAccountId,
      description: 'Creator payout',
    });

    return {
      id: transfer.id,
      amount: transfer.amount / 100,
      currency: transfer.currency,
      status: (transfer as unknown as { status: string }).status,
      method: 'stripe_transfer',
    };
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe payout error' });
    throw new Error(`Payout creation failed: ${(error as Error).message}`);
  }
}

/**
 * Get connected account balance
 */
export async function getStripeAccountBalance(accountId: string): Promise<number> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId,
    });
    
    // Return available balance in USD
    const usdBalance = balance.available.find(b => b.currency === 'usd');
    return usdBalance ? usdBalance.amount / 100 : 0;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe balance error' });
    return 0;
  }
}

/**
 * Create connected account for creator
 */
export async function createStripeConnectedAccount(
  email: string,
  creatorId: string
): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        creatorId: creatorId,
      },
    });

    return account.id;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe connected account error' });
    throw new Error(`Connected account creation failed: ${(error as Error).message}`);
  }
}

/**
 * Generate account link for onboarding
 */
export async function createStripeAccountLink(accountId: string): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/creator/payouts/onboarding?refresh=true`,
      return_url: `${process.env.FRONTEND_URL}/creator/payouts/onboarding?success=true`,
      type: 'account_onboarding',
    });

    return accountLink.url;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe account link error' });
    throw new Error(`Account link creation failed: ${(error as Error).message}`);
  }
}

/**
 * Process payout through Stripe
 */
export async function processStripePayout(
  payoutId: string,
  amount: number,
  destinationAccountId: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  if (!isStripeConfigured()) {
    return {
      success: false,
      error: 'Stripe is not configured'
    };
  }

  try {
    // Create the payout
    const payout = await createStripePayout(amount, destinationAccountId);
    
    // Update payout record
    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.COMPLETED,
        razorpayPayoutId: payout.id,
        completedAt: new Date(),
      },
    });

    // Record the transaction
    await prisma.transaction.create({
      data: {
        subscriptionId: '', // Will be linked to subscription
        amount: amount,
        status: PaymentStatus.COMPLETED,
        description: 'Stripe payout',
        metadata: {
          payoutId: payoutId,
          stripeTransferId: payout.id,
        },
      },
    });

    return {
      success: true,
      transactionId: payout.id,
    };

  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe payout processing error' });
    
    // Update payout as failed
    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.FAILED,
        errorMessage: (error as Error).message,
      },
    });

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Webhook handler for Stripe events
 */
export async function handleStripeWebhook(
  payload: Buffer,
  signature: string
): Promise<void> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured');
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logInfo('Payment succeeded: ' + paymentIntent.id);
        // Handle successful payment
        break;

      // Note: 'transfer.paid' not supported in current Stripe API version
      // Will be handled with updated webhook signatures

      case 'account.updated':
        const account = event.data.object as Stripe.Account;
        logInfo('Account updated: ' + account.id);
        // Handle account updates
        break;

      default:
        logInfo(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Stripe webhook error' });
    throw new Error(`Webhook handling failed: ${(error as Error).message}`);
  }
}

// Export for use in payment controller
export { stripe };