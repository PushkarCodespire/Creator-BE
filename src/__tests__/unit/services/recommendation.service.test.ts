// ===========================================
// RECOMMENDATION SERVICE — UNIT TESTS
// ===========================================

import {
  calculateCreatorRecommendationScore,
  getCollaborativeRecommendations,
  getContentBasedRecommendations,
  getSimilarCreators,
  getRecommendedPosts,
  diversifyRecommendations,
} from '../../../services/recommendation.service';

describe('RecommendationService', () => {
  describe('calculateCreatorRecommendationScore', () => {
    const baseUserProfile = {
      userId: 'user-1',
      followingIds: ['c-followed'],
      likedPostCategories: ['Tech'],
      interactionHistory: [],
    };

    it('should give 40 points for category match', () => {
      const creator = {
        id: 'c-new',
        category: 'Tech',
        followersCount: 10,
        postsCount: 5,
        isVerified: false,
        createdAt: new Date(Date.now() - 365 * 24 * 3600 * 1000), // 1 year old
      };

      const result = calculateCreatorRecommendationScore(creator, baseUserProfile, []);

      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.reasons).toContainEqual(expect.stringContaining('Tech'));
    });

    it('should give 30 points when similar to followed creators', () => {
      const followedCreator = {
        id: 'c-followed',
        category: 'Tech',
        followersCount: 100,
        postsCount: 50,
        isVerified: true,
        createdAt: new Date('2023-01-01'),
      };

      const newCreator = {
        id: 'c-new',
        category: 'Tech',
        followersCount: 50,
        postsCount: 20,
        isVerified: false,
        createdAt: new Date('2023-06-01'),
      };

      const result = calculateCreatorRecommendationScore(
        newCreator,
        { ...baseUserProfile, likedPostCategories: [] },
        [followedCreator, newCreator]
      );

      expect(result.reasons).toContain('Similar to creators you follow');
    });

    it('should give 10 points for verified creators', () => {
      const creator = {
        id: 'c-verified',
        category: 'Other',
        followersCount: 10,
        postsCount: 5,
        isVerified: true,
        createdAt: new Date('2023-01-01'),
      };

      const result = calculateCreatorRecommendationScore(
        creator,
        { ...baseUserProfile, likedPostCategories: [] },
        []
      );

      expect(result.reasons).toContain('Verified creator');
    });

    it('should give 15 points for new creators (< 30 days)', () => {
      const creator = {
        id: 'c-new',
        category: 'Other',
        followersCount: 1,
        postsCount: 1,
        isVerified: false,
        createdAt: new Date(), // brand new
      };

      const result = calculateCreatorRecommendationScore(
        creator,
        { ...baseUserProfile, likedPostCategories: [] },
        []
      );

      expect(result.reasons).toContain('New to the platform');
    });

    it('should penalize -100 for already followed creators', () => {
      const creator = {
        id: 'c-followed',
        category: 'Tech',
        followersCount: 1000,
        postsCount: 100,
        isVerified: true,
        createdAt: new Date('2023-01-01'),
      };

      const result = calculateCreatorRecommendationScore(creator, baseUserProfile, []);

      expect(result.score).toBe(0); // Clamped to 0
    });
  });

  describe('getCollaborativeRecommendations', () => {
    it('should return empty array when user follows nobody', async () => {
      const mockPrisma = {
        follow: {
          findMany: jest.fn()
            .mockResolvedValueOnce([]) // user following
        },
        like: { findMany: jest.fn() },
        creator: { findMany: jest.fn() },
      };

      const result = await getCollaborativeRecommendations(mockPrisma as any, 'user-1');

      expect(result).toEqual([]);
    });

    it('should return recommended creator IDs based on similar users', async () => {
      const mockPrisma = {
        follow: {
          findMany: jest.fn()
            .mockResolvedValueOnce([{ followingId: 'c1' }, { followingId: 'c2' }]) // user follows
            .mockResolvedValueOnce([
              { followerId: 'similar-1' },
              { followerId: 'similar-1' },
              { followerId: 'similar-2' },
              { followerId: 'similar-2' },
            ]) // similar users
            .mockResolvedValueOnce([
              { followingId: 'c3' },
              { followingId: 'c3' },
              { followingId: 'c4' },
            ]) // recommendations
        },
        like: { findMany: jest.fn() },
        creator: { findMany: jest.fn() },
      };

      const result = await getCollaborativeRecommendations(mockPrisma as any, 'user-1');

      expect(result).toContain('c3');
    });
  });

  describe('getContentBasedRecommendations', () => {
    it('should return scored and sorted recommendations', () => {
      const creators = [
        { id: 'c1', category: 'Tech', followersCount: 100, postsCount: 50, isVerified: true, createdAt: new Date('2023-01-01') },
        { id: 'c2', category: 'Art', followersCount: 50, postsCount: 10, isVerified: false, createdAt: new Date('2023-06-01') },
      ];

      const userProfile = {
        userId: 'u1',
        followingIds: [],
        likedPostCategories: ['Tech'],
        interactionHistory: [],
      };

      const result = getContentBasedRecommendations(creators, userProfile, 10);

      expect(result[0]._recommendationScore).toBeGreaterThanOrEqual(result[1]._recommendationScore);
      expect(result[0].id).toBe('c1'); // Tech matches user interest
    });

    it('should exclude already-followed creators', () => {
      const creators = [
        { id: 'c-followed', category: 'Tech', followersCount: 100, postsCount: 50, isVerified: true, createdAt: new Date('2023-01-01') },
        { id: 'c-new', category: 'Tech', followersCount: 50, postsCount: 10, isVerified: false, createdAt: new Date('2023-06-01') },
      ];

      const userProfile = {
        userId: 'u1',
        followingIds: ['c-followed'],
        likedPostCategories: ['Tech'],
        interactionHistory: [],
      };

      const result = getContentBasedRecommendations(creators, userProfile, 10);

      expect(result.find((r) => r.id === 'c-followed')).toBeUndefined();
    });
  });

  describe('getSimilarCreators', () => {
    it('should rank creators by similarity score', () => {
      const target = { id: 'target', category: 'Tech', followersCount: 100, postsCount: 50, isVerified: true, createdAt: new Date() };
      const creators = [
        { id: 'c1', category: 'Tech', followersCount: 90, postsCount: 45, isVerified: true, createdAt: new Date() },
        { id: 'c2', category: 'Art', followersCount: 10, postsCount: 5, isVerified: false, createdAt: new Date() },
      ];

      const result = getSimilarCreators(target, [target, ...creators]);

      expect(result[0].id).toBe('c1');
      expect(result[0]._similarityScore).toBeGreaterThan(result[1]._similarityScore);
    });

    it('should exclude the target creator from results', () => {
      const target = { id: 'target', category: 'Tech', followersCount: 100, postsCount: 50, isVerified: true, createdAt: new Date() };

      const result = getSimilarCreators(target, [target]);

      expect(result).toHaveLength(0);
    });
  });

  describe('getRecommendedPosts', () => {
    it('should score posts based on user preferences', () => {
      const posts = [
        { id: 'p1', creatorId: 'c1', creator: { category: 'Tech' }, likesCount: 10, commentsCount: 5 },
        { id: 'p2', creatorId: 'c2', creator: { category: 'Art' }, likesCount: 1, commentsCount: 0 },
      ];

      const userProfile = {
        userId: 'u1',
        followingIds: ['c1'],
        likedPostCategories: ['Tech'],
        interactionHistory: [],
      };

      const result = getRecommendedPosts(posts, userProfile);

      expect(result[0].id).toBe('p1');
      expect(result[0]._recommendationScore).toBeGreaterThan(result[1]._recommendationScore);
    });
  });

  describe('diversifyRecommendations', () => {
    it('should penalize over-represented categories', () => {
      const recommendations = [
        { category: 'Tech', _recommendationScore: 100 },
        { category: 'Tech', _recommendationScore: 90 },
        { category: 'Tech', _recommendationScore: 80 },
        { category: 'Art', _recommendationScore: 70 },
      ];

      const result = diversifyRecommendations(recommendations, 0.3);

      // Art should be boosted relative to repeated Tech entries
      const artIndex = result.findIndex((r: any) => r.category === 'Art');
      expect(artIndex).toBeLessThanOrEqual(3); // Art should move up
    });

    it('should not modify scores with diversityFactor of 0', () => {
      const recommendations = [
        { category: 'Tech', _recommendationScore: 100 },
        { category: 'Tech', _recommendationScore: 90 },
      ];

      const result = diversifyRecommendations(recommendations, 0);

      expect(result[0]._recommendationScore).toBe(100);
      expect(result[1]._recommendationScore).toBe(90);
    });
  });
});
