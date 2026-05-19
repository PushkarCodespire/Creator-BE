// ===========================================
// CREATOR MANAGEMENT (ADMIN) CONTROLLER TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn()
    },
    conversation: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn()
    },
    message: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn()
    },
    user: { findMany: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
    earningsLedger: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn()
    },
    payout: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn()
    },
    bankAccount: { upsert: jest.fn() },
    creatorContent: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn()
    },
    pricingHistory: { findMany: jest.fn(), create: jest.fn() },
    analyticsEvent: { create: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../utils/contextBuilder', () => ({
  buildEnhancedContext: jest.fn()
}));

jest.mock('../../../utils/openai', () => ({
  generateCreatorResponse: jest.fn(),
  isOpenAIConfigured: jest.fn()
}));

jest.mock('../../../utils/earnings', () => ({
  completePayoutEntry: jest.fn(),
  createPayoutEntry: jest.fn(),
  getEarningsBreakdown: jest.fn()
}));

import prisma from '../../../../prisma/client';
import {
  getCreatorDashboard,
  listCreators,
  getPendingCreators,
  getCreatorDetails,
  updateCreator,
  updateCreatorProfile,
  updateCreatorAIConfig,
  toggleCreatorVerification,
  verifyCreator,
  toggleCreatorStatus,
  rejectCreator,
  getCreatorAnalytics,
  getCreatorSubscribers,
  getCreatorRevenue,
  getPayoutConfig,
  updatePayoutConfig,
  processManualPayout,
  getCreatorConversations,
  getConversationDetails,
  testCreatorAI,
  getPricingConfig,
  updatePricingConfig,
  getPricingHistory,
  getCreatorContent,
  deleteCreatorContent
} from '../../../controllers/admin/creator-management.controller';
import { buildEnhancedContext } from '../../../utils/contextBuilder';
import { generateCreatorResponse, isOpenAIConfigured } from '../../../utils/openai';
import { getEarningsBreakdown, createPayoutEntry, completePayoutEntry } from '../../../utils/earnings';

// Standard helpers
const makeReq = (o: any = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: { authorization: 'Bearer t' },
  user: { id: 'u1', role: 'USER', email: 'e@e.com' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  cookies: {},
  ...o
});
const makeRes = () => {
  const r: any = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  r.send = jest.fn(() => r);
  r.setHeader = jest.fn(() => r);
  r.getHeader = jest.fn(() => undefined);
  r.on = jest.fn(() => r);
  r.once = jest.fn(() => r);
  r.emit = jest.fn();
  r.headersSent = false;
  r.locals = {};
  r.writableEnded = false;
  return r;
};
const next = jest.fn();

const mockCreator = {
  id: 'cr1',
  displayName: 'Test Creator',
  category: 'Music',
  isVerified: true,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  totalEarnings: 5000,
  totalMessages: 100,
  rating: 4.5,
  pricePerMessage: 10,
  lifetimeEarnings: 5000,
  availableBalance: 1000,
  pendingBalance: 200,
  bankAccount: null,
  userId: 'u1',
  paymentMethod: 'BANK_TRANSFER',
  bankDetails: null,
  payoutSchedule: 'weekly',
  minimumPayout: 500,
  taxInfo: null,
  aiPersonality: 'Friendly',
  aiTone: 'casual',
  responseStyle: 'GPT-4',
  welcomeMessage: 'Hello!',
  firstMessageFree: false,
  discountFirstFive: 0
};

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================
// getCreatorDashboard
// =============================================
describe('getCreatorDashboard', () => {
  const setupDashboardMocks = () => {
    (prisma.creator.count as jest.Mock).mockResolvedValue(10);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(50);
    (prisma.message.count as jest.Mock).mockResolvedValue(500);
    (prisma.creator.aggregate as jest.Mock).mockResolvedValue({
      _avg: { rating: 4.2 },
      _sum: { lifetimeEarnings: 100000 }
    });
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([mockCreator]);
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([
      { category: 'Music', _count: { id: 5 } }
    ]);
  };

  it('returns dashboard stats with correct shape', async () => {
    setupDashboardMocks();
    const res = makeRes();
    await getCreatorDashboard(makeReq(), res);
    const call = (res.json as jest.Mock).mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data).toHaveProperty('stats');
    expect(call.data).toHaveProperty('recentCreators');
    expect(call.data).toHaveProperty('topPerformingCreators');
    expect(call.data).toHaveProperty('categoryDistribution');
    expect(call.data).toHaveProperty('growthTrend');
  });

  it('handles null rating aggregate gracefully', async () => {
    setupDashboardMocks();
    (prisma.creator.aggregate as jest.Mock).mockResolvedValue({
      _avg: { rating: null },
      _sum: { lifetimeEarnings: null }
    });
    const res = makeRes();
    await getCreatorDashboard(makeReq(), res);
    const stats = (res.json as jest.Mock).mock.calls[0][0].data.stats;
    expect(stats.avgResponseQuality).toBe(0);
    expect(stats.totalRevenue).toBe(0);
  });

  it('maps topPerformingCreators correctly with null rating', async () => {
    setupDashboardMocks();
    (prisma.creator.findMany as jest.Mock)
      .mockResolvedValueOnce([mockCreator]) // recentCreators
      .mockResolvedValueOnce([{ ...mockCreator, rating: null }]); // topPerformingCreators
    const res = makeRes();
    await getCreatorDashboard(makeReq(), res);
    const top = (res.json as jest.Mock).mock.calls[0][0].data.topPerformingCreators;
    expect(top[0].rating).toBeNull();
  });

  it('builds categoryDistribution from groupBy result', async () => {
    setupDashboardMocks();
    (prisma.creator.groupBy as jest.Mock).mockResolvedValue([
      { category: 'Music', _count: { id: 3 } },
      { category: null, _count: { id: 1 } } // null should be skipped
    ]);
    const res = makeRes();
    await getCreatorDashboard(makeReq(), res);
    const dist = (res.json as jest.Mock).mock.calls[0][0].data.categoryDistribution;
    expect(dist.Music).toBe(3);
    expect(dist).not.toHaveProperty('null');
  });

  it('generates a growthTrend array of 12 entries', async () => {
    setupDashboardMocks();
    const res = makeRes();
    await getCreatorDashboard(makeReq(), res);
    const trend = (res.json as jest.Mock).mock.calls[0][0].data.growthTrend;
    expect(trend).toHaveLength(12);
  });
});

