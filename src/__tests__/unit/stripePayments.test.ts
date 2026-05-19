// ===========================================
// STRIPE PAYMENTS UNIT TESTS
// ===========================================

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockTransfersCreate = jest.fn();
const mockBalanceRetrieve = jest.fn();
const mockAccountsCreate = jest.fn();
const mockAccountLinksCreate = jest.fn();
const mockWebhooksConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
    },
    transfers: {
      create: mockTransfersCreate,
    },
    balance: {
      retrieve: mockBalanceRetrieve,
    },
    accounts: {
      create: mockAccountsCreate,
    },
    accountLinks: {
      create: mockAccountLinksCreate,
    },
    webhooks: {
      constructEvent: mockWebhooksConstructEvent,
    },
  }));
});

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    payout: {
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

import prisma from '../../../prisma/client';
import {
  isStripeConfigured,
  createStripePaymentIntent,
  confirmStripePayment,
  createStripePayout,
  getStripeAccountBalance,
  createStripeConnectedAccount,
  createStripeAccountLink,
  processStripePayout,
  handleStripeWebhook,
} from '../../utils/stripePayments';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Stripe Payments Utils - Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isStripeConfigured', () => {
    it('should return true when both keys are set', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_key';
      const result = isStripeConfigured();
      expect(result).toBe(true);
    });

    it('should return false when secret key is missing', () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_key';
      const result = isStripeConfigured();
      expect(result).toBe(false);
    });

    it('should return false when publishable key is missing', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';
      process.env.STRIPE_PUBLISHABLE_KEY = '';
      const result = isStripeConfigured();
      expect(result).toBe(false);
    });

    it('should return false when both keys are missing', () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';
      const result = isStripeConfigured();
      expect(result).toBe(false);
    });
  });

  describe('createStripePaymentIntent', () => {
    it('should create a payment intent with correct amount in cents', async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: 'pi_test_123',
        amount: 2999,
        currency: 'usd',
        status: 'requires_payment_method',
        client_secret: 'pi_test_123_secret',
      });

      const result = await createStripePaymentIntent(29.99);

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 2999,
          currency: 'usd',
        })
      );
      expect(result).toEqual({
        id: 'pi_test_123',
        amount: 29.99,
        currency: 'usd',
        status: 'requires_payment_method',
        clientSecret: 'pi_test_123_secret',
      });
    });

    it('should support custom currency', async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: 'pi_test_456',
        amount: 10000,
        currency: 'inr',
        status: 'requires_payment_method',
        client_secret: 'pi_test_456_secret',
      });

      await createStripePaymentIntent(100, 'INR');

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'inr',
        })
      );
    });

    it('should pass metadata to Stripe', async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: 'pi_test_789',
        amount: 5000,
        currency: 'usd',
        status: 'requires_payment_method',
        client_secret: 'secret',
      });

      await createStripePaymentIntent(50, 'usd', { userId: 'user-1' });

      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { userId: 'user-1' },
        })
      );
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(createStripePaymentIntent(100)).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on Stripe API error', async () => {
      mockPaymentIntentsCreate.mockRejectedValue(new Error('Card declined'));

      await expect(createStripePaymentIntent(100)).rejects.toThrow('Payment intent creation failed');
    });
  });

  describe('confirmStripePayment', () => {
    it('should retrieve and return payment intent details', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: 'pi_test_123',
        amount: 5000,
        currency: 'usd',
        status: 'succeeded',
        client_secret: 'secret_123',
      });

      const result = await confirmStripePayment('pi_test_123');

      expect(result).toEqual({
        id: 'pi_test_123',
        amount: 50,
        currency: 'usd',
        status: 'succeeded',
        clientSecret: 'secret_123',
      });
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(confirmStripePayment('pi_test')).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on retrieval error', async () => {
      mockPaymentIntentsRetrieve.mockRejectedValue(new Error('Not found'));

      await expect(confirmStripePayment('pi_invalid')).rejects.toThrow('Payment confirmation failed');
    });
  });

  describe('createStripePayout', () => {
    it('should create a transfer to connected account', async () => {
      mockTransfersCreate.mockResolvedValue({
        id: 'tr_test_123',
        amount: 10000,
        currency: 'usd',
        status: 'paid',
      });

      const result = await createStripePayout(100, 'acct_test_123');

      expect(mockTransfersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          destination: 'acct_test_123',
        })
      );
      expect(result).toEqual({
        id: 'tr_test_123',
        amount: 100,
        currency: 'usd',
        status: 'paid',
        method: 'stripe_transfer',
      });
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(createStripePayout(100, 'acct_test')).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on transfer error', async () => {
      mockTransfersCreate.mockRejectedValue(new Error('Insufficient funds'));

      await expect(createStripePayout(100, 'acct_test')).rejects.toThrow('Payout creation failed');
    });
  });

  describe('getStripeAccountBalance', () => {
    it('should return USD available balance', async () => {
      mockBalanceRetrieve.mockResolvedValue({
        available: [{ currency: 'usd', amount: 50000 }],
      });

      const result = await getStripeAccountBalance('acct_test_123');

      expect(result).toBe(500);
    });

    it('should return 0 when no USD balance', async () => {
      mockBalanceRetrieve.mockResolvedValue({
        available: [{ currency: 'eur', amount: 50000 }],
      });

      const result = await getStripeAccountBalance('acct_test_123');

      expect(result).toBe(0);
    });

    it('should return 0 on error', async () => {
      mockBalanceRetrieve.mockRejectedValue(new Error('Account not found'));

      const result = await getStripeAccountBalance('acct_invalid');

      expect(result).toBe(0);
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(getStripeAccountBalance('acct_test')).rejects.toThrow('Stripe is not configured');
    });
  });

  describe('createStripeConnectedAccount', () => {
    it('should create an express connected account', async () => {
      mockAccountsCreate.mockResolvedValue({ id: 'acct_new_123' });

      const result = await createStripeConnectedAccount('creator@example.com', 'creator-1');

      expect(result).toBe('acct_new_123');
      expect(mockAccountsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'express',
          email: 'creator@example.com',
          metadata: { creatorId: 'creator-1' },
        })
      );
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(
        createStripeConnectedAccount('test@example.com', 'c-1')
      ).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on account creation error', async () => {
      mockAccountsCreate.mockRejectedValue(new Error('Invalid email'));

      await expect(
        createStripeConnectedAccount('bad-email', 'c-1')
      ).rejects.toThrow('Connected account creation failed');
    });
  });

  describe('createStripeAccountLink', () => {
    it('should create an onboarding account link', async () => {
      mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/onboarding' });

      const result = await createStripeAccountLink('acct_test_123');

      expect(result).toBe('https://connect.stripe.com/onboarding');
      expect(mockAccountLinksCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          account: 'acct_test_123',
          type: 'account_onboarding',
        })
      );
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(createStripeAccountLink('acct_test')).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on link creation error', async () => {
      mockAccountLinksCreate.mockRejectedValue(new Error('Account not found'));

      await expect(createStripeAccountLink('acct_bad')).rejects.toThrow('Account link creation failed');
    });
  });

  describe('processStripePayout', () => {
    it('should process payout successfully', async () => {
      mockTransfersCreate.mockResolvedValue({
        id: 'tr_payout_123',
        amount: 5000,
        currency: 'usd',
        status: 'paid',
      });
      (mockPrisma.payout.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.transaction.create as jest.Mock).mockResolvedValue({});

      const result = await processStripePayout('payout-1', 50, 'acct_test');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tr_payout_123');
      expect(mockPrisma.payout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payout-1' },
          data: expect.objectContaining({
            status: 'COMPLETED',
          }),
        })
      );
    });

    it('should mark payout as failed on error', async () => {
      mockTransfersCreate.mockRejectedValue(new Error('Transfer failed'));
      (mockPrisma.payout.update as jest.Mock).mockResolvedValue({});

      const result = await processStripePayout('payout-1', 50, 'acct_test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transfer failed');
      expect(mockPrisma.payout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
          }),
        })
      );
    });

    it('should return error when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      const result = await processStripePayout('payout-1', 50, 'acct_test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Stripe is not configured');
    });

    it('should create transaction record on success', async () => {
      mockTransfersCreate.mockResolvedValue({
        id: 'tr_123',
        amount: 10000,
        currency: 'usd',
        status: 'paid',
      });
      (mockPrisma.payout.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.transaction.create as jest.Mock).mockResolvedValue({});

      await processStripePayout('payout-2', 100, 'acct_test');

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 100,
            status: 'COMPLETED',
          }),
        })
      );
    });
  });

  describe('handleStripeWebhook', () => {
    it('should handle payment_intent.succeeded event', async () => {
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_test_123', amount: 5000 },
        },
      });

      await expect(
        handleStripeWebhook(Buffer.from('payload'), 'sig_test')
      ).resolves.not.toThrow();
    });

    it('should handle account.updated event', async () => {
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'account.updated',
        data: {
          object: { id: 'acct_test_123' },
        },
      });

      await expect(
        handleStripeWebhook(Buffer.from('payload'), 'sig_test')
      ).resolves.not.toThrow();
    });

    it('should handle unrecognized event types gracefully', async () => {
      mockWebhooksConstructEvent.mockReturnValue({
        type: 'unknown.event',
        data: { object: {} },
      });

      await expect(
        handleStripeWebhook(Buffer.from('payload'), 'sig_test')
      ).resolves.not.toThrow();
    });

    it('should throw when Stripe is not configured', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      process.env.STRIPE_PUBLISHABLE_KEY = '';

      await expect(
        handleStripeWebhook(Buffer.from('payload'), 'sig_test')
      ).rejects.toThrow('Stripe is not configured');
    });

    it('should throw on invalid webhook signature', async () => {
      mockWebhooksConstructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        handleStripeWebhook(Buffer.from('payload'), 'bad_sig')
      ).rejects.toThrow('Webhook handling failed');
    });
  });
});
