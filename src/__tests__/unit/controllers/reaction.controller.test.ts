// ===========================================
// REACTION CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    message: { findUnique: jest.fn() },
    messageReaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn()
    }
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
  addReaction,
  removeReaction,
  getMessageReactions
} from '../../../controllers/reaction.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Reaction Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // addReaction
  // ============================================================
  describe('addReaction', () => {
    it('should add a new reaction and return 201', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageReaction.create as jest.Mock).mockResolvedValue({
        id: 'r-1', emoji: '👍', user: { id: 'user-1', name: 'U', avatar: null }
      });

      await addReaction(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when emoji is missing', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: {} });
      const res = mockRes();

      await expect(addReaction(req, res)).rejects.toThrow('Emoji is required');
    });

    it('should throw 400 when emoji is not a string (number)', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: 123 } });
      const res = mockRes();

      await expect(addReaction(req, res)).rejects.toThrow('Emoji is required');
    });

    it('should throw 400 when emoji length exceeds 10 characters', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: 'a'.repeat(11) } });
      const res = mockRes();

      await expect(addReaction(req, res)).rejects.toThrow('Invalid emoji');
    });

    it('should throw 404 when message not found', async () => {
      const req = mockReq({ params: { messageId: 'bad' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(addReaction(req, res)).rejects.toThrow('Message not found');
    });

    it('should throw 403 when user does not own the conversation', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'other-user' }
      });

      await expect(addReaction(req, res)).rejects.toThrow('Access denied');
    });

    it('should return 200 with existing reaction when already reacted with same emoji', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '❤️' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'r-existing', emoji: '❤️', messageId: 'msg-1', userId: 'user-1'
      });

      await addReaction(req, res);

      expect(prisma.messageReaction.create).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Already reacted' })
      );
    });

    it('should allow reaction when conversation has no userId (public)', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '🎉' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: null }
      });
      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageReaction.create as jest.Mock).mockResolvedValue({
        id: 'r-1', emoji: '🎉', user: { id: 'user-1', name: 'U', avatar: null }
      });

      await addReaction(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create reaction with correct data', async () => {
      const req = mockReq({ params: { messageId: 'msg-5' }, body: { emoji: '😂' }, user: { id: 'user-3' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-5', conversation: { userId: 'user-3' }
      });
      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageReaction.create as jest.Mock).mockResolvedValue({ id: 'r-2', emoji: '😂', user: {} });

      await addReaction(req, res);

      const createCall = (prisma.messageReaction.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.messageId).toBe('msg-5');
      expect(createCall.data.userId).toBe('user-3');
      expect(createCall.data.emoji).toBe('😂');
    });

    it('should accept an emoji at exactly 10 characters (boundary)', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: 'a'.repeat(10) } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({
        id: 'msg-1', conversation: { userId: 'user-1' }
      });
      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.messageReaction.create as jest.Mock).mockResolvedValue({ id: 'r-1', emoji: 'aaaaaaaaaa', user: {} });

      await addReaction(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ============================================================
  // removeReaction
  // ============================================================
  describe('removeReaction', () => {
    it('should remove a reaction successfully', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r-1' });
      (prisma.messageReaction.delete as jest.Mock).mockResolvedValue({});

      await removeReaction(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Reaction removed' })
      );
    });

    it('should throw 400 when emoji is missing', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: {} });
      const res = mockRes();

      await expect(removeReaction(req, res)).rejects.toThrow('Emoji is required');
    });

    it('should throw 404 when reaction not found', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(removeReaction(req, res)).rejects.toThrow('Reaction not found');
    });

    it('should call messageReaction.delete with the reaction id', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '🔥' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r-99' });
      (prisma.messageReaction.delete as jest.Mock).mockResolvedValue({});

      await removeReaction(req, res);

      expect(prisma.messageReaction.delete).toHaveBeenCalledWith({ where: { id: 'r-99' } });
    });

    it('should look up reaction by messageId, userId, emoji composite key', async () => {
      const req = mockReq({ params: { messageId: 'msg-7' }, body: { emoji: '✅' }, user: { id: 'user-2' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r-1' });
      (prisma.messageReaction.delete as jest.Mock).mockResolvedValue({});

      await removeReaction(req, res);

      expect(prisma.messageReaction.findUnique).toHaveBeenCalledWith({
        where: { messageId_userId_emoji: { messageId: 'msg-7', userId: 'user-2', emoji: '✅' } }
      });
    });

    it('should not call delete when reaction does not exist', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👍' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(removeReaction(req, res)).rejects.toThrow();
      expect(prisma.messageReaction.delete).not.toHaveBeenCalled();
    });

    it('should return success: true on removal', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' }, body: { emoji: '👎' } });
      const res = mockRes();

      (prisma.messageReaction.findUnique as jest.Mock).mockResolvedValue({ id: 'r-2' });
      (prisma.messageReaction.delete as jest.Mock).mockResolvedValue({});

      await removeReaction(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });
  });

  // ============================================================
  // getMessageReactions
  // ============================================================
  describe('getMessageReactions', () => {
    it('should return empty grouped reactions when no reactions exist', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue([]);

      await getMessageReactions(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { reactions: {}, total: 0 } })
      );
    });

    it('should throw 404 when message not found', async () => {
      const req = mockReq({ params: { messageId: 'bad' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getMessageReactions(req, res)).rejects.toThrow('Message not found');
    });

    it('should group reactions by emoji', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue([
        { id: 'r-1', emoji: '👍', userId: 'u-1', createdAt: new Date(), user: { id: 'u-1', name: 'Alice', avatar: null } },
        { id: 'r-2', emoji: '👍', userId: 'u-2', createdAt: new Date(), user: { id: 'u-2', name: 'Bob', avatar: null } },
        { id: 'r-3', emoji: '❤️', userId: 'u-3', createdAt: new Date(), user: { id: 'u-3', name: 'Charlie', avatar: null } }
      ]);

      await getMessageReactions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.reactions['👍']).toHaveLength(2);
      expect(callArg.data.reactions['❤️']).toHaveLength(1);
    });

    it('should return total count of all reactions', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue([
        { id: 'r-1', emoji: '👍', userId: 'u-1', createdAt: new Date(), user: {} },
        { id: 'r-2', emoji: '❤️', userId: 'u-2', createdAt: new Date(), user: {} }
      ]);

      await getMessageReactions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.total).toBe(2);
    });

    it('should include userId and user info in each grouped reaction entry', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      const createdAt = new Date();
      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue([
        { id: 'r-1', emoji: '🎉', userId: 'u-5', createdAt, user: { id: 'u-5', name: 'Dave', avatar: null } }
      ]);

      await getMessageReactions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      const entry = callArg.data.reactions['🎉'][0];
      expect(entry.userId).toBe('u-5');
      expect(entry.user.name).toBe('Dave');
      expect(entry.id).toBe('r-1');
    });

    it('should query reactions by messageId', async () => {
      const req = mockReq({ params: { messageId: 'msg-42' } });
      const res = mockRes();

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-42' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue([]);

      await getMessageReactions(req, res);

      expect(prisma.messageReaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { messageId: 'msg-42' } })
      );
    });

    it('should handle multiple different emoji types correctly', async () => {
      const req = mockReq({ params: { messageId: 'msg-1' } });
      const res = mockRes();

      const emojis = ['👍', '❤️', '😂', '🔥', '🎉'];
      const reactions = emojis.map((emoji, i) => ({
        id: `r-${i}`, emoji, userId: `u-${i}`, createdAt: new Date(), user: { id: `u-${i}`, name: `User${i}`, avatar: null }
      }));

      (prisma.message.findUnique as jest.Mock).mockResolvedValue({ id: 'msg-1' });
      (prisma.messageReaction.findMany as jest.Mock).mockResolvedValue(reactions);

      await getMessageReactions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(Object.keys(callArg.data.reactions)).toHaveLength(5);
      expect(callArg.data.total).toBe(5);
    });
  });
});
