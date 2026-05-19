// ===========================================
// RAZORPAY PAYOUTS UTILITY (RAZORPAY X)
// ===========================================

import Razorpay from 'razorpay';
import crypto from 'crypto';
import { logError, logInfo } from './logger';

// Initialize Razorpay X instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const razorpayX: any = process.env.RAZORPAY_X_KEY_ID ? new Razorpay({
  key_id: process.env.RAZORPAY_X_KEY_ID || '',
  key_secret: process.env.RAZORPAY_X_KEY_SECRET || ''
}) : null;

// ===========================================
// CREATE RAZORPAY CONTACT
// ===========================================

interface CreateContactParams {
  name: string;
  email: string;
  contact?: string;
  type: 'vendor' | 'customer';
  reference_id: string;
}

export const createContact = async (params: CreateContactParams) => {
  if (!razorpayX) {
    throw new Error('Razorpay X not configured. Please set RAZORPAY_X_KEY_ID and RAZORPAY_X_KEY_SECRET in environment variables.');
  }

  try {
    const contact = await razorpayX.contacts.create(params);
    return contact;
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Razorpay contact creation failed' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error((error as any).error?.description || 'Failed to create Razorpay contact');
  }
};

// ===========================================
// CREATE FUND ACCOUNT (BANK ACCOUNT)
// ===========================================

interface CreateFundAccountParams {
  contact_id: string;
  account_type: 'bank_account';
  bank_account: {
    name: string;
    ifsc: string;
    account_number: string;
  };
}

export const createFundAccount = async (params: CreateFundAccountParams) => {
  if (!razorpayX) {
    throw new Error('Razorpay X not configured.');
  }

  try {
    const fundAccount = await razorpayX.fundAccount.create(params);
    return fundAccount;
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Razorpay fund account creation failed' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error((error as any).error?.description || 'Failed to create fund account');
  }
};

// ===========================================
// CREATE PAYOUT
// ===========================================

interface CreatePayoutParams {
  fund_account_id: string;
  amount: number; // In paise (₹100 = 10000 paise)
  currency: string;
  mode: 'IMPS' | 'NEFT' | 'RTGS' | 'UPI';
  purpose: string;
  reference_id: string;
  narration: string;
}

export const createPayout = async (params: CreatePayoutParams) => {
  if (!razorpayX) {
    throw new Error('Razorpay X not configured.');
  }

  try {
    const payout = await razorpayX.payouts.create(params);
    return payout;
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Razorpay payout creation failed' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error((error as any).error?.description || 'Failed to create payout');
  }
};

// ===========================================
// GET PAYOUT STATUS
// ===========================================

export const getPayoutStatus = async (payoutId: string) => {
  if (!razorpayX) {
    throw new Error('Razorpay X not configured.');
  }

  try {
    const payout = await razorpayX.payouts.fetch(payoutId);
    return payout;
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Failed to fetch payout status' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error((error as any).error?.description || 'Failed to fetch payout status');
  }
};

// ===========================================
// VERIFY PAYOUT WEBHOOK SIGNATURE
// ===========================================

export const verifyPayoutWebhook = (
  payload: string,
  signature: string,
  secret: string
): boolean => {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return expectedSignature === signature;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Webhook verification failed' });
    return false;
  }
};

// ===========================================
// DETERMINE PAYOUT MODE
// ===========================================

export const determinePayoutMode = (amount: number): 'IMPS' | 'NEFT' | 'RTGS' => {
  // IMPS: Up to ₹2 lakhs (fast, 24x7)
  // NEFT: Any amount (working hours)
  // RTGS: Minimum ₹2 lakhs (fast, working hours)

  const amountInRupees = amount / 100;

  if (amountInRupees >= 200000) {
    return 'RTGS';
  } else {
    return 'IMPS'; // Default for amounts under ₹2 lakhs
  }
};

// ===========================================
// CALCULATE PAYOUT FEE
// ===========================================

export const calculatePayoutFee = (amount: number): number => {
  // Razorpay Payouts Fee Structure (approximate):
  // IMPS/NEFT: ₹2-3 per transaction
  // RTGS: ₹15-25 per transaction

  const amountInRupees = amount / 100;

  if (amountInRupees >= 200000) {
    return 2000; // ₹20 for RTGS (in paise)
  } else {
    return 300; // ₹3 for IMPS/NEFT (in paise)
  }
};

// ===========================================
// MOCK PAYOUT (FOR DEVELOPMENT)
// ===========================================

export const mockPayout = async (params: CreatePayoutParams) => {
  logInfo('MOCK MODE: Payout would be created');

  return {
    id: `pout_mock_${Date.now()}`,
    entity: 'payout',
    fund_account_id: params.fund_account_id,
    amount: params.amount,
    currency: params.currency,
    status: 'processing',
    mode: params.mode,
    purpose: params.purpose,
    reference_id: params.reference_id,
    narration: params.narration,
    created_at: Math.floor(Date.now() / 1000)
  };
};

// ===========================================
// EXPORT HELPER TO DETERMINE IF MOCK MODE
// ===========================================

export const isRazorpayXConfigured = (): boolean => {
  return !!(process.env.RAZORPAY_X_KEY_ID && process.env.RAZORPAY_X_KEY_SECRET);
};