// =============================================
// listCreators
// =============================================
describe('listCreators', () => {
  it('returns paginated creators list', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([mockCreator]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(1);
    const res = makeRes();
    await listCreators(makeReq({ query: { page: '1', limit: '20' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.data.pagination.total).toBe(1);
  });

  it('applies verified filter', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await listCreators(makeReq({ query: { verified: 'true' } }), res);
    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isVerified: true }) })
    );
  });

  it('applies active filter', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await listCreators(makeReq({ query: { active: 'false' } }), res);
    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: false }) })
    );
  });

  it('applies search filter with OR clause', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await listCreators(makeReq({ query: { search: 'test' } }), res);
    const whereArg = (prisma.creator.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
  });

  it('applies category filter', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await listCreators(makeReq({ query: { category: 'Music' } }), res);
    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'Music' }) })
    );
  });

  it('calculates totalPages correctly', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(45);
    const res = makeRes();
    await listCreators(makeReq({ query: { page: '1', limit: '20' } }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.pagination.totalPages).toBe(3);
  });
});

// =============================================
// getPendingCreators
// =============================================
describe('getPendingCreators', () => {
  it('returns pending creators with pagination', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([mockCreator]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(1);
    const res = makeRes();
    await getPendingCreators(makeReq({ query: {} }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.data.pagination).toBeDefined();
  });

  it('uses default page 1 and limit 20', async () => {
    (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creator.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await getPendingCreators(makeReq({ query: {} }), res);
    expect(prisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });
});

// =============================================
// getCreatorDetails
// =============================================
describe('getCreatorDetails', () => {
  it('returns creator detail without bank account', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await getCreatorDetails(makeReq({ params: { creatorId: 'cr1' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.data.bankAccount).toBeNull();
  });

  it('masks bank account number and PAN when present', async () => {
    const creatorWithBank = {
      ...mockCreator,
      bankAccount: {
        id: 'ba1',
        accountNumber: '12345678',
        panNumber: 'ABCDE1234F',
        accountHolderName: 'Test',
        bankName: 'SBI',
        ifscCode: 'SBIN0001234',
        isVerified: true,
        kycStatus: 'VERIFIED'
      }
    };
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(creatorWithBank);
    const res = makeRes();
    await getCreatorDetails(makeReq({ params: { creatorId: 'cr1' } }), res);
    const bankData = (res.json as jest.Mock).mock.calls[0][0].data.bankAccount;
    expect(bankData.accountNumber).toMatch(/\*+\d{4}/);
    expect(bankData.panNumber).toMatch(/\*{6}/);
  });

  it('handles bank account with null accountNumber and panNumber', async () => {
    const creatorWithBank = {
      ...mockCreator,
      bankAccount: {
        id: 'ba1',
        accountNumber: null,
        panNumber: null,
        accountHolderName: 'Test',
        bankName: 'SBI',
        ifscCode: 'SBIN0001234',
        isVerified: true,
        kycStatus: 'VERIFIED'
      }
    };
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(creatorWithBank);
    const res = makeRes();
    await getCreatorDetails(makeReq({ params: { creatorId: 'cr1' } }), res);
    const bankData = (res.json as jest.Mock).mock.calls[0][0].data.bankAccount;
    expect(bankData.accountNumber).toBeNull();
    expect(bankData.panNumber).toBeNull();
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getCreatorDetails(makeReq({ params: { creatorId: 'bad' } }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('excludes bankAccount from creator object', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await getCreatorDetails(makeReq({ params: { creatorId: 'cr1' } }), res);
    const creator = (res.json as jest.Mock).mock.calls[0][0].data.creator;
    expect(creator.bankAccount).toBeUndefined();
  });
});

// =============================================
// updateCreator
// =============================================
describe('updateCreator', () => {
  it('updates creator with valid body', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { displayName: 'New Name' } }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('passes only provided fields to prisma', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { bio: 'My bio' } }),
      res
    );
    const dataArg = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(dataArg.bio).toBe('My bio');
    expect(dataArg.displayName).toBeUndefined();
  });

  it('converts pricePerMessage to number', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { pricePerMessage: '25' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.pricePerMessage).toBe(25);
  });

  it('sets verifiedAt when isVerified is true', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: 'true' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isVerified).toBe(true);
    expect(data.verifiedAt).toBeInstanceOf(Date);
  });

  it('sets verifiedAt to null when isVerified is false', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: false } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.verifiedAt).toBeNull();
  });

  it('handles allowNewConversations boolean string', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updateCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { allowNewConversations: 'false' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.allowNewConversations).toBe(false);
  });
});

