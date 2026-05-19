// ===========================================
// EARNINGS UNIT TESTS
// ===========================================

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    earningsLedger: {
      create: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}));

import prisma from '../../../prisma/client';
import {
  distributeEarnings,
  createPayoutEntry,
  completePayoutEntry,
  refundPayoutEntry,
  getEarningsBreakdown,
} from '../../utils/earnings';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Earnings Utils - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('distributeEarnings', () => {
    it('should distribute earnings and update creator balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        lifetimeEarnings: 500,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await distributeEarnings({
        creatorId: 'creator-1',
        amount: 50,
        sourceType: 'subscription',
        description: 'Monthly subscription earnings',
      });

      expect(result).toEqual({ balanceBefore: 100, balanceAfter: 150 });
      expect(mockPrisma.creator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'creator-1' },
          data: expect.objectContaining({
            availableBalance: 150,
          }),
        })
      );
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creatorId: 'creator-1',
            type: 'CREDIT',
            amount: 50,
          }),
        })
      );
    });

    it('should throw if creator is not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        distributeEarnings({
          creatorId: 'invalid-id',
          amount: 50,
          sourceType: 'subscription',
          description: 'Test',
        })
      ).rejects.toThrow('Creator not found');
    });

    it('should handle brand_deal source type', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 200,
        lifetimeEarnings: 1000,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await distributeEarnings({
        creatorId: 'creator-1',
        amount: 300,
        sourceType: 'brand_deal',
        sourceId: 'deal-123',
        description: 'Brand deal payment',
      });

      expect(result).toEqual({ balanceBefore: 200, balanceAfter: 500 });
      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: 'brand_deal',
            sourceId: 'deal-123',
          }),
        })
      );
    });

    it('should correctly compute balance for zero initial balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        lifetimeEarnings: 0,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await distributeEarnings({
        creatorId: 'creator-1',
        amount: 75,
        sourceType: 'adjustment',
        description: 'Adjustment',
      });

      expect(result).toEqual({ balanceBefore: 0, balanceAfter: 75 });
    });
  });

  describe('createPayoutEntry', () => {
    it('should deduct from available and add to pending balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 500,
        pendingBalance: 100,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await createPayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 200,
      });

      expect(result).toEqual({ availableBalance: 300, pendingBalance: 300 });
    });

    it('should throw if creator is not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        createPayoutEntry({
          creatorId: 'invalid-id',
          payoutId: 'payout-1',
          amount: 100,
        })
      ).rejects.toThrow('Creator not found');
    });

    it('should throw if insufficient balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 50,
        pendingBalance: 0,
      });

      await expect(
        createPayoutEntry({
          creatorId: 'creator-1',
          payoutId: 'payout-1',
          amount: 100,
        })
      ).rejects.toThrow('Insufficient available balance');
    });

    it('should create DEBIT ledger entry for payout', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 1000,
        pendingBalance: 0,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await createPayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 500,
      });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DEBIT',
            sourceType: 'payout',
            sourceId: 'payout-1',
          }),
        })
      );
    });
  });

  describe('completePayoutEntry', () => {
    it('should deduct from pending balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        pendingBalance: 300,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await completePayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 200,
      });

      expect(result).toEqual({ pendingBalance: 100 });
    });

    it('should throw if creator is not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        completePayoutEntry({
          creatorId: 'invalid-id',
          payoutId: 'payout-1',
          amount: 100,
        })
      ).rejects.toThrow('Creator not found');
    });

    it('should create DEBIT ledger entry with correct description', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        pendingBalance: 500,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await completePayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 500,
      });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Payout completed',
          }),
        })
      );
    });
  });

  describe('refundPayoutEntry', () => {
    it('should refund amount from pending to available balance', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        pendingBalance: 300,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await refundPayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 200,
      });

      expect(result).toEqual({ availableBalance: 300, pendingBalance: 100 });
    });

    it('should throw if creator is not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        refundPayoutEntry({
          creatorId: 'invalid-id',
          payoutId: 'payout-1',
          amount: 100,
        })
      ).rejects.toThrow('Creator not found');
    });

    it('should create REFUND ledger entry', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        pendingBalance: 500,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await refundPayoutEntry({
        creatorId: 'creator-1',
        payoutId: 'payout-1',
        amount: 500,
      });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'REFUND',
            description: 'Payout refunded (failed/cancelled)',
          }),
        })
      );
    });
  });

  describe('getEarningsBreakdown', () => {
    it('should return earnings breakdown for a creator', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 500,
        pendingBalance: 200,
        lifetimeEarnings: 5000,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([
        { sourceType: 'subscription', _sum: { amount: 3000 } },
        { sourceType: 'brand_deal', _sum: { amount: 2000 } },
      ]);

      const result = await getEarningsBreakdown('creator-1');

      expect(result).toEqual({
        availableBalance: 500,
        pendingBalance: 200,
        lifetimeEarnings: 5000,
        subscriptionEarnings: 3000,
        brandDealEarnings: 2000,
      });
    });

    it('should throw if creator is not found', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getEarningsBreakdown('invalid-id')).rejects.toThrow('Creator not found');
    });

    it('should default missing source types to 0', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        pendingBalance: 0,
        lifetimeEarnings: 100,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await getEarningsBreakdown('creator-1');

      expect(result.subscriptionEarnings).toBe(0);
      expect(result.brandDealEarnings).toBe(0);
    });

    it('should handle null sum amounts as 0', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 50,
        pendingBalance: 0,
        lifetimeEarnings: 50,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([
        { sourceType: 'subscription', _sum: { amount: null } },
      ]);

      const result = await getEarningsBreakdown('creator-1');

      expect(result.subscriptionEarnings).toBe(0);
    });
  });
});

