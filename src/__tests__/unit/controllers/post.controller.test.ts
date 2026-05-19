// ===========================================
// POST CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn() },
    post: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn(), findFirst: jest.fn() },
    like: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
    comment: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    notification: { create: jest.fn() }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/feedAlgorithm.service', () => ({
  rankPosts: jest.fn((posts: any[]) => posts),
  mixFeedContent: jest.fn((a: any[], _b: any[], limit: number) => a.slice(0, limit)),
  getDefaultFeedQuery: jest.fn(() => ({ orderBy: { likesCount: 'desc' } }))
}));

jest.mock('../../../utils/logger', () => ({ logError: jest.fn() }));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import * as feedAlgorithm from '../../../services/feedAlgorithm.service';
import {
  createPost,
  getCreatorPostStats,
  getFeed,
  getPost,
  updatePost,
  deletePost,
  likePost,
  unlikePost,
  getPostLikes
} from '../../../controllers/post.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'CREATOR' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Post Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish feed algorithm mock implementations after resetMocks: true clears them
    (feedAlgorithm.rankPosts as jest.Mock).mockImplementation((posts: any[]) => posts);
    (feedAlgorithm.mixFeedContent as jest.Mock).mockImplementation((a: any[], _b: any[], limit: number) => a.slice(0, limit));
    (feedAlgorithm.getDefaultFeedQuery as jest.Mock).mockImplementation(() => ({ orderBy: { likesCount: 'desc' } }));
  });

  // ============================================================
  // createPost
  // ============================================================
  describe('createPost', () => {
    it('should create a post and return 201', async () => {
      const req = mockReq({ body: { content: 'Hello world!' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.post.create as jest.Mock).mockResolvedValue({ id: 'p-1', content: 'Hello world!' });

      await createPost(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Post created successfully' }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(createPost(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 403 when user is not a creator', async () => {
      const req = mockReq({ body: { content: 'test' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(createPost(req, res)).rejects.toThrow('Only creators can create posts');
    });

    it('should throw 400 when content is empty string', async () => {
      const req = mockReq({ body: { content: '' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });

      await expect(createPost(req, res)).rejects.toThrow('Post content is required');
    });

    it('should throw 400 when content is whitespace only', async () => {
      const req = mockReq({ body: { content: '   ' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });

      await expect(createPost(req, res)).rejects.toThrow('Post content is required');
    });

    it('should create a scheduled post with isPublished=false when publishedAt is provided', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const req = mockReq({ body: { content: 'Scheduled post', publishedAt: futureDate } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.post.create as jest.Mock).mockResolvedValue({ id: 'p-1', isPublished: false });

      await createPost(req, res);

      const createCall = (prisma.post.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.isPublished).toBe(false);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should create a post with media attachment', async () => {
      const req = mockReq({ body: { content: 'Post with image', media: { url: 'http://img.com/a.jpg', type: 'IMAGE' } } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.post.create as jest.Mock).mockResolvedValue({ id: 'p-2', content: 'Post with image', media: { url: 'http://img.com/a.jpg' } });

      await createPost(req, res);

      const createCall = (prisma.post.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.media).toEqual({ url: 'http://img.com/a.jpg', type: 'IMAGE' });
    });

    it('should create post with VIDEO type', async () => {
      const req = mockReq({ body: { content: 'Video post', type: 'VIDEO' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.post.create as jest.Mock).mockResolvedValue({ id: 'p-3', type: 'VIDEO' });

      await createPost(req, res);

      const createCall = (prisma.post.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.type).toBe('VIDEO');
    });
  });

  // ============================================================
  // getCreatorPostStats
  // ============================================================
  describe('getCreatorPostStats', () => {
    it('should return stats for a creator', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(50);
      (prisma.post.count as jest.Mock).mockResolvedValue(10);
      (prisma.comment.count as jest.Mock).mockResolvedValue(100);
      (prisma.post.findFirst as jest.Mock).mockResolvedValue({
        id: 'p-1',
        content: 'Top post',
        media: null,
        likesCount: 200,
        commentsCount: 30,
        createdAt: new Date(),
        publishedAt: new Date()
      });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorPostStats(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          totals: expect.objectContaining({ followers: 50, posts: 10, comments: 100 })
        })
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getCreatorPostStats(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 403 when user is not a creator', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCreatorPostStats(req, res)).rejects.toThrow('Only creators can view post stats');
    });

    it('should return null topPost when no posts exist', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.count as jest.Mock).mockResolvedValue(0);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorPostStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.topPost).toBeNull();
    });

    it('should truncate long content in contentPreview', async () => {
      const req = mockReq();
      const res = mockRes();
      const longContent = 'x'.repeat(300);

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.findFirst as jest.Mock).mockResolvedValue({
        id: 'p-1', content: longContent, media: null, likesCount: 1, commentsCount: 0,
        createdAt: new Date(), publishedAt: new Date()
      });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorPostStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.topPost.contentPreview.length).toBeLessThanOrEqual(163); // 160 + '...'
    });

    it('should include recentComments with post preview', async () => {
      const req = mockReq();
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.comment.count as jest.Mock).mockResolvedValue(1);
      (prisma.post.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'c-1',
          content: 'A comment',
          createdAt: new Date(),
          post: { id: 'p-1', content: 'Post content', media: null },
          user: { id: 'u-2', name: 'Jane', avatar: null }
        }
      ]);

      await getCreatorPostStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.recentComments).toHaveLength(1);
      expect(callArg.data.recentComments[0].id).toBe('c-1');
    });

    it('should use createdAt as fallback when publishedAt is null', async () => {
      const req = mockReq();
      const res = mockRes();
      const createdAt = new Date('2024-01-01');

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.comment.count as jest.Mock).mockResolvedValue(0);
      (prisma.post.findFirst as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'Post', media: null, likesCount: 5, commentsCount: 0,
        createdAt, publishedAt: null
      });
      (prisma.comment.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorPostStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.topPost.publishedAt).toEqual(createdAt);
    });
  });

  // ============================================================
  // getFeed
  // ============================================================
  describe('getFeed', () => {
    it('should return chronological feed for a specific creatorId', async () => {
      const req = mockReq({ query: { creatorId: 'cr-1', page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-1', content: 'test', _count: { likes: 2, comments: 1 } }
      ]);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

      await getFeed(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return trending feed when user has no follows', async () => {
      const req = mockReq({ user: { id: 'user-1' }, query: {} });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.count as jest.Mock).mockResolvedValue(0);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

      await getFeed(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return personalized feed when user follows creators', async () => {
      const req = mockReq({ user: { id: 'user-1' }, query: {} });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([{ followingId: 'cr-2' }]);
      (prisma.post.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-1', _count: { likes: 0, comments: 0 }, likesCount: 0, commentsCount: 0 }
      ]);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

      await getFeed(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return feed without like status when unauthenticated', async () => {
      const req = mockReq({ user: undefined, query: {} });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.count as jest.Mock).mockResolvedValue(0);

      await getFeed(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should mark liked posts in creatorId feed', async () => {
      const req = mockReq({ user: { id: 'user-1' }, query: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-1', content: 'x', _count: { likes: 5, comments: 2 } }
      ]);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([{ postId: 'p-1' }]);

      await getFeed(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.posts[0].isLiked).toBe(true);
    });

    it('should apply correct pagination in default feed', async () => {
      const req = mockReq({ user: { id: 'user-1' }, query: { page: '2', limit: '5' } });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.post.count as jest.Mock).mockResolvedValue(15);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

      await getFeed(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.page).toBe(2);
      expect(callArg.data.pagination.limit).toBe(5);
      expect(callArg.data.pagination.totalPages).toBe(3);
    });

    it('should set isLiked=false for posts user has not liked', async () => {
      const req = mockReq({ user: { id: 'user-1' }, query: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.post.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-2', _count: { likes: 1, comments: 0 } }
      ]);
      (prisma.post.count as jest.Mock).mockResolvedValue(1);
      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);

      await getFeed(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.posts[0].isLiked).toBe(false);
    });
  });

  // ============================================================
  // getPost
  // ============================================================
  describe('getPost', () => {
    it('should return a single post with counts', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'x', creator: {}, _count: { likes: 5 }
      });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);

      await getPost(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(callArg.data.likesCount).toBe(5);
    });

    it('should throw 404 when post not found', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getPost(req, res)).rejects.toThrow('Post not found');
    });

    it('should return isLiked=true when authenticated user liked the post', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'x', creator: {}, _count: { likes: 1 }
      });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });

      await getPost(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.isLiked).toBe(true);
    });

    it('should return isLiked=false when user has not liked', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'x', creator: {}, _count: { likes: 3 }
      });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);

      await getPost(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.isLiked).toBe(false);
    });

    it('should not query likes table when unauthenticated', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: undefined });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'x', creator: {}, _count: { likes: 0 }
      });

      await getPost(req, res);

      expect(prisma.like.findUnique).not.toHaveBeenCalled();
      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.isLiked).toBe(false);
    });

    it('should include creator info in response', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({
        id: 'p-1', content: 'x',
        creator: { id: 'cr-1', displayName: 'Alice', profileImage: null, isVerified: true, category: 'Tech', bio: 'Bio' },
        _count: { likes: 0 }
      });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);

      await getPost(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.creator.displayName).toBe('Alice');
    });
  });

  // ============================================================
  // updatePost
  // ============================================================
  describe('updatePost', () => {
    it('should update own post successfully', async () => {
      const req = mockReq({ params: { id: 'p-1' }, body: { content: 'updated' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.post.update as jest.Mock).mockResolvedValue({ id: 'p-1', content: 'updated' });

      await updatePost(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Post updated successfully'
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: undefined, body: { content: 'x' } });
      const res = mockRes();

      await expect(updatePost(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when post does not exist', async () => {
      const req = mockReq({ params: { id: 'bad' }, body: { content: 'x' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updatePost(req, res)).rejects.toThrow('Post not found');
    });

    it('should throw 403 when editing another creator post', async () => {
      const req = mockReq({ params: { id: 'p-1' }, body: { content: 'hack' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'other-user' } });

      await expect(updatePost(req, res)).rejects.toThrow('You can only edit your own posts');
    });

    it('should allow updating media to null', async () => {
      const req = mockReq({ params: { id: 'p-1' }, body: { media: null } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.post.update as jest.Mock).mockResolvedValue({ id: 'p-1', media: null });

      await updatePost(req, res);

      const updateCall = (prisma.post.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).toHaveProperty('media', null);
    });

    it('should allow toggling isPublished', async () => {
      const req = mockReq({ params: { id: 'p-1' }, body: { isPublished: false } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.post.update as jest.Mock).mockResolvedValue({ id: 'p-1', isPublished: false });

      await updatePost(req, res);

      const updateCall = (prisma.post.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).toHaveProperty('isPublished', false);
    });

    it('should allow updating type field', async () => {
      const req = mockReq({ params: { id: 'p-1' }, body: { type: 'VIDEO' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.post.update as jest.Mock).mockResolvedValue({ id: 'p-1', type: 'VIDEO' });

      await updatePost(req, res);

      const updateCall = (prisma.post.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.type).toBe('VIDEO');
    });
  });

  // ============================================================
  // deletePost
  // ============================================================
  describe('deletePost', () => {
    it('should delete own post', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.post.delete as jest.Mock).mockResolvedValue({});

      await deletePost(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Post deleted successfully'
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: undefined });
      const res = mockRes();

      await expect(deletePost(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when post does not exist', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deletePost(req, res)).rejects.toThrow('Post not found');
    });

    it('should throw 403 when deleting another creator post', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'other' } });

      await expect(deletePost(req, res)).rejects.toThrow('You can only delete your own posts');
    });

    it('should call prisma.post.delete with correct id', async () => {
      const req = mockReq({ params: { id: 'p-42' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-42', creator: { userId: 'user-1' } });
      (prisma.post.delete as jest.Mock).mockResolvedValue({});

      await deletePost(req, res);

      expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 'p-42' } });
    });

    it('should not delete if findUnique returns post belonging to another user', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: { id: 'hacker' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });

      await expect(deletePost(req, res)).rejects.toThrow();
      expect(prisma.post.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // likePost
  // ============================================================
  describe('likePost', () => {
    it('should like a post and return 201', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'other' } });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.like.create as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 1 });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await likePost(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ likesCount: 1 })
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: undefined });
      const res = mockRes();

      await expect(likePost(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when post not found', async () => {
      const req = mockReq({ params: { id: 'bad' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(likePost(req, res)).rejects.toThrow('Post not found');
    });

    it('should throw 400 when post already liked', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'other' } });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });

      await expect(likePost(req, res)).rejects.toThrow('Post already liked');
    });

    it('should not create notification when liking own post', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'user-1' } });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.like.create as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 1 });

      await likePost(req, res);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should create notification when liking another creator post', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'creator-user' } });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.like.create as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 5 });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await likePost(req, res);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'creator-user' }) })
      );
    });

    it('should still succeed even if notification creation fails', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.post.findUnique as jest.Mock).mockResolvedValue({ id: 'p-1', creator: { userId: 'other' } });
      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.like.create as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 1 });
      (prisma.notification.create as jest.Mock).mockRejectedValue(new Error('Notification failed'));

      await likePost(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ============================================================
  // unlikePost
  // ============================================================
  describe('unlikePost', () => {
    it('should unlike a post', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.like.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 0 });

      await unlikePost(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { likesCount: 0 }
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ params: { id: 'p-1' }, user: undefined });
      const res = mockRes();

      await expect(unlikePost(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 400 when post is not liked', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.like.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(unlikePost(req, res)).rejects.toThrow('Post not liked');
    });

    it('should call prisma.like.delete with correct composite key', async () => {
      const req = mockReq({ params: { id: 'p-5' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.like.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 4 });

      await unlikePost(req, res);

      expect(prisma.like.delete).toHaveBeenCalledWith({
        where: { userId_postId: { userId: 'user-1', postId: 'p-5' } }
      });
    });

    it('should decrement likesCount on the post', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.like.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 9 });

      await unlikePost(req, res);

      const updateCall = (prisma.post.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.likesCount).toEqual({ decrement: 1 });
    });

    it('should return the updated likesCount in response', async () => {
      const req = mockReq({ params: { id: 'p-1' } });
      const res = mockRes();

      (prisma.like.findUnique as jest.Mock).mockResolvedValue({ id: 'l-1' });
      (prisma.like.delete as jest.Mock).mockResolvedValue({});
      (prisma.post.update as jest.Mock).mockResolvedValue({ likesCount: 42 });

      await unlikePost(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.likesCount).toBe(42);
    });
  });

  // ============================================================
  // getPostLikes
  // ============================================================
  describe('getPostLikes', () => {
    it('should return paginated likes list', async () => {
      const req = mockReq({ params: { id: 'p-1' }, query: {} });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.like.count as jest.Mock).mockResolvedValue(0);

      await getPostLikes(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return user info for each like', async () => {
      const req = mockReq({ params: { id: 'p-1' }, query: {} });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([
        { id: 'l-1', user: { id: 'u-2', name: 'Bob', avatar: null, creator: null } }
      ]);
      (prisma.like.count as jest.Mock).mockResolvedValue(1);

      await getPostLikes(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.likes).toHaveLength(1);
      expect(callArg.data.likes[0].name).toBe('Bob');
    });

    it('should include correct pagination metadata', async () => {
      const req = mockReq({ params: { id: 'p-1' }, query: { page: '2', limit: '5' } });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.like.count as jest.Mock).mockResolvedValue(12);

      await getPostLikes(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.page).toBe(2);
      expect(callArg.data.pagination.limit).toBe(5);
      expect(callArg.data.pagination.total).toBe(12);
      expect(callArg.data.pagination.totalPages).toBe(3);
    });

    it('should use default page=1 limit=20 when no query params', async () => {
      const req = mockReq({ params: { id: 'p-1' }, query: {} });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.like.count as jest.Mock).mockResolvedValue(0);

      await getPostLikes(req, res);

      const findManyCall = (prisma.like.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(20);
    });

    it('should query likes by postId', async () => {
      const req = mockReq({ params: { id: 'p-99' }, query: {} });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.like.count as jest.Mock).mockResolvedValue(0);

      await getPostLikes(req, res);

      expect(prisma.like.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { postId: 'p-99' } })
      );
    });

    it('should return empty likes array when no one liked the post', async () => {
      const req = mockReq({ params: { id: 'p-1' }, query: {} });
      const res = mockRes();

      (prisma.like.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.like.count as jest.Mock).mockResolvedValue(0);

      await getPostLikes(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.likes).toEqual([]);
      expect(callArg.data.pagination.total).toBe(0);
    });
  });
});
