// ===========================================
// LOCAL VECTOR STORE (SQLite-based)
// Alternative to Pinecone - No account needed
// ===========================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logWarning, logInfo } from './logger';

let db: Database.Database | null = null;
let warnedNotInitialized = false;

const warnVectorStoreDisabled = (context: string) => {
  if (warnedNotInitialized) return;
  warnedNotInitialized = true;
  logWarning(`[VectorStore] Disabled (${context}). Operations will be skipped.`);
};

// ===========================================
// INITIALIZATION
// ===========================================

export async function initializeVectorStore() {
  const dbDir = path.dirname(config.vectorDb.path);
  
  if (!fs.existsSync(dbDir)) {
    warnVectorStoreDisabled(`missing dir ${dbDir}`);
    return;
  }

  try {
    db = new Database(config.vectorDb.path);
  
    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
  
    // Create vectors table
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        content_id TEXT,
        chunk_index INTEGER,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    
      CREATE INDEX IF NOT EXISTS idx_vectors_creator ON vectors(creator_id);
      CREATE INDEX IF NOT EXISTS idx_vectors_content ON vectors(content_id);
    `);

    logInfo('Vector store initialized at: ' + config.vectorDb.path);
  } catch (error) {
    db = null;
    warnVectorStoreDisabled('init error');
    logWarning('[VectorStore] Initialization failed: ' + String(error));
  }
}

// ===========================================
// VECTOR OPERATIONS
// ===========================================

export interface VectorEntry {
  id: string;
  creatorId: string;
  contentId?: string;
  chunkIndex?: number;
  text: string;
  embedding: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

// Store a vector
export function storeVector(entry: VectorEntry) {
  if (!db) {
    warnVectorStoreDisabled('storeVector');
    return;
  }
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, creator_id, content_id, chunk_index, text, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    entry.id,
    entry.creatorId,
    entry.contentId || null,
    entry.chunkIndex || null,
    entry.text,
    JSON.stringify(entry.embedding),
    entry.metadata ? JSON.stringify(entry.metadata) : null
  );
}

// Store multiple vectors
export function storeVectors(entries: VectorEntry[]) {
  if (!db) {
    warnVectorStoreDisabled('storeVectors');
    return;
  }
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, creator_id, content_id, chunk_index, text, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items: VectorEntry[]) => {
    for (const entry of items) {
      stmt.run(
        entry.id,
        entry.creatorId,
        entry.contentId || null,
        entry.chunkIndex || null,
        entry.text,
        JSON.stringify(entry.embedding),
        entry.metadata ? JSON.stringify(entry.metadata) : null
      );
    }
  });
  
  insertMany(entries);
}

// Delete vectors by creator
export function deleteVectorsByCreator(creatorId: string) {
  if (!db) {
    warnVectorStoreDisabled('deleteVectorsByCreator');
    return;
  }
  const stmt = db.prepare('DELETE FROM vectors WHERE creator_id = ?');
  stmt.run(creatorId);
}

// Delete vectors by content
export function deleteVectorsByContent(contentId: string) {
  if (!db) {
    warnVectorStoreDisabled('deleteVectorsByContent');
    return;
  }
  const stmt = db.prepare('DELETE FROM vectors WHERE content_id = ?');
  stmt.run(contentId);
}

// ===========================================
// EMBEDDING PROVIDER MIGRATION HELPERS
// ===========================================

/**
 * Check the dimension of stored vectors against the expected dimension.
 * Call this on startup after initializeVectorStore() to detect a provider switch.
 * Returns { needsReembed: true } when dimensions don't match.
 */
export function checkEmbeddingDimension(expectedDimension: number): {
  needsReembed: boolean;
  storedDimension: number;
  count: number;
} {
  if (!db) return { needsReembed: false, storedDimension: 0, count: 0 };

  const countRow = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
  if (!countRow || countRow.count === 0) {
    return { needsReembed: false, storedDimension: expectedDimension, count: 0 };
  }

  const row = db.prepare('SELECT embedding FROM vectors LIMIT 1').get() as { embedding: string } | undefined;
  if (!row) return { needsReembed: false, storedDimension: expectedDimension, count: 0 };

  const embedding = JSON.parse(row.embedding) as number[];
  const storedDimension = embedding.length;

  return {
    needsReembed:    storedDimension !== expectedDimension,
    storedDimension,
    count:           countRow.count,
  };
}

/**
 * Delete ALL vectors so the backfill worker re-embeds them with the new provider.
 * Only call this after checkEmbeddingDimension() confirms a mismatch.
 */
export function clearAllVectors(): number {
  if (!db) return 0;
  const result = db.prepare('DELETE FROM vectors').run();
  logInfo(`[VectorStore] Cleared ${result.changes} vectors for provider migration`);
  return result.changes;
}

// ===========================================
// SIMILARITY SEARCH
// ===========================================

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SearchResult {
  id: string;
  text: string;
  score: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

// Search for similar vectors
export function searchSimilar(
  creatorId: string,
  queryEmbedding: number[],
  topK: number = 5,
  minScore: number = 0.7,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadataFilter?: Record<string, any>
): SearchResult[] {
  if (!db) {
    warnVectorStoreDisabled('searchSimilar');
    return [];
  }
  let query = `
    SELECT id, text, embedding, metadata, created_at
    FROM vectors
    WHERE creator_id = ?
  `;
  
  const params: unknown[] = [creatorId];
  
  // Add metadata filtering if provided
  if (metadataFilter) {
    // Simple metadata filtering - can be enhanced
    Object.entries(metadataFilter).forEach(([key, value]) => {
      query += ` AND metadata LIKE ?`;
      params.push(`%"${key}":"${value}"%`);
    });
  }
  
  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as Array<{
    id: string;
    text: string;
    embedding: string;
    metadata: string | null;
    created_at: string;
  }>;
  
  // Calculate similarities with temporal weighting
  const now = Date.now();
  const results: SearchResult[] = rows.map(row => {
    const embedding = JSON.parse(row.embedding) as number[];
    const baseScore = cosineSimilarity(queryEmbedding, embedding);
    
    // Apply temporal weighting (recent content gets slight boost)
    const createdAt = new Date(row.created_at).getTime();
    const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);
    const temporalWeight = daysOld < 30 ? 1.05 : daysOld < 90 ? 1.0 : 0.95;
    const finalScore = Math.min(baseScore * temporalWeight, 1.0);
    
    return {
      id: row.id,
      text: row.text,
      score: finalScore,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  });
  
  // Sort by score and filter
  return results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Hybrid search: combines semantic and keyword search
 */
export function hybridSearch(
  creatorId: string,
  queryEmbedding: number[],
  queryText: string,
  topK: number = 5,
  minScore: number = 0.7
): SearchResult[] {
  if (!db) {
    warnVectorStoreDisabled('hybridSearch');
    return [];
  }
  // Semantic search
  const semanticResults = searchSimilar(creatorId, queryEmbedding, topK * 2, minScore);
  
  // Keyword search (simple text matching)
  const keywords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  let keywordRows: Array<{
    id: string;
    text: string;
    embedding: string;
    metadata: string | null;
  }> = [];

  if (keywords.length > 0) {
    const keywordStmt = db.prepare(`
      SELECT id, text, embedding, metadata
      FROM vectors
      WHERE creator_id = ? AND (
        ${keywords.map(() => 'text LIKE ?').join(' OR ')}
      )
    `);
    const keywordParams: unknown[] = [creatorId, ...keywords.map(k => `%${k}%`)];
    keywordRows = keywordStmt.all(...keywordParams) as typeof keywordRows;
  }
  
  // Score keyword results
  const keywordResults: SearchResult[] = keywordRows.map(row => {
    const text = row.text.toLowerCase();
    const matches = keywords.reduce((acc, keyword) => {
      return acc + (text.match(new RegExp(keyword, 'g')) || []).length;
    }, 0);
    const score = Math.min(0.5 + (matches / keywords.length) * 0.3, 0.9);
    
    return {
      id: row.id,
      text: row.text,
      score,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  });
  
  // Combine and deduplicate
  const combined = new Map<string, SearchResult>();
  
  semanticResults.forEach(result => {
    const key = result.id;
    if (!combined.has(key) || combined.get(key)!.score < result.score) {
      combined.set(key, result);
    }
  });
  
  keywordResults.forEach(result => {
    const key = result.id;
    if (combined.has(key)) {
      // Boost score if found in both
      const existing = combined.get(key)!;
      existing.score = Math.min(existing.score + 0.1, 1.0);
    } else {
      combined.set(key, result);
    }
  });
  
  // Return top K results
  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ===========================================
// STATISTICS
// ===========================================

export function getVectorCount(creatorId?: string): number {
  if (!db) {
    warnVectorStoreDisabled('getVectorCount');
    return 0;
  }
  if (creatorId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM vectors WHERE creator_id = ?');
    const result = stmt.get(creatorId) as { count: number };
    return result.count;
  }
  
  const stmt = db.prepare('SELECT COUNT(*) as count FROM vectors');
  const result = stmt.get() as { count: number };
  return result.count;
}

export function vectorExists(id: string): boolean {
  if (!db) return false;
  const stmt = db.prepare('SELECT 1 FROM vectors WHERE id = ? LIMIT 1');
  return !!stmt.get(id);
}

export function getCreatorStats(creatorId: string) {
  if (!db) {
    warnVectorStoreDisabled('getCreatorStats');
    return { total_chunks: 0, total_contents: 0 };
  }
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_chunks,
      COUNT(DISTINCT content_id) as total_contents
    FROM vectors
    WHERE creator_id = ?
  `);
  
  return stmt.get(creatorId) as { total_chunks: number; total_contents: number };
}
