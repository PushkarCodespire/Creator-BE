// ===========================================
// QUERY OPTIMIZER UNIT TESTS
// ===========================================

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    conversation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    message: {
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    contentChunk: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import prisma from '../../../prisma/client';
import {
  getCreatorsOptimized,
  getConversationWithMessagesOptimized,
  getUserConversationsBatch,
  getCreatorAnalyticsOptimized,
  searchContentOptimized,
} from '../../utils/queryOptimizer';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Query Optimizer Utils - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCreatorsOptimized', () => {
    it('should fetch paginated creators with default parameters', async () => {
      const mockCreators = [
        { id: '1', displayName: 'Creator 1', isVerified: true },
        { id: '2', displayName: 'Creator 2', isVerified: false },
      ];
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue(mockCreators);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(2);

      const result = await getCreatorsOptimized({});

      expect(result.creators).toEqual(mockCreators);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 12,
        total: 2,
        totalPages: 1,
      });
    });

    it('should apply category filter', async () => {
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreatorsOptimized({ category: 'tech' });

      expect(mockPrisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'tech' }),
        })
      );
    });

    it('should apply search filter with OR conditions', async () => {
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreatorsOptimized({ search: 'gaming' });

      expect(mockPrisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ displayName: expect.objectContaining({ contains: 'gaming' }) }),
            ]),
          }),
        })
      );
    });

    it('should apply verified filter', async () => {
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreatorsOptimized({ verified: true });

      expect(mockPrisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isVerified: true }),
        })
      );
    });

    it('should calculate correct pagination', async () => {
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(50);

      const result = await getCreatorsOptimized({ page: 3, limit: 10 });

      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 50,
        totalPages: 5,
      });
      expect(mockPrisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        })
      );
    });

    it('should always filter for active creators', async () => {
      (mockPrisma.creator.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.creator.count as jest.Mock).mockResolvedValue(0);

      await getCreatorsOptimized({});

      expect(mockPrisma.creator.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        })
      );
    });
  });

  describe('getConversationWithMessagesOptimized', () => {
    it('should fetch conversation with creator and messages', async () => {
      const mockConversation = {
        id: 'conv-1',
        creator: { id: 'c1', displayName: 'Creator' },
        messages: [{ id: 'm1', content: 'Hello' }],
      };
      (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue(mockConversation);

      const result = await getConversationWithMessagesOptimized('conv-1');

      expect(result).toEqual(mockConversation);
      expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          include: expect.objectContaining({
            creator: expect.any(Object),
            messages: expect.any(Object),
          }),
        })
      );
    });

    it('should return null for non-existent conversation', async () => {
      (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getConversationWithMessagesOptimized('nonexistent');

      expect(result).toBeNull();
    });

    it('should limit messages to 50', async () => {
      (mockPrisma.conversation.findUnique as jest.Mock).mockResolvedValue({});

      await getConversationWithMessagesOptimized('conv-1');

      expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            messages: expect.objectContaining({ take: 50 }),
          }),
        })
      );
    });
  });

  describe('getUserConversationsBatch', () => {
    it('should fetch user conversations with last message', async () => {
      const mockConversations = [
        { id: 'conv-1', creator: { displayName: 'C1' }, messages: [{ content: 'Hi' }] },
      ];
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue(mockConversations);

      const result = await getUserConversationsBatch('user-1');

      expect(result).toEqual(mockConversations);
      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          take: 10,
        })
      );
    });

    it('should respect custom limit', async () => {
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getUserConversationsBatch('user-1', 5);

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it('should order by lastMessageAt descending', async () => {
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getUserConversationsBatch('user-1');

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastMessageAt: 'desc' },
        })
      );
    });

    it('should include only last message per conversation', async () => {
      (mockPrisma.conversation.findMany as jest.Mock).mockResolvedValue([]);

      await getUserConversationsBatch('user-1');

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            messages: expect.objectContaining({ take: 1 }),
          }),
        })
      );
    });
  });

  describe('getCreatorAnalyticsOptimized', () => {
    it('should return analytics overview and time series data', async () => {
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([10, 500, { _count: 150 }]);
      (mockPrisma.conversation.groupBy as jest.Mock).mockResolvedValue([
        { createdAt: new Date(), _count: 3 },
      ]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([
        { createdAt: new Date(), _count: 20 },
      ]);

      const result = await getCreatorAnalyticsOptimized('creator-1');

      expect(result.overview).toEqual({
        totalChats: 10,
        totalMessages: 500,
        messagesLast30Days: 150,
      });
      expect(result.chatsByDate).toHaveLength(1);
      expect(result.messagesByDate).toHaveLength(1);
    });

    it('should use custom days parameter', async () => {
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([0, 0, { _count: 0 }]);
      (mockPrisma.conversation.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([]);

      await getCreatorAnalyticsOptimized('creator-1', 7);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should handle empty analytics', async () => {
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([0, 0, { _count: 0 }]);
      (mockPrisma.conversation.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.message.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await getCreatorAnalyticsOptimized('creator-no-data');

      expect(result.overview.totalChats).toBe(0);
      expect(result.chatsByDate).toEqual([]);
      expect(result.messagesByDate).toEqual([]);
    });
  });

  describe('searchContentOptimized', () => {
    it('should return content chunks for creator', async () => {
      const mockChunks = [
        { id: 'chunk-1', text: 'Sample content', chunkIndex: 0 },
        { id: 'chunk-2', text: 'More content', chunkIndex: 1 },
      ];
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);

      const result = await searchContentOptimized('creator-1', 'sample');

      expect(result).toHaveLength(2);
    });

    it('should limit results based on limit parameter', async () => {
      const mockChunks = Array.from({ length: 10 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `Content ${i}`,
        chunkIndex: i,
      }));
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);

      const result = await searchContentOptimized('creator-1', 'test', 3);

      expect(result).toHaveLength(3);
    });

    it('should return empty array when no chunks found', async () => {
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

      const result = await searchContentOptimized('creator-1', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('should filter by completed content status', async () => {
      (mockPrisma.contentChunk.findMany as jest.Mock).mockResolvedValue([]);

      await searchContentOptimized('creator-1', 'query');

      expect(mockPrisma.contentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            content: expect.objectContaining({
              status: 'COMPLETED',
            }),
          }),
        })
      );
    });
  });
});