// =============================================
// updateCreatorProfile
// =============================================
describe('updateCreatorProfile', () => {
  it('updates profile fields only', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await updateCreatorProfile(
      makeReq({
        params: { creatorId: 'cr1' },
        body: { displayName: 'Updated', category: 'Gaming', bio: 'A bio', tags: ['tag1'] }
      }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.displayName).toBe('Updated');
    expect(data.category).toBe('Gaming');
  });
});

// =============================================
// updateCreatorAIConfig
// =============================================
describe('updateCreatorAIConfig', () => {
  it('updates AI config fields', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await updateCreatorAIConfig(
      makeReq({
        params: { creatorId: 'cr1' },
        body: { aiPersonality: 'Funny', aiTone: 'casual', maxMessagesPerDay: 50 }
      }),
      res
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.aiPersonality).toBe('Funny');
    expect(data.maxMessagesPerDay).toBe(50);
  });

  it('parses allowNewConversations string value', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updateCreatorAIConfig(
      makeReq({ params: { creatorId: 'cr1' }, body: { allowNewConversations: 'true' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.allowNewConversations).toBe(true);
  });
});

// =============================================
// toggleCreatorVerification
// =============================================
describe('toggleCreatorVerification', () => {
  it('verifies creator when isVerified is true', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue({ ...mockCreator, isVerified: true });
    const res = makeRes();
    await toggleCreatorVerification(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: true } }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isVerified).toBe(true);
    expect(data.isRejected).toBe(false);
  });

  it('unverifies creator when isVerified is false', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue({ ...mockCreator, isVerified: false });
    await toggleCreatorVerification(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: false } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.verifiedAt).toBeNull();
    expect(data.isRejected).toBeUndefined();
  });

  it('throws 400 when isVerified is missing', async () => {
    await expect(
      toggleCreatorVerification(
        makeReq({ params: { creatorId: 'cr1' }, body: {} }),
        makeRes()
      )
    ).rejects.toThrow('isVerified is required');
  });

  it('accepts string "true" for isVerified', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await toggleCreatorVerification(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: 'true' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isVerified).toBe(true);
  });

  it('accepts boolean false for isVerified', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await toggleCreatorVerification(
      makeReq({ params: { creatorId: 'cr1' }, body: { isVerified: false } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isVerified).toBe(false);
  });
});

// =============================================
// verifyCreator
// =============================================
describe('verifyCreator', () => {
  it('verifies creator and clears rejection fields', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await verifyCreator(makeReq({ params: { creatorId: 'cr1' } }), res);
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isVerified).toBe(true);
    expect(data.isRejected).toBe(false);
    expect(data.rejectedAt).toBeNull();
    expect(data.rejectionReason).toBeNull();
  });

  it('returns success response', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await verifyCreator(makeReq({ params: { creatorId: 'cr1' } }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });
});

