// ===========================================
// RECOMMENDATION SERVICE
// ===========================================
// Personalized creator and post recommendations

interface CreatorRecord {
  id: string;
  category?: string | null;
  followersCount?: number | null;
  postsCount?: number | null;
  isVerified?: boolean;
  createdAt: Date | string;
  tags?: string[];
}

interface PostRecord {
  id?: string;
  creatorId?: string;
  creator?: { category?: string | null } | null;
  likesCount?: number;
  commentsCount?: number;
  _recommendationScore?: number;
}

interface RecommendationScore {
  id: string;
  score: number;
  reasons: string[];
}

interface UserProfile {
  userId: string;
  followingIds: string[];
  likedPostCategories: string[];
  interactionHistory: string[];
}

interface PrismaClient {
  follow: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<any[]>;
  };
  like: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<any[]>;
  };
  creator: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<any[]>;
  };
}

/**
 * Calculate recommendation score for a creator
 * Based on user's interests, following patterns, and creator popularity
 */
export const calculateCreatorRecommendationScore = (
  creator: CreatorRecord,
  userProfile: UserProfile,
  allCreators: CreatorRecord[]
): RecommendationScore => {
  let score = 0;
  const reasons: string[] = [];

  // 1. Category match (40 points)
  if (creator.category && userProfile.likedPostCategories.includes(creator.category)) {
    score += 40;
    reasons.push(`Matches your interest in ${creator.category}`);
  }

  // 2. Similar to followed creators (30 points)
  const followedCreators = allCreators.filter(c =>
    userProfile.followingIds.includes(c.id)
  );
  const followedCategories = followedCreators.map(c => c.category);

  if (followedCategories.includes(creator.category)) {
    score += 30;
    reasons.push('Similar to creators you follow');
  }

  // 3. Popularity score (20 points max)
  const followersCount = creator.followersCount || 0;
  const popularityScore = Math.min(20, Math.log10(followersCount + 1) * 4);
  score += popularityScore;

  if (popularityScore > 15) {
    reasons.push('Popular creator');
  }

  // 4. Activity score (20 points max)
  const postsCount = creator.postsCount || 0;
  const activityScore = Math.min(20, Math.log10(postsCount + 1) * 5);
  score += activityScore;

  if (activityScore > 15) {
    reasons.push('Very active');
  }

  // 5. Verification bonus (10 points)
  if (creator.isVerified) {
    score += 10;
    reasons.push('Verified creator');
  }

  // 6. New creator boost (15 points if less than 30 days old)
  const creatorAge = Date.now() - new Date(creator.createdAt).getTime();
  const ageInDays = creatorAge / (1000 * 60 * 60 * 24);

  if (ageInDays < 30) {
    score += 15;
    reasons.push('New to the platform');
  }

  // 7. Penalty if already following (-100 points)
  if (userProfile.followingIds.includes(creator.id)) {
    score -= 100;
  }

  return {
    id: creator.id,
    score: Math.max(0, score),
    reasons,
  };
};

/**
 * Get creator recommendations based on collaborative filtering
 * "Users who follow X also follow Y"
 */
export const getCollaborativeRecommendations = async (
  prisma: PrismaClient,
  userId: string,
  limit: number = 10
): Promise<string[]> => {
  // Get user's following list
  const userFollowing = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const followingIds = userFollowing.map((f: any) => f.followingId as string);

  if (followingIds.length === 0) {
    return [];
  }

  // Find users with similar following patterns
  const similarUsers = await prisma.follow.findMany({
    where: {
      followingId: { in: followingIds },
      followerId: { not: userId },
    },
    select: {
      followerId: true,
    },
  });

  // Count occurrences to find most similar users
  const userCounts = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  similarUsers.forEach((follow: any) => {
    const count = userCounts.get(follow.followerId as string) || 0;
    userCounts.set(follow.followerId as string, count + 1);
  });

  // Get top similar users (who follow at least 2 same creators)
  const topSimilarUsers = Array.from(userCounts.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([userId]) => userId);

  if (topSimilarUsers.length === 0) {
    return [];
  }

  // Get creators that similar users follow but current user doesn't
  const recommendations = await prisma.follow.findMany({
    where: {
      followerId: { in: topSimilarUsers },
      followingId: { notIn: followingIds },
    },
    select: {
      followingId: true,
    },
  });

  // Count and rank recommendations
  const creatorCounts = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recommendations.forEach((follow: any) => {
    const count = creatorCounts.get(follow.followingId as string) || 0;
    creatorCounts.set(follow.followingId as string, count + 1);
  });

  // Return top recommended creator IDs
  return Array.from(creatorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([creatorId]) => creatorId);
};

