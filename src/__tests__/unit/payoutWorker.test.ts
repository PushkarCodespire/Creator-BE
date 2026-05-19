// ===========================================
// PAYOUT WORKER UNIT TESTS
// ===========================================

// Standard helpers
const makeReq = (o: any = {}) => ({ body: {}, params: {}, query: {}, headers: { authorization: 'Bearer t' }, user: { id: 'u1', role: 'USER', email: 'e@e.com' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, cookies: {}, ...o });
const makeRes = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); r.send = jest.fn(() => r); r.setHeader = jest.fn(() => r); r.getHeader = jest.fn(() => undefined); r.on = jest.fn(() => r); r.once = jest.fn(() => r); r.emit = jest.fn(); r.headersSent = false; r.locals = {}; r.writableEnded = false; return r; };
const next = jest.fn();

// ---- Module mocks (before imports) ----

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    payout: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn()
    },
    creator: { update: jest.fn() },
    earningsLedger: { create: jest.fn() },
    analyticsEvent: { create: jest.fn() }
  }
}));

jest.mock('../../utils/razorpayPayouts', () => ({
  createPayout: jest.fn(),
  mockPayout: jest.fn(),
  isRazorpayXConfigured: jest.fn(),
  determinePayoutMode: jest.fn().mockReturnValue('IMPS'),
  calculatePayoutFee: jest.fn().mockReturnValue(0)
}));

jest.mock('../../workers/emailWorker', () => ({
  EmailWorker: {
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn()
}));

import prisma from '../../../prisma/client';
import { PayoutWorker } from '../../workers/payoutWorker';
import { isRazorpayXConfigured, mockPayout, createPayout } from '../../utils/razorpayPayouts';
import { EmailWorker } from '../../workers/emailWorker';

// Helper: build a full payout object
const buildPayout = (overrides: any = {}) => ({
  id: 'payout1',
  creatorId: 'cr1',
  status: 'PENDING',
  amount: { toNumber: () => 1000 },
  netAmount: { toNumber: () => 950 },
  requestedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
  creator: {
    userId: 'u1',
    availableBalance: { minus: jest.fn().mockReturnValue(0) },
    bankAccount: {
      id: 'ba1',
      isVerified: true,
      razorpayFundAccountId: 'fa_test123'
    }
  },
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================
// PayoutWorker.processJob — routing
// ============================================
describe('PayoutWorker.processJob', () => {
  it('throws for unknown job type', async () => {
    await expect(
      PayoutWorker.processJob({ payoutId: 'p1', type: 'unknown' as any })
    ).rejects.toThrow('Unknown job type: unknown');
  });

  it('routes process type to processPayout', async () => {
    const payout = buildPayout();
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(payout);
    (prisma.payout.update as jest.Mock).mockResolvedValue({ ...payout, status: 'PROCESSING' });
    (isRazorpayXConfigured as jest.Mock).mockReturnValue(false);
    (mockPayout as jest.Mock).mockResolvedValue({ id: 'razorpay_payout_1' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.earningsLedger.create as jest.Mock).mockResolvedValue({});
    (EmailWorker.sendNotificationEmail as jest.Mock).mockResolvedValue({});

    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' })
    ).resolves.toBeUndefined();
  });

  it('routes retry type — resets FAILED payout and re-processes', async () => {
    const failedPayout = buildPayout({ status: 'FAILED' });
    const pendingPayout = buildPayout({ status: 'PENDING' });

    (prisma.payout.findUnique as jest.Mock)
      .mockResolvedValueOnce(failedPayout)   // retryPayout check
      .mockResolvedValueOnce(pendingPayout); // processPayout call

    (prisma.payout.update as jest.Mock).mockResolvedValue({ ...pendingPayout, status: 'PROCESSING' });
    (isRazorpayXConfigured as jest.Mock).mockReturnValue(false);
    (mockPayout as jest.Mock).mockResolvedValue({ id: 'razorpay_mock_1' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.earningsLedger.create as jest.Mock).mockResolvedValue({});

    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'retry' })
    ).resolves.toBeUndefined();
  });

  it('routes cancel type — cancels PENDING payout', async () => {
    const payout = buildPayout({ status: 'PENDING' });
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(payout);
    (prisma.payout.update as jest.Mock).mockResolvedValue({ ...payout, status: 'CANCELLED' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});

    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'cancel' })
    ).resolves.toBeUndefined();
  });
});