// =============================================
// toggleCreatorStatus
// =============================================
describe('toggleCreatorStatus', () => {
  it('enables creator via isEnabled', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue({ ...mockCreator, isActive: true });
    const res = makeRes();
    await toggleCreatorStatus(
      makeReq({ params: { creatorId: 'cr1' }, body: { isEnabled: true } }),
      res
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
  });

  it('disables creator via isActive', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue({ ...mockCreator, isActive: false });
    await toggleCreatorStatus(
      makeReq({ params: { creatorId: 'cr1' }, body: { isActive: false } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isActive).toBe(false);
  });

  it('throws 400 when neither isEnabled nor isActive provided', async () => {
    await expect(
      toggleCreatorStatus(
        makeReq({ params: { creatorId: 'cr1' }, body: {} }),
        makeRes()
      )
    ).rejects.toThrow('isEnabled or isActive is required');
  });

  it('prefers isEnabled when both are provided', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await toggleCreatorStatus(
      makeReq({ params: { creatorId: 'cr1' }, body: { isEnabled: true, isActive: false } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
  });

  it('accepts string "false" for isEnabled', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await toggleCreatorStatus(
      makeReq({ params: { creatorId: 'cr1' }, body: { isEnabled: 'false' } }),
      makeRes()
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isActive).toBe(false);
  });
});

// =============================================
// rejectCreator
// =============================================
describe('rejectCreator', () => {
  it('rejects creator with reason', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await rejectCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: { reason: 'Incomplete profile' } }),
      res
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.isActive).toBe(false);
    expect(data.isVerified).toBe(false);
    expect(data.isRejected).toBe(true);
    expect(data.rejectionReason).toBe('Incomplete profile');
  });

  it('rejects creator without reason (defaults to null)', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await rejectCreator(
      makeReq({ params: { creatorId: 'cr1' }, body: {} }),
      res
    );
    const data = (prisma.creator.update as jest.Mock).mock.calls[0][0].data;
    expect(data.rejectionReason).toBeNull();
  });

  it('returns success with message', async () => {
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await rejectCreator(makeReq({ params: { creatorId: 'cr1' } }), res);
    const resp = (res.json as jest.Mock).mock.calls[0][0];
    expect(resp.success).toBe(true);
    expect(resp.message).toBe('Creator application rejected');
  });
});

// =============================================
// getCreatorAnalytics
// =============================================
describe('getCreatorAnalytics', () => {
  const setupAnalyticsMocks = () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(10);
    (prisma.message.count as jest.Mock).mockResolvedValue(100);
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date('2024-01-01'), lastMessageAt: new Date('2024-01-02') }
    ]);
    (prisma.conversation.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'u1', _count: { id: 3 } }
    ]);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(5);
    (prisma.earningsLedger.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 500 } });
    (prisma.earningsLedger.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date('2024-01-01'), amount: 100 },
      { createdAt: new Date('2024-01-02'), amount: 200 }
    ]);
    (prisma.message.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date('2024-01-01') }
    ]);
    (prisma.message.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'u1', _count: { id: 5 } }
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'u1', name: 'User 1', email: 'u1@e.com' }
    ]);
    (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', title: 'Title', type: 'video', createdAt: new Date() }
    ]);
  };

  it('returns full analytics payload', async () => {
    setupAnalyticsMocks();
    const res = makeRes();
    await getCreatorAnalytics(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('engagement');
    expect(data.data).toHaveProperty('revenue');
    expect(data.data).toHaveProperty('trends');
    expect(data.data).toHaveProperty('topUsers');
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getCreatorAnalytics(makeReq({ params: { creatorId: 'bad' }, query: {} }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('computes avgMessagesPerConversation as 0 when no conversations', async () => {
    setupAnalyticsMocks();
    (prisma.conversation.count as jest.Mock).mockResolvedValue(0);
    const res = makeRes();
    await getCreatorAnalytics(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const engagement = (res.json as jest.Mock).mock.calls[0][0].data.engagement;
    expect(engagement.avgMessagesPerConversation).toBe(0);
  });

  it('handles empty earnings correctly', async () => {
    setupAnalyticsMocks();
    (prisma.earningsLedger.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });
    const res = makeRes();
    await getCreatorAnalytics(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.revenue.totalEarnings).toBe(0);
  });

  it('accepts various timeframe values', async () => {
    setupAnalyticsMocks();
    for (const tf of ['7d', 'month', '90d', 'year', '14d', '3m']) {
      jest.clearAllMocks();
      setupAnalyticsMocks();
      const res = makeRes();
      await getCreatorAnalytics(
        makeReq({ params: { creatorId: 'cr1' }, query: { timeframe: tf } }),
        res
      );
      expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
    }
  });

  it('computes repeatUserRate as 0 when uniqueUsers is 0', async () => {
    setupAnalyticsMocks();
    (prisma.conversation.groupBy as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getCreatorAnalytics(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.engagement.retentionRate).toBe(0);
  });
});

// =============================================
// getCreatorSubscribers
// =============================================
describe('getCreatorSubscribers', () => {
  const setupSubscriberMocks = () => {
    (prisma.follow.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { followerId: 'f1', createdAt: new Date(), follower: { id: 'f1', name: 'Fan', email: 'fan@e.com' } }
      ])
      .mockResolvedValueOnce([{ followerId: 'f1' }]);
    (prisma.follow.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        { userId: 'f1', _count: { id: 2 }, _max: { createdAt: new Date() } }
      ])
      .mockResolvedValueOnce([]);
  };

  it('returns subscriber stats', async () => {
    setupSubscriberMocks();
    const res = makeRes();
    await getCreatorSubscribers(
      makeReq({ params: { creatorId: 'cr1' }, query: {} }),
      res
    );
    const data = (res.json as jest.Mock).mock.calls[0][0];
    expect(data.success).toBe(true);
    expect(data.data.stats).toHaveProperty('totalFollowers');
    expect(data.data.subscribers).toHaveLength(1);
  });

  it('filters subscribers by status=active', async () => {
    setupSubscriberMocks();
    const res = makeRes();
    await getCreatorSubscribers(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'active' } }),
      res
    );
    // only active subscribers should remain (the one with recent message)
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('filters subscribers by status=inactive', async () => {
    (prisma.follow.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { followerId: 'f1', createdAt: new Date(), follower: { id: 'f1', name: 'Fan', email: 'fan@e.com' } }
      ])
      .mockResolvedValueOnce([{ followerId: 'f1' }]);
    (prisma.follow.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        { userId: 'f1', _count: { id: 2 }, _max: { createdAt: new Date('2020-01-01') } }
      ])
      .mockResolvedValueOnce([]);
    const res = makeRes();
    await getCreatorSubscribers(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'inactive' } }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('applies search filter', async () => {
    setupSubscriberMocks();
    await getCreatorSubscribers(
      makeReq({ params: { creatorId: 'cr1' }, query: { search: 'fan' } }),
      makeRes()
    );
    const whereArg = (prisma.follow.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.follower).toBeDefined();
  });

  it('returns empty subscribers when no followers', async () => {
    (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.follow.count as jest.Mock).mockResolvedValue(0);
    (prisma.message.groupBy as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getCreatorSubscribers(
      makeReq({ params: { creatorId: 'cr1' }, query: {} }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].data.subscribers).toHaveLength(0);
  });
});

// =============================================
// getCreatorRevenue
// =============================================
describe('getCreatorRevenue', () => {
  const setupRevenueMocks = () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      availableBalance: 800,
      pendingBalance: 100
    });
    (prisma.earningsLedger.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 1000 } });
    (prisma.earningsLedger.findMany as jest.Mock).mockResolvedValue([
      { createdAt: new Date('2024-01-01'), amount: 500 },
      { createdAt: new Date('2024-01-01'), amount: 200 }
    ]);
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', createdAt: new Date(), amount: 800, status: 'COMPLETED', netAmount: 780 }
    ]);
  };

  it('returns revenue summary', async () => {
    setupRevenueMocks();
    const res = makeRes();
    await getCreatorRevenue(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.summary.grossRevenue).toBe(1000);
    expect(data.summary.platformFee).toBe(200);
    expect(data.summary.creatorShare).toBe(800);
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getCreatorRevenue(makeReq({ params: { creatorId: 'bad' }, query: {} }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('returns PAID payoutStatus when latest payout is COMPLETED', async () => {
    setupRevenueMocks();
    const res = makeRes();
    await getCreatorRevenue(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.summary.payoutStatus).toBe('PAID');
  });

  it('returns NONE when no payouts', async () => {
    setupRevenueMocks();
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getCreatorRevenue(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.summary.payoutStatus).toBe('NONE');
  });

  it('returns payout status from non-completed payout', async () => {
    setupRevenueMocks();
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', createdAt: new Date(), amount: 800, status: 'PENDING', netAmount: 800 }
    ]);
    const res = makeRes();
    await getCreatorRevenue(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.summary.payoutStatus).toBe('PENDING');
  });

  it('handles null earnings', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.earningsLedger.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });
    (prisma.earningsLedger.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payout.findMany as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getCreatorRevenue(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data.summary.grossRevenue).toBe(0);
  });
});

