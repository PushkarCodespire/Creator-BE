// ===========================================
// RAZORPAY PAYOUTS UTILITY UNIT TESTS
// ===========================================

// Mock Razorpay before importing the module so the module-level
// razorpayX initialisation picks up the mock.
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    contacts: { create: jest.fn() },
    fundAccount: { create: jest.fn() },
    payouts: { create: jest.fn(), fetch: jest.fn() }
  }));
});

jest.mock('../../utils/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn()
}));

import crypto from 'crypto';

// Helper type-declarations (actual functions loaded via require inside tests)
let createContact: any;
let createFundAccount: any;
let createPayout: any;
let getPayoutStatus: any;
let verifyPayoutWebhook: any;
let determinePayoutMode: any;
let calculatePayoutFee: any;
let mockPayout: any;

describe('razorpayPayouts utility', () => {
  // ============================================================
  // SECTION A: isRazorpayXConfigured + pure helpers
  // (no Razorpay instance needed – we test env-var-independent logic)
  // ============================================================

  describe('isRazorpayXConfigured', () => {
    afterEach(() => {
      delete process.env.RAZORPAY_X_KEY_ID;
      delete process.env.RAZORPAY_X_KEY_SECRET;
      jest.resetModules();
    });

    it('should return false when env vars are absent', () => {
      delete process.env.RAZORPAY_X_KEY_ID;
      delete process.env.RAZORPAY_X_KEY_SECRET;
      jest.resetModules();
      // require a fresh copy so the module-level flag is re-evaluated
      const mod = require('../../utils/razorpayPayouts');
      expect(mod.isRazorpayXConfigured()).toBe(false);
    });

    it('should return true when both env vars are set', () => {
      process.env.RAZORPAY_X_KEY_ID = 'key_test';
      process.env.RAZORPAY_X_KEY_SECRET = 'secret_test';
      jest.resetModules();
      const mod = require('../../utils/razorpayPayouts');
      expect(mod.isRazorpayXConfigured()).toBe(true);
    });
  });

  describe('determinePayoutMode', () => {
    beforeAll(() => {
      const mod = require('../../utils/razorpayPayouts');
      determinePayoutMode = mod.determinePayoutMode;
    });

    it('should return IMPS for amounts below ₹2 lakhs (in paise)', () => {
      // 1 lakh = 100 rupees = 10000 paise. Amount here is paise.
      expect(determinePayoutMode(10000 * 100)).toBe('IMPS');  // ₹10,000
    });

    it('should return IMPS for amount exactly below 2 lakh rupees', () => {
      expect(determinePayoutMode(19999900)).toBe('IMPS'); // ₹1,99,999
    });

    it('should return RTGS for amounts at exactly ₹2 lakhs', () => {
      expect(determinePayoutMode(20000000)).toBe('RTGS'); // ₹2,00,000 in paise
    });

    it('should return RTGS for amounts above ₹2 lakhs', () => {
      expect(determinePayoutMode(50000000)).toBe('RTGS'); // ₹5,00,000
    });
  });

  describe('calculatePayoutFee', () => {
    beforeAll(() => {
      const mod = require('../../utils/razorpayPayouts');
      calculatePayoutFee = mod.calculatePayoutFee;
    });

    it('should return 300 paise (₹3) for amounts below ₹2 lakhs', () => {
      expect(calculatePayoutFee(100000)).toBe(300); // ₹1000 in paise
    });

    it('should return 2000 paise (₹20) for amounts at or above ₹2 lakhs', () => {
      expect(calculatePayoutFee(20000000)).toBe(2000);
    });

    it('should return 2000 paise for amounts well above ₹2 lakhs', () => {
      expect(calculatePayoutFee(50000000)).toBe(2000);
    });

    it('should return 300 for a zero-amount (edge case)', () => {
      expect(calculatePayoutFee(0)).toBe(300);
    });
  });

  describe('verifyPayoutWebhook', () => {
    beforeAll(() => {
      const mod = require('../../utils/razorpayPayouts');
      verifyPayoutWebhook = mod.verifyPayoutWebhook;
    });

    const secret = 'test-webhook-secret';
    const payload = JSON.stringify({ event: 'payout.processed', data: 'test' });

    it('should return true for a valid signature', () => {
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(verifyPayoutWebhook(payload, sig, secret)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      expect(verifyPayoutWebhook(payload, 'wrong-sig', secret)).toBe(false);
    });

    it('should return false when signature is an empty string', () => {
      expect(verifyPayoutWebhook(payload, '', secret)).toBe(false);
    });

    it('should return false when payload does not match', () => {
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(verifyPayoutWebhook('different-payload', sig, secret)).toBe(false);
    });
  });

  describe('mockPayout', () => {
    beforeAll(() => {
      const mod = require('../../utils/razorpayPayouts');
      mockPayout = mod.mockPayout;
    });

    it('should return a mock payout object with expected shape', async () => {
      const params = {
        fund_account_id: 'fa_test',
        amount: 50000,
        currency: 'INR',
        mode: 'IMPS' as const,
        purpose: 'payout',
        reference_id: 'ref_1',
        narration: 'Test narration'
      };

      const result = await mockPayout(params);

      expect(result).toMatchObject({
        entity: 'payout',
        fund_account_id: 'fa_test',
        amount: 50000,
        currency: 'INR',
        status: 'processing',
        mode: 'IMPS',
        purpose: 'payout',
        reference_id: 'ref_1',
        narration: 'Test narration'
      });
      expect(result.id).toMatch(/^pout_mock_/);
      expect(typeof result.created_at).toBe('number');
    });
  });

  // ============================================================
  // SECTION B: functions that require razorpayX to be initialized
  // We use env vars + jest.resetModules to get a fresh module with
  // an active Razorpay instance. We use require() after resetModules
  // so we get the same Razorpay mock that the freshly-loaded module sees.
  // ============================================================

  describe('with Razorpay X configured', () => {
    let razorpayInstance: any;

    beforeEach(() => {
      process.env.RAZORPAY_X_KEY_ID = 'key_live';
      process.env.RAZORPAY_X_KEY_SECRET = 'secret_live';
      jest.resetModules();

      // Load the module fresh so the module-level razorpayX is initialized
      const mod = require('../../utils/razorpayPayouts');
      createContact = mod.createContact;
      createFundAccount = mod.createFundAccount;
      createPayout = mod.createPayout;
      getPayoutStatus = mod.getPayoutStatus;

      // Get the Razorpay constructor mock that was re-registered after resetModules
      const RazorpayMock = require('razorpay');
      // The module constructed one instance – grab it from mock.results
      razorpayInstance = RazorpayMock.mock.results[RazorpayMock.mock.results.length - 1]?.value;
    });

    afterEach(() => {
      delete process.env.RAZORPAY_X_KEY_ID;
      delete process.env.RAZORPAY_X_KEY_SECRET;
      jest.resetModules();
    });

    describe('createContact', () => {
      it('should call razorpayX.contacts.create and return contact', async () => {
        const fakeContact = { id: 'cont_123', name: 'John' };
        razorpayInstance.contacts.create.mockResolvedValue(fakeContact);

        const result = await createContact({
          name: 'John',
          email: 'john@example.com',
          type: 'vendor',
          reference_id: 'cr_1'
        });

        expect(razorpayInstance.contacts.create).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'John', type: 'vendor' })
        );
        expect(result).toEqual(fakeContact);
      });

      it('should throw with error description when Razorpay call fails with structured error', async () => {
        razorpayInstance.contacts.create.mockRejectedValue({
          error: { description: 'Invalid email' }
        });

        await expect(createContact({
          name: 'Bad', email: 'bad', type: 'vendor', reference_id: 'r1'
        })).rejects.toThrow('Invalid email');
      });

      it('should throw generic message when error has no description', async () => {
        razorpayInstance.contacts.create.mockRejectedValue(new Error('Network error'));

        await expect(createContact({
          name: 'Bad', email: 'bad', type: 'vendor', reference_id: 'r1'
        })).rejects.toThrow('Failed to create Razorpay contact');
      });
    });

    describe('createFundAccount', () => {
      it('should call razorpayX.fundAccount.create and return fund account', async () => {
        const fakeFa = { id: 'fa_456' };
        razorpayInstance.fundAccount.create.mockResolvedValue(fakeFa);

        const result = await createFundAccount({
          contact_id: 'cont_123',
          account_type: 'bank_account',
          bank_account: { name: 'John', ifsc: 'SBIN0001234', account_number: '1234567890' }
        });

        expect(razorpayInstance.fundAccount.create).toHaveBeenCalled();
        expect(result).toEqual(fakeFa);
      });

      it('should throw with description on structured Razorpay error', async () => {
        razorpayInstance.fundAccount.create.mockRejectedValue({
          error: { description: 'Invalid IFSC' }
        });

        await expect(createFundAccount({
          contact_id: 'c1',
          account_type: 'bank_account',
          bank_account: { name: 'N', ifsc: 'BAD', account_number: '123' }
        })).rejects.toThrow('Invalid IFSC');
      });

      it('should throw generic message when error has no description', async () => {
        razorpayInstance.fundAccount.create.mockRejectedValue(new Error('Timeout'));

        await expect(createFundAccount({
          contact_id: 'c1',
          account_type: 'bank_account',
          bank_account: { name: 'N', ifsc: 'X', account_number: '1' }
        })).rejects.toThrow('Failed to create fund account');
      });
    });

    describe('createPayout', () => {
      const payoutParams = {
        fund_account_id: 'fa_123',
        amount: 50000,
        currency: 'INR',
        mode: 'IMPS' as const,
        purpose: 'payout',
        reference_id: 'ref_123',
        narration: 'Test narration'
      };

      it('should call razorpayX.payouts.create and return payout', async () => {
        const fakePayout = { id: 'pout_789', status: 'processing' };
        razorpayInstance.payouts.create.mockResolvedValue(fakePayout);

        const result = await createPayout(payoutParams);

        expect(razorpayInstance.payouts.create).toHaveBeenCalledWith(payoutParams);
        expect(result).toEqual(fakePayout);
      });

      it('should throw with description on structured Razorpay error', async () => {
        razorpayInstance.payouts.create.mockRejectedValue({
          error: { description: 'Insufficient balance in account' }
        });

        await expect(createPayout(payoutParams)).rejects.toThrow('Insufficient balance in account');
      });

      it('should throw generic message when error has no description', async () => {
        razorpayInstance.payouts.create.mockRejectedValue(new Error('Server error'));

        await expect(createPayout(payoutParams)).rejects.toThrow('Failed to create payout');
      });
    });

    describe('getPayoutStatus', () => {
      it('should call razorpayX.payouts.fetch and return payout', async () => {
        const fakePayout = { id: 'pout_abc', status: 'processed' };
        razorpayInstance.payouts.fetch.mockResolvedValue(fakePayout);

        const result = await getPayoutStatus('pout_abc');

        expect(razorpayInstance.payouts.fetch).toHaveBeenCalledWith('pout_abc');
        expect(result).toEqual(fakePayout);
      });

      it('should throw with description on structured Razorpay error', async () => {
        razorpayInstance.payouts.fetch.mockRejectedValue({
          error: { description: 'Payout not found' }
        });

        await expect(getPayoutStatus('bad_id')).rejects.toThrow('Payout not found');
      });

      it('should throw generic message when error has no description', async () => {
        razorpayInstance.payouts.fetch.mockRejectedValue(new Error('Network error'));

        await expect(getPayoutStatus('p1')).rejects.toThrow('Failed to fetch payout status');
      });
    });
  });

  // ============================================================
  // SECTION C: functions when razorpayX is NOT configured
  // ============================================================

  describe('without Razorpay X configured', () => {
    beforeEach(() => {
      delete process.env.RAZORPAY_X_KEY_ID;
      delete process.env.RAZORPAY_X_KEY_SECRET;
      jest.resetModules();

      const mod = require('../../utils/razorpayPayouts');
      createContact = mod.createContact;
      createFundAccount = mod.createFundAccount;
      createPayout = mod.createPayout;
      getPayoutStatus = mod.getPayoutStatus;
    });

    afterEach(() => {
      jest.resetModules();
    });

    it('createContact should throw "Razorpay X not configured"', async () => {
      await expect(createContact({ name: 'N', email: 'e@e.com', type: 'vendor', reference_id: 'r' }))
        .rejects.toThrow('Razorpay X not configured');
    });

    it('createFundAccount should throw "Razorpay X not configured"', async () => {
      await expect(createFundAccount({
        contact_id: 'c1', account_type: 'bank_account',
        bank_account: { name: 'N', ifsc: 'I', account_number: '1' }
      })).rejects.toThrow('Razorpay X not configured');
    });

    it('createPayout should throw "Razorpay X not configured"', async () => {
      await expect(createPayout({
        fund_account_id: 'fa', amount: 100, currency: 'INR', mode: 'IMPS',
        purpose: 'p', reference_id: 'r', narration: 'n'
      })).rejects.toThrow('Razorpay X not configured');
    });

    it('getPayoutStatus should throw "Razorpay X not configured"', async () => {
      await expect(getPayoutStatus('pout_1')).rejects.toThrow('Razorpay X not configured');
    });
  });
});
