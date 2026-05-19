// ===========================================
// FEED ALGORITHM SERVICE — UNIT TESTS
// ===========================================

import {
  calculatePostScore,
  rankPosts,
  mixFeedContent,
  getDefaultFeedQuery,
} from '../../../services/feedAlgorithm.service';

describe('FeedAlgorithmService', () => {
  describe('calculatePostScore', () => {
    it('should give following bonus of 40 points', () => {
      const result = calculatePostScore(
        {
          isFollowing: true,
          recencyHours: 0,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          creatorId: 'creator-1',
        },
        []
      );

      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.reasons).toContain('Following creator');
    });

    it('should give discovery bonus of 10 points for non-followed', () => {
      const result = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 30, // no recency points
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          creatorId: 'creator-1',
        },
        []
      );

      expect(result.score).toBe(10);
      expect(result.reasons).toContain('Discovery');
    });

    it('should apply recency scoring (newer = higher)', () => {
      const recent = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 1,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          creatorId: 'c1',
        },
        []
      );

      const old = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 25,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          creatorId: 'c1',
        },
        []
      );

      expect(recent.score).toBeGreaterThan(old.score);
    });

    it('should weight engagement (likes=1, comments=3, shares=5)', () => {
      const result = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 30,
          likesCount: 5,
          commentsCount: 2,
          sharesCount: 1,
          creatorId: 'c1',
        },
        []
      );

      // 5*1 + 2*3 + 1*5 = 16, capped at 30
      // Total: 10 (discovery) + 0 (recency) + 16 (engagement) = 26
      expect(result.score).toBe(26);
    });

    it('should cap engagement score at 30', () => {
      const result = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 30,
          likesCount: 100,
          commentsCount: 100,
          sharesCount: 100,
          creatorId: 'c1',
        },
        []
      );

      // discovery(10) + recency(0) + engagement(capped 30) = 40
      expect(result.score).toBe(40);
    });

    it('should apply diversity penalty for repeated creators', () => {
      const recentCreatorIds = ['creator-1', 'creator-1', 'creator-1'];

      const result = calculatePostScore(
        {
          isFollowing: false,
          recencyHours: 30,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          creatorId: 'creator-1',
        },
        recentCreatorIds
      );

      expect(result.reasons).toContain('Diversity adjustment');
      // 10 (discovery) - 20 (penalty) = capped at 0
      expect(result.score).toBe(0);
    });
  });

  describe('rankPosts', () => {
    it('should sort posts by score descending', () => {
      const posts = [
        {
          creatorId: 'c1',
          publishedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // old
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
        },
        {
          creatorId: 'c2',
          publishedAt: new Date().toISOString(), // very recent
          likesCount: 10,
          commentsCount: 5,
          sharesCount: 2,
        },
      ];

      const ranked = rankPosts(posts, 'user-1', ['c2']);

      expect(ranked[0].creatorId).toBe('c2');
      expect(ranked[0]._score).toBeGreaterThan(ranked[1]._score);
    });

    it('should add _score and _scoreReasons to each post', () => {
      const posts = [
        {
          creatorId: 'c1',
          createdAt: new Date().toISOString(),
          likesCount: 1,
          commentsCount: 0,
          sharesCount: 0,
        },
      ];

      const ranked = rankPosts(posts, null, []);

      expect(ranked[0]).toHaveProperty('_score');
      expect(ranked[0]).toHaveProperty('_scoreReasons');
      expect(Array.isArray(ranked[0]._scoreReasons)).toBe(true);
    });
  });

  describe('mixFeedContent', () => {
    it('should mix 70% followed and 30% discovery', () => {
      const followed = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}` }));
      const discovery = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` }));

      const mixed = mixFeedContent(followed, discovery, 10);

      expect(mixed.length).toBe(10);
    });

    it('should handle fewer posts than limit', () => {
      const followed = [{ id: 'f1' }];
      const discovery = [{ id: 'd1' }];

      const mixed = mixFeedContent(followed, discovery, 10);

      expect(mixed.length).toBe(2);
    });
  });

  describe('getDefaultFeedQuery', () => {
    it('should return ordering by likes and publish date', () => {
      const query = getDefaultFeedQuery();

      expect(query.orderBy).toEqual([
        { likesCount: 'desc' },
        { publishedAt: 'desc' },
      ]);
    });
  });

  // ===========================================
  // NEW BRANCH COVERAGE TESTS
  // ===========================================

  describe('calculatePostScore — additional branches', () => {
    it('should add "Very recent" reason when recencyScore > 20', () => {
      // recencyScore = 30 - 5 = 25 > 20
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 5, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).toContain('Very recent');
    });

    it('should add "Recent" reason when recencyScore is between 11 and 20', () => {
      // recencyScore = 30 - 15 = 15, which is > 10 but not > 20
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 15, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).toContain('Recent');
      expect(result.reasons).not.toContain('Very recent');
    });

    it('should NOT add recency reason when recencyScore is exactly 10', () => {
      // recencyScore = 30 - 20 = 10, which is NOT > 10
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 20, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).not.toContain('Recent');
      expect(result.reasons).not.toContain('Very recent');
    });

    it('should NOT add recency reason when recencyScore is 0 (>= 30 hours old)', () => {
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 35, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).not.toContain('Recent');
      expect(result.reasons).not.toContain('Very recent');
    });

    it('should add "High engagement" when engagementScore > 20', () => {
      // 5*1 + 3*3 + 2*5 = 5 + 9 + 10 = 24 > 20
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 5, commentsCount: 3, sharesCount: 2, creatorId: 'c1' },
        []
      );
      expect(result.reasons).toContain('High engagement');
    });

    it('should add "Popular" when engagementScore is between 11 and 20', () => {
      // 0 + 4*3 + 0 = 12 > 10 but not > 20
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 4, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).toContain('Popular');
      expect(result.reasons).not.toContain('High engagement');
    });

    it('should NOT add engagement reason when engagementScore is exactly 10', () => {
      // 10*1 + 0 + 0 = 10, NOT > 10
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 10, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        []
      );
      expect(result.reasons).not.toContain('Popular');
      expect(result.reasons).not.toContain('High engagement');
    });

    it('should NOT apply diversity penalty when creator appears fewer than 3 times', () => {
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        ['c1', 'c1'] // only 2 occurrences
      );
      expect(result.reasons).not.toContain('Diversity adjustment');
    });

    it('should apply diversity penalty at exactly 3 occurrences', () => {
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        ['c1', 'c1', 'c1'] // exactly 3
      );
      expect(result.reasons).toContain('Diversity adjustment');
    });

    it('should not penalise different creator IDs from the recent list', () => {
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'other' },
        ['c1', 'c1', 'c1']
      );
      expect(result.reasons).not.toContain('Diversity adjustment');
    });

    it('should clamp final score to 0 (never negative)', () => {
      // Discovery 10 - penalty 20 = -10 → clamped to 0
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'c1' },
        ['c1', 'c1', 'c1']
      );
      expect(result.score).toBe(0);
    });

    it('should include both following bonus and high engagement reason', () => {
      const result = calculatePostScore(
        { isFollowing: true, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 5, creatorId: 'c1' },
        []
      );
      // 40 (follow) + 0 (recency) + 25 (engagement) = 65, engagement > 20
      expect(result.reasons).toContain('Following creator');
      expect(result.reasons).toContain('High engagement');
      expect(result.score).toBe(65);
    });

    it('postId in result is set to creatorId', () => {
      const result = calculatePostScore(
        { isFollowing: false, recencyHours: 30, likesCount: 0, commentsCount: 0, sharesCount: 0, creatorId: 'creator-xyz' },
        []
      );
      expect(result.postId).toBe('creator-xyz');
    });
  });

  describe('rankPosts — additional branches', () => {
    it('should handle empty posts array', () => {
      const result = rankPosts([], 'user-1', []);
      expect(result).toEqual([]);
    });

    it('should accumulate recentCreatorIds to apply diversity penalty progressively', () => {
      const sameCreator = 'repeated-creator';
      const posts = Array.from({ length: 5 }, (_, i) => ({
        creatorId: sameCreator,
        publishedAt: new Date(Date.now() - i * 1000).toISOString(),
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0
      }));

      const ranked = rankPosts(posts, 'user-1', []);

      // Posts 4 and 5 (index 3+) should have diversity penalty applied
      const penalised = ranked.filter(p => p._scoreReasons.includes('Diversity adjustment'));
      expect(penalised.length).toBeGreaterThan(0);
    });

    it('should use createdAt as fallback when publishedAt is absent', () => {
      const posts = [
        {
          creatorId: 'c1',
          createdAt: new Date().toISOString(),
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0
          // no publishedAt
        }
      ];
      const result = rankPosts(posts, 'user-1', []);
      expect(result[0]).toHaveProperty('_score');
    });

    it('should mark post as following when creatorId is in followingIds', () => {
      const posts = [
        { creatorId: 'followed-creator', publishedAt: new Date().toISOString(), likesCount: 0, commentsCount: 0, sharesCount: 0 }
      ];
      const ranked = rankPosts(posts, 'user-1', ['followed-creator']);
      expect(ranked[0]._scoreReasons).toContain('Following creator');
    });

    it('should default likesCount/commentsCount/sharesCount to 0 when absent', () => {
      const posts = [{ creatorId: 'c1', publishedAt: new Date().toISOString() }];
      // Should not throw
      const result = rankPosts(posts, 'user-1', []);
      expect(result[0]).toHaveProperty('_score');
    });
  });

  describe('mixFeedContent — additional branches', () => {
    it('should return empty array when both inputs are empty', () => {
      const result = mixFeedContent([], [], 10);
      expect(result).toEqual([]);
    });

    it('should compute followedCount as ceil(70% of limit)', () => {
      // limit=3 → ceil(3*0.7) = ceil(2.1) = 3 followed, 0 discovery
      const followed = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
      const discovery = [{ id: 'd1' }, { id: 'd2' }];

      const result = mixFeedContent(followed, discovery, 3);
      expect(result.length).toBe(3);
    });

    it('should take only up to followedCount from followedPosts', () => {
      const followed = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}` }));
      const discovery = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}` }));

      const result = mixFeedContent(followed, discovery, 10);
      // ceil(10*0.7)=7 followed, 3 discovery
      expect(result.length).toBe(10);
    });

    it('should handle limit=1 (ceil(0.7) = 1 followed, 0 discovery)', () => {
      const followed = [{ id: 'f0' }];
      const discovery = [{ id: 'd0' }];

      const result = mixFeedContent(followed, discovery, 1);
      expect(result.length).toBe(1);
    });

    it('shuffleWithBias should produce same length array', () => {
      // limit=8: ceil(8*0.7)=6 followed, 2 discovery — supply enough of both
      const followed = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}` }));
      const discovery = Array.from({ length: 2 }, (_, i) => ({ id: `d${i}` }));

      const result = mixFeedContent(followed, discovery, 8);
      expect(result.length).toBe(8);
    });
  });
});