// =============================================
// getPayoutConfig
// =============================================
describe('getPayoutConfig', () => {
  it('returns payout config without bank account', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await getPayoutConfig(makeReq({ params: { creatorId: 'cr1' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.bankDetails).toBeNull();
  });

  it('masks bank account number in payout config', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      bankAccount: {
        accountHolderName: 'Test',
        accountNumber: '123456789',
        bankName: 'SBI',
        ifscCode: 'SBIN001',
        isVerified: true,
        kycStatus: 'VERIFIED'
      }
    });
    const res = makeRes();
    await getPayoutConfig(makeReq({ params: { creatorId: 'cr1' } }), res);
    const bankDetails = (res.json as jest.Mock).mock.calls[0][0].data.bankDetails;
    expect(bankDetails.accountNumber).toMatch(/\*/);
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getPayoutConfig(makeReq({ params: { creatorId: 'bad' } }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('returns null accountNumber in bankAccount when it is null', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      bankAccount: {
        accountHolderName: 'Test',
        accountNumber: null,
        bankName: 'SBI',
        ifscCode: 'SBIN001',
        isVerified: true,
        kycStatus: 'VERIFIED'
      }
    });
    const res = makeRes();
    await getPayoutConfig(makeReq({ params: { creatorId: 'cr1' } }), res);
    const bankDetails = (res.json as jest.Mock).mock.calls[0][0].data.bankDetails;
    expect(bankDetails.accountNumber).toBeNull();
  });
});

