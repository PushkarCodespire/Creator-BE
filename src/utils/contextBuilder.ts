// ===========================================
// CONTEXT BUILDER UTILITY
// Enhanced context building for AI responses
// ===========================================

import { searchSimilar } from './vectorStore';
import { generateEmbedding, generateChatCompletion } from './openai';
import prisma from '../../prisma/client';
import { logInfo } from './logger';

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

  // HyDE is only worth the extra OpenAI call (~500ms) for research/data queries.
  // General coaching questions get fast plain-embedding search instead.
  const needsHyde = isResearchQuery(userMessage);

  // PERF: Start plain embedding and (if needed) HyDE generation simultaneously.
  // Previously: embed → hyde → embed(hyde text) — 3 sequential OpenAI calls.
  // Now: embed & hyde run in parallel, then one more embed only when hyde succeeded.
  const [queryEmbedding, hydeResponse] = await Promise.all([
    generateEmbedding(userMessage),
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
    try { contentEmbedding = await generateEmbedding(hydeText); } catch { /* fall back to plain */ }
  } else {
    logInfo(`[RAG] HyDE skipped (${needsHyde ? 'failed' : 'not a research query'}): "${userMessage.slice(0, 60)}"`);
  }

  // Search corrections (plain embedding — exact question matching)
  const rawCorrections = searchSimilar(creatorId, queryEmbedding, 2, 0.82, { type: 'correction' });
  const correctionExamples = rawCorrections
    .map(r => ({
      question: (r.metadata?.userMessage as string) || '',
      answer:   (r.metadata?.chosenResponse as string) || '',
    }))
    .filter(c => c.question && c.answer);

  // PERF: Fetch Postgres chunks and keyword search in parallel.
  // Chunk fetch is reused for both hyde+plain similarity passes (one DB round trip).
  const [allRows, keywordResults] = await Promise.all([
    prisma.contentChunk.findMany({
      where: { content: { creatorId, status: 'COMPLETED' }, embedding: { not: null } },
      select: { text: true, embedding: true, content: { select: { title: true, type: true } } },
      take: 500,
    }),
    useHybridSearch ? performKeywordSearch(creatorId, userMessage, maxChunks) : Promise.resolve([]),
  ]);

  const hydeResults  = scoreChunks(allRows, contentEmbedding, maxChunks * 2, minScore);
  const plainResults = needsHyde && contentEmbedding !== queryEmbedding
    ? scoreChunks(allRows, queryEmbedding, maxChunks * 2, minScore)
    : [];

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

  logInfo(`[RAG] semantic=${semanticResults.length} hyde=${hydeResults.length} plain=${plainResults.length} keyword=${keywordResults.length} minScore=${minScore} for: "${userMessage.slice(0, 60)}"`);

  // Combine and re-rank results
  const combinedResults = combineAndRerank(semanticResults, keywordResults, maxChunks);
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

/**
 * Perform keyword-based search
 */
async function performKeywordSearch(
  creatorId: string,
  query: string,
  maxResults: number
): Promise<ContextChunk[]> {
  // Extract keywords from query
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return [];
  }

  // Search in content chunks — OR across top 3 keywords so domain-specific
  // words like "incline" or "bench" win over generic long words like "instead"
  const searchKeywords = keywords.slice(0, 3);
  const chunks = await prisma.contentChunk.findMany({
    where: {
      content: { creatorId },
      OR: searchKeywords.map(k => ({
        text: { contains: k, mode: 'insensitive' as const },
      })),
    },
    take: maxResults * 2,
    include: {
      content: {
        select: {
          title: true,
          type: true,
        },
      },
    },
  });

  // Score chunks based on keyword matches
  return chunks.map((chunk) => {
    const text = chunk.text.toLowerCase();
    const score = keywords.reduce((acc, keyword) => {
      const matches = (text.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
      return acc + matches * 0.1;
    }, 0.5); // Base score

    return {
      text: chunk.text,
      score: Math.min(score, 1.0),
      source: chunk.content.title,
      metadata: {
        contentType: chunk.content.type,
      },
    };
  });
}

// HyDE is only worthwhile when the query is asking for specific facts/data.
// Routing general coaching questions through HyDE adds ~500ms for zero benefit.
function isResearchQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    /\bstudy\b/, /\bresearch\b/, /\bevidence\b/, /\bscientific\b/, /\bproven\b/,
    /\bshown\b/, /\bfound\b/, /\bmeta.?analysis\b/, /\bclinical\b/,
    /\bhow much\b/, /\bhow many\b/, /\bpercent/, /\blbs?\b/, /\bkgs?\b/, /\bgrams?\b/,
    /\bdexa\b/, /\bemg\b/, /\bmri\b/, /\bultrasound\b/,
    /\d+/,
  ].some(p => p.test(lower));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Score pre-fetched rows against a query embedding — avoids a second DB round trip.
type ChunkRow = { text: string; embedding: unknown; content: { title: string; type: string } };
function scoreChunks(rows: ChunkRow[], queryEmbedding: number[], topK: number, minScore: number): ContextChunk[] {
  const scored: ContextChunk[] = [];
  for (const row of rows) {
    try {
      const vec = JSON.parse(row.embedding as string) as number[];
      const score = cosineSimilarity(queryEmbedding, vec);
      if (score >= minScore) {
        scored.push({ text: row.text, score, source: row.content.title, metadata: { contentType: row.content.type } });
      }
    } catch { /* skip malformed */ }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Extract keywords from query
 */
function extractKeywords(query: string): string[] {
  // Remove common stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  ]);

  // Extract words (3+ characters, not stop words)
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));

  // Return unique words, sorted by length (longer words are more specific)
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 5);
}

/**
 * Combine semantic and keyword results, then re-rank
 */
function combineAndRerank(
  semanticResults: Array<{ text: string; score: number }>,
  keywordResults: ContextChunk[],
  maxResults: number
): ContextChunk[] {
  // Create a map to combine results
  const combinedMap = new Map<string, ContextChunk>();

  // Add semantic results
  semanticResults.forEach((result, _index) => {
    const key = result.text.substring(0, 100); // Use first 100 chars as key
    if (!combinedMap.has(key)) {
      combinedMap.set(key, {
        text: result.text,
        score: result.score * 0.7, // Weight semantic search
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
      if (result.source) existing.source = result.source;
      if (result.metadata) existing.metadata = result.metadata;
    }
  });

  // Convert to array, sort by score, and return top results
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
  // Simple summary: extract key topics and main points
  // In production, this could use OpenAI to generate a proper summary

  const userMessages = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  // Extract key phrases (simple approach)
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