// ============================================
// processPayout — internal logic via processJob('process')
// ============================================
describe('processPayout — via processJob', () => {
  const setup = (payoutOverrides: any = {}, razorpayConfigured = false) => {
    const payout = buildPayout(payoutOverrides);
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(payout);
    (prisma.payout.update as jest.Mock).mockResolvedValue(payout);
    (isRazorpayXConfigured as jest.Mock).mockReturnValue(razorpayConfigured);
    (mockPayout as jest.Mock).mockResolvedValue({ id: 'mock_razorpay_id' });
    (createPayout as jest.Mock).mockResolvedValue({ id: 'real_razorpay_id', utr: 'UTR123' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.earningsLedger.create as jest.Mock).mockResolvedValue({});
    (EmailWorker.sendNotificationEmail as jest.Mock).mockResolvedValue({});
    return payout;
  };

  it('throws when payout not found', async () => {
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      PayoutWorker.processJob({ payoutId: 'missing', type: 'process' })
    ).rejects.toThrow('Payout not found: missing');
  });

  it('throws when payout is not PENDING', async () => {
    setup({ status: 'COMPLETED' });
    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' })
    ).rejects.toThrow('Payout is not in pending status: COMPLETED');
  });

  it('throws when creator has no bank account', async () => {
    setup({ creator: { userId: 'u1', availableBalance: { minus: jest.fn() }, bankAccount: null } });
    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' })
    ).rejects.toThrow('Creator has no bank account: cr1');
  });

  it('throws when bank account is not verified', async () => {
    setup({
      creator: {
        userId: 'u1',
        availableBalance: { minus: jest.fn() },
        bankAccount: { id: 'ba1', isVerified: false, razorpayFundAccountId: 'fa_1' }
      }
    });
    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' })
    ).rejects.toThrow('Bank account is not verified for creator: cr1');
  });

  it('processes payout using mock mode when Razorpay is not configured', async () => {
    setup();
    await PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' });

    expect(mockPayout).toHaveBeenCalled();
    expect(createPayout).not.toHaveBeenCalled();
    expect(prisma.payout.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' })
    }));
    expect(prisma.earningsLedger.create).toHaveBeenCalled();
    expect(EmailWorker.sendNotificationEmail).toHaveBeenCalled();
  });

  it('processes payout using real Razorpay when configured', async () => {
    setup({}, true); // razorpay configured
    await PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' });

    expect(createPayout).toHaveBeenCalled();
    expect(mockPayout).not.toHaveBeenCalled();
  });

  it('marks payout as FAILED and rethrows when Razorpay call fails', async () => {
    setup();
    (mockPayout as jest.Mock).mockRejectedValue(new Error('Razorpay API error'));

    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'process' })
    ).rejects.toThrow('Razorpay API error');

    // Should have updated status to FAILED
    const updateCalls = (prisma.payout.update as jest.Mock).mock.calls;
    const failedUpdate = updateCalls.find(
      (call) => call[0].data?.status === 'FAILED'
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate[0].data.errorMessage).toBe('Razorpay API error');
  });
});

// ============================================
// retryPayout — via processJob('retry')
// ============================================
describe('retryPayout — via processJob', () => {
  it('throws when payout not found', async () => {
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      PayoutWorker.processJob({ payoutId: 'missing', type: 'retry' })
    ).rejects.toThrow('Payout not found: missing');
  });

  it('throws when payout is not in FAILED status', async () => {
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(buildPayout({ status: 'COMPLETED' }));
    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'retry' })
    ).rejects.toThrow('Payout is not in failed status: COMPLETED');
  });
});

// ============================================
// cancelPayout — via processJob('cancel')
// ============================================
describe('cancelPayout — via processJob', () => {
  it('throws when payout not found', async () => {
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      PayoutWorker.processJob({ payoutId: 'missing', type: 'cancel' })
    ).rejects.toThrow('Payout not found: missing');
  });

  it('throws when payout cannot be cancelled (COMPLETED status)', async () => {
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(buildPayout({ status: 'COMPLETED' }));
    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'cancel' })
    ).rejects.toThrow('Cannot cancel payout in status: COMPLETED');
  });

  it('cancels a FAILED payout', async () => {
    const payout = buildPayout({ status: 'FAILED' });
    (prisma.payout.findUnique as jest.Mock).mockResolvedValue(payout);
    (prisma.payout.update as jest.Mock).mockResolvedValue({ ...payout, status: 'CANCELLED' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});

    await expect(
      PayoutWorker.processJob({ payoutId: 'payout1', type: 'cancel' })
    ).resolves.toBeUndefined();

    expect(prisma.creator.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { availableBalance: { increment: payout.amount } }
    }));
  });
});