// =============================================
// updatePayoutConfig
// =============================================
describe('updatePayoutConfig', () => {
  it('updates payout schedule and minimum payout', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    const res = makeRes();
    await updatePayoutConfig(
      makeReq({ params: { creatorId: 'cr1' }, body: { schedule: 'monthly', minimumPayout: 1000 } }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      updatePayoutConfig(makeReq({ params: { creatorId: 'bad' }, body: {} }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('upserts bank account when paymentMethod is BANK_TRANSFER with complete bankDetails', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.bankAccount.upsert as jest.Mock).mockResolvedValue({});
    const res = makeRes();
    await updatePayoutConfig(
      makeReq({
        params: { creatorId: 'cr1' },
        body: {
          paymentMethod: 'BANK_TRANSFER',
          bankDetails: {
            accountHolderName: 'John',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI'
          }
        }
      }),
      res
    );
    expect(prisma.bankAccount.upsert).toHaveBeenCalled();
  });

  it('throws 400 when bank details incomplete for BANK_TRANSFER', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await expect(
      updatePayoutConfig(
        makeReq({
          params: { creatorId: 'cr1' },
          body: {
            paymentMethod: 'BANK_TRANSFER',
            bankDetails: { accountHolderName: 'John' } // missing fields
          }
        }),
        makeRes()
      )
    ).rejects.toThrow('Bank details are incomplete');
  });

  it('does not upsert bank account for non-BANK_TRANSFER method', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    await updatePayoutConfig(
      makeReq({ params: { creatorId: 'cr1' }, body: { paymentMethod: 'UPI' } }),
      makeRes()
    );
    expect(prisma.bankAccount.upsert).not.toHaveBeenCalled();
  });

  it('uses accountName as fallback for accountHolderName', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.creator.update as jest.Mock).mockResolvedValue(mockCreator);
    (prisma.bankAccount.upsert as jest.Mock).mockResolvedValue({});
    await updatePayoutConfig(
      makeReq({
        params: { creatorId: 'cr1' },
        body: {
          paymentMethod: 'BANK_TRANSFER',
          bankDetails: {
            accountName: 'John',
            accountNumber: '1234567890',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI'
          }
        }
      }),
      makeRes()
    );
    const upsertArgs = (prisma.bankAccount.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArgs.create.accountHolderName).toBe('John');
  });
});

// =============================================
// processManualPayout
// =============================================
describe('processManualPayout', () => {
  const setupPayoutMocks = () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      availableBalance: 2000,
      bankAccount: { id: 'ba1', isVerified: true }
    });
    (getEarningsBreakdown as jest.Mock).mockResolvedValue({
      subscriptionEarnings: 1000,
      brandDealEarnings: 500
    });
    (prisma.payout.create as jest.Mock).mockResolvedValue({ id: 'payout1' });
    (createPayoutEntry as jest.Mock).mockResolvedValue({});
    (completePayoutEntry as jest.Mock).mockResolvedValue({});
    (prisma.payout.update as jest.Mock).mockResolvedValue({ id: 'payout1', status: 'COMPLETED' });
  };

  it('processes payout successfully', async () => {
    setupPayoutMocks();
    const res = makeRes();
    await processManualPayout(
      makeReq({ params: { creatorId: 'cr1' }, body: { amount: 500, notes: 'Test payout' } }),
      res
    );
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('throws 400 when amount is missing', async () => {
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'cr1' }, body: {} }), makeRes())
    ).rejects.toThrow('Amount is required');
  });

  it('throws 400 when amount is zero', async () => {
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'cr1' }, body: { amount: 0 } }), makeRes())
    ).rejects.toThrow('Amount is required');
  });

  it('throws 400 when amount is negative', async () => {
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'cr1' }, body: { amount: -100 } }), makeRes())
    ).rejects.toThrow('Amount is required');
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'bad' }, body: { amount: 100 } }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('throws 400 when creator has no bank account', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      availableBalance: 2000,
      bankAccount: null
    });
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'cr1' }, body: { amount: 100 } }), makeRes())
    ).rejects.toThrow('Creator has no bank account on file');
  });

  it('throws 400 when insufficient balance', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      ...mockCreator,
      availableBalance: 50,
      bankAccount: { id: 'ba1' }
    });
    await expect(
      processManualPayout(makeReq({ params: { creatorId: 'cr1' }, body: { amount: 500 } }), makeRes())
    ).rejects.toThrow('Insufficient balance');
  });
});

