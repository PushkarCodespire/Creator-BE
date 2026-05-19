// ===========================================
// FEED ALGORITHM SERVICE
// ===========================================
// Personalized feed ranking based on user preferences, engagement, and recency

interface PostScore {
  postId: string;
  score: number;
  reasons: string[];
}

interface ScoringFactors {
  isFollowing: boolean;
  recencyHours: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  creatorId: string;
}

/**
 * Calculate personalized score for a post
 * Higher score = higher priority in feed
 */
export const calculatePostScore = (factors: ScoringFactors, recentCreatorIds: string[]): PostScore => {
  let score = 0;
  const reasons: string[] = [];

  // 1. Following bonus (40 points)
  if (factors.isFollowing) {
    score += 40;
    reasons.push('Following creator');
  } else {
    score += 10; // Discovery bonus for non-followed creators
    reasons.push('Discovery');
  }

  // 2. Recency score (30 points max)
  // Posts lose 1 point per hour, capped at 30 hours
  const recencyScore = Math.max(0, 30 - factors.recencyHours);
  score += recencyScore;
  if (recencyScore > 20) {
    reasons.push('Very recent');
  } else if (recencyScore > 10) {
    reasons.push('Recent');
  }

  // 3. Engagement score (30 points max)
  // Weighted: likes (1pt each), comments (3pts each), shares (5pts each)
  const engagementScore = Math.min(
    30,
    factors.likesCount * 1 + factors.commentsCount * 3 + factors.sharesCount * 5
  );
  score += engagementScore;
  if (engagementScore > 20) {
    reasons.push('High engagement');
  } else if (engagementScore > 10) {
    reasons.push('Popular');
  }

  // 4. Diversity penalty (-20 points)
  // Penalize if we've shown too many posts from this creator recently
  const creatorPostCount = recentCreatorIds.filter(id => id === factors.creatorId).length;
  if (creatorPostCount >= 3) {
    score -= 20;
    reasons.push('Diversity adjustment');
  }

  return {
    postId: factors.creatorId,
    score: Math.max(0, score),
    reasons,
  };
};

/**
 * Rank posts for personalized feed
 */
export const rankPosts = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posts: any[],
  userId: string | null,
  followingIds: string[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] => {
  const recentCreatorIds: string[] = [];

  const scoredPosts = posts.map(post => {
    const isFollowing = followingIds.includes(post.creatorId);
    const publishedAt = new Date(post.publishedAt || post.createdAt);
    const now = new Date();
    const recencyHours = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);

    const score = calculatePostScore(
      {
        isFollowing,
        recencyHours,
        likesCount: post.likesCount || 0,
        commentsCount: post.commentsCount || 0,
        sharesCount: post.sharesCount || 0,
        creatorId: post.creatorId,
      },
      recentCreatorIds
    );

    // Track this creator for diversity
    recentCreatorIds.push(post.creatorId);

    return {
      ...post,
      _score: score.score,
      _scoreReasons: score.reasons,
    };
  });

  // Sort by score descending
  return scoredPosts.sort((a, b) => b._score - a._score);
};

/**
 * Mix followed and discovery posts
 * Ensures 70% followed, 30% discovery for users with follows
 */
export const mixFeedContent = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  followedPosts: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  discoveryPosts: any[],
  limit: number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] => {
  const followedCount = Math.ceil(limit * 0.7);
  const discoveryCount = limit - followedCount;

  const mixed = [
    ...followedPosts.slice(0, followedCount),
    ...discoveryPosts.slice(0, discoveryCount),
  ];

  // Shuffle slightly to avoid predictable patterns
  return shuffleWithBias(mixed, 0.8); // 80% keep original order
};

/**
 * Shuffle array with bias towards original order
 * bias = 1.0 means no shuffle, 0.0 means full random shuffle
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shuffleWithBias = (array: any[], bias: number): any[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    if (Math.random() > bias) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  return shuffled;
};

/**
 * Get recommended posts for new users (no follows yet)
 */
export const getDefaultFeedQuery = () => {
  // For new users, show trending/popular content
  return {
    orderBy: [
      { likesCount: 'desc' as const },
      { publishedAt: 'desc' as const },
    ],
  };
};
