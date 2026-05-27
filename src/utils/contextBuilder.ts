// ===========================================
// CONTEXT BUILDER UTILITY
// Enhanced context building for AI responses
// ===========================================

import { searchSimilar, hybridSearch, SearchResult } from './vectorStore';
import { generateEmbedding, generateChatCompletion } from './openai';
import { logInfo } from './logger';

// ── Embedding cache ────────────────────────────────────────────────────────────
// Avoids re-embedding the same text multiple times within a session.
// FIFO eviction at 200 entries keeps memory bounded to ~2.5 MB
// (Gemini: 200 × 3072 dims × 4 bytes ≈ 2.4 MB).
const _embCache = new Map<string, number[]>();
const EMB_CACHE_MAX = 200;

async function getCachedEmbedding(text: string): Promise<number[]> {
  const hit = _embCache.get(text);
  if (hit) return hit;
  const vec = await generateEmbedding(text);
  if (_embCache.size >= EMB_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order)
    const firstKey = _embCache.keys().next().value;
    if (firstKey !== undefined) _embCache.delete(firstKey);
  }
  _embCache.set(text, vec);
  return vec;
}

export interface ContextChunk {
  text: string;
  score: number;
  source?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextOptions {
  creatorId: string;
  userMessage: string;
  conversationHistory: ConversationMessage[];
  maxChunks?: number;
  minScore?: number;
  useHybridSearch?: boolean;
  includeConversationSummary?: boolean;
}

/**
 * Build enhanced context for AI response generation
 * Uses hybrid search (semantic + keyword) and re-ranking
 */
export async function buildEnhancedContext(options: ContextOptions): Promise<{
  relevantChunks: ContextChunk[];
  correctionExamples: { question: string; answer: string }[];
  conversationSummary?: string;
  enhancedHistory: ConversationMessage[];
}> {
  const {
    creatorId,
    userMessage,
    conversationHistory,
    maxChunks = 5,
    minScore = 0.7,
    useHybridSearch = true,
    includeConversationSummary = false,
  } = options;

  // HyDE is only worth the extra AI call (~500ms) for explicit study/evidence queries.
  // General coaching questions get fast plain-embedding search instead.
  const needsHyde = isResearchQuery(userMessage);

  // PERF: Start plain embedding and (if needed) HyDE generation simultaneously.
  // Previously: embed → hyde → embed(hyde text) — 3 sequential AI calls.
  // Now: embed & hyde run in parallel; cache avoids re-embedding repeated queries.
  const [queryEmbedding, hydeResponse] = await Promise.all([
    getCachedEmbedding(userMessage),
    needsHyde
      ? generateChatCompletion([
          { role: 'system', content: 'Answer in 2 sentences as a fitness researcher. Include specific: study author names, outcomes in lbs/kg, measurement methods (DEXA, MRI, EMG). Output only the answer.' },
          { role: 'user', content: userMessage },
        ], { maxTokens: 80, temperature: 0.1 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  let contentEmbedding = queryEmbedding;
  if (hydeResponse) {
    const hydeText = hydeResponse.content.trim();
    logInfo(`[RAG] HyDE: "${hydeText.slice(0, 100)}"`);
    try { contentEmbedding = await getCachedEmbedding(hydeText); } catch { /* fall back to plain */ }
  } else {
    logInfo(`[RAG] HyDE skipped (${needsHyde ? 'failed' : 'not a research query'}): "${userMessage.slice(0, 60)}"`);
  }

  // Corrections search (plain embedding — exact question matching, sync SQLite)
  const rawCorrections = searchSimilar(creatorId, queryEmbedding, 2, 0.82, { type: 'correction' });
  const correctionExamples = rawCorrections
    .map(r => ({
      question: (r.metadata?.userMessage as string) || '',
      answer:   (r.metadata?.chosenResponse as string) || '',
    }))
    .filter(c => c.question && c.answer);

  // PERF: SQLite vector store is in-process — no async DB round-trips needed.
  // hybridSearch runs semantic + keyword scoring in one synchronous pass.
  // This replaces the previous prisma.contentChunk.findMany({ take: 500 }) call.
  const toChunk = (r: SearchResult): ContextChunk => ({
    text:     r.text,
    score:    r.score,
    source:   r.metadata?.contentTitle as string | undefined,
    metadata: { contentType: r.metadata?.contentType as string | undefined },
  });

  const hydeRaw = useHybridSearch
    ? hybridSearch(creatorId, contentEmbedding, userMessage, maxChunks * 2, minScore)
    : searchSimilar(creatorId, contentEmbedding, maxChunks * 2, minScore);

  const plainRaw = (needsHyde && contentEmbedding !== queryEmbedding)
    ? searchSimilar(creatorId, queryEmbedding, maxChunks * 2, minScore)
    : [];

  const hydeResults  = hydeRaw.map(toChunk);
  const plainResults = plainRaw.map(toChunk);

  // Merge: de-duplicate by first-100-chars key, keep the higher score
  const mergeMap = new Map<string, ContextChunk>();
  for (const r of [...hydeResults, ...plainResults]) {
    const key = r.text.substring(0, 100);
    const existing = mergeMap.get(key);
    if (!existing || r.score > existing.score) mergeMap.set(key, r);
  }
  const semanticResults = Array.from(mergeMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks * 2);

  logInfo(`[RAG] semantic=${semanticResults.length} hyde=${hydeResults.length} plain=${plainResults.length} (SQLite) minScore=${minScore} for: "${userMessage.slice(0, 60)}"`);

  // Re-rank — keyword boost already applied by hybridSearch above
  const combinedResults = combineAndRerank(semanticResults, [], maxChunks);
  logInfo(`[RAG] combined=${combinedResults.length} chunks passed to AI`);

  // Build conversation summary if needed
  let conversationSummary: string | undefined;
  if (includeConversationSummary && conversationHistory.length > 10) {
    conversationSummary = await generateConversationSummary(conversationHistory);
  }

  // 6 messages is enough context and keeps the prompt lean (fewer tokens = faster generation)
  const enhancedHistory = conversationHistory.slice(-6);

  return {
    relevantChunks: combinedResults,
    correctionExamples,
    conversationSummary,
    enhancedHistory,
  };
}

// HyDE is only worthwhile when the query explicitly asks about studies or clinical evidence.
// Removing broad triggers like /\d+/ and /\bhow much\b/ that fired on routine coaching
// questions (e.g. "how much protein?") and added ~500ms with no quality improvement.
function isResearchQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    /\bstudy\b/, /\bstudies\b/, /\bresearch\b/, /\bevidence\b/, /\bscientific\b/, /\bproven\b/,
    /\bmeta.?analysis\b/, /\bclinical(?:ly)?\b/, /\bpeer.?reviewed\b/,
    /\bdexa\b/, /\bemg\b/, /\bmri\b/, /\bultrasound\b/,
  ].some(p => p.test(lower));
}

/**
 * Combine and re-rank results.
 * Semantic results get a 0.7 weight; keyword results boost already-matched chunks only.
 */
function combineAndRerank(
  semanticResults: ContextChunk[],
  keywordResults: ContextChunk[],
  maxResults: number
): ContextChunk[] {
  const combinedMap = new Map<string, ContextChunk>();

  semanticResults.forEach((result) => {
    const key = result.text.substring(0, 100);
    if (!combinedMap.has(key)) {
      combinedMap.set(key, {
        text:     result.text,
        score:    result.score * 0.7,
        source:   result.source,
        metadata: result.metadata,
      });
    }
  });

  // Keyword results only BOOST existing semantic results — they don't add new entries.
  // Adding keyword-only chunks pollutes results with topically adjacent but irrelevant
  // content (e.g. "upper body workout" chunks matching on the word "upper" alone).
  keywordResults.forEach((result) => {
    const key = result.text.substring(0, 100);
    if (combinedMap.has(key)) {
      const existing = combinedMap.get(key)!;
      existing.score = Math.min(existing.score + result.score * 0.3, 1.0);
      if (result.source)   existing.source   = result.source;
      if (result.metadata) existing.metadata = result.metadata;
    }
  });

  return Array.from(combinedMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Generate conversation summary for long conversations
 */
async function generateConversationSummary(
  conversationHistory: ConversationMessage[]
): Promise<string> {
  const userMessages = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  const words = userMessages
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);

  const wordFreq = new Map<string, number>();
  words.forEach((word) => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });

  const topWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return `Previous conversation topics: ${topWords.join(', ')}`;
}

/**
 * Calculate temporal weight for content chunks
 * Recent content gets higher weight
 */
export function calculateTemporalWeight(createdAt: Date, daysOld: number): number {
  const maxAge = 365; // 1 year
  const ageRatio = Math.min(daysOld / maxAge, 1);
  // Recent content (0-30 days) gets weight 1.0, older content gets less
  return ageRatio < 0.08 ? 1.0 : Math.max(0.5, 1.0 - ageRatio * 0.5);
}