// =============================================
// getCreatorConversations
// =============================================
describe('getCreatorConversations', () => {
  const setupConvoMocks = () => {
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'conv1',
        userId: 'u1',
        isActive: true,
        createdAt: new Date(),
        user: { id: 'u1', name: 'Fan', email: 'fan@e.com' },
        _count: { messages: 5 }
      }
    ]);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.groupBy as jest.Mock).mockResolvedValue([
      { conversationId: 'conv1', _count: { id: 2 } }
    ]);
  };

  it('returns conversations with stats', async () => {
    setupConvoMocks();
    const res = makeRes();
    await getCreatorConversations(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.stats).toHaveProperty('total');
    expect(data.conversations).toHaveLength(1);
  });

  it('applies active status filter', async () => {
    setupConvoMocks();
    await getCreatorConversations(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'active' } }),
      makeRes()
    );
    const whereArg = (prisma.conversation.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(true);
  });

  it('applies ended status filter', async () => {
    setupConvoMocks();
    await getCreatorConversations(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'ended' } }),
      makeRes()
    );
    const whereArg = (prisma.conversation.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(false);
  });

  it('applies flagged status filter', async () => {
    setupConvoMocks();
    await getCreatorConversations(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'flagged' } }),
      makeRes()
    );
    const whereArg = (prisma.conversation.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.messages).toBeDefined();
  });

  it('marks conversation as flagged when in flagged map', async () => {
    setupConvoMocks();
    const res = makeRes();
    await getCreatorConversations(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const conv = (res.json as jest.Mock).mock.calls[0][0].data.conversations[0];
    expect(conv.isFlagged).toBe(true);
  });

  it('shows Guest for null user', async () => {
    (prisma.conversation.findMany as jest.Mock).mockResolvedValue([
      { id: 'conv1', userId: null, isActive: false, createdAt: new Date(), user: null, _count: { messages: 0 } }
    ]);
    (prisma.conversation.count as jest.Mock).mockResolvedValue(1);
    (prisma.message.groupBy as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getCreatorConversations(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const conv = (res.json as jest.Mock).mock.calls[0][0].data.conversations[0];
    expect(conv.userName).toBe('Guest');
  });
});

// =============================================
// getConversationDetails
// =============================================
describe('getConversationDetails', () => {
  it('returns conversation with messages', async () => {
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: 'conv1',
      user: { id: 'u1', name: 'Fan', email: 'fan@e.com' },
      creator: { id: 'cr1', displayName: 'Creator' },
      messages: [{ id: 'm1', content: 'Hello', createdAt: new Date() }],
      createdAt: new Date(),
      lastMessageAt: new Date(),
      isActive: true
    });
    const res = makeRes();
    await getConversationDetails(makeReq({ params: { conversationId: 'conv1' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.conversation.id).toBe('conv1');
    expect(data.messages).toHaveLength(1);
  });

  it('throws 404 when conversation not found', async () => {
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getConversationDetails(makeReq({ params: { conversationId: 'bad' } }), makeRes())
    ).rejects.toThrow('Conversation not found');
  });
});

// =============================================
// testCreatorAI
// =============================================
describe('testCreatorAI', () => {
  it('throws 400 when message is empty', async () => {
    await expect(
      testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: { message: '' } }), makeRes())
    ).rejects.toThrow('Message is required');
  });

  it('throws 400 when message is whitespace', async () => {
    await expect(
      testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: { message: '   ' } }), makeRes())
    ).rejects.toThrow('Message is required');
  });

  it('throws 400 when message is missing', async () => {
    await expect(
      testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: {} }), makeRes())
    ).rejects.toThrow('Message is required');
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      testCreatorAI(makeReq({ params: { creatorId: 'bad' }, body: { message: 'Hello' } }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('returns disabled message when OpenAI is not configured', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (isOpenAIConfigured as jest.Mock).mockReturnValue(false);
    const res = makeRes();
    await testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: { message: 'Hello' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.message).toContain('disabled');
  });

  it('returns AI response when OpenAI is configured', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (isOpenAIConfigured as jest.Mock).mockReturnValue(true);
    (buildEnhancedContext as jest.Mock).mockResolvedValue({
      relevantChunks: [{ text: 'chunk1', source: 'doc', score: 0.9, metadata: { contentType: 'article' } }],
      conversationSummary: null
    });
    (generateCreatorResponse as jest.Mock).mockResolvedValue({
      content: 'Hello there!',
      tokensUsed: 100,
      qualityScore: 0.95,
      citations: []
    });
    const res = makeRes();
    await testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: { message: 'Hello', tone: 'friendly' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.message).toBe('Hello there!');
    expect(data.metadata.tokensUsed).toBe(100);
  });

  it('includes contentSources from relevantChunks', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(mockCreator);
    (isOpenAIConfigured as jest.Mock).mockReturnValue(true);
    (buildEnhancedContext as jest.Mock).mockResolvedValue({
      relevantChunks: [{ text: 'chunk1', source: null, score: 0.8, metadata: null }],
      conversationSummary: 'summary'
    });
    (generateCreatorResponse as jest.Mock).mockResolvedValue({
      content: 'Response',
      tokensUsed: 50,
      qualityScore: null,
      citations: ['cite1']
    });
    const res = makeRes();
    await testCreatorAI(makeReq({ params: { creatorId: 'cr1' }, body: { message: 'Hi' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.metadata.contentSources[0].title).toBe('Content');
    expect(data.metadata.contentSources[0].type).toBeNull();
    expect(data.metadata.relevanceScore).toBe(0);
  });
});

// =============================================
// getPricingConfig
// =============================================
describe('getPricingConfig', () => {
  it('returns pricing config for creator', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({
      id: 'cr1',
      pricePerMessage: 10,
      firstMessageFree: false,
      discountFirstFive: 0,
      updatedAt: new Date()
    });
    const res = makeRes();
    await getPricingConfig(makeReq({ params: { creatorId: 'cr1' } }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.pricePerMessage).toBe(10);
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      getPricingConfig(makeReq({ params: { creatorId: 'bad' } }), makeRes())
    ).rejects.toThrow('Creator not found');
  });
});

