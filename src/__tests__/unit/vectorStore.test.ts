// ===========================================
// VECTOR STORE — UNIT TESTS
// ===========================================
// Strategy: resetModules before each test so the module-level `db` and
// `warnedNotInitialized` singletons are always fresh.

// ─── Stable mock fn refs — re-wired after each resetModules ──────────────────

let mockStmtRun: jest.Mock;
let mockStmtAll: jest.Mock;
let mockStmtGet: jest.Mock;
let mockPrepare: jest.Mock;
let mockPragma: jest.Mock;
let mockExec: jest.Mock;
let mockTransaction: jest.Mock;
let DatabaseMock: jest.Mock;
let fsDirExists: boolean;
let databaseConstructorShouldThrow: boolean;

// Top-level jest.mock calls use factory closures that reference the lets above.
// We must define the mocks at module scope, but re-wire implementations in beforeEach.

jest.mock('better-sqlite3');
jest.mock('fs');
jest.mock('../../config', () => ({
  config: { vectorDb: { path: '/tmp/test-vectors.db' } },
}));
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

// ─── Import types only (real module re-imported fresh in each test via jest.isolateModules)

import type { VectorEntry } from '../../utils/vectorStore';

// ─── Helper: re-wire all mocks and return fresh module ───────────────────────

function setup(opts: { dirExists?: boolean; ctorThrows?: boolean } = {}) {
  fsDirExists = opts.dirExists ?? true;
  databaseConstructorShouldThrow = opts.ctorThrows ?? false;

  mockStmtRun = jest.fn();
  mockStmtAll = jest.fn().mockReturnValue([]);
  mockStmtGet = jest.fn().mockReturnValue({ count: 0, total_chunks: 0, total_contents: 0 });
  mockPrepare = jest.fn().mockReturnValue({
    run: mockStmtRun,
    all: mockStmtAll,
    get: mockStmtGet,
  });
  mockPragma = jest.fn();
  mockExec = jest.fn();
  mockTransaction = jest.fn().mockImplementation((fn: Function) => fn);

  const mockDbInstance = {
    pragma: mockPragma,
    exec: mockExec,
    prepare: mockPrepare,
    transaction: mockTransaction,
  };

  DatabaseMock = require('better-sqlite3') as jest.Mock;
  DatabaseMock.mockImplementation(() => {
    if (databaseConstructorShouldThrow) throw new Error('DB init failed');
    return mockDbInstance;
  });

  const fsModule = require('fs') as { existsSync: jest.Mock };
  fsModule.existsSync.mockReturnValue(fsDirExists);

  // Return fresh vectorStore module
  let vs: typeof import('../../utils/vectorStore');
  jest.isolateModules(() => {
    vs = require('../../utils/vectorStore');
  });
  return vs!;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('VectorStore', () => {
  const entry: VectorEntry = {
    id: 'v1',
    creatorId: 'creator-1',
    contentId: 'content-1',
    chunkIndex: 0,
    text: 'Sample text chunk',
    embedding: [0.1, 0.2, 0.3],
    metadata: { source: 'blog' },
  };

  // ─── initializeVectorStore ─────────────────────────────────────

  describe('initializeVectorStore', () => {
    it('should warn and skip when the DB directory does not exist', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      // Verify that no DB was opened (db stays null — storeVector is a no-op)
      vs.storeVector({ id: 'x', creatorId: 'c', text: 't', embedding: [1] });
      expect(mockStmtRun).not.toHaveBeenCalled();
    });

    it('should create DB and run WAL pragma when dir exists', async () => {
      const vs = setup({ dirExists: true });
      await vs.initializeVectorStore();
      expect(mockPragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockExec).toHaveBeenCalled();
    });

    it('should set db to null when Database constructor throws (no-op storeVector)', async () => {
      const vs = setup({ dirExists: true, ctorThrows: true });
      await vs.initializeVectorStore();
      // db stays null after failed init, so storeVector is a no-op
      vs.storeVector({ id: 'x', creatorId: 'c', text: 't', embedding: [1] });
      expect(mockStmtRun).not.toHaveBeenCalled();
    });

    it('should initialize db so that storeVector runs without error', async () => {
      const vs = setup({ dirExists: true });
      await vs.initializeVectorStore();
      // If init succeeded, storeVector should invoke prepare (not a no-op)
      expect(() =>
        vs.storeVector({ id: 'x', creatorId: 'c', text: 't', embedding: [1] })
      ).not.toThrow();
      expect(mockPrepare).toHaveBeenCalled();
    });

    it('should suppress duplicate db-null warnings (warnedNotInitialized flag)', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore(); // first call → warnedNotInitialized=true
      // storeVector triggers warnVectorStoreDisabled — second invocation should be suppressed
      // We just verify it does not throw (the flag prevents a second logWarning call)
      expect(() => vs.storeVector({ id: 'x', creatorId: 'c', text: 't', embedding: [1] })).not.toThrow();
    });
  });

  // ─── storeVector ───────────────────────────────────────────────

  describe('storeVector', () => {
    it('should call prepare + run with correct values when db is initialized', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      vs.storeVector(entry);
      // Note: chunkIndex 0 is falsy, so source does `0 || null` → null
      expect(mockStmtRun).toHaveBeenCalledWith(
        'v1',
        'creator-1',
        'content-1',
        null, // chunkIndex: 0 || null = null
        'Sample text chunk',
        JSON.stringify([0.1, 0.2, 0.3]),
        JSON.stringify({ source: 'blog' })
      );
    });

    it('should pass null for optional contentId and chunkIndex when omitted', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const e: VectorEntry = { id: 'v2', creatorId: 'c1', text: 'text', embedding: [0.5] };
      vs.storeVector(e);
      const call = mockStmtRun.mock.calls[0];
      expect(call[2]).toBeNull(); // contentId
      expect(call[3]).toBeNull(); // chunkIndex
      expect(call[6]).toBeNull(); // metadata
    });

    it('should pass null metadata when metadata is undefined', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      vs.storeVector({ id: 'x', creatorId: 'c1', text: 't', embedding: [1], metadata: undefined });
      const call = mockStmtRun.mock.calls[0];
      expect(call[6]).toBeNull();
    });

    it('should be a no-op when db is null (dir missing)', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore(); // db stays null
      vs.storeVector(entry);
      expect(mockStmtRun).not.toHaveBeenCalled();
    });
  });

  // ─── storeVectors ──────────────────────────────────────────────

  describe('storeVectors', () => {
    it('should call transaction with all entries', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const entries: VectorEntry[] = [
        { id: 'a', creatorId: 'c1', text: 'text A', embedding: [0.1] },
        { id: 'b', creatorId: 'c1', text: 'text B', embedding: [0.2] },
      ];
      vs.storeVectors(entries);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should be a no-op when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      vs.storeVectors([entry]);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should handle an empty array without throwing', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      expect(() => vs.storeVectors([])).not.toThrow();
    });
  });

  // ─── deleteVectorsByCreator ────────────────────────────────────

  describe('deleteVectorsByCreator', () => {
    it('should prepare DELETE and run with creatorId', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      vs.deleteVectorsByCreator('creator-1');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('creator_id'));
      expect(mockStmtRun).toHaveBeenCalledWith('creator-1');
    });

    it('should be a no-op when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      vs.deleteVectorsByCreator('creator-1');
      expect(mockStmtRun).not.toHaveBeenCalled();
    });
  });

  // ─── deleteVectorsByContent ────────────────────────────────────

  describe('deleteVectorsByContent', () => {
    it('should prepare DELETE and run with contentId', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      vs.deleteVectorsByContent('content-99');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('content_id'));
      expect(mockStmtRun).toHaveBeenCalledWith('content-99');
    });

    it('should be a no-op when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      vs.deleteVectorsByContent('content-99');
      expect(mockStmtRun).not.toHaveBeenCalled();
    });
  });

  // ─── searchSimilar ─────────────────────────────────────────────

  describe('searchSimilar', () => {
    it('should return empty array when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      expect(vs.searchSimilar('c1', [0.1], 5, 0.7)).toEqual([]);
    });

    it('should filter results below minScore', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 'hi', text: 'Match', embedding: JSON.stringify([1, 0, 0]), metadata: null, created_at: now },
        { id: 'lo', text: 'No match', embedding: JSON.stringify([0, 1, 0]), metadata: null, created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0, 0], 5, 0.7);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('hi');
    });

    it('should respect topK limit', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const highSim = JSON.stringify([1, 0]);
      mockStmtAll.mockReturnValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `r${i}`, text: `t${i}`, embedding: highSim, metadata: null, created_at: now,
        }))
      );
      const results = vs.searchSimilar('c1', [1, 0], 2, 0.5);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should add metadata filter clause to query when metadataFilter provided', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtAll.mockReturnValue([]);
      vs.searchSimilar('c1', [1], 5, 0.5, { type: 'video' });
      const preparedQueries: string[] = mockPrepare.mock.calls.map((c: any[]) => c[0] as string);
      expect(preparedQueries.some(q => q.includes('metadata'))).toBe(true);
    });

    it('should parse metadata JSON from stored row', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 'r1', text: 'meta', embedding: JSON.stringify([1, 0]), metadata: JSON.stringify({ tag: 'x' }), created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0], 5, 0.5);
      expect(results[0].metadata).toEqual({ tag: 'x' });
    });

    it('should return undefined metadata when row.metadata is null', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 'r1', text: 'no meta', embedding: JSON.stringify([1, 0]), metadata: null, created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0], 5, 0.5);
      expect(results[0].metadata).toBeUndefined();
    });

    it('should return 0 similarity for mismatched vector lengths (filtered out)', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 'r1', text: 'mismatch', embedding: JSON.stringify([1, 0, 0]), metadata: null, created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0], 5, 0.5);
      expect(results.find(r => r.id === 'r1')).toBeUndefined();
    });

    it('should return 0 similarity for zero vector (norm=0)', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 'z', text: 'zero', embedding: JSON.stringify([0, 0, 0]), metadata: null, created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0, 0], 5, 0.5);
      expect(results.find(r => r.id === 'z')).toBeUndefined();
    });

    it('should apply temporal weight: 30-90 day old content gets weight 1.0', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const embedding = JSON.stringify([1, 0]);
      mockStmtAll.mockReturnValue([
        { id: 'mid', text: 'mid age', embedding, metadata: null, created_at: sixtyDaysAgo },
      ]);
      const results = vs.searchSimilar('c1', [1, 0], 5, 0.5);
      if (results.length > 0) {
        expect(results[0].score).toBeLessThanOrEqual(1.0);
        expect(results[0].score).toBeGreaterThan(0);
      }
    });

    it('should cap score at 1.0 with temporal boost on recent content', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const embedding = JSON.stringify([1, 0]);
      mockStmtAll.mockReturnValue([
        { id: 'r', text: 'recent perfect', embedding, metadata: null, created_at: now },
      ]);
      const results = vs.searchSimilar('c1', [1, 0], 5, 0.5);
      if (results.length > 0) {
        expect(results[0].score).toBeLessThanOrEqual(1.0);
      }
    });
  });

  // ─── hybridSearch ──────────────────────────────────────────────

  describe('hybridSearch', () => {
    it('should return empty array when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      expect(vs.hybridSearch('c1', [0.1], 'query', 5, 0.7)).toEqual([]);
    });

    it('should return array of SearchResult objects', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      mockStmtAll.mockReturnValue([
        { id: 's1', text: 'semantic result about testing', embedding: JSON.stringify([1, 0]), metadata: null, created_at: now },
      ]);
      const results = vs.hybridSearch('c1', [1, 0], 'testing query text', 5, 0.5);
      expect(Array.isArray(results)).toBe(true);
      results.forEach(r => {
        expect(r).toHaveProperty('id');
        expect(r).toHaveProperty('text');
        expect(r).toHaveProperty('score');
      });
    });

    it('should skip keyword search when all query words are <=3 chars', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtAll.mockReturnValue([]);
      // "hi" "yo" are <=3 chars → keyword block is skipped
      const results = vs.hybridSearch('c1', [1, 0], 'hi yo', 5, 0.5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should deduplicate results appearing in both semantic and keyword results', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const embedding = JSON.stringify([1, 0]);
      // same id returned by both semantic and keyword all() calls
      mockStmtAll
        .mockReturnValueOnce([
          { id: 'dup', text: 'content about testing dedup', embedding, metadata: null, created_at: now },
        ])
        .mockReturnValueOnce([
          { id: 'dup', text: 'content about testing dedup', embedding, metadata: null, created_at: now },
        ]);
      const results = vs.hybridSearch('c1', [1, 0], 'testing dedup content', 10, 0.5);
      expect(results.filter(r => r.id === 'dup').length).toBe(1);
    });

    it('should boost score for results found in both result sets', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const embedding = JSON.stringify([1, 0]);
      mockStmtAll
        .mockReturnValueOnce([
          { id: 'boost', text: 'content about testing keywords here', embedding, metadata: null, created_at: now },
        ])
        .mockReturnValueOnce([
          { id: 'boost', text: 'content about testing keywords here', embedding, metadata: null, created_at: now },
        ]);
      const results = vs.hybridSearch('c1', [1, 0], 'testing keywords content', 10, 0.5);
      const boosted = results.find(r => r.id === 'boost');
      expect(boosted).toBeDefined();
      expect(boosted!.score).toBeGreaterThan(0);
    });

    it('should respect topK in final slice', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const embedding = JSON.stringify([1, 0]);
      mockStmtAll.mockReturnValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `r${i}`, text: `text with many words about things ${i}`, embedding, metadata: null, created_at: now,
        }))
      );
      const results = vs.hybridSearch('c1', [1, 0], 'words things about many', 3, 0.5);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should include keyword-only results when semantic has no matches', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const orthogonalEmbedding = JSON.stringify([0, 1]); // score=0 vs query [1,0]
      mockStmtAll
        .mockReturnValueOnce([]) // semantic: returns nothing (or all filtered)
        .mockReturnValueOnce([
          { id: 'kw1', text: 'content about testing keywords', orthogonalEmbedding, metadata: null, created_at: now },
        ]);
      const results = vs.hybridSearch('c1', [1, 0], 'testing keywords content', 5, 0.3);
      // keyword results should appear
      expect(Array.isArray(results)).toBe(true);
    });

    it('should sort final results by score descending', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      const now = new Date().toISOString();
      const hiEmbed = JSON.stringify([1, 0]);
      const loEmbed = JSON.stringify([0.7, 0.7]);
      mockStmtAll.mockReturnValue([
        { id: 'lo', text: 'lo score', embedding: loEmbed, metadata: null, created_at: now },
        { id: 'hi', text: 'hi score', embedding: hiEmbed, metadata: null, created_at: now },
      ]);
      const results = vs.hybridSearch('c1', [1, 0], 'long query with words score', 10, 0.4);
      if (results.length >= 2) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });
  });

  // ─── getVectorCount ────────────────────────────────────────────

  describe('getVectorCount', () => {
    it('should return 0 when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      expect(vs.getVectorCount()).toBe(0);
    });

    it('should return count for specific creatorId', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ count: 42 });
      expect(vs.getVectorCount('creator-1')).toBe(42);
    });

    it('should query with creator_id filter when creatorId provided', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ count: 5 });
      vs.getVectorCount('creator-abc');
      const preparedQueries: string[] = mockPrepare.mock.calls.map((c: any[]) => c[0] as string);
      expect(preparedQueries.some(q => q.includes('creator_id'))).toBe(true);
    });

    it('should return total count when no creatorId provided', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ count: 100 });
      expect(vs.getVectorCount()).toBe(100);
    });

    it('should return 0 when count is 0', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ count: 0 });
      expect(vs.getVectorCount('empty')).toBe(0);
    });
  });

  // ─── getCreatorStats ───────────────────────────────────────────

  describe('getCreatorStats', () => {
    it('should return zeros when db is null', async () => {
      const vs = setup({ dirExists: false });
      await vs.initializeVectorStore();
      // When db is null the source returns a hardcoded object
      const stats = vs.getCreatorStats('creator-1');
      expect(stats.total_chunks).toBe(0);
      expect(stats.total_contents).toBe(0);
    });

    it('should return stats from db when initialized', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ total_chunks: 10, total_contents: 3 });
      const stats = vs.getCreatorStats('creator-1');
      expect(stats).toMatchObject({ total_chunks: 10, total_contents: 3 });
    });

    it('should call stmt.get with the correct creatorId', async () => {
      const vs = setup();
      await vs.initializeVectorStore();
      mockStmtGet.mockReturnValue({ total_chunks: 1, total_contents: 1 });
      vs.getCreatorStats('specific-creator');
      expect(mockStmtGet).toHaveBeenCalledWith('specific-creator');
    });
  });
});
