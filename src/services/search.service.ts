// ===========================================
// SEARCH SERVICE
// ===========================================
// Enhanced global search across creators, posts, users, and hashtags

interface SearchResult {
  type: 'creator' | 'post' | 'user' | 'hashtag';
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  url: string;
  relevance: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface SearchFilters {
  type?: 'all' | 'creator' | 'post' | 'user' | 'hashtag';
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
  verified?: boolean;
}

/**
 * Calculate search relevance score
 * Higher score = better match
 */
export const calculateRelevanceScore = (
  query: string,
  title: string,
  subtitle?: string,
  tags?: string[]
): number => {
  const queryLower = query.toLowerCase();
  const titleLower = title.toLowerCase();
  const subtitleLower = subtitle?.toLowerCase() || '';

  let score = 0;

  // Exact match bonus (100 points)
  if (titleLower === queryLower) {
    score += 100;
  }

  // Starts with query (50 points)
  else if (titleLower.startsWith(queryLower)) {
    score += 50;
  }

  // Contains query (25 points)
  else if (titleLower.includes(queryLower)) {
    score += 25;
  }

  // Subtitle match (15 points)
  if (subtitleLower.includes(queryLower)) {
    score += 15;
  }

  // Tag match (10 points per tag)
  if (tags) {
    tags.forEach(tag => {
      if (tag.toLowerCase().includes(queryLower)) {
        score += 10;
      }
    });
  }

  // Word boundary match bonus (20 points)
  const words = titleLower.split(/\s+/);
  if (words.some(word => word.startsWith(queryLower))) {
    score += 20;
  }

  // Length penalty (prefer shorter, more specific matches)
  const lengthRatio = queryLower.length / titleLower.length;
  score += lengthRatio * 10;

  return score;
};

/**
 * Format search results with relevance scoring
 */
export const formatSearchResults = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any[],
  query: string,
  type: 'creator' | 'post' | 'user' | 'hashtag'
): SearchResult[] => {
  return results.map((item) => {
    let searchResult: SearchResult;

    switch (type) {
      case 'creator':
        searchResult = {
          type: 'creator',
          id: item.id,
          title: item.displayName,
          subtitle: item.bio,
          image: item.profileImage,
          url: `/creator/${item.id}`,
          relevance: calculateRelevanceScore(query, item.displayName, item.bio, [item.category]),
        };
        break;

      case 'post':
        searchResult = {
          type: 'post',
          id: item.id,
          title: item.content.substring(0, 100),
          subtitle: item.creator?.displayName,
          image: item.creator?.profileImage,
          url: `/posts/${item.id}`,
          relevance: calculateRelevanceScore(query, item.content, item.creator?.displayName),
        };
        break;

      case 'user':
        searchResult = {
          type: 'user',
          id: item.id,
          title: item.name,
          subtitle: item.email,
          image: item.avatar,
          url: `/profile/${item.id}`,
          relevance: calculateRelevanceScore(query, item.name, item.email),
        };
        break;

      case 'hashtag':
        searchResult = {
          type: 'hashtag',
          id: item.tag,
          title: item.tag,
          subtitle: `${item.count} posts`,
          url: `/search?q=${encodeURIComponent(item.tag)}`,
          relevance: calculateRelevanceScore(query, item.tag),
        };
        break;
    }

    return searchResult;
  }).sort((a, b) => b.relevance - a.relevance);
};

/**
 * Get autocomplete suggestions
 */
export const getAutocompleteSuggestions = (
  allResults: SearchResult[],
  limit: number = 10
): SearchResult[] => {
  // Sort by relevance and limit
  return allResults
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
};

/**
 * Generate search query for database
 */
export const buildSearchQuery = (query: string) => {
  // Split into words for partial matching
  const words = query.trim().split(/\s+/);

  return {
    OR: words.map((word: string) => ({
      contains: word,
      mode: 'insensitive' as const,
    })),
  };
};

/**
 * Highlight matching text in search results
 */
export const highlightMatch = (text: string, query: string): string => {
  if (!query) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
};

/**
 * Popular search queries tracking
 */
const popularSearches = new Map<string, number>();

export const trackSearch = (query: string) => {
  const normalizedQuery = query.toLowerCase().trim();
  const currentCount = popularSearches.get(normalizedQuery) || 0;
  popularSearches.set(normalizedQuery, currentCount + 1);
};

export const getPopularSearches = (limit: number = 10): string[] => {
  return Array.from(popularSearches.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([query]) => query);
};

/**
 * Search history management (for recent searches)
 */
export class SearchHistory {
  private static readonly MAX_HISTORY = 10;
  private static readonly STORAGE_KEY = 'search_history';

  static add(query: string) {
    const history = this.get();
    const normalizedQuery = query.trim();

    if (!normalizedQuery) return;

    // Remove if already exists
    const filtered = history.filter(q => q !== normalizedQuery);

    // Add to beginning
    filtered.unshift(normalizedQuery);

    // Limit size
    const _limited = filtered.slice(0, this.MAX_HISTORY);

    // Save to localStorage
    // No-op in backend
  }

  static get(): string[] {
    return [];
  }

  static clear() {
    // No-op in backend
  }

  static remove(_query: string) {
    // No-op in backend
  }
}
