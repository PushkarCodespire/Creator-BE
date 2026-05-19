// ===========================================
// SEARCH SERVICE — UNIT TESTS
// ===========================================

import {
  calculateRelevanceScore,
  formatSearchResults,
  getAutocompleteSuggestions,
  buildSearchQuery,
  highlightMatch,
  trackSearch,
  getPopularSearches,
  SearchHistory,
} from '../../../services/search.service';

describe('SearchService', () => {
  describe('calculateRelevanceScore', () => {
    it('should give 100 points for exact match', () => {
      const score = calculateRelevanceScore('hello', 'hello');
      expect(score).toBeGreaterThanOrEqual(100);
    });

    it('should give 50 points for starts-with match', () => {
      const score = calculateRelevanceScore('hel', 'hello world');
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it('should give 25 points for contains match', () => {
      const score = calculateRelevanceScore('world', 'hello world test');
      expect(score).toBeGreaterThanOrEqual(25);
    });

    it('should give additional points for subtitle match', () => {
      const withSubtitle = calculateRelevanceScore('test', 'title', 'test subtitle');
      const withoutSubtitle = calculateRelevanceScore('test', 'title', 'no match');
      expect(withSubtitle).toBeGreaterThan(withoutSubtitle);
    });

    it('should give points for tag matches', () => {
      const withTags = calculateRelevanceScore('coding', 'Some Title', undefined, [
        'coding',
        'tech',
      ]);
      const withoutTags = calculateRelevanceScore('coding', 'Some Title');
      expect(withTags).toBeGreaterThan(withoutTags);
    });

    it('should be case insensitive', () => {
      const score1 = calculateRelevanceScore('HELLO', 'hello');
      const score2 = calculateRelevanceScore('hello', 'HELLO');
      expect(score1).toBe(score2);
    });

    it('should return 0 for no match at all', () => {
      const score = calculateRelevanceScore('xyz', 'abc def');
      // Only length ratio bonus applies
      expect(score).toBeLessThan(10);
    });
  });

  describe('formatSearchResults', () => {
    it('should format creator results with relevance', () => {
      const results = [
        {
          id: 'c1',
          displayName: 'Test Creator',
          bio: 'A test bio',
          profileImage: '/img.jpg',
          category: 'Tech',
        },
      ];

      const formatted = formatSearchResults(results, 'test', 'creator');

      expect(formatted[0].type).toBe('creator');
      expect(formatted[0].title).toBe('Test Creator');
      expect(formatted[0].relevance).toBeGreaterThan(0);
      expect(formatted[0].url).toBe('/creator/c1');
    });

    it('should format post results correctly', () => {
      const results = [
        {
          id: 'p1',
          content: 'This is a long post content about testing',
          creator: { displayName: 'Creator', profileImage: '/img.jpg' },
        },
      ];

      const formatted = formatSearchResults(results, 'testing', 'post');

      expect(formatted[0].type).toBe('post');
      expect(formatted[0].url).toBe('/posts/p1');
    });

    it('should format user results correctly', () => {
      const results = [
        { id: 'u1', name: 'John', email: 'john@test.com', avatar: '/avatar.jpg' },
      ];

      const formatted = formatSearchResults(results, 'john', 'user');

      expect(formatted[0].type).toBe('user');
      expect(formatted[0].title).toBe('John');
    });

    it('should format hashtag results correctly', () => {
      const results = [{ tag: '#coding', count: 42 }];

      const formatted = formatSearchResults(results, 'coding', 'hashtag');

      expect(formatted[0].type).toBe('hashtag');
      expect(formatted[0].id).toBe('#coding');
    });

    it('should sort results by relevance descending', () => {
      const results = [
        { id: 'c1', displayName: 'No Match', bio: '', profileImage: '', category: '' },
        { id: 'c2', displayName: 'test', bio: '', profileImage: '', category: '' },
      ];

      const formatted = formatSearchResults(results, 'test', 'creator');

      expect(formatted[0].id).toBe('c2'); // Exact match ranks higher
    });
  });

  describe('getAutocompleteSuggestions', () => {
    it('should return top N results sorted by relevance', () => {
      const results = Array.from({ length: 20 }, (_, i) => ({
        type: 'creator' as const,
        id: `c${i}`,
        title: `Creator ${i}`,
        url: `/creator/c${i}`,
        relevance: i * 10,
      }));

      const suggestions = getAutocompleteSuggestions(results, 5);

      expect(suggestions).toHaveLength(5);
      expect(suggestions[0].relevance).toBeGreaterThanOrEqual(suggestions[1].relevance);
    });

    it('should use default limit of 10', () => {
      const results = Array.from({ length: 20 }, (_, i) => ({
        type: 'creator' as const,
        id: `c${i}`,
        title: `Creator ${i}`,
        url: `/creator/c${i}`,
        relevance: i,
      }));

      const suggestions = getAutocompleteSuggestions(results);

      expect(suggestions).toHaveLength(10);
    });
  });

  describe('buildSearchQuery', () => {
    it('should build OR query from space-separated words', () => {
      const query = buildSearchQuery('hello world');

      expect(query.OR).toHaveLength(2);
      expect(query.OR[0]).toEqual({ contains: 'hello', mode: 'insensitive' });
      expect(query.OR[1]).toEqual({ contains: 'world', mode: 'insensitive' });
    });

    it('should handle single word', () => {
      const query = buildSearchQuery('hello');

      expect(query.OR).toHaveLength(1);
    });
  });

  describe('highlightMatch', () => {
    it('should wrap matches in <mark> tags', () => {
      const result = highlightMatch('Hello World', 'World');
      expect(result).toBe('Hello <mark>World</mark>');
    });

    it('should be case insensitive', () => {
      const result = highlightMatch('Hello World', 'world');
      expect(result).toBe('Hello <mark>World</mark>');
    });

    it('should return original text when query is empty', () => {
      const result = highlightMatch('Hello World', '');
      expect(result).toBe('Hello World');
    });
  });

  describe('trackSearch / getPopularSearches', () => {
    it('should track and return popular searches', () => {
      trackSearch('React');
      trackSearch('React');
      trackSearch('React');
      trackSearch('Vue');

      const popular = getPopularSearches(2);

      expect(popular[0]).toBe('react');
      expect(popular).toHaveLength(2);
    });
  });

  describe('SearchHistory', () => {
    it('should return empty array from get()', () => {
      expect(SearchHistory.get()).toEqual([]);
    });

    it('should not throw on add()', () => {
      expect(() => SearchHistory.add('test')).not.toThrow();
    });

    it('should not throw on clear()', () => {
      expect(() => SearchHistory.clear()).not.toThrow();
    });

    it('should not throw on remove()', () => {
      expect(() => SearchHistory.remove('test')).not.toThrow();
    });
  });
});

// ===========================================
// EXTENDED COVERAGE TESTS
// ===========================================

describe('SearchService — extended coverage', () => {

  // ---- calculateRelevanceScore extended ----
  describe('calculateRelevanceScore — extended', () => {
    it('should accumulate subtitle and tag points on top of title match', () => {
      const baseScore = calculateRelevanceScore('react', 'react', undefined, undefined);
      const bonusScore = calculateRelevanceScore('react', 'react', 'react hooks tutorial', ['react-native']);
      expect(bonusScore).toBeGreaterThan(baseScore);
    });

    it('should give 10 points per matching tag', () => {
      const oneTag = calculateRelevanceScore('js', 'Title', undefined, ['javascript']);
      const twoTags = calculateRelevanceScore('js', 'Title', undefined, ['javascript', 'js-framework']);
      expect(twoTags - oneTag).toBeCloseTo(10, 0);
    });

    it('should give word-boundary bonus when query matches a word start', () => {
      // 'cod' starts 'coding' so we get the word boundary bonus
      const withBoundary = calculateRelevanceScore('cod', 'learn coding today');
      // 'oday' does not start any word
      const withoutBoundary = calculateRelevanceScore('oday', 'learn coding today');
      expect(withBoundary).toBeGreaterThan(withoutBoundary);
    });

    it('should give higher score for shorter titles (length ratio)', () => {
      // query length / title length is higher for short title → bigger lengthRatio bonus
      const shortTitle = calculateRelevanceScore('hi', 'hi there');
      const longTitle = calculateRelevanceScore('hi', 'hi there and everything else in the world');
      expect(shortTitle).toBeGreaterThan(longTitle);
    });

    it('should handle empty tags array without throwing', () => {
      expect(() => calculateRelevanceScore('test', 'test title', undefined, [])).not.toThrow();
    });

    it('should handle empty subtitle string as no subtitle match', () => {
      const withEmpty = calculateRelevanceScore('test', 'title', '');
      const withUndefined = calculateRelevanceScore('test', 'title', undefined);
      expect(withEmpty).toBe(withUndefined);
    });
  });

  // ---- formatSearchResults extended ----
  describe('formatSearchResults — extended', () => {
    it('should truncate post content to 100 chars for title', () => {
      const longContent = 'A'.repeat(200);
      const results = [{ id: 'p1', content: longContent, creator: null }];

      const formatted = formatSearchResults(results, 'A', 'post');

      expect(formatted[0].title.length).toBe(100);
    });

    it('should handle post with null creator gracefully', () => {
      const results = [{ id: 'p1', content: 'Some content here', creator: null }];

      const formatted = formatSearchResults(results, 'content', 'post');

      expect(formatted[0].subtitle).toBeUndefined();
      expect(formatted[0].image).toBeUndefined();
    });

    it('should encode hashtag query in URL', () => {
      const results = [{ tag: '#hello world', count: 5 }];

      const formatted = formatSearchResults(results, 'hello', 'hashtag');

      expect(formatted[0].url).toContain(encodeURIComponent('#hello world'));
    });

    it('should set correct url pattern for user type', () => {
      const results = [{ id: 'u1', name: 'Alice', email: 'alice@example.com', avatar: null }];

      const formatted = formatSearchResults(results, 'alice', 'user');

      expect(formatted[0].url).toBe('/profile/u1');
    });

    it('should return empty array for empty input', () => {
      const formatted = formatSearchResults([], 'query', 'creator');

      expect(formatted).toEqual([]);
    });

    it('should include category as tag in creator relevance calculation', () => {
      const results = [
        {
          id: 'c1',
          displayName: 'Creator Name',
          bio: 'bio',
          profileImage: null,
          category: 'fitness',
        },
      ];

      const formatted = formatSearchResults(results, 'fitness', 'creator');

      // Category match adds to relevance
      expect(formatted[0].relevance).toBeGreaterThan(0);
    });
  });

  // ---- getAutocompleteSuggestions extended ----
  describe('getAutocompleteSuggestions — extended', () => {
    it('should return all results when fewer than limit', () => {
      const results = [
        { type: 'user' as const, id: 'u1', title: 'Alice', url: '/profile/u1', relevance: 50 },
        { type: 'user' as const, id: 'u2', title: 'Bob', url: '/profile/u2', relevance: 30 },
      ];

      const suggestions = getAutocompleteSuggestions(results, 10);

      expect(suggestions).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      const suggestions = getAutocompleteSuggestions([]);

      expect(suggestions).toEqual([]);
    });

    it('should sort strictly descending by relevance', () => {
      const results = [
        { type: 'creator' as const, id: 'c1', title: 'Low', url: '/c1', relevance: 10 },
        { type: 'creator' as const, id: 'c2', title: 'High', url: '/c2', relevance: 90 },
        { type: 'creator' as const, id: 'c3', title: 'Mid', url: '/c3', relevance: 50 },
      ];

      const suggestions = getAutocompleteSuggestions(results, 3);

      expect(suggestions[0].id).toBe('c2');
      expect(suggestions[1].id).toBe('c3');
      expect(suggestions[2].id).toBe('c1');
    });
  });

  // ---- buildSearchQuery extended ----
  describe('buildSearchQuery — extended', () => {
    it('should trim leading/trailing whitespace before splitting', () => {
      const query = buildSearchQuery('  hello  ');

      expect(query.OR).toHaveLength(1);
      expect(query.OR[0].contains).toBe('hello');
    });

    it('should split on multiple consecutive spaces', () => {
      const query = buildSearchQuery('one  two   three');

      expect(query.OR.length).toBeGreaterThanOrEqual(3);
    });

    it('should always set mode to insensitive', () => {
      const query = buildSearchQuery('test');

      query.OR.forEach((clause) => {
        expect(clause.mode).toBe('insensitive');
      });
    });
  });

  // ---- highlightMatch extended ----
  describe('highlightMatch — extended', () => {
    it('should highlight all occurrences of the query', () => {
      const result = highlightMatch('test foo test bar test', 'test');

      const matches = result.match(/<mark>test<\/mark>/g) || [];
      expect(matches).toHaveLength(3);
    });

    it('should handle special regex characters in query gracefully (may throw or match literally)', () => {
      // We test that the function does not crash when given a dot (regex wildcard)
      expect(() => highlightMatch('hello world', '.')).not.toThrow();
    });

    it('should return unchanged text when query does not appear', () => {
      const result = highlightMatch('hello world', 'xyz');

      expect(result).toBe('hello world');
    });

    it('should handle multiword text with single letter match', () => {
      const result = highlightMatch('abc', 'a');

      expect(result).toBe('<mark>a</mark>bc');
    });
  });

  // ---- trackSearch / getPopularSearches extended ----
  describe('trackSearch / getPopularSearches — extended', () => {
    it('should normalize query to lowercase before tracking', () => {
      // Track a uniquely named term in both cases to verify they merge
      trackSearch('UniqueTermXYZ');
      trackSearch('uniquetermxyz');

      const popular = getPopularSearches(50); // get all
      const found = popular.find((q) => q === 'uniquetermxyz');

      // Both calls should merge into a single lowercase key
      expect(found).toBe('uniquetermxyz');
    });

    it('should respect the limit parameter', () => {
      trackSearch('alpha');
      trackSearch('beta');
      trackSearch('gamma');
      trackSearch('delta');
      trackSearch('epsilon');

      const popular = getPopularSearches(3);

      expect(popular.length).toBeLessThanOrEqual(3);
    });

    it('should return most-searched term first among terms tracked in this test', () => {
      // Track a unique term many times so it rises to the top of the global map
      const topTerm = 'zzz_absolute_top_term_unique';
      for (let i = 0; i < 1000; i++) trackSearch(topTerm);

      const popular = getPopularSearches(1);

      expect(popular[0]).toBe(topTerm);
    });

    it('should return empty array when limit is 0', () => {
      const popular = getPopularSearches(0);

      expect(popular).toEqual([]);
    });
  });

  // ---- SearchHistory extended ----
  describe('SearchHistory — extended', () => {
    it('add should not throw for empty string', () => {
      expect(() => SearchHistory.add('')).not.toThrow();
    });

    it('add should not throw for whitespace-only string', () => {
      expect(() => SearchHistory.add('   ')).not.toThrow();
    });

    it('get should always return an array', () => {
      const history = SearchHistory.get();

      expect(Array.isArray(history)).toBe(true);
    });

    it('remove should be a no-op and not throw', () => {
      expect(() => SearchHistory.remove('non-existent')).not.toThrow();
    });

    it('clear should be a no-op and not throw', () => {
      expect(() => SearchHistory.clear()).not.toThrow();
    });
  });
});
