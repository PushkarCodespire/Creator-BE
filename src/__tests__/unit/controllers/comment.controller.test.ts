// ===========================================
// COMMENT CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    post: { findUnique: jest.fn(), update: jest.fn() },
    comment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    creator: { findUnique: jest.fn() },
    notification: { create: jest.fn() }
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
  createComment,
  getComments,
  getReplies,
  updateComment,
  deleteComment,
  likeComment,
  unlikeComment
} from '../../../controllers/comment.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Comment Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // createComment
  // ============================================================
  describe('createComment', () => {
    it('should create a top-level comment and return 201', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: 'Great post!' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1', creatorId: 'cr-1' });
      (prisma.comment.create as jest.Mock).mockResolvedValue({
        id: 'c-1', content: 'Great post!', user: { id: 'user-1', name: 'U', avatar: null }, _count: { replies: 0 }
      });
      (prisma.post.update as jest.Mock).mockResolvedValue({});
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ userId: 'other-user' });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await createComment(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when content is empty string', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: '' } });
      const res = mockRes();

      await expect(createComment(req, res)).rejects.toThrow('Comment content is required');
    });

    it('should throw 400 when content is whitespace only', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: '   ' } });
      const res = mockRes();

      await expect(createComment(req, res)).rejects.toThrow('Comment content is required');
    });

    it('should throw 404 when post not found', async () => {
      const req = mockReq({ params: { postId: 'bad' }, body: { content: 'hi' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(createComment(req, res)).rejects.toThrow('Post not found');
    });

    it('should throw 404 when parent comment not found', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: 'reply', parentId: 'bad' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(createComment(req, res)).rejects.toThrow('Parent comment not found');
    });

    it('should throw 400 when parent comment belongs to a different post', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: 'reply', parentId: 'c-other' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-other', postId: 'post-2' });

      await expect(createComment(req, res)).rejects.toThrow('Parent comment does not belong to this post');
    });

    it('should increment post commentsCount after creating comment', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: 'Nice!' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1', creatorId: 'cr-1' });
      (prisma.comment.create as jest.Mock).mockResolvedValue({ id: 'c-1', content: 'Nice!', user: {}, _count: { replies: 0 } });
      (prisma.post.update as jest.Mock).mockResolvedValue({});
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-1' }); // same user, no notification
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await createComment(req, res);

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { commentsCount: { increment: 1 } }
      });
    });

    it('should not send notification when user comments on own post', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, body: { content: 'My comment' }, user: { id: 'creator-user' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1', creatorId: 'cr-1' });
      (prisma.comment.create as jest.Mock).mockResolvedValue({ id: 'c-1', content: 'My comment', user: {}, _count: { replies: 0 } });
      (prisma.post.update as jest.Mock).mockResolvedValue({});
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ userId: 'creator-user' });

      await createComment(req, res);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should create a reply with parentId', async () => {
      const req = mockReq({
        params: { postId: 'post-1' },
        body: { content: 'Reply!', parentId: 'c-parent' }
      });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1', creatorId: 'cr-1' });
      (prisma.comment.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'c-parent', postId: 'post-1' }) // parent check
        .mockResolvedValueOnce({ id: 'c-parent', userId: 'other-user' }); // reply notification check
      (prisma.comment.create as jest.Mock).mockResolvedValue({ id: 'c-reply', content: 'Reply!', user: {}, _count: { replies: 0 } });
      (prisma.post.update as jest.Mock).mockResolvedValue({});
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ userId: 'other-user' });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await createComment(req, res);

      const createCall = (prisma.comment.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.parentId).toBe('c-parent');
    });
  });

  // ============================================================
  // getComments
  // ============================================================
  describe('getComments', () => {
    it('should return paginated top-level comments', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getComments(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when post not found', async () => {
      const req = mockReq({ params: { postId: 'bad' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getComments(req, res)).rejects.toThrow('Post not found');
    });

    it('should sort by newest by default (createdAt desc)', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: {} });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getComments(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('should sort by oldest when sort=oldest', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: { sort: 'oldest' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getComments(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('should sort by likesCount when sort=popular', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: { sort: 'popular' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getComments(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ likesCount: 'desc' });
    });

    it('should only fetch top-level comments (parentId: null)', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: {} });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getComments(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.parentId).toBeNull();
    });

    it('should return pagination info including totalPages', async () => {
      const req = mockReq({ params: { postId: 'post-1' }, query: { page: '1', limit: '5' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'post-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(20);

      await getComments(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.totalPages).toBe(4);
    });
  });

  // ============================================================
  // getReplies
  // ============================================================
  describe('getReplies', () => {
    it('should return paginated replies for a comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, query: {} });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getReplies(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when parent comment not found', async () => {
      const req = mockReq({ params: { commentId: 'bad' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getReplies(req, res)).rejects.toThrow('Comment not found');
    });

    it('should fetch replies ordered by createdAt asc (chronological)', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, query: {} });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getReplies(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('should filter replies by parentId', async () => {
      const req = mockReq({ params: { commentId: 'c-99' }, query: {} });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-99' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getReplies(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.parentId).toBe('c-99');
    });

    it('should use default page=1 limit=10', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, query: {} });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);

      await getReplies(req, res);

      const findManyCall = (prisma.comment.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(10);
    });

    it('should return replies with user info', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, query: {} });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([
        { id: 'r-1', content: 'Reply text', user: { id: 'u-2', name: 'Bob', avatar: null }, _count: { replies: 0 } }
      ]);
      (prisma.comment.count as jest.Mock).mockResolvedValue(1);

      await getReplies(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.replies).toHaveLength(1);
    });
  });

  // ============================================================
  // updateComment
  // ============================================================
  describe('updateComment', () => {
    it('should update own comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: 'edited content' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', userId: 'user-1' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', content: 'edited content' });

      await updateComment(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 400 when content is empty', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: '' } });
      const res = mockRes();

      await expect(updateComment(req, res)).rejects.toThrow('Comment content is required');
    });

    it('should throw 400 when content is whitespace only', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: '   ' } });
      const res = mockRes();

      await expect(updateComment(req, res)).rejects.toThrow('Comment content is required');
    });

    it('should throw 404 when comment not found', async () => {
      const req = mockReq({ params: { commentId: 'bad' }, body: { content: 'x' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateComment(req, res)).rejects.toThrow('Comment not found');
    });

    it('should throw 403 when editing another user comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: 'edited' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', userId: 'other-user' });

      await expect(updateComment(req, res)).rejects.toThrow('You can only edit your own comments');
    });

    it('should trim content before saving', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: '  trimmed  ' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', userId: 'user-1' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', content: 'trimmed' });

      await updateComment(req, res);

      const updateCall = (prisma.comment.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.content).toBe('trimmed');
    });

    it('should not call update when user does not own comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, body: { content: 'hijack' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', userId: 'other-user' });

      await expect(updateComment(req, res)).rejects.toThrow();
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // deleteComment
  // ============================================================
  describe('deleteComment', () => {
    it('should delete own comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'c-1', userId: 'user-1', postId: 'p-1', _count: { replies: 0 } });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({});

      await deleteComment(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Comment deleted successfully' }));
    });

    it('should throw 404 when comment not found', async () => {
      const req = mockReq({ params: { commentId: 'bad' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteComment(req, res)).rejects.toThrow('Comment not found');
    });

    it('should throw 403 when deleting other user comment without ADMIN role', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({
        id: 'c-1', userId: 'other-user', _count: { replies: 0 }
      });

      await expect(deleteComment(req, res)).rejects.toThrow('You can only delete your own comments');
    });

    it('should allow ADMIN to delete any comment', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, user: { id: 'admin-1', role: 'ADMIN' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'c-1', userId: 'other-user', postId: 'p-1', _count: { replies: 0 } });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({});

      await deleteComment(req, res);

      expect(prisma.comment.delete).toHaveBeenCalled();
    });

    it('should decrement commentsCount by total number deleted (including replies)', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      // Parent comment (c-1) has 2 direct replies
      (prisma.comment.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'c-1', userId: 'user-1', postId: 'p-1', _count: { replies: 2 } });
      // countCommentsToDelete: replies of c-1
      (prisma.comment.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'r-1' }, { id: 'r-2' }]) // replies of c-1
        .mockResolvedValueOnce([]) // replies of r-1
        .mockResolvedValueOnce([]); // replies of r-2
      (prisma.comment.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({});

      await deleteComment(req, res);

      const updateCall = (prisma.post.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.commentsCount).toEqual({ decrement: 3 }); // 1 + 2
    });

    it('should not delete comment when user does not own it', async () => {
      const req = mockReq({ params: { commentId: 'c-1' }, user: { id: 'hacker' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({
        id: 'c-1', userId: 'user-1', _count: { replies: 0 }
      });

      await expect(deleteComment(req, res)).rejects.toThrow();
      expect(prisma.comment.delete).not.toHaveBeenCalled();
    });

    it('should call prisma.comment.delete with correct id', async () => {
      const req = mockReq({ params: { commentId: 'c-77' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'c-77', userId: 'user-1', postId: 'p-1', _count: { replies: 0 } });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.comment.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({});

      await deleteComment(req, res);

      expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'c-77' } });
    });
  });

  // ============================================================
  // likeComment
  // ============================================================
  describe('likeComment', () => {
    it('should increment comment likesCount', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 1 });

      await likeComment(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { likesCount: 1 } })
      );
    });

    it('should throw 404 when comment not found', async () => {
      const req = mockReq({ params: { commentId: 'bad' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(likeComment(req, res)).rejects.toThrow('Comment not found');
    });

    it('should call prisma.comment.update with increment', async () => {
      const req = mockReq({ params: { commentId: 'c-2' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-2' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-2', likesCount: 5 });

      await likeComment(req, res);

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'c-2' },
        data: { likesCount: { increment: 1 } }
      });
    });

    it('should return the new likesCount in response', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 42 });

      await likeComment(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.likesCount).toBe(42);
    });

    it('should return success: true', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 1 });

      await likeComment(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });

    it('should not call update if comment does not exist', async () => {
      const req = mockReq({ params: { commentId: 'ghost' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(likeComment(req, res)).rejects.toThrow();
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // unlikeComment
  // ============================================================
  describe('unlikeComment', () => {
    it('should decrement comment likesCount', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 1 });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 0 });

      await unlikeComment(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { likesCount: 0 } })
      );
    });

    it('should throw 404 when comment not found', async () => {
      const req = mockReq({ params: { commentId: 'bad' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(unlikeComment(req, res)).rejects.toThrow('Comment not found');
    });

    it('should decrement by 1 when likesCount > 0', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 5 });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 4 });

      await unlikeComment(req, res);

      const updateCall = (prisma.comment.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.likesCount).toEqual({ decrement: 1 });
    });

    it('should decrement by 0 when likesCount is already 0 (no underflow)', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 0 });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 0 });

      await unlikeComment(req, res);

      const updateCall = (prisma.comment.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.likesCount).toEqual({ decrement: 0 });
    });

    it('should return new likesCount in response', async () => {
      const req = mockReq({ params: { commentId: 'c-1' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 10 });
      (prisma.comment.update as jest.Mock).mockResolvedValue({ id: 'c-1', likesCount: 9 });

      await unlikeComment(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.likesCount).toBe(9);
    });

    it('should not call update when comment does not exist', async () => {
      const req = mockReq({ params: { commentId: 'ghost' } });
      const res = mockRes();

      (prisma.comment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(unlikeComment(req, res)).rejects.toThrow();
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });
});