/**
 * Get content-based recommendations
 * Based on user's interaction history and preferences
 */
export const getContentBasedRecommendations = (
  creators: CreatorRecord[],
  userProfile: UserProfile,
  limit: number = 10
): (CreatorRecord & { _recommendationScore: number; _reasons: string[] })[] => {
  // Calculate scores for all creators
  const scoredCreators = creators
    .filter(creator => !userProfile.followingIds.includes(creator.id))
    .map(creator => {
      const scoreData = calculateCreatorRecommendationScore(creator, userProfile, creators);
      return {
        ...creator,
        _recommendationScore: scoreData.score,
        _reasons: scoreData.reasons,
      };
    });

  // Sort by score and return top N
  return scoredCreators
    .sort((a, b) => b._recommendationScore - a._recommendationScore)
    .slice(0, limit);
};

/**
 * Get similar creators based on a specific creator
 * Used for "Similar Creators" sections
 */
export const getSimilarCreators = (
  targetCreator: CreatorRecord,
  allCreators: CreatorRecord[],
  limit: number = 5
): (CreatorRecord & { _similarityScore: number })[] => {
  const scoredCreators = allCreators
    .filter(c => c.id !== targetCreator.id)
    .map(creator => {
      let similarityScore = 0;

      // Same category (50 points)
      if (creator.category === targetCreator.category) {
        similarityScore += 50;
      }

      // Similar follower count (20 points max)
      const cFollowers = creator.followersCount ?? 0;
      const tFollowers = targetCreator.followersCount ?? 0;
      const followerRatio = Math.min(cFollowers, tFollowers) / Math.max(cFollowers, tFollowers, 1);
      similarityScore += followerRatio * 20;

      // Similar activity level (15 points max)
      const cPosts = creator.postsCount ?? 0;
      const tPosts = targetCreator.postsCount ?? 0;
      const postsRatio = Math.min(cPosts, tPosts) / Math.max(cPosts, tPosts, 1);
      similarityScore += postsRatio * 15;

      // Both verified (15 points)
      if (creator.isVerified && targetCreator.isVerified) {
        similarityScore += 15;
      }

      return {
        ...creator,
        _similarityScore: similarityScore,
      };
    });

  return scoredCreators
    .sort((a, b) => b._similarityScore - a._similarityScore)
    .slice(0, limit);
};

/**
 * Get recommended posts based on user preferences
 */
export const getRecommendedPosts = (
  posts: PostRecord[],
  userProfile: UserProfile
): (PostRecord & { _recommendationScore: number })[] => {
  return posts.map(post => {
    let score = 0;

    // Category match
    if (post.creator?.category && userProfile.likedPostCategories.includes(post.creator.category)) {
      score += 30;
    }

    // From followed creator
    if (post.creatorId && userProfile.followingIds.includes(post.creatorId)) {
      score += 40;
    }

    // Engagement score
    const engagement = (post.likesCount || 0) + (post.commentsCount || 0) * 3;
    score += Math.min(30, Math.log10(engagement + 1) * 10);

    return {
      ...post,
      _recommendationScore: score,
    };
  }).sort((a, b) => b._recommendationScore - a._recommendationScore);
};

/**
 * Build user profile from activity
 */
