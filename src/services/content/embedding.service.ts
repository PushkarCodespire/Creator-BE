// ===========================================
// EMBEDDING SERVICE (Gemini-first, OpenAI fallback)
// ===========================================
// Primary: Gemini text-embedding-004 (768-dim, free tier)
// Fallback: OpenAI text-embedding-3-small (1536-dim)
// Provider is selected once per server start — never mixed mid-session.

import Bottleneck from 'bottleneck';
import retry from 'async-retry';
import {
  generateEmbedding as generateEmbeddingBase,
  generateEmbeddings as generateEmbeddingsBase,
  isAIConfigured,
  getEmbeddingProvider,
} from '../../utils/openai';
import { config } from '../../config';
import { logInfo, logWarning, logError } from '../../utils/logger';
import { recordOpenAICall, embeddingGenerationDuration } from '../../utils/metrics';

// Re-export provider info so callers (e.g. index.ts startup check) can read it
export { getEmbeddingProvider };

// Rate limiter — conservative limits compatible with Gemini free tier (15 RPM)
const limiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 500, // ~120 req/min max — well within both providers' free limits
  reservoir: 200,
  reservoirRefreshAmount: 200,
  reservoirRefreshInterval: 60 * 1000,
});

/**
 * Generate embedding for a single text.
 * Uses Gemini (768-dim) if GEMINI_API_KEY is set, otherwise OpenAI (1536-dim).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!isAIConfigured()) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  const startTime = Date.now();

  return limiter.schedule(() =>
    retry(
      async () => {
        const embedding = await generateEmbeddingBase(text);
        const duration = (Date.now() - startTime) / 1000;
        embeddingGenerationDuration.observe({ batch_size: '1' }, duration);
        recordOpenAICall('embeddings', 'success');
        return embedding;
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 10000,
        onRetry: (error: Error, attempt: number) => {
          logWarning(`[Embedding] Retry attempt ${attempt} after error: ${error.message}`);
        },
      }
    )
  );
}

/**
 * Generate embeddings for multiple texts.
 * Processes in batches of 20 (conservative for Gemini free tier).
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!isAIConfigured()) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  if (texts.length === 0) return [];

  // Smaller batch size for Gemini (no native batch API — each is a separate request)
  const batchSize = getEmbeddingProvider() === 'gemini' ? 10 : 50;
  const allEmbeddings: number[][] = [];

  logInfo(`[Embedding] Generating ${texts.length} embeddings via ${getEmbeddingProvider()} in batches of ${batchSize}`);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);

    logInfo(`[Embedding] Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)`);

    try {
      const embeddings = await limiter.schedule(() =>
        retry(
          async () => {
            const batchStart = Date.now();
            const result = await generateEmbeddingsBase(batch);
            const duration = (Date.now() - batchStart) / 1000;
            embeddingGenerationDuration.observe({ batch_size: batch.length.toString() }, duration);
            recordOpenAICall('embeddings', 'success');
            return result;
          },
          {
            retries: 3,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 15000,
            onRetry: (error: Error, attempt: number) => {
              logWarning(`[Embedding] Batch ${batchNumber} retry ${attempt}: ${error.message}`);
            },
          }
        )
      );

      if (Array.isArray(embeddings)) allEmbeddings.push(...embeddings);
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), {
        context: `[Embedding] Batch ${batchNumber} failed`,
      });
      recordOpenAICall('embeddings', 'error', error instanceof Error ? error.name : 'unknown');
      throw error;
    }
  }

  logInfo(`[Embedding] Done: ${allEmbeddings.filter(e => e.length > 0).length}/${texts.length} embeddings`);
  return allEmbeddings;
}

/**
 * Get rate limiter status
 */
export function getRateLimiterStatus() {
  return {
    running: limiter.running(),
    done: limiter.done(),
    queued: limiter.queued()
  };
}
