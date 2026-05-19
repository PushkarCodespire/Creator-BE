// ===========================================
// PAYOUT CONTROLLER UNIT TESTS
// ===========================================

import { Request, Response } from 'express';
import {
  addBankAccount,
  getBankAccount,
  requestPayout,
  getPayoutHistory,
  getPayoutDetails,
  cancelPayout,
  getEarnings,
  getEarningsLedger,
  handlePayoutWebhook
} from '../../controllers/payout.controller';
import prisma from '../../../prisma/client';
import * as razorpayPayouts from '../../utils/razorpayPayouts';

jest.mock('../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

// Mock Prisma client
jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    bankAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    payout: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn()
    },
    earningsLedger: {
      findMany: jest.fn(),
      count: jest.fn()
    }
  }
}));

// Mock Razorpay Payouts
jest.mock('../../utils/razorpayPayouts');

// Mock earnings utility
jest.mock('../../utils/earnings', () => ({
  createPayoutEntry: jest.fn(),
  completePayoutEntry: jest.fn(),
  refundPayoutEntry: jest.fn(),
  getEarningsBreakdown: jest.fn()
}));

jest.mock('../../utils/logger', () => ({ logError: jest.fn(), logInfo: jest.fn() }));

describe('Payout Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let nextMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn(() => ({ json: jsonMock })) as any;
    nextMock = jest.fn();

    mockRequest = {
      user: {
        id: 'user-123',
        email: 'creator@test.com',
        name: 'Test Creator',
        role: 'CREATOR' as any,
        creator: { id: 'creator-123' }
      },
      body: {},
      query: {},
      params: {}
    };

    mockResponse = {
      json: jsonMock,
      status: statusMock
    };

    jest.clearAllMocks();

    // Default prisma mock return values
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.bankAccount.create as jest.Mock).mockResolvedValue({});
    (prisma.bankAccount.update as jest.Mock).mockResolvedValue({});
    (prisma.payout.create as jest.Mock).mockResolvedValue({});
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payout.count as jest.Mock).mockResolvedValue(0);
    (prisma.payout.update as jest.Mock).mockResolvedValue({});
    (prisma.payout.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.earningsLedger.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.earningsLedger.count as jest.Mock).mockResolvedValue(0);

    // Default razorpay mock return values
    (razorpayPayouts.isRazorpayXConfigured as jest.Mock).mockReturnValue(false);
    (razorpayPayouts.calculatePayoutFee as jest.Mock).mockReturnValue(0);
    (razorpayPayouts.determinePayoutMode as jest.Mock).mockReturnValue('IMPS');
    (razorpayPayouts.createContact as jest.Mock).mockResolvedValue({ id: 'contact_mock' });
    (razorpayPayouts.createFundAccount as jest.Mock).mockResolvedValue({ id: 'fa_mock' });
    (razorpayPayouts.createPayout as jest.Mock).mockResolvedValue({ id: 'rp_mock' });
    (razorpayPayouts.mockPayout as jest.Mock).mockResolvedValue({ id: 'rp_mock_dev' });

    // Default earnings mock
    const earnings = require('../../utils/earnings');
    (earnings.getEarningsBreakdown as jest.Mock).mockResolvedValue({
      availableBalance: 0,
      pendingBalance: 0,
      lifetimeEarnings: 0,
      subscriptionEarnings: 0,
      brandDealEarnings: 0,
    });
    (earnings.createPayoutEntry as jest.Mock).mockResolvedValue({});
    (earnings.completePayoutEntry as jest.Mock).mockResolvedValue({});
    (earnings.refundPayoutEntry as jest.Mock).mockResolvedValue({});
  });

  describe('addBankAccount', () => {
    const validBankData = {
      accountHolderName: 'John Doe',
      accountNumber: '1234567890',
      ifscCode: 'SBIN0001234',
      bankName: 'State Bank of India',
      accountType: 'SAVINGS',
      panNumber: 'ABCDE1234F',
      aadharLast4: '1234'
    };

    it('should create new bank account successfully', async () => {
      mockRequest.body = validBankData;

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123',
        userId: 'user-123',
        displayName: 'Test Creator',
        user: { email: 'test@creator.com' }
      });

      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue(null);
      (razorpayPayouts.isRazorpayXConfigured as jest.Mock).mockReturnValue(true);

      (razorpayPayouts.createContact as jest.Mock).mockResolvedValue({
        id: 'contact_123'
      });

      (razorpayPayouts.createFundAccount as jest.Mock).mockResolvedValue({
        id: 'fa_123'
      });

      (prisma.bankAccount.create as jest.Mock).mockResolvedValue({
        id: 'bank-123',
        ...validBankData,
        razorpayContactId: 'contact_123',
        razorpayFundAccountId: 'fa_123',
        isVerified: false,
        kycStatus: 'PENDING'
      });

      await addBankAccount(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.bankAccount.create).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });
  });

  describe('getEarnings', () => {
    it('should return earnings breakdown', async () => {
      const { getEarningsBreakdown } = require('../../utils/earnings');
      (getEarningsBreakdown as jest.Mock).mockResolvedValue({
        availableBalance: 10000,
        pendingBalance: 2000,
        lifetimeEarnings: 50000
      });

      await getEarnings(mockRequest as Request, mockResponse as Response, nextMock);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            availableBalance: 10000
          })
        })
      );
    });
  });

  describe('requestPayout', () => {
    it('should create payout successfully', async () => {
      mockRequest.body = { amount: 5000 };

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123',
        availableBalance: 10000,
        bankAccount: {
          id: 'bank-123',
          kycStatus: 'VERIFIED',
          razorpayFundAccountId: 'fa_123'
        }
      });

      (razorpayPayouts.calculatePayoutFee as jest.Mock).mockReturnValue(300); // 3 rupees in paise
      (razorpayPayouts.determinePayoutMode as jest.Mock).mockReturnValue('IMPS');
      (razorpayPayouts.createPayout as jest.Mock).mockResolvedValue({ id: 'rp_payout_1' });

      (prisma.payout.create as jest.Mock).mockResolvedValue({
        id: 'payout-123',
        amount: 5000,
        status: 'PENDING'
      });

      await requestPayout(mockRequest as Request, mockResponse as Response, nextMock);

      expect(prisma.payout.create).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });
  });

  // ==========================================
  // ADDITIONAL BRANCH COVERAGE TESTS
  // ==========================================

  describe('addBankAccount – validation branches', () => {
    it('should throw 403 when user has no creator profile', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      mockRequest.body = { accountHolderName: 'A', accountNumber: '123456789', ifscCode: 'SBIN0001234', bankName: 'SBI' };
      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can add bank accounts');
    });

    it('should throw 400 when required fields are missing', async () => {
      mockRequest.body = { accountHolderName: 'A' }; // missing accountNumber etc
      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('All bank details are required');
    });

    it('should throw 400 on invalid IFSC code', async () => {
      mockRequest.body = { accountHolderName: 'A', accountNumber: '123456789', ifscCode: 'BADINVALIDIFSC', bankName: 'SBI' };
      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Invalid IFSC code format');
    });

    it('should throw 400 when account number is too short', async () => {
      mockRequest.body = { accountHolderName: 'A', accountNumber: '12345678', ifscCode: 'SBIN0001234', bankName: 'SBI' };
      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Invalid account number');
    });

    it('should throw 400 when account number is too long', async () => {
      mockRequest.body = { accountHolderName: 'A', accountNumber: '1234567890123456789', ifscCode: 'SBIN0001234', bankName: 'SBI' };
      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Invalid account number');
    });

    it('should update existing bank account when one already exists', async () => {
      mockRequest.body = {
        accountHolderName: 'John Doe', accountNumber: '1234567890',
        ifscCode: 'SBIN0001234', bankName: 'SBI', accountType: 'CURRENT', panNumber: 'ABCDE1234F', aadharLast4: '9999'
      };
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue({
        id: 'bank-existing', razorpayContactId: 'ct_existing', razorpayFundAccountId: 'fa_existing'
      });
      (prisma.bankAccount.update as jest.Mock).mockResolvedValue({
        id: 'bank-existing', accountHolderName: 'John Doe', accountNumber: '1234567890',
        ifscCode: 'SBIN0001234', bankName: 'SBI', kycStatus: 'SUBMITTED'
      });

      await addBankAccount(mockRequest as Request, mockResponse as Response, nextMock);
      expect(prisma.bankAccount.update).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should set kycStatus PENDING when panNumber is not provided', async () => {
      mockRequest.body = {
        accountHolderName: 'Jane', accountNumber: '1234567890',
        ifscCode: 'SBIN0001234', bankName: 'SBI'
      };
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.bankAccount.create as jest.Mock).mockResolvedValue({
        id: 'bank-new', accountNumber: '1234567890', kycStatus: 'PENDING'
      });

      await addBankAccount(mockRequest as Request, mockResponse as Response, nextMock);
      expect(prisma.bankAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kycStatus: 'PENDING' }) })
      );
    });

    it('should throw 500 when Razorpay contact creation fails', async () => {
      mockRequest.body = {
        accountHolderName: 'A', accountNumber: '1234567890',
        ifscCode: 'SBIN0001234', bankName: 'SBI'
      };
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue(null);
      (razorpayPayouts.isRazorpayXConfigured as jest.Mock).mockReturnValue(true);
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', user: { email: 'e@e.com' }
      });
      (razorpayPayouts.createContact as jest.Mock).mockRejectedValue(new Error('Razorpay error'));

      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock))
        .rejects.toThrow('Failed to create payout account');
    });

    it('should throw 500 when Razorpay fund account creation fails', async () => {
      mockRequest.body = {
        accountHolderName: 'A', accountNumber: '1234567890',
        ifscCode: 'SBIN0001234', bankName: 'SBI'
      };
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue({ razorpayContactId: 'ct_x', razorpayFundAccountId: null });
      (razorpayPayouts.isRazorpayXConfigured as jest.Mock).mockReturnValue(true);
      (razorpayPayouts.createFundAccount as jest.Mock).mockRejectedValue(new Error('FA error'));

      await expect(addBankAccount(mockRequest as Request, mockResponse as Response, nextMock))
        .rejects.toThrow('Failed to link bank account');
    });
  });

  describe('getBankAccount', () => {
    it('should throw 403 when user has no creator profile', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      await expect(getBankAccount(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can view bank accounts');
    });

    it('should return null when no bank account found', async () => {
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue(null);
      await getBankAccount(mockRequest as Request, mockResponse as Response, nextMock);
      expect(jsonMock).toHaveBeenCalledWith({ success: true, data: null });
    });

    it('should return masked account with null panNumber when panNumber is null', async () => {
      (prisma.bankAccount.findUnique as jest.Mock).mockResolvedValue({
        id: 'b1', accountNumber: '1234567890', panNumber: null, creatorId: 'creator-123'
      });
      await getBankAccount(mockRequest as Request, mockResponse as Response, nextMock);
      const call = (jsonMock as jest.Mock).mock.calls[0][0];
      expect(call.data.panNumber).toBeNull();
      expect(call.data.accountNumber).toMatch(/^\*+\d{4}$/);
    });
  });

  describe('requestPayout – validation branches', () => {
    it('should throw 403 when user has no creator profile', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can request payouts');
    });

    it('should throw 400 when amount is below minimum', async () => {
      // Use amount=1, which is below any reasonable MIN_PAYOUT_AMOUNT (default 1000, env may set 100)
      mockRequest.body = { amount: 1 };
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Minimum payout amount');
    });

    it('should throw 400 when no amount provided', async () => {
      mockRequest.body = {};
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Minimum payout amount');
    });

    it('should throw 404 when creator not found', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Creator not found');
    });

    it('should throw 400 when bank account is missing', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', availableBalance: 10000, bankAccount: null, user: { email: 'e@e.com' }
      });
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Please add your bank account details first');
    });

    it('should throw 400 when KYC is not verified', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', availableBalance: 10000,
        bankAccount: { id: 'b1', kycStatus: 'PENDING', razorpayFundAccountId: 'fa_x' },
        user: { email: 'e@e.com' }
      });
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('KYC verification');
    });

    it('should throw 400 when balance is insufficient', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', availableBalance: 100,
        bankAccount: { id: 'b1', kycStatus: 'VERIFIED', razorpayFundAccountId: 'fa_x' },
        user: { email: 'e@e.com' }
      });
      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Insufficient balance');
    });

    it('should throw 500 and refund when payout processing fails', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', availableBalance: 10000, displayName: 'Creator X',
        bankAccount: { id: 'b1', kycStatus: 'VERIFIED', razorpayFundAccountId: null },
        user: { email: 'e@e.com' }
      });
      (prisma.payout.create as jest.Mock).mockResolvedValue({ id: 'p1', amount: 5000 });

      const earnings = require('../../utils/earnings');
      (earnings.createPayoutEntry as jest.Mock).mockResolvedValue({});
      (earnings.refundPayoutEntry as jest.Mock).mockResolvedValue({});
      (prisma.payout.update as jest.Mock).mockResolvedValue({});

      await expect(requestPayout(mockRequest as Request, mockResponse as Response, nextMock))
        .rejects.toThrow('Failed to process payout');

      expect(earnings.refundPayoutEntry).toHaveBeenCalled();
    });

    it('should use real Razorpay when RazorpayX is configured', async () => {
      mockRequest.body = { amount: 5000 };
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
        id: 'creator-123', availableBalance: 10000, displayName: 'Creator X',
        bankAccount: { id: 'b1', kycStatus: 'VERIFIED', razorpayFundAccountId: 'fa_live' },
        user: { email: 'e@e.com' }
      });
      (prisma.payout.create as jest.Mock).mockResolvedValue({ id: 'p2', amount: 5000 });
      (prisma.payout.update as jest.Mock).mockResolvedValue({});
      (razorpayPayouts.isRazorpayXConfigured as jest.Mock).mockReturnValue(true);
      (razorpayPayouts.createPayout as jest.Mock).mockResolvedValue({ id: 'rz_live_1' });

      const earnings = require('../../utils/earnings');
      (earnings.createPayoutEntry as jest.Mock).mockResolvedValue({});

      await requestPayout(mockRequest as Request, mockResponse as Response, nextMock);
      expect(razorpayPayouts.createPayout).toHaveBeenCalled();
    });
  });

  describe('getPayoutHistory', () => {
    it('should throw 403 when user has no creator', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      await expect(getPayoutHistory(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can view payout history');
    });

    it('should return paginated payout history', async () => {
      mockRequest.query = { page: '2', limit: '5' };
      (prisma.payout.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', amount: 5000 }]);
      (prisma.payout.count as jest.Mock).mockResolvedValue(10);

      await getPayoutHistory(mockRequest as Request, mockResponse as Response, nextMock);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ pagination: expect.objectContaining({ totalPages: 2 }) })
      }));
    });
  });

  describe('getPayoutDetails', () => {
    it('should throw 403 when user has no creator', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      mockRequest.params = { id: 'p1' };
      await expect(getPayoutDetails(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can view payout details');
    });

    it('should throw 404 when payout not found', async () => {
      mockRequest.params = { id: 'missing' };
      (prisma.payout.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(getPayoutDetails(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Payout not found');
    });

    it('should return payout details', async () => {
      mockRequest.params = { id: 'p1' };
      (prisma.payout.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', amount: 5000, status: 'COMPLETED' });
      await getPayoutDetails(mockRequest as Request, mockResponse as Response, nextMock);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('cancelPayout', () => {
    it('should throw 403 when user has no creator', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      mockRequest.params = { id: 'p1' };
      await expect(cancelPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can cancel payouts');
    });

    it('should throw 404 when payout not found', async () => {
      mockRequest.params = { id: 'missing' };
      (prisma.payout.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(cancelPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Payout not found');
    });

    it('should throw 400 when payout is not PENDING', async () => {
      mockRequest.params = { id: 'p1' };
      (prisma.payout.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', amount: 5000, status: 'PROCESSING' });
      await expect(cancelPayout(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only pending payouts can be cancelled');
    });

    it('should cancel a PENDING payout and refund', async () => {
      mockRequest.params = { id: 'p1' };
      (prisma.payout.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', amount: 5000, status: 'PENDING', creatorId: 'creator-123' });
      (prisma.payout.update as jest.Mock).mockResolvedValue({});
      const earnings = require('../../utils/earnings');
      (earnings.refundPayoutEntry as jest.Mock).mockResolvedValue({});

      await cancelPayout(mockRequest as Request, mockResponse as Response, nextMock);
      expect(earnings.refundPayoutEntry).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getEarnings', () => {
    it('should throw 403 when user has no creator', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      await expect(getEarnings(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can view earnings');
    });
  });

  describe('getEarningsLedger', () => {
    it('should throw 403 when user has no creator', async () => {
      mockRequest.user = { id: 'u1', email: 'a@b.com', name: 'N', role: 'USER' as any } as any;
      await expect(getEarningsLedger(mockRequest as Request, mockResponse as Response, nextMock)).rejects.toThrow('Only creators can view earnings ledger');
    });

    it('should return paginated ledger entries', async () => {
      mockRequest.query = { page: '1', limit: '10' };
      (prisma.earningsLedger.findMany as jest.Mock).mockResolvedValue([{ id: 'e1' }]);
      (prisma.earningsLedger.count as jest.Mock).mockResolvedValue(1);

      await getEarningsLedger(mockRequest as Request, mockResponse as Response, nextMock);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('handlePayoutWebhook', () => {
    const buildPayoutWebhookReq = (event: string, payoutEntity: object, signature = 'sig') =>
      ({
        headers: { 'x-razorpay-signature': signature },
        body: { event, payload: { payout: { entity: payoutEntity } } }
      } as unknown as Request);

    it('should throw 401 when signature is invalid', async () => {
      const secret = 'webhook-secret';
      process.env.RAZORPAY_X_WEBHOOK_SECRET = secret;
      const req = buildPayoutWebhookReq('payout.processed', { reference_id: 'p1', utr: 'UTR001' }, 'bad-sig');
      const res = { json: jsonMock, status: statusMock } as unknown as Response;
      await expect(handlePayoutWebhook(req, res, nextMock)).rejects.toThrow('Invalid webhook signature');
      delete process.env.RAZORPAY_X_WEBHOOK_SECRET;
    });

    it('should return success for unrelated events', async () => {
      const { verifyPayoutWebhook } = require('../../utils/razorpayPayouts');
      (verifyPayoutWebhook as jest.Mock).mockReturnValue(true);

      const req = {
        headers: { 'x-razorpay-signature': 'sig' },
        body: { event: 'contact.created', payload: { payout: { entity: {} } } }
      } as unknown as Request;
      const res = { json: jsonMock, status: statusMock } as unknown as Response;

      await handlePayoutWebhook(req, res, nextMock);
      expect(jsonMock).toHaveBeenCalledWith({ success: true });
    });

    it('should handle payout.processed and complete the payout', async () => {
      const { verifyPayoutWebhook } = require('../../utils/razorpayPayouts');
      (verifyPayoutWebhook as jest.Mock).mockReturnValue(true);

      const payoutEntity = { reference_id: 'payout-123', utr: 'UTR999' };
      const req = {
        headers: { 'x-razorpay-signature': 'sig' },
        body: { event: 'payout.processed', payload: { payout: { entity: payoutEntity } } }
      } as unknown as Request;
      const res = { json: jsonMock, status: statusMock } as unknown as Response;

      (prisma.payout.findUnique as jest.Mock).mockResolvedValue({ id: 'payout-123', creatorId: 'creator-123', amount: 5000 });
      (prisma.payout.update as jest.Mock).mockResolvedValue({});
      const earnings = require('../../utils/earnings');
      (earnings.completePayoutEntry as jest.Mock).mockResolvedValue({});

      await handlePayoutWebhook(req, res, nextMock);
      expect(prisma.payout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
      );
      expect(earnings.completePayoutEntry).toHaveBeenCalled();
    });

    it('should handle payout.failed and refund', async () => {
      const { verifyPayoutWebhook } = require('../../utils/razorpayPayouts');
      (verifyPayoutWebhook as jest.Mock).mockReturnValue(true);

      const payoutEntity = { reference_id: 'payout-123', failure_reason: 'Bank error' };
      const req = {
        headers: { 'x-razorpay-signature': 'sig' },
        body: { event: 'payout.failed', payload: { payout: { entity: payoutEntity } } }
      } as unknown as Request;
      const res = { json: jsonMock, status: statusMock } as unknown as Response;

      (prisma.payout.findUnique as jest.Mock).mockResolvedValue({ id: 'payout-123', creatorId: 'creator-123', amount: 5000 });
      (prisma.payout.update as jest.Mock).mockResolvedValue({});
      const earnings = require('../../utils/earnings');
      (earnings.refundPayoutEntry as jest.Mock).mockResolvedValue({});

      await handlePayoutWebhook(req, res, nextMock);
      expect(prisma.payout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
      );
      expect(earnings.refundPayoutEntry).toHaveBeenCalled();
    });

    it('should handle payout.reversed and refund', async () => {
      const { verifyPayoutWebhook } = require('../../utils/razorpayPayouts');
      (verifyPayoutWebhook as jest.Mock).mockReturnValue(true);

      const payoutEntity = { reference_id: 'payout-rev', failure_reason: null };
      const req = {
        headers: { 'x-razorpay-signature': 'sig' },
        body: { event: 'payout.reversed', payload: { payout: { entity: payoutEntity } } }
      } as unknown as Request;
      const res = { json: jsonMock, status: statusMock } as unknown as Response;

      (prisma.payout.findUnique as jest.Mock).mockResolvedValue({ id: 'payout-rev', creatorId: 'creator-123', amount: 3000 });
      (prisma.payout.update as jest.Mock).mockResolvedValue({});
      const earnings = require('../../utils/earnings');
      (earnings.refundPayoutEntry as jest.Mock).mockResolvedValue({});

      await handlePayoutWebhook(req, res, nextMock);
      expect(prisma.payout.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorMessage: 'Payout failed' }) })
      );
    });

    it('should return success when payout not found in DB (idempotent)', async () => {
      const { verifyPayoutWebhook } = require('../../utils/razorpayPayouts');
      (verifyPayoutWebhook as jest.Mock).mockReturnValue(true);

      const req = {
        headers: { 'x-razorpay-signature': 'sig' },
        body: { event: 'payout.processed', payload: { payout: { entity: { reference_id: 'unknown' } } } }
      } as unknown as Request;
      const res = { json: jsonMock, status: statusMock } as unknown as Response;

      (prisma.payout.findUnique as jest.Mock).mockResolvedValue(null);

      await handlePayoutWebhook(req, res, nextMock);
      expect(jsonMock).toHaveBeenCalledWith({ success: true });
    });
  });
});