export const buildUserProfile = async (
  prisma: PrismaClient,
  userId: string
): Promise<UserProfile> => {
  // Get following list
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  // Get liked posts to determine category preferences
  const likedPosts = await prisma.like.findMany({
    where: { userId },
    include: {
      post: {
        include: {
          creator: {
            select: { category: true },
          },
        },
      },
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  // Extract categories from liked posts
  const categories = likedPosts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((like: any) => {
      const post = like.post;
      const creator = post?.creator;
      return creator?.category as string | undefined;
    })
    .filter(Boolean) as string[];

  // Count category occurrences
  const categoryCounts = new Map<string, number>();
  categories.forEach((category: string) => {
    const count = categoryCounts.get(category) || 0;
    categoryCounts.set(category, count + 1);
  });

  // Get top 3 categories
  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

  return {
    userId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    followingIds: following.map((f: any) => f.followingId as string),
    likedPostCategories: topCategories,
    interactionHistory: [], // TODO: Track chat history, comments, etc.
  };
};

/**
 * Diversity function to avoid filter bubbles
 * Ensures recommendations include variety
 */
export const diversifyRecommendations = (
  recommendations: (CreatorRecord & { _recommendationScore: number })[],
  diversityFactor: number = 0.3
): (CreatorRecord & { _recommendationScore: number })[] => {
  const categoryCounts = new Map<string, number>();
  const diversified: (CreatorRecord & { _recommendationScore: number })[] = [];

  for (const rec of recommendations) {
    const category = rec.category || 'uncategorized';
    const count = categoryCounts.get(category) || 0;

    // Penalize if category is overrepresented
    const penalty = count * diversityFactor;
    const adjustedScore = rec._recommendationScore - penalty;

    diversified.push({
      ...rec,
      _recommendationScore: adjustedScore,
    });

    categoryCounts.set(category, count + 1);
  }

  return diversified.sort((a, b) => b._recommendationScore - a._recommendationScore);
};

/**
 * Get recommended creators for user dashboard
 * Optimized for user panel API
 */
export const getRecommendedCreatorsForUser = async (params: {
  userId: string;
  interests: string[];
  followingIds: string[];
  limit: number;
}) => {
  const { userId, interests, followingIds, limit } = params;
  void userId;

  // Use internal prisma import
  const prisma = (await import('../../prisma/client')).default;

  // Get categories from followed creators
  const followedCreators = await prisma.creator.findMany({
    where: { id: { in: followingIds } },
    select: { category: true, tags: true }
  });

  const followedCategories = followedCreators
    .map(c => c.category)
    .filter(Boolean) as string[];

  const followedTags = followedCreators
    .flatMap(c => c.tags)
    .filter(Boolean) as string[];

  // Combine all relevant categories and tags
  const relevantCategories = [...new Set([...interests, ...followedCategories])];
  const relevantTags = [...new Set([...interests, ...followedTags])];

  // Build recommendation query
  const recommendations = await prisma.creator.findMany({
    where: {
      id: { notIn: followingIds },
      isActive: true,
      isVerified: true,
      OR: [
        { category: { in: relevantCategories } },
        { tags: { hasSome: relevantTags } }
      ]
    },
    take: limit * 2, // Get more than needed to filter
    orderBy: [
      { followersCount: 'desc' },
      { rating: 'desc' },
      { totalChats: 'desc' }
    ],
    select: {
      id: true,
      displayName: true,
      profileImage: true,
      category: true,
      tagline: true,
      isVerified: true,
      followersCount: true,
      rating: true,
      totalChats: true,
      tags: true
    }
  });

  // Score and rank recommendations
  const scoredRecommendations = recommendations.map(creator => {
    let score = 0;

    // Interest match (highest weight)
    if (interests.includes(creator.category || '')) {
      score += 40;
    }

    // Tag matches
    const matchingTags = creator.tags.filter(tag => relevantTags.includes(tag));
    score += matchingTags.length * 10;

    // Similar to followed creators
    if (followedCategories.includes(creator.category || '')) {
      score += 20;
    }

    // Popularity bonus
    if (creator.followersCount && creator.followersCount > 500) {
      score += 15;
    }

    // Rating bonus
    if (creator.rating && Number(creator.rating) >= 4.5) {
      score += 10;
    }

    // Activity bonus
    if (creator.totalChats && creator.totalChats > 1000) {
      score += 5;
    }

    return {
      ...creator,
      score,
      reasons: [] as string[]
    };
  });

  // Sort by score and take top results
  const topRecommendations = scoredRecommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Add reasons for recommendations
  const enrichedRecommendations = topRecommendations.map(rec => {
    const reasons: string[] = [];

    if (interests.includes(rec.category || '')) {
      reasons.push('Matches your interests');
    }

    if (followedCategories.includes(rec.category || '')) {
      reasons.push('Similar to creators you follow');
    }

    if (rec.followersCount && rec.followersCount > 500) {
      reasons.push('Popular creator');
    }

    if (rec.rating && Number(rec.rating) >= 4.5) {
      reasons.push('Highly rated');
    }

    if (rec.totalChats && rec.totalChats > 1000) {
      reasons.push('Very active');
    }

    return {
      ...rec,
      reasons
    };
  });

  return enrichedRecommendations;
};
