// ===========================================
// PAYOUT INTEGRATION TESTS
// ===========================================
// Tests the full payout flow: earnings → bank account → request → process → complete

import request from 'supertest';
import express from 'express';
import {
  createTestUser,
  createTestCreator,
  cleanupTestData,
  authHeader
} from '../helpers/testHelpers';
import prisma from '../../../prisma/client';
import payoutRoutes from '../../routes/payout.routes';
import { authenticate } from '../../middleware/auth';
import * as earningsUtils from '../../utils/earnings';
import * as razorpayPayouts from '../../utils/razorpayPayouts';

// Mock Razorpay Payouts
jest.mock('../../utils/razorpayPayouts');

// Create test app
const app = express();
app.use(express.json());
app.use('/api/payouts', payoutRoutes);

describe('Payout Integration Tests', () => {
  beforeEach(async () => {
    await cleanupTestData();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Bank Account Setup', () => {
    it('should add bank account with KYC details', async () => {
      const creator = await createTestCreator(false);

      // Mock Razorpay responses
      (razorpayPayouts.createContact as jest.Mock).mockResolvedValue({
        id: 'contact_123'
      });

      (razorpayPayouts.createFundAccount as jest.Mock).mockResolvedValue({
        id: 'fa_123',
        active: true
      });

      const bankData = {
        accountHolderName: 'John Doe',
        accountNumber: '1234567890',
        ifscCode: 'SBIN0001234',
        bankName: 'State Bank of India',
        accountType: 'SAVINGS',
        panNumber: 'ABCDE1234F',
        aadharLast4: '5678'
      };

      const response = await request(app)
        .post('/api/payouts/bank-account')
        .set(authHeader(creator.token))
        .send(bankData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        accountHolderName: bankData.accountHolderName,
        ifscCode: bankData.ifscCode,
        bankName: bankData.bankName,
        kycStatus: 'PENDING',
        isVerified: false
      });

      // Verify account number is masked in response
      expect(response.body.data.accountNumber).toContain('*');
      expect(response.body.data.accountNumber).not.toBe(bankData.accountNumber);

      // Verify Razorpay integration was called
      expect(razorpayPayouts.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          name: bankData.accountHolderName,
          email: creator.email
        })
      );

      expect(razorpayPayouts.createFundAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: 'contact_123',
          accountNumber: bankData.accountNumber,
          ifscCode: bankData.ifscCode
        })
      );

      // Verify bank account was saved to database
      const dbBankAccount = await prisma.bankAccount.findUnique({
        where: { creatorId: creator.creatorId }
      });

      expect(dbBankAccount).not.toBeNull();
      expect(dbBankAccount?.razorpayContactId).toBe('contact_123');
      expect(dbBankAccount?.razorpayFundAccountId).toBe('fa_123');
    });

    it('should update existing bank account', async () => {
      const creator = await createTestCreator(false);

      // Create initial bank account
      await prisma.bankAccount.create({
        data: {
          creatorId: creator.creatorId,
          accountHolderName: 'Old Name',
          accountNumber: '0987654321',
          ifscCode: 'HDFC0001234',
          bankName: 'HDFC Bank',
          accountType: 'SAVINGS',
          kycStatus: 'PENDING'
        }
      });

      // Mock Razorpay
      (razorpayPayouts.createContact as jest.Mock).mockResolvedValue({
        id: 'contact_new'
      });

      (razorpayPayouts.createFundAccount as jest.Mock).mockResolvedValue({
        id: 'fa_new'
      });

      // Update bank account
      const updatedData = {
        accountHolderName: 'New Name',
        accountNumber: '1111222233',
        ifscCode: 'SBIN0005678',
        bankName: 'State Bank of India',
        accountType: 'CURRENT',
        panNumber: 'NEWPN1234F',
        aadharLast4: '9999'
      };

      const response = await request(app)
        .post('/api/payouts/bank-account')
        .set(authHeader(creator.token))
        .send(updatedData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accountHolderName).toBe('New Name');

      // Verify update in database
      const dbBankAccount = await prisma.bankAccount.findUnique({
        where: { creatorId: creator.creatorId }
      });

      expect(dbBankAccount?.accountHolderName).toBe('New Name');
      expect(dbBankAccount?.accountType).toBe('CURRENT');
    });

    it('should validate IFSC code format', async () => {
      const creator = await createTestCreator(false);

      const response = await request(app)
        .post('/api/payouts/bank-account')
        .set(authHeader(creator.token))
        .send({
          accountHolderName: 'John Doe',
          accountNumber: '1234567890',
          ifscCode: 'INVALID', // Invalid format
          bankName: 'Test Bank',
          accountType: 'SAVINGS'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('IFSC');
    });

    it('should retrieve bank account with masked details', async () => {
      const creator = await createTestCreator(false);

      // Create bank account
      await prisma.bankAccount.create({
        data: {
          creatorId: creator.creatorId,
          accountHolderName: 'John Doe',
          accountNumber: '1234567890',
          ifscCode: 'SBIN0001234',
          bankName: 'State Bank of India',
          accountType: 'SAVINGS',
          kycStatus: 'VERIFIED',
          isVerified: true
        }
      });

      const response = await request(app)
        .get('/api/payouts/bank-account')
        .set(authHeader(creator.token))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        accountHolderName: 'John Doe',
        bankName: 'State Bank of India',
        kycStatus: 'VERIFIED',
        isVerified: true
      });

      // Account number should be masked
      expect(response.body.data.accountNumber).toMatch(/\*{6}\d{4}/);
      expect(response.body.data.accountNumber).not.toBe('1234567890');
    });
  });

  describe('Payout Request Flow', () => {
    it('should request payout successfully', async () => {
      const creator = await createTestCreator(false);

      // Setup: Add earnings and bank account
      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: {
            availableBalance: 10000,
            lifetimeEarnings: 10000
          }
        }),
        prisma.bankAccount.create({
          data: {
            creatorId: creator.creatorId,
            accountHolderName: 'John Doe',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
            accountType: 'SAVINGS',
            kycStatus: 'VERIFIED',
            isVerified: true,
            razorpayContactId: 'contact_123',
            razorpayFundAccountId: 'fa_123'
          }
        })
      ]);

      // Mock Razorpay payout
      (razorpayPayouts.calculatePayoutFee as jest.Mock).mockReturnValue(3);
      (razorpayPayouts.determinePayoutMode as jest.Mock).mockReturnValue('IMPS');
      (razorpayPayouts.createPayout as jest.Mock).mockResolvedValue({
        id: 'payout_rzp123',
        status: 'processing',
        utr: 'UTR123456'
      });

      // Request payout
      const response = await request(app)
        .post('/api/payouts/request')
        .set(authHeader(creator.token))
        .send({
          amount: 5000
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        amount: 5000,
        fee: 3,
        netAmount: 4997,
        status: 'PROCESSING'
      });

      // Verify payout was created in database
      const payout = await prisma.payout.findFirst({
        where: { creatorId: creator.creatorId }
      });

      expect(payout).not.toBeNull();
      expect(payout?.amount.toNumber()).toBe(5000);
      expect(payout?.razorpayPayoutId).toBe('payout_rzp123');

      // Verify creator balance was updated
      const updatedCreator = await prisma.creator.findUnique({
        where: { id: creator.creatorId }
      });

      expect(updatedCreator?.availableBalance.toNumber()).toBe(5000); // 10000 - 5000
      expect(updatedCreator?.pendingBalance.toNumber()).toBe(5000); // Amount in payout
    });

    it('should enforce minimum payout amount', async () => {
      const creator = await createTestCreator(false);

      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: { availableBalance: 10000 }
        }),
        prisma.bankAccount.create({
          data: {
            creatorId: creator.creatorId,
            accountHolderName: 'John Doe',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
            accountType: 'SAVINGS',
            kycStatus: 'VERIFIED',
            razorpayFundAccountId: 'fa_123'
          }
        })
      ]);

      const response = await request(app)
        .post('/api/payouts/request')
        .set(authHeader(creator.token))
        .send({
          amount: 500 // Below ₹1,000 minimum
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('minimum');
    });

    it('should check sufficient balance', async () => {
      const creator = await createTestCreator(false);

      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: { availableBalance: 2000 }
        }),
        prisma.bankAccount.create({
          data: {
            creatorId: creator.creatorId,
            accountHolderName: 'John Doe',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
            accountType: 'SAVINGS',
            kycStatus: 'VERIFIED',
            razorpayFundAccountId: 'fa_123'
          }
        })
      ]);

      const response = await request(app)
        .post('/api/payouts/request')
        .set(authHeader(creator.token))
        .send({
          amount: 5000 // More than available balance
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient balance');
    });

    it('should require KYC verification', async () => {
      const creator = await createTestCreator(false);

      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: { availableBalance: 10000 }
        }),
        prisma.bankAccount.create({
          data: {
            creatorId: creator.creatorId,
            accountHolderName: 'John Doe',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
            accountType: 'SAVINGS',
            kycStatus: 'PENDING', // Not verified
            razorpayFundAccountId: 'fa_123'
          }
        })
      ]);

      const response = await request(app)
        .post('/api/payouts/request')
        .set(authHeader(creator.token))
        .send({
          amount: 5000
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('KYC');
    });

    it('should calculate correct fees for different amounts', async () => {
      const creator = await createTestCreator(false);

      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: { availableBalance: 300000 }
        }),
        prisma.bankAccount.create({
          data: {
            creatorId: creator.creatorId,
            accountHolderName: 'John Doe',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
            accountType: 'SAVINGS',
            kycStatus: 'VERIFIED',
            razorpayFundAccountId: 'fa_123'
          }
        })
      ]);

      // RTGS (₹2 lakhs+) should have ₹20 fee
      (razorpayPayouts.calculatePayoutFee as jest.Mock).mockReturnValue(20);
      (razorpayPayouts.determinePayoutMode as jest.Mock).mockReturnValue('RTGS');
      (razorpayPayouts.createPayout as jest.Mock).mockResolvedValue({
        id: 'payout_123',
        status: 'processing'
      });

      const response = await request(app)
        .post('/api/payouts/request')
        .set(authHeader(creator.token))
        .send({
          amount: 250000 // Above RTGS threshold
        })
        .expect(200);

      expect(response.body.data.fee).toBe(20);
      expect(response.body.data.netAmount).toBe(249980);
    });
  });

  describe('Payout History', () => {
    it('should retrieve payout history with pagination', async () => {
      const creator = await createTestCreator(false);

      // Create multiple payouts
      const payouts = await Promise.all([
        prisma.payout.create({
          data: {
            creatorId: creator.creatorId,
            amount: 5000,
            fee: 3,
            netAmount: 4997,
            subscriptionEarnings: 5000,
            brandDealEarnings: 0,
            status: 'COMPLETED',
            bankAccountId: 'bank-123',
            completedAt: new Date()
          }
        }),
        prisma.payout.create({
          data: {
            creatorId: creator.creatorId,
            amount: 3000,
            fee: 3,
            netAmount: 2997,
            subscriptionEarnings: 3000,
            brandDealEarnings: 0,
            status: 'PENDING',
            bankAccountId: 'bank-123'
          }
        })
      ]);

      const response = await request(app)
        .get('/api/payouts?page=1&limit=10')
        .set(authHeader(creator.token))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.payouts).toHaveLength(2);
      expect(response.body.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1
      });
    });

    it('should filter payouts by status', async () => {
      const creator = await createTestCreator(false);

      await Promise.all([
        prisma.payout.create({
          data: {
            creatorId: creator.creatorId,
            amount: 5000,
            fee: 3,
            netAmount: 4997,
            subscriptionEarnings: 5000,
            brandDealEarnings: 0,
            status: 'COMPLETED',
            bankAccountId: 'bank-123'
          }
        }),
        prisma.payout.create({
          data: {
            creatorId: creator.creatorId,
            amount: 3000,
            fee: 3,
            netAmount: 2997,
            subscriptionEarnings: 3000,
            brandDealEarnings: 0,
            status: 'FAILED',
            bankAccountId: 'bank-123'
          }
        })
      ]);

      const response = await request(app)
        .get('/api/payouts?status=COMPLETED')
        .set(authHeader(creator.token))
        .expect(200);

      expect(response.body.data.payouts).toHaveLength(1);
      expect(response.body.data.payouts[0].status).toBe('COMPLETED');
    });
  });

  describe('Earnings Breakdown', () => {
    it('should return earnings breakdown with sources', async () => {
      const creator = await createTestCreator(false);

      // Set up earnings
      await Promise.all([
        prisma.creator.update({
          where: { id: creator.creatorId },
          data: {
            availableBalance: 8000,
            pendingBalance: 2000,
            lifetimeEarnings: 15000
          }
        }),
        prisma.earningsLedger.createMany({
          data: [
            {
              creatorId: creator.creatorId,
              type: 'CREDIT',
              amount: 5000,
              description: 'Subscription earnings',
              sourceType: 'subscription',
              balanceBefore: 0,
              balanceAfter: 5000
            },
            {
              creatorId: creator.creatorId,
              type: 'CREDIT',
              amount: 10000,
              description: 'Brand deal earnings',
              sourceType: 'brand_deal',
              balanceBefore: 5000,
              balanceAfter: 15000
            },
            {
              creatorId: creator.creatorId,
              type: 'DEBIT',
              amount: 5000,
              description: 'Payout',
              sourceType: 'payout',
              balanceBefore: 15000,
              balanceAfter: 10000
            }
          ]
        })
      ]);

      const response = await request(app)
        .get('/api/payouts/earnings')
        .set(authHeader(creator.token))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        availableBalance: 8000,
        pendingBalance: 2000,
        lifetimeEarnings: 15000
      });

      // Should include earnings by source
      expect(response.body.data.subscriptionEarnings).toBeDefined();
      expect(response.body.data.brandDealEarnings).toBeDefined();
    });
  });

  describe('Authorization', () => {
    it('should only allow creators to access payout endpoints', async () => {
      const user = await createTestUser('USER'); // Not a creator

      await request(app)
        .post('/api/payouts/request')
        .set(authHeader(user.token))
        .send({ amount: 5000 })
        .expect(403);
    });

    it('should block unauthenticated requests', async () => {
      await request(app)
        .get('/api/payouts')
        .expect(401);
    });

    it('should prevent creator from accessing another creator\'s payouts', async () => {
      const [creator1, creator2] = await Promise.all([
        createTestCreator(false),
        createTestCreator(false)
      ]);

      // Create payout for creator1
      await prisma.payout.create({
        data: {
          creatorId: creator1.creatorId,
          amount: 5000,
          fee: 3,
          netAmount: 4997,
          subscriptionEarnings: 5000,
          brandDealEarnings: 0,
          status: 'COMPLETED',
          bankAccountId: 'bank-123'
        }
      });

      // Creator2 tries to access creator1's payouts
      const response = await request(app)
        .get('/api/payouts')
        .set(authHeader(creator2.token))
        .expect(200);

      // Should only see their own (0 payouts)
      expect(response.body.data.payouts).toHaveLength(0);
    });
  });
});
