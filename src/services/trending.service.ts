// ===========================================
// TRENDING SERVICE
// ===========================================
// Calculate trending creators and posts based on engagement velocity

interface TrendingPostRecord {
  publishedAt?: Date | string;
  createdAt?: Date | string;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  content?: string;
  id?: string;
  creator?: { category?: string | null } | null;
}

interface TrendingCreatorRecord {
  totalChats?: number;
  totalMessages?: number;
  followersCount?: number;
  createdAt: Date | string;
  isVerified?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface TrendingScore {
  id: string;
  score: number;
  velocity: number; // Engagement rate over time
}

interface EngagementMetrics {
  likes: number;
  comments: number;
  shares: number;
  followers?: number;
  timestamp: Date;
}

/**
 * Calculate trending score based on engagement velocity
 * Recent engagement weighted more heavily than old engagement
 *
 * Score = (Recent Engagement / Time Factor) * Recency Boost
 */
export const calculateTrendingScore = (
  recentMetrics: EngagementMetrics,
  olderMetrics: EngagementMetrics,
  createdAt: Date
): number => {
  const now = new Date();
  const ageInHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

  // Calculate total engagement (weighted)
  const calculateEngagement = (metrics: EngagementMetrics) => {
    return (
      metrics.likes * 1 +
      metrics.comments * 3 +
      metrics.shares * 5 +
      (metrics.followers || 0) * 2
    );
  };

  const recentEngagement = calculateEngagement(recentMetrics);
  const olderEngagement = calculateEngagement(olderMetrics);

  // Engagement velocity (growth rate)
  const velocity = Math.max(0, recentEngagement - olderEngagement);

  // Time decay factor (newer content gets boost)
  // Content loses 10% of score per day
  const decayFactor = Math.max(0.1, 1 - (ageInHours / 24) * 0.1);

  // Trending score
  const score = velocity * decayFactor * (1 + recentEngagement / 100);

  return score;
};

/**
 * Get trending posts within a time window
 * @param posts - Posts with engagement metrics
 * @param timeWindow - Hours to look back (24 = daily, 168 = weekly)
 */
export const getTrendingPosts = (
  posts: TrendingPostRecord[],
  timeWindow: number = 24
): (TrendingPostRecord & { _trendingScore: number; _velocity: number })[] => {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - timeWindow * 60 * 60 * 1000);

  // Filter posts within time window
  const recentPosts = posts.filter(post => {
    const postDate = new Date((post.publishedAt || post.createdAt) as Date);
    return postDate >= cutoffTime;
  });

  // Calculate trending score for each post
  const scoredPosts = recentPosts.map(post => {
    const postAge = now.getTime() - new Date((post.publishedAt || post.createdAt) as Date).getTime();
    const ageInHours = postAge / (1000 * 60 * 60);

    // Engagement velocity (engagement per hour)
    const totalEngagement =
      (post.likesCount || 0) * 1 +
      (post.commentsCount || 0) * 3 +
      (post.sharesCount || 0) * 5;

    const velocity = ageInHours > 0 ? totalEngagement / ageInHours : totalEngagement;

    // Recency boost (posts less than 6 hours old get boost)
    const recencyBoost = ageInHours < 6 ? 1.5 : 1.0;

    // Final trending score
    const trendingScore = velocity * recencyBoost;

    return {
      ...post,
      _trendingScore: trendingScore,
      _velocity: velocity,
    };
  });

  // Sort by trending score
  return scoredPosts.sort((a, b) => b._trendingScore - a._trendingScore);
};

/**
 * Get trending creators based on growth metrics
 * @param creators - Creators with follower/engagement data
 * @param timeWindow - Hours to look back
 */
export const getTrendingCreators = (
  creators: TrendingCreatorRecord[],
  _timeWindow: number = 168 // Default: weekly
): (TrendingCreatorRecord & { _trendingScore: number; _engagementRate: number })[] => {
  const now = new Date();

  const scoredCreators = creators.map(creator => {
    // Calculate engagement rate (total engagement / followers)
    const totalEngagement =
      (creator.totalChats || 0) +
      (creator.totalMessages || 0) / 10 + // Messages less valuable than chats
      (creator.followersCount || 0) * 2;

    const followerCount = Math.max(1, creator.followersCount || 1); // Avoid division by zero
    const engagementRate = totalEngagement / followerCount;

    // Account creation age factor (newer creators get boost for discovery)
    const creatorAge = now.getTime() - new Date(creator.createdAt).getTime();
    const ageInDays = creatorAge / (1000 * 60 * 60 * 24);
    const newCreatorBoost = ageInDays < 30 ? 1.3 : 1.0; // 30% boost for creators under 30 days

    // Verification bonus
    const verificationBonus = creator.isVerified ? 1.2 : 1.0;

    // Calculate trending score
    const trendingScore = engagementRate * newCreatorBoost * verificationBonus;

    return {
      ...creator,
      _trendingScore: trendingScore,
      _engagementRate: engagementRate,
    };
  });

  // Sort by trending score
  return scoredCreators.sort((a, b) => b._trendingScore - a._trendingScore);
};

/**
 * Get trending hashtags from posts
 * @param posts - Posts to extract hashtags from
 */
export const getTrendingHashtags = (posts: TrendingPostRecord[]): { tag: string; count: number; posts: string[] }[] => {
  const hashtagMap = new Map<string, { count: number; posts: Set<string> }>();

  // Extract hashtags from post content
  posts.forEach(post => {
    const content = post.content || '';
    const hashtags = content.match(/#[a-zA-Z0-9_]+/g) || [];

    hashtags.forEach((tag: string) => {
      const normalizedTag = tag.toLowerCase();
      const existing = hashtagMap.get(normalizedTag) || { count: 0, posts: new Set() };
      existing.count += 1;
      existing.posts.add(post.id as string);
      hashtagMap.set(normalizedTag, existing);
    });
  });

  // Convert to array and sort by count
  const trending = Array.from(hashtagMap.entries())
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      posts: Array.from(data.posts),
    }))
    .sort((a, b) => b.count - a.count);

  return trending;
};

/**
 * Get category-specific trending posts
 * @param posts - All posts
 * @param category - Category to filter by
 */
export const getCategoryTrending = (posts: TrendingPostRecord[], category: string): (TrendingPostRecord & { _trendingScore: number; _velocity: number })[] => {
  const categoryPosts = posts.filter(post => post.creator?.category === category);
  return getTrendingPosts(categoryPosts, 168); // Weekly trending for categories
};

/**
 * Time-based trending options
 */
export enum TrendingTimeWindow {
  HOURLY = 1,
  DAILY = 24,
  WEEKLY = 168,
  MONTHLY = 720,
}

/**
 * Get trending content by time window
 */
export const getTrendingByTimeWindow = (
  content: TrendingPostRecord[] | TrendingCreatorRecord[],
  window: TrendingTimeWindow,
  type: 'posts' | 'creators'
): unknown[] => {
  if (type === 'posts') {
    return getTrendingPosts(content as TrendingPostRecord[], window);
  } else {
    return getTrendingCreators(content as TrendingCreatorRecord[], window);
  }
};