// ============================================
// PayoutWorker.processPendingPayouts
// ============================================
describe('PayoutWorker.processPendingPayouts', () => {
  it('processes all pending payouts and continues on per-payout error', async () => {
    const p1 = buildPayout({ id: 'p1' });
    const p2 = buildPayout({ id: 'p2' });

    (prisma.payout.findMany as jest.Mock).mockResolvedValue([p1, p2]);

    // p1 succeeds, p2 fails internally
    (prisma.payout.findUnique as jest.Mock)
      .mockResolvedValueOnce(p1)   // process p1
      .mockResolvedValueOnce(p2);  // process p2

    (prisma.payout.update as jest.Mock).mockResolvedValue(p1);
    (isRazorpayXConfigured as jest.Mock).mockReturnValue(false);
    (mockPayout as jest.Mock)
      .mockResolvedValueOnce({ id: 'rp1' }) // p1 ok
      .mockRejectedValueOnce(new Error('Payment failed')); // p2 fails

    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.earningsLedger.create as jest.Mock).mockResolvedValue({});
    (EmailWorker.sendNotificationEmail as jest.Mock).mockResolvedValue({});

    await expect(PayoutWorker.processPendingPayouts()).resolves.toBeUndefined();
    expect(prisma.payout.findMany).toHaveBeenCalled();
  });

  it('handles empty pending payouts array', async () => {
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);
    await expect(PayoutWorker.processPendingPayouts()).resolves.toBeUndefined();
    expect(prisma.payout.findUnique).not.toHaveBeenCalled();
  });
});

// ============================================
// PayoutWorker.retryFailedPayouts
// ============================================
describe('PayoutWorker.retryFailedPayouts', () => {
  it('retries failed payouts and continues on error', async () => {
    const failedPayout = buildPayout({ id: 'fp1', status: 'FAILED' });
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([failedPayout]);

    // retry: findUnique for retry check
    (prisma.payout.findUnique as jest.Mock)
      .mockResolvedValueOnce(failedPayout)   // retryPayout status check
      .mockResolvedValueOnce(buildPayout()); // processPayout after reset

    (prisma.payout.update as jest.Mock).mockResolvedValue(failedPayout);
    (isRazorpayXConfigured as jest.Mock).mockReturnValue(false);
    (mockPayout as jest.Mock).mockResolvedValue({ id: 'mock_retry' });
    (prisma.creator.update as jest.Mock).mockResolvedValue({});
    (prisma.earningsLedger.create as jest.Mock).mockResolvedValue({});
    (EmailWorker.sendNotificationEmail as jest.Mock).mockResolvedValue({});

    await expect(PayoutWorker.retryFailedPayouts()).resolves.toBeUndefined();
  });

  it('handles empty failed payouts array', async () => {
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);
    await expect(PayoutWorker.retryFailedPayouts()).resolves.toBeUndefined();
  });
});

// ============================================
// PayoutWorker.generatePayoutReport
// ============================================
describe('PayoutWorker.generatePayoutReport', () => {
  const setupReportMocks = () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({
      _count: 5,
      _sum: { amount: 50000, fee: 500, netAmount: 49500 }
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});
  };

  it('generates daily report', async () => {
    setupReportMocks();
    const report = await PayoutWorker.generatePayoutReport('daily');
    expect(report.period).toBe('daily');
    expect(report.totalPayouts).toBe(5);
    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });

  it('generates weekly report', async () => {
    setupReportMocks();
    const report = await PayoutWorker.generatePayoutReport('weekly');
    expect(report.period).toBe('weekly');
  });

  it('generates monthly report', async () => {
    setupReportMocks();
    const report = await PayoutWorker.generatePayoutReport('monthly');
    expect(report.period).toBe('monthly');
  });

  it('throws for invalid period', async () => {
    await expect(
      PayoutWorker.generatePayoutReport('quarterly' as any)
    ).rejects.toThrow('Invalid period: quarterly');
  });

  it('handles null aggregate sums', async () => {
    (prisma.payout.aggregate as jest.Mock).mockResolvedValue({
      _count: 0,
      _sum: { amount: null, fee: null, netAmount: null }
    });
    (prisma.analyticsEvent.create as jest.Mock).mockResolvedValue({});
    const report = await PayoutWorker.generatePayoutReport('daily');
    expect(report.totalAmount).toBe(0);
    expect(report.totalFees).toBe(0);
  });
});