// ===========================================
// EXTENDED COVERAGE TESTS
// ===========================================

describe('Earnings Utils — extended coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- distributeEarnings extended ----
  describe('distributeEarnings — extended', () => {
    it('should create ledger entry with CREDIT type', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        lifetimeEarnings: 0,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await distributeEarnings({
        creatorId: 'c1',
        amount: 100,
        sourceType: 'subscription',
        description: 'Sub earnings',
      });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'CREDIT' }),
        })
      );
    });

    it('should record correct balanceBefore and balanceAfter in ledger', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 250,
        lifetimeEarnings: 1000,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await distributeEarnings({
        creatorId: 'c1',
        amount: 50,
        sourceType: 'adjustment',
        description: 'Bonus',
      });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 250,
            balanceAfter: 300,
          }),
        })
      );
    });

    it('should increment lifetimeEarnings and totalEarnings', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        lifetimeEarnings: 500,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await distributeEarnings({
        creatorId: 'c1',
        amount: 75,
        sourceType: 'brand_deal',
        description: 'Deal payment',
      });

      expect(mockPrisma.creator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lifetimeEarnings: { increment: 75 },
            totalEarnings: { increment: 75 },
          }),
        })
      );
    });

    it('should handle decimal amounts correctly', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 10.5,
        lifetimeEarnings: 100,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await distributeEarnings({
        creatorId: 'c1',
        amount: 4.5,
        sourceType: 'subscription',
        description: 'Partial payment',
      });

      expect(result.balanceBefore).toBeCloseTo(10.5);
      expect(result.balanceAfter).toBeCloseTo(15);
    });
  });

  // ---- createPayoutEntry extended ----
  describe('createPayoutEntry — extended', () => {
    it('should allow payout when available balance exactly equals amount', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        pendingBalance: 0,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await createPayoutEntry({
        creatorId: 'c1',
        payoutId: 'payout-exact',
        amount: 100,
      });

      expect(result.availableBalance).toBe(0);
      expect(result.pendingBalance).toBe(100);
    });

    it('should record balanceBefore and balanceAfter correctly in ledger', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 500,
        pendingBalance: 50,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await createPayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 200 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 500,
            balanceAfter: 300,
          }),
        })
      );
    });

    it('should set description to "Payout requested"', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 200,
        pendingBalance: 0,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await createPayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 100 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: 'Payout requested' }),
        })
      );
    });
  });

  // ---- completePayoutEntry extended ----
  describe('completePayoutEntry — extended', () => {
    it('should reduce pending balance to 0 when completing full amount', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        pendingBalance: 500,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      const result = await completePayoutEntry({
        creatorId: 'c1',
        payoutId: 'p1',
        amount: 500,
      });

      expect(result.pendingBalance).toBe(0);
    });

    it('should use EarningsType.DEBIT in ledger entry', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ pendingBalance: 300 });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await completePayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 100 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'DEBIT' }),
        })
      );
    });

    it('should record correct balanceBefore and balanceAfter for pending', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({ pendingBalance: 400 });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await completePayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 150 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 400,
            balanceAfter: 250,
          }),
        })
      );
    });
  });

  // ---- refundPayoutEntry extended ----
  describe('refundPayoutEntry — extended', () => {
    it('should use EarningsType.REFUND in ledger entry', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        pendingBalance: 100,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await refundPayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 100 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'REFUND' }),
        })
      );
    });

    it('should record correct balanceBefore and balanceAfter for available', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 50,
        pendingBalance: 200,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await refundPayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 100 });

      expect(mockPrisma.earningsLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceBefore: 50,
            balanceAfter: 150,
          }),
        })
      );
    });

    it('should update creator with new available and pending balances', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 200,
        pendingBalance: 300,
      });
      (mockPrisma.creator.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

      await refundPayoutEntry({ creatorId: 'c1', payoutId: 'p1', amount: 100 });

      expect(mockPrisma.creator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            availableBalance: 300,
            pendingBalance: 200,
          }),
        })
      );
    });
  });

  // ---- getEarningsBreakdown extended ----
  describe('getEarningsBreakdown — extended', () => {
    it('should query ledger only for CREDIT type entries', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 100,
        pendingBalance: 0,
        lifetimeEarnings: 100,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([]);

      await getEarningsBreakdown('c1');

      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'CREDIT' }),
        })
      );
    });

    it('should convert Decimal-like strings to numbers', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: '123.45',
        pendingBalance: '67.89',
        lifetimeEarnings: '500.00',
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await getEarningsBreakdown('c1');

      expect(typeof result.availableBalance).toBe('number');
      expect(typeof result.pendingBalance).toBe('number');
      expect(typeof result.lifetimeEarnings).toBe('number');
    });

    it('should include brand_deal earnings correctly', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        pendingBalance: 0,
        lifetimeEarnings: 999,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([
        { sourceType: 'brand_deal', _sum: { amount: 999 } },
      ]);

      const result = await getEarningsBreakdown('c1');

      expect(result.brandDealEarnings).toBe(999);
      expect(result.subscriptionEarnings).toBe(0);
    });

    it('should query groupBy by sourceType for the correct creatorId', async () => {
      (mockPrisma.creator.findUnique as jest.Mock).mockResolvedValue({
        availableBalance: 0,
        pendingBalance: 0,
        lifetimeEarnings: 0,
      });
      (mockPrisma.earningsLedger.groupBy as jest.Mock).mockResolvedValue([]);

      await getEarningsBreakdown('specific-creator-id');

      expect(mockPrisma.earningsLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ creatorId: 'specific-creator-id' }),
        })
      );
    });
  });
});
