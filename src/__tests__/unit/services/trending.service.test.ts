// ===========================================
// TRENDING SERVICE — UNIT TESTS
// ===========================================

import {
  calculateTrendingScore,
  getTrendingPosts,
  getTrendingCreators,
  getTrendingHashtags,
  getCategoryTrending,
  getTrendingByTimeWindow,
  TrendingTimeWindow,
} from '../../../services/trending.service';

describe('TrendingService', () => {
  describe('calculateTrendingScore', () => {
    it('should return higher score for recent engagement growth', () => {
      const now = new Date();
      const recentMetrics = { likes: 50, comments: 10, shares: 5, followers: 0, timestamp: now };
      const olderMetrics = { likes: 10, comments: 2, shares: 1, followers: 0, timestamp: now };

      const score = calculateTrendingScore(recentMetrics, olderMetrics, new Date(Date.now() - 3600 * 1000));

      expect(score).toBeGreaterThan(0);
    });

    it('should apply time decay (older content scores lower)', () => {
      const now = new Date();
      const metrics = { likes: 50, comments: 10, shares: 5, followers: 0, timestamp: now };
      const empty = { likes: 0, comments: 0, shares: 0, followers: 0, timestamp: now };

      const recentScore = calculateTrendingScore(metrics, empty, new Date(Date.now() - 3600 * 1000)); // 1 hour
      const olderScore = calculateTrendingScore(metrics, empty, new Date(Date.now() - 72 * 3600 * 1000)); // 3 days

      expect(recentScore).toBeGreaterThan(olderScore);
    });

    it('should return 0 when no growth in engagement', () => {
      const now = new Date();
      const metrics = { likes: 10, comments: 2, shares: 1, followers: 0, timestamp: now };

      const score = calculateTrendingScore(metrics, metrics, new Date());

      expect(score).toBe(0);
    });

    it('should weight shares higher than likes', () => {
      const now = new Date();
      const empty = { likes: 0, comments: 0, shares: 0, followers: 0, timestamp: now };

      const sharesMetrics = { likes: 0, comments: 0, shares: 10, followers: 0, timestamp: now };
      const likesMetrics = { likes: 10, comments: 0, shares: 0, followers: 0, timestamp: now };

      const sharesScore = calculateTrendingScore(sharesMetrics, empty, new Date(Date.now() - 3600 * 1000));
      const likesScore = calculateTrendingScore(likesMetrics, empty, new Date(Date.now() - 3600 * 1000));

      expect(sharesScore).toBeGreaterThan(likesScore);
    });
  });

  describe('getTrendingPosts', () => {
    it('should filter posts within time window', () => {
      const now = new Date();
      const posts = [
        { id: 'p1', publishedAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 5, sharesCount: 2 },
        { id: 'p2', publishedAt: new Date(now.getTime() - 48 * 3600 * 1000).toISOString(), likesCount: 100, commentsCount: 50, sharesCount: 20 },
      ];

      const trending = getTrendingPosts(posts, 24);

      expect(trending).toHaveLength(1);
      expect(trending[0].id).toBe('p1');
    });

    it('should sort by trending score descending', () => {
      const now = new Date();
      const posts = [
        { id: 'p1', publishedAt: new Date(now.getTime() - 1 * 3600 * 1000).toISOString(), likesCount: 5, commentsCount: 1, sharesCount: 0 },
        { id: 'p2', publishedAt: new Date(now.getTime() - 1 * 3600 * 1000).toISOString(), likesCount: 50, commentsCount: 20, sharesCount: 10 },
      ];

      const trending = getTrendingPosts(posts, 24);

      expect(trending[0].id).toBe('p2');
      expect(trending[0]._trendingScore).toBeGreaterThan(trending[1]._trendingScore);
    });

    it('should apply recency boost to posts under 6 hours', () => {
      const now = new Date();
      const posts = [
        { id: 'recent', publishedAt: new Date(now.getTime() - 1 * 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 2, sharesCount: 1 },
        { id: 'older', publishedAt: new Date(now.getTime() - 10 * 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 2, sharesCount: 1 },
      ];

      const trending = getTrendingPosts(posts, 24);

      // Same engagement but different recency boost
      expect(trending[0].id).toBe('recent');
    });

    it('should return empty array when no posts in window', () => {
      const result = getTrendingPosts([], 24);
      expect(result).toEqual([]);
    });
  });

  describe('getTrendingCreators', () => {
    it('should score creators by engagement rate', () => {
      const creators = [
        { id: 'c1', totalChats: 100, totalMessages: 500, followersCount: 10, isVerified: false, createdAt: new Date('2023-01-01').toISOString() },
        { id: 'c2', totalChats: 200, totalMessages: 1000, followersCount: 10, isVerified: false, createdAt: new Date('2023-01-01').toISOString() },
      ];

      const trending = getTrendingCreators(creators);

      expect(trending[0].id).toBe('c2');
      expect(trending[0]._trendingScore).toBeGreaterThan(trending[1]._trendingScore);
    });

    it('should boost new creators (< 30 days)', () => {
      const creators = [
        { id: 'old', totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: false, createdAt: new Date('2022-01-01').toISOString() },
        { id: 'new', totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: false, createdAt: new Date().toISOString() },
      ];

      const trending = getTrendingCreators(creators);

      expect(trending[0].id).toBe('new');
    });

    it('should boost verified creators', () => {
      const creators = [
        { id: 'unverified', totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: false, createdAt: new Date('2023-01-01').toISOString() },
        { id: 'verified', totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: true, createdAt: new Date('2023-01-01').toISOString() },
      ];

      const trending = getTrendingCreators(creators);

      expect(trending[0].id).toBe('verified');
    });
  });

  describe('getTrendingHashtags', () => {
    it('should extract and count hashtags from posts', () => {
      const posts = [
        { id: 'p1', content: 'Check out #coding and #tech' },
        { id: 'p2', content: 'More #coding content' },
        { id: 'p3', content: 'Some #art stuff' },
      ];

      const hashtags = getTrendingHashtags(posts);

      expect(hashtags[0].tag).toBe('#coding');
      expect(hashtags[0].count).toBe(2);
      expect(hashtags[0].posts).toContain('p1');
      expect(hashtags[0].posts).toContain('p2');
    });

    it('should normalize hashtags to lowercase', () => {
      const posts = [
        { id: 'p1', content: '#Coding' },
        { id: 'p2', content: '#coding' },
        { id: 'p3', content: '#CODING' },
      ];

      const hashtags = getTrendingHashtags(posts);

      expect(hashtags).toHaveLength(1);
      expect(hashtags[0].count).toBe(3);
    });

    it('should return empty array for posts without hashtags', () => {
      const posts = [
        { id: 'p1', content: 'No hashtags here' },
      ];

      const hashtags = getTrendingHashtags(posts);

      expect(hashtags).toEqual([]);
    });
  });

  describe('getCategoryTrending', () => {
    it('should filter by category before calculating trending', () => {
      const now = new Date();
      const posts = [
        { id: 'p1', creator: { category: 'Tech' }, publishedAt: new Date(now.getTime() - 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 5, sharesCount: 2 },
        { id: 'p2', creator: { category: 'Art' }, publishedAt: new Date(now.getTime() - 3600 * 1000).toISOString(), likesCount: 50, commentsCount: 20, sharesCount: 10 },
      ];

      const trending = getCategoryTrending(posts, 'Tech');

      expect(trending).toHaveLength(1);
      expect(trending[0].id).toBe('p1');
    });
  });

  describe('getTrendingByTimeWindow', () => {
    it('should delegate to getTrendingPosts for posts type', () => {
      const now = new Date();
      const posts = [
        { id: 'p1', publishedAt: new Date(now.getTime() - 1000).toISOString(), likesCount: 1, commentsCount: 0, sharesCount: 0 },
      ];

      const result = getTrendingByTimeWindow(posts, TrendingTimeWindow.DAILY, 'posts');

      expect(result[0]).toHaveProperty('_trendingScore');
    });

    it('should delegate to getTrendingCreators for creators type', () => {
      const creators = [
        { id: 'c1', totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: false, createdAt: new Date().toISOString() },
      ];

      const result = getTrendingByTimeWindow(creators, TrendingTimeWindow.WEEKLY, 'creators');

      expect(result[0]).toHaveProperty('_trendingScore');
    });
  });
});

// ==========================================================
// EXTENDED BRANCH COVERAGE
// ==========================================================

describe('TrendingService — extended coverage', () => {
  // ---- calculateTrendingScore branches ----

  describe('calculateTrendingScore — decay floor', () => {
    it('applies decayFactor floor of 0.1 for very old content', () => {
      const now = new Date();
      const metrics = { likes: 100, comments: 10, shares: 10, followers: 0, timestamp: now };
      const empty = { likes: 0, comments: 0, shares: 0, followers: 0, timestamp: now };

      // 200 days old → (200 / 24) * 0.1 = 83.3% decay → floor at 0.1
      const veryOldDate = new Date(Date.now() - 200 * 24 * 3600 * 1000);
      const score = calculateTrendingScore(metrics, empty, veryOldDate);

      expect(score).toBeGreaterThan(0);
    });

    it('counts followers in engagement weighting', () => {
      const now = new Date();
      const withFollowers = { likes: 0, comments: 0, shares: 0, followers: 100, timestamp: now };
      const empty = { likes: 0, comments: 0, shares: 0, followers: 0, timestamp: now };
      const recent = new Date(Date.now() - 3600 * 1000);

      const scoreWith = calculateTrendingScore(withFollowers, empty, recent);
      const scoreWithout = calculateTrendingScore(empty, empty, recent);

      expect(scoreWith).toBeGreaterThan(scoreWithout);
    });

    it('velocity is clamped to 0 when recent < older', () => {
      const now = new Date();
      const older = { likes: 100, comments: 50, shares: 20, followers: 0, timestamp: now };
      const recent = { likes: 10, comments: 5, shares: 2, followers: 0, timestamp: now };

      const score = calculateTrendingScore(recent, older, new Date(Date.now() - 3600 * 1000));
      expect(score).toBe(0);
    });

    it('content posted exactly now gets decay close to 1', () => {
      const now = new Date();
      const metrics = { likes: 10, comments: 2, shares: 1, followers: 0, timestamp: now };
      const empty = { likes: 0, comments: 0, shares: 0, followers: 0, timestamp: now };

      // createdAt = now → ageInHours ≈ 0
      const score = calculateTrendingScore(metrics, empty, now);
      expect(score).toBeGreaterThan(0);
    });
  });

  // ---- getTrendingPosts branches ----

  describe('getTrendingPosts — edge cases', () => {
    it('uses createdAt when publishedAt is missing', () => {
      const now = new Date();
      const posts = [
        { id: 'p1', createdAt: new Date(now.getTime() - 1000 * 60).toISOString(), likesCount: 5, commentsCount: 0, sharesCount: 0 },
      ];

      const result = getTrendingPosts(posts, 24);

      expect(result).toHaveLength(1);
      expect(result[0]._velocity).toBeDefined();
    });

    it('ageInHours = 0 uses totalEngagement directly as velocity', () => {
      const now = new Date();
      const posts = [
        { id: 'zero', publishedAt: now.toISOString(), likesCount: 10, commentsCount: 2, sharesCount: 1 },
      ];

      const result = getTrendingPosts(posts, 24);
      // velocity = totalEngagement when ageInHours = 0
      const expectedEngagement = 10 * 1 + 2 * 3 + 1 * 5;
      expect(result[0]._velocity).toBe(expectedEngagement);
    });

    it('post older than 6 hours does NOT get recency boost', () => {
      const now = new Date();
      const posts = [
        { id: 'old', publishedAt: new Date(now.getTime() - 8 * 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 0, sharesCount: 0 },
      ];

      const result = getTrendingPosts(posts, 24);
      // recencyBoost = 1.0
      expect(result[0]._trendingScore).toBe(result[0]._velocity * 1.0);
    });

    it('post under 6 hours DOES get recency boost (1.5×)', () => {
      const now = new Date();
      const posts = [
        { id: 'new', publishedAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(), likesCount: 10, commentsCount: 0, sharesCount: 0 },
      ];

      const result = getTrendingPosts(posts, 24);
      expect(result[0]._trendingScore).toBe(result[0]._velocity * 1.5);
    });

    it('uses HOURLY window (1h) correctly', () => {
      const now = new Date();
      const posts = [
        { id: 'recent', publishedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), likesCount: 5, commentsCount: 0, sharesCount: 0 },
        { id: 'old', publishedAt: new Date(now.getTime() - 90 * 60 * 1000).toISOString(), likesCount: 50, commentsCount: 0, sharesCount: 0 },
      ];

      const result = getTrendingPosts(posts, TrendingTimeWindow.HOURLY);
      expect(result.every(p => p.id === 'recent')).toBe(true);
    });
  });

  // ---- getTrendingCreators branches ----

  describe('getTrendingCreators — edge cases', () => {
    it('treats 0 followers as 1 to avoid division by zero', () => {
      const creators = [
        { id: 'zero', totalChats: 10, totalMessages: 100, followersCount: 0, isVerified: false, createdAt: new Date('2023-01-01').toISOString() },
      ];

      const result = getTrendingCreators(creators);
      expect(result[0]._engagementRate).toBeGreaterThan(0);
    });

    it('verified creator gets 1.2x bonus', () => {
      const base = { totalChats: 10, totalMessages: 50, followersCount: 10, createdAt: new Date('2022-01-01').toISOString() };
      const creators = [
        { ...base, id: 'unverified', isVerified: false },
        { ...base, id: 'verified', isVerified: true },
      ];

      const result = getTrendingCreators(creators);
      const v = result.find(c => c.id === 'verified')!;
      const u = result.find(c => c.id === 'unverified')!;
      expect(v._trendingScore / u._trendingScore).toBeCloseTo(1.2);
    });

    it('new creator (< 30 days) gets 1.3x boost', () => {
      const base = { totalChats: 10, totalMessages: 50, followersCount: 10, isVerified: false };
      const creators = [
        { ...base, id: 'old', createdAt: new Date('2022-01-01').toISOString() },
        { ...base, id: 'new', createdAt: new Date().toISOString() },
      ];

      const result = getTrendingCreators(creators);
      const n = result.find(c => c.id === 'new')!;
      const o = result.find(c => c.id === 'old')!;
      expect(n._trendingScore / o._trendingScore).toBeCloseTo(1.3);
    });
  });

  // ---- getTrendingHashtags branches ----

  describe('getTrendingHashtags — edge cases', () => {
    it('handles posts with empty content', () => {
      const posts = [{ id: 'p1', content: '' }, { id: 'p2' }];
      const result = getTrendingHashtags(posts);
      expect(result).toEqual([]);
    });

    it('sorts hashtags by count descending', () => {
      const posts = [
        { id: 'p1', content: '#a #b #a' },
        { id: 'p2', content: '#a' },
        { id: 'p3', content: '#b' },
      ];
      const result = getTrendingHashtags(posts);
      expect(result[0].tag).toBe('#a');
      expect(result[0].count).toBe(3); // appears twice in p1 + once in p2
    });

    it('deduplicates post ids for same hashtag in same post', () => {
      const posts = [{ id: 'p1', content: '#dup #dup' }];
      const result = getTrendingHashtags(posts);
      // posts set de-duped — only 1 unique post id
      expect(result[0].posts).toHaveLength(1);
    });
  });

  // ---- getCategoryTrending ----

  describe('getCategoryTrending — additional cases', () => {
    it('returns empty when no posts match category', () => {
      const posts = [{ id: 'p1', creator: { category: 'Art' }, publishedAt: new Date().toISOString(), likesCount: 0 }];
      const result = getCategoryTrending(posts, 'Tech');
      expect(result).toHaveLength(0);
    });

    it('handles posts without creator field', () => {
      const posts = [{ id: 'p1', publishedAt: new Date().toISOString(), likesCount: 0 }];
      const result = getCategoryTrending(posts, 'Tech');
      expect(result).toHaveLength(0);
    });
  });

  // ---- TrendingTimeWindow enum ----

  describe('TrendingTimeWindow enum values', () => {
    it('has correct numeric values', () => {
      expect(TrendingTimeWindow.HOURLY).toBe(1);
      expect(TrendingTimeWindow.DAILY).toBe(24);
      expect(TrendingTimeWindow.WEEKLY).toBe(168);
      expect(TrendingTimeWindow.MONTHLY).toBe(720);
    });
  });
});
