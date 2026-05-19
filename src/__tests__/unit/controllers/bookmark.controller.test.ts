// ===========================================
// BOOKMARK CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    message: { findUnique: jest.fn(), findMany: jest.fn() },
    messageBookmark: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    conversation: { findMany: jest.fn() }
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

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  addBookmark,
  removeBookmark,
  getUserBookmarks,
  getBookmarkRecommendations
} from '../../../controllers/bookmark.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Bookmark Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // addBookmark
  // ============================================================
  describe('addBookmark', () => {
    it('should create a new bookmark and return 201', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { note: 'important' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageBookmark.create as jest.Mock).mockResolvedValue({
        id: 'bm-1', messageId: 'msg-1', userId: 'user-1', note: 'important'
      });

      await addBookmark(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when message not found', async () => {
      const req = mockReq({ params: { messageId: 'bad' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(addBookmark(req, res)).rejects.toThrow('Message not found');
    });

    it('should throw 403 when user does not own conversation', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'other-user' }
      });

      await expect(addBookmark(req, res)).rejects.toThrow('Access denied');
    });

    it('should update an existing bookmark note instead of creating a duplicate', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { note: 'updated note' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({
        id: 'bm-1', messageId: 'msg-1'
      });
      (prisma.messageBookmark.update as jest.Mock).mockResolvedValue({
        id: 'bm-1', note: 'updated note'
      });

      await addBookmark(req, res);

      expect(prisma.messageBookmark.create).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Bookmark updated' })
      );
    });

    it('should allow bookmark when conversation has no userId (public convo)', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: null }
      });
      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageBookmark.create as jest.Mock).mockResolvedValue({ id: 'bm-1' });

      await addBookmark(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create bookmark with null note when note not provided', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: {} });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageBookmark.create as jest.Mock).mockResolvedValue({ id: 'bm-1', note: null });

      await addBookmark(req, res);

      const createCall = (prisma.messageBookmark.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.note).toBeNull();
    });

    it('should update note to null when updating existing bookmark without note', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: {} });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({ id: 'bm-1' });
      (prisma.messageBookmark.update as jest.Mock).mockResolvedValue({ id: 'bm-1', note: null });

      await addBookmark(req, res);

      const updateCall = (prisma.messageBookmark.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.note).toBeNull();
    });
  });

  // ============================================================
  // removeBookmark
  // ============================================================
  describe('removeBookmark', () => {
    it('should remove bookmark successfully', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({ id: 'bm-1' });
      (prisma.messageBookmark.delete as jest.Mock).mockResolvedValue({});

      await removeBookmark(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Bookmark removed' })
      );
    });

    it('should throw 404 when bookmark not found', async () => {
      const req = mockReq({ params: { messageId: 'msg-x' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(removeBookmark(req, res)).rejects.toThrow('Bookmark not found');
    });

    it('should call prisma.messageBookmark.delete with the bookmark id', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({ id: 'bm-99' });
      (prisma.messageBookmark.delete as jest.Mock).mockResolvedValue({});

      await removeBookmark(req, res);

      expect(prisma.messageBookmark.delete).toHaveBeenCalledWith({ where: { id: 'bm-99' } });
    });

    it('should look up bookmark by messageId and userId composite key', async () => {
      const req = mockReq({ params: { messageId: 'msg-7' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({ id: 'bm-1' });
      (prisma.messageBookmark.delete as jest.Mock).mockResolvedValue({});

      await removeBookmark(req, res);

      expect(prisma.messageBookmark.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { messageId_userId: { messageId: 'msg-7', userId: 'user-1' } }
        })
      );
    });

    it('should not call delete when bookmark does not exist', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(removeBookmark(req, res)).rejects.toThrow();
      expect(prisma.messageBookmark.delete).not.toHaveBeenCalled();
    });

    it('should return success:true on removal', async () => {
      const req = mockReq({ params: { messageId: 'msg-2' } });
      const res = mockRes();

      (prisma.messageBookmark.findUnique as jest.Mock).mockResolvedValue({ id: 'bm-2' });
      (prisma.messageBookmark.delete as jest.Mock).mockResolvedValue({});

      await removeBookmark(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });
  });

  // ============================================================
  // getUserBookmarks
  // ============================================================
  describe('getUserBookmarks', () => {
    it('should return paginated bookmarks with metadata', async () => {
      const req = mockReq({ query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          bookmarks: [],
          pagination: expect.any(Object)
        })
      }));
    });

    it('should filter by conversationId when provided', async () => {
      const req = mockReq({ query: { conversationId: 'conv-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      const findManyCall = (prisma.messageBookmark.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.message?.conversationId).toBe('conv-1');
    });

    it('should filter by creatorId when provided', async () => {
      const req = mockReq({ query: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      const findManyCall = (prisma.messageBookmark.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.message?.conversation?.creatorId).toBe('cr-1');
    });

    it('should apply date range filter when from and to are provided', async () => {
      const req = mockReq({ query: { from: '2024-01-01', to: '2024-12-31' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      const findManyCall = (prisma.messageBookmark.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.createdAt).toBeDefined();
      expect(findManyCall.where.createdAt.gte).toBeInstanceOf(Date);
      expect(findManyCall.where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('should include search filter in message content when search provided', async () => {
      const req = mockReq({ query: { search: 'hello' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      const findManyCall = (prisma.messageBookmark.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.message?.content?.contains).toBe('hello');
    });

    it('should return correct pagination totals', async () => {
      const req = mockReq({ query: { page: '3', limit: '5' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(25);

      await getUserBookmarks(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.total).toBe(25);
      expect(callArg.data.pagination.totalPages).toBe(5);
      expect(callArg.data.pagination.page).toBe(3);
    });

    it('should return filter metadata in response', async () => {
      const req = mockReq({ query: { creatorId: 'cr-5', search: 'hello' } });
      const res = mockRes();

      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.count as jest.Mock).mockResolvedValue(0);

      await getUserBookmarks(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.filters.creatorId).toBe('cr-5');
      expect(callArg.data.filters.search).toBe('hello');
    });
  });

  // ============================================================
  // getBookmarkRecommendations
  // ============================================================
  describe('getBookmarkRecommendations', () => {
    it('should return empty recommendations when no conversations', async () => {
      const req = mockReq({ query: { limit: '5' } });
      const res = mockRes();

      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getBookmarkRecommendations(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recommendations).toEqual([]);
    });

    it('should filter messages shorter than 200 chars', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1' }]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'm-1',
          content: 'Short msg',
          createdAt: new Date(),
          conversation: { id: 'c-1', creator: { id: 'cr-1', displayName: 'C', profileImage: null, category: 'Tech' } }
        }
      ]);

      await getBookmarkRecommendations(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recommendations).toHaveLength(0);
    });

    it('should include long messages (>200 chars) in recommendations', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      const longContent = 'A'.repeat(250);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1' }]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'm-1',
          content: longContent,
          createdAt: new Date(),
          conversation: { id: 'c-1', creator: { id: 'cr-1', displayName: 'C', profileImage: null, category: 'Tech' } }
        }
      ]);

      await getBookmarkRecommendations(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recommendations).toHaveLength(1);
      expect(callArg.data.recommendations[0].messageId).toBe('m-1');
    });

    it('should exclude already-bookmarked messages from recommendations', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      const longContent = 'B'.repeat(300);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1' }]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([{ messageId: 'm-1' }]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getBookmarkRecommendations(req, res);

      const findManyMsgCall = (prisma.message.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyMsgCall.where.id.notIn).toContain('m-1');
    });

    it('should truncate recommendation content to 200 chars with ellipsis', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      const longContent = 'C'.repeat(500);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1' }]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'm-1',
          content: longContent,
          createdAt: new Date(),
          conversation: { id: 'c-1', creator: { id: 'cr-1', displayName: 'C', profileImage: null, category: 'Tech' } }
        }
      ]);

      await getBookmarkRecommendations(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recommendations[0].content).toHaveLength(203); // 200 + '...'
    });

    it('should use default limit of 10 when no limit query param', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([]);

      await getBookmarkRecommendations(req, res);

      const findManyMsgCall = (prisma.message.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyMsgCall.take).toBe(20); // limit * 2 = 10 * 2
    });

    it('should add reason field to each recommendation', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      const longContent = 'D'.repeat(250);
      (prisma.conversation.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1' }]);
      (prisma.messageBookmark.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'm-2',
          content: longContent,
          createdAt: new Date(),
          conversation: { id: 'c-1', creator: { id: 'cr-1', displayName: 'C', profileImage: null, category: 'Tech' } }
        }
      ]);

      await getBookmarkRecommendations(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recommendations[0].reason).toBe('Detailed response worth saving');
    });
  });
});
