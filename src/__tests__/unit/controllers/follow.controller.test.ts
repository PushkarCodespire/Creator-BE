// ===========================================
// FOLLOW CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn(), findMany: jest.fn() },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn()
    },
    notification: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn() }
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

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import {
  followCreator,
  unfollowCreator,
  getFollowers,
  getFollowing,
  getFollowStats,
  checkFollowing,
  getCreatorSuggestions
} from '../../../controllers/follow.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'USER' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Follow Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ============================================================
  // followCreator
  // ============================================================
  describe('followCreator', () => {
    it('should follow a creator and return 201', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1', userId: 'other' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({
        id: 'f-1',
        following: { id: 'cr-1', displayName: 'Creator', profileImage: null, isVerified: false }
      });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await followCreator(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Successfully followed creator'
      }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined, params: { creatorId: 'cr-1' } });
      const res = mockRes();

      await expect(followCreator(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { creatorId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(followCreator(req, res)).rejects.toThrow('Creator not found');
    });

    it('should throw 400 when already following this creator', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-1' });

      await expect(followCreator(req, res)).rejects.toThrow('Already following this creator');
    });

    it('should create follow with correct followerId and followingId', async () => {
      const req = mockReq({ params: { creatorId: 'cr-5' }, user: { id: 'user-7' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-5', userId: 'creator-user' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({ id: 'f-1', following: {} });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await followCreator(req, res);

      const createCall = (prisma.follow.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.followerId).toBe('user-7');
      expect(createCall.data.followingId).toBe('cr-5');
    });

    it('should create a notification for the creator on follow', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' }, user: { id: 'user-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1', userId: 'creator-user' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({ id: 'f-1', following: {} });
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await followCreator(req, res);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'creator-user' })
        })
      );
    });

    it('should still succeed even if notification creation fails', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1', userId: 'other' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({ id: 'f-1', following: {} });
      (prisma.notification.create as jest.Mock).mockRejectedValue(new Error('Notification failed'));

      await followCreator(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should not call follow.create when already following', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-existing' });

      await expect(followCreator(req, res)).rejects.toThrow();
      expect(prisma.follow.create).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // unfollowCreator
  // ============================================================
  describe('unfollowCreator', () => {
    it('should unfollow a creator successfully', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-1' });
      (prisma.follow.delete as jest.Mock).mockResolvedValue({});

      await unfollowCreator(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Successfully unfollowed creator' })
      );
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined, params: { creatorId: 'cr-1' } });
      const res = mockRes();

      await expect(unfollowCreator(req, res)).rejects.toThrow('Authentication required');
    });

    it('should throw 400 when not following the creator', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(unfollowCreator(req, res)).rejects.toThrow('Not following this creator');
    });

    it('should call follow.delete with correct composite key', async () => {
      const req = mockReq({ params: { creatorId: 'cr-9' }, user: { id: 'user-3' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-1' });
      (prisma.follow.delete as jest.Mock).mockResolvedValue({});

      await unfollowCreator(req, res);

      expect(prisma.follow.delete).toHaveBeenCalledWith({
        where: { followerId_followingId: { followerId: 'user-3', followingId: 'cr-9' } }
      });
    });

    it('should not call delete when follow record does not exist', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(unfollowCreator(req, res)).rejects.toThrow();
      expect(prisma.follow.delete).not.toHaveBeenCalled();
    });

    it('should return success: true in response', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-1' });
      (prisma.follow.delete as jest.Mock).mockResolvedValue({});

      await unfollowCreator(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });
  });

  // ============================================================
  // getFollowers
  // ============================================================
  describe('getFollowers', () => {
    it('should return paginated followers list', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowers(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when user is not a creator', async () => {
      const req = mockReq({ params: { userId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getFollowers(req, res)).rejects.toThrow('Creator not found');
    });

    it('should query followers by creatorId', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-55' });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowers(req, res);

      const findManyCall = (prisma.follow.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.followingId).toBe('cr-55');
    });

    it('should return followers mapped from f.follower', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { follower: { id: 'u-2', name: 'Bob', avatar: null, role: 'USER', creator: null } }
      ]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(1);

      await getFollowers(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.followers).toHaveLength(1);
      expect(callArg.data.followers[0].name).toBe('Bob');
    });

    it('should include pagination metadata', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, query: { page: '2', limit: '5' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(20);

      await getFollowers(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.total).toBe(20);
      expect(callArg.data.pagination.totalPages).toBe(4);
    });

    it('should default to page=1 limit=20 when no query params', async () => {
      const req = mockReq({ params: { userId: 'u-1' }, query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowers(req, res);

      const findManyCall = (prisma.follow.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(20);
    });
  });

  // ============================================================
  // getFollowing
  // ============================================================
  describe('getFollowing', () => {
    it('should return following list with enriched data', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: {} });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowing(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should enrich each following entry with lastInteraction', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: {} });
      const res = mockRes();

      const lastMessageAt = new Date();
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        {
          createdAt: new Date(),
          following: { id: 'cr-1', displayName: 'Alice', profileImage: null, isVerified: true, category: 'Tech', tagline: null, totalChats: 10, rating: 4.5, followersCount: 200, isActive: true }
        }
      ]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(1);
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
        lastMessageAt,
        _count: { messages: 5 }
      });

      await getFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.following[0].lastInteraction).toEqual(lastMessageAt);
      expect(callArg.data.following[0].totalMessages).toBe(5);
    });

    it('should return null lastInteraction when no conversation exists', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: {} });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        {
          createdAt: new Date(),
          following: { id: 'cr-1', displayName: 'Bob', profileImage: null, isVerified: false, category: null, tagline: null, totalChats: 0, rating: null, followersCount: 0, isActive: true }
        }
      ]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(1);
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(null);

      await getFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.following[0].lastInteraction).toBeNull();
      expect(callArg.data.following[0].totalMessages).toBe(0);
    });

    it('should filter by category when provided', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: { category: 'Tech' } });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowing(req, res);

      const findManyCall = (prisma.follow.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.following?.category).toBe('Tech');
    });

    it('should sort alphabetically when sort=alphabetical', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: { sort: 'alphabetical' } });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowing(req, res);

      const findManyCall = (prisma.follow.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual({ following: { displayName: 'asc' } });
    });

    it('should include filter metadata in response', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: { category: 'Music', sort: 'popular' } });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.filters.category).toBe('Music');
      expect(callArg.data.filters.sort).toBe('popular');
    });

    it('should include pagination in response', async () => {
      const req = mockReq({ params: { userId: 'user-1' }, query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.follow.count as jest.Mock).mockResolvedValue(30);

      await getFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.total).toBe(30);
      expect(callArg.data.pagination.totalPages).toBe(3);
    });
  });

  // ============================================================
  // getFollowStats
  // ============================================================
  describe('getFollowStats', () => {
    it('should return follower and following counts for a creator', async () => {
      const req = mockReq({ params: { userId: 'user-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(10);

      await getFollowStats(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ followers: expect.any(Number), following: expect.any(Number) })
      }));
    });

    it('should return 0 followers when user is not a creator', async () => {
      const req = mockReq({ params: { userId: 'user-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.count as jest.Mock).mockResolvedValue(5); // following count only

      await getFollowStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.followers).toBe(0);
    });

    it('should return following count regardless of creator status', async () => {
      const req = mockReq({ params: { userId: 'user-non-creator' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.count as jest.Mock).mockResolvedValue(7);

      await getFollowStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.following).toBe(7);
    });

    it('should query follow.count for followers with followingId = creator.id', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-77' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(25);

      await getFollowStats(req, res);

      const countCalls = (prisma.follow.count as jest.Mock).mock.calls;
      const followerCall = countCalls.find(call => call[0]?.where?.followingId === 'cr-77');
      expect(followerCall).toBeDefined();
    });

    it('should query follow.count for following with followerId = userId', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.follow.count as jest.Mock).mockResolvedValue(3);

      await getFollowStats(req, res);

      const countCalls = (prisma.follow.count as jest.Mock).mock.calls;
      const followingCall = countCalls.find(call => call[0]?.where?.followerId === 'u-1');
      expect(followingCall).toBeDefined();
    });

    it('should return success: true', async () => {
      const req = mockReq({ params: { userId: 'u-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.follow.count as jest.Mock).mockResolvedValue(0);

      await getFollowStats(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });
  });

  // ============================================================
  // checkFollowing
  // ============================================================
  describe('checkFollowing', () => {
    it('should return isFollowing=true when user follows the creator', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f-1' });

      await checkFollowing(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFollowing: true } })
      );
    });

    it('should return isFollowing=false when user does not follow', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      await checkFollowing(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFollowing: false } })
      );
    });

    it('should return isFollowing=false without querying DB when unauthenticated', async () => {
      const req = mockReq({ user: undefined, params: { creatorId: 'cr-1' } });
      const res = mockRes();

      await checkFollowing(req, res);

      expect(prisma.follow.findUnique).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFollowing: false } })
      );
    });

    it('should query follow with correct composite key', async () => {
      const req = mockReq({ params: { creatorId: 'cr-42' }, user: { id: 'user-7' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      await checkFollowing(req, res);

      expect(prisma.follow.findUnique).toHaveBeenCalledWith({
        where: { followerId_followingId: { followerId: 'user-7', followingId: 'cr-42' } }
      });
    });

    it('should return success: true in all cases', async () => {
      const req = mockReq({ params: { creatorId: 'cr-1' } });
      const res = mockRes();

      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      await checkFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.success).toBe(true);
    });

    it('should handle the case where user property has no id gracefully', async () => {
      const req = mockReq({ user: undefined, params: { creatorId: 'cr-1' } });
      const res = mockRes();

      // Should not throw, should just return isFollowing: false
      await checkFollowing(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.isFollowing).toBe(false);
    });
  });

  // ============================================================
  // getCreatorSuggestions
  // ============================================================
  describe('getCreatorSuggestions', () => {
    it('should return creator suggestions', async () => {
      const req = mockReq({ query: { limit: '5' } });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: ['Tech'] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorSuggestions(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 401 when not authenticated', async () => {
      const req = mockReq({ user: undefined });
      const res = mockRes();

      await expect(getCreatorSuggestions(req, res)).rejects.toThrow('Authentication required');
    });

    it('should exclude already-followed creators from suggestions', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { followingId: 'cr-already', following: { category: 'Tech' } }
      ]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorSuggestions(req, res);

      const findManyCall = (prisma.creator.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.id.notIn).toContain('cr-already');
    });

    it('should add "Matches your interests" reason when category matches user interests', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: ['Tech'] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([
        { id: 'cr-1', displayName: 'Alice', profileImage: null, category: 'Tech', tagline: null, isVerified: true, followersCount: 50, rating: 4.0, totalChats: 5, tags: [] }
      ]);

      await getCreatorSuggestions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.suggestions[0].suggestedReasons).toContain('Matches your interests');
    });

    it('should add "Popular creator" reason when followersCount > 100', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([
        { id: 'cr-1', displayName: 'Popular', profileImage: null, category: 'Music', tagline: null, isVerified: true, followersCount: 500, rating: 3.0, totalChats: 100, tags: [] }
      ]);

      await getCreatorSuggestions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.suggestions[0].suggestedReasons).toContain('Popular creator');
    });

    it('should add "Highly rated" reason when rating >= 4.5', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([
        { id: 'cr-1', displayName: 'Top Rated', profileImage: null, category: 'Art', tagline: null, isVerified: true, followersCount: 10, rating: 4.9, totalChats: 20, tags: [] }
      ]);

      await getCreatorSuggestions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.suggestions[0].suggestedReasons).toContain('Highly rated');
    });

    it('should include basedOn interests and followedCategories', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: ['Music'] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([
        { followingId: 'cr-1', following: { category: 'Tech' } }
      ]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorSuggestions(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.basedOn.interests).toContain('Music');
      expect(callArg.data.basedOn.followedCategories).toContain('Tech');
    });

    it('should use default limit of 10 when not provided', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ interests: [] });
      (prisma.follow.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creator.findMany as jest.Mock).mockResolvedValue([]);

      await getCreatorSuggestions(req, res);

      const findManyCall = (prisma.creator.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.take).toBe(10);
    });
  });
});