// =============================================
// updatePricingConfig
// =============================================
describe('updatePricingConfig', () => {
  const updatedCreator = { ...mockCreator, pricePerMessage: 20, firstMessageFree: true, discountFirstFive: 0.1 };

  it('updates pricing and records history', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1' });
    (prisma.creator.update as jest.Mock).mockResolvedValue(updatedCreator);
    (prisma.pricingHistory.create as jest.Mock).mockResolvedValue({});
    const res = makeRes();
    await updatePricingConfig(
      makeReq({ params: { creatorId: 'cr1' }, body: { pricePerMessage: 20, firstMessageFree: true, discountFirstFive: 0.1 } }),
      res
    );
    expect(prisma.pricingHistory.create).toHaveBeenCalled();
    expect((res.json as jest.Mock).mock.calls[0][0].success).toBe(true);
  });

  it('throws 404 when creator not found', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      updatePricingConfig(makeReq({ params: { creatorId: 'bad' }, body: {} }), makeRes())
    ).rejects.toThrow('Creator not found');
  });

  it('throws 400 when discountFirstFive is negative', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1' });
    await expect(
      updatePricingConfig(
        makeReq({ params: { creatorId: 'cr1' }, body: { discountFirstFive: -0.5 } }),
        makeRes()
      )
    ).rejects.toThrow('discountFirstFive must be between 0 and 1');
  });

  it('throws 400 when discountFirstFive exceeds 1', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1' });
    await expect(
      updatePricingConfig(
        makeReq({ params: { creatorId: 'cr1' }, body: { discountFirstFive: 1.5 } }),
        makeRes()
      )
    ).rejects.toThrow('discountFirstFive must be between 0 and 1');
  });

  it('records history with system as changedBy when no user', async () => {
    (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1' });
    (prisma.creator.update as jest.Mock).mockResolvedValue(updatedCreator);
    (prisma.pricingHistory.create as jest.Mock).mockResolvedValue({});
    await updatePricingConfig(
      makeReq({ params: { creatorId: 'cr1' }, body: { pricePerMessage: 15 }, user: undefined }),
      makeRes()
    );
    const histArgs = (prisma.pricingHistory.create as jest.Mock).mock.calls[0][0].data;
    expect(histArgs.changedBy).toBe('system');
  });
});

// =============================================
// getPricingHistory
// =============================================
describe('getPricingHistory', () => {
  it('returns pricing history', async () => {
    (prisma.pricingHistory.findMany as jest.Mock).mockResolvedValue([
      { id: 'ph1', pricePerMessage: 10, createdAt: new Date() }
    ]);
    const res = makeRes();
    await getPricingHistory(makeReq({ params: { creatorId: 'cr1' } }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data).toHaveLength(1);
  });

  it('returns empty history when none exists', async () => {
    (prisma.pricingHistory.findMany as jest.Mock).mockResolvedValue([]);
    const res = makeRes();
    await getPricingHistory(makeReq({ params: { creatorId: 'cr1' } }), res);
    expect((res.json as jest.Mock).mock.calls[0][0].data).toHaveLength(0);
  });
});

// =============================================
// getCreatorContent
// =============================================
describe('getCreatorContent', () => {
  it('returns paginated content', async () => {
    (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', title: 'Video', type: 'video', createdAt: new Date() }
    ]);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(1);
    const res = makeRes();
    await getCreatorContent(makeReq({ params: { creatorId: 'cr1' }, query: {} }), res);
    const data = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(data.contents).toHaveLength(1);
    expect(data.pagination.total).toBe(1);
  });

  it('applies status filter when provided', async () => {
    (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.creatorContent.count as jest.Mock).mockResolvedValue(0);
    await getCreatorContent(
      makeReq({ params: { creatorId: 'cr1' }, query: { status: 'PUBLISHED' } }),
      makeRes()
    );
    const whereArg = (prisma.creatorContent.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.status).toBe('PUBLISHED');
  });
});

// =============================================
// deleteCreatorContent
// =============================================
describe('deleteCreatorContent', () => {
  it('deletes content successfully', async () => {
    (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({ id: 'c1', creatorId: 'cr1' });
    (prisma.creatorContent.delete as jest.Mock).mockResolvedValue({});
    const res = makeRes();
    await deleteCreatorContent(
      makeReq({ params: { creatorId: 'cr1', contentId: 'c1' } }),
      res
    );
    const resp = (res.json as jest.Mock).mock.calls[0][0];
    expect(resp.success).toBe(true);
    expect(resp.message).toBe('Content deleted');
  });

  it('throws 404 when content not found', async () => {
    (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      deleteCreatorContent(
        makeReq({ params: { creatorId: 'cr1', contentId: 'bad' } }),
        makeRes()
      )
    ).rejects.toThrow('Content not found');
  });
});
