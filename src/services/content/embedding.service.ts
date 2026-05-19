// ===========================================
// EMBEDDING SERVICE (OpenAI with Rate Limiting)
// ===========================================
// Generate embeddings with rate limiting and batching
// Based on Phase 5 of the implementation plan

import Bottleneck from 'bottleneck';
import retry from 'async-retry';
import { openai } from '../../utils/openai';
import { config } from '../../config';
import { logInfo, logWarning, logError } from '../../utils/logger';
import { recordOpenAICall, embeddingGenerationDuration } from '../../utils/metrics';

// Rate limiter configuration
// OpenAI Tier 1: 3,000 requests/minute, 200,000 tokens/minute
const limiter = new Bottleneck({
  maxConcurrent: 5, // Process 5 requests in parallel
  minTime: 1000, // 1 second between requests (60 req/min per connection)
  reservoir: 3000, // 3000 requests
  reservoirRefreshAmount: 3000,
  reservoirRefreshInterval: 60 * 1000 // Refresh every minute
});

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!config.openai.apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Limit input length to 8000 characters (~2000 tokens)
  const truncatedText = text.slice(0, 8000);

  const startTime = Date.now();
  
  return limiter.schedule(() =>
    retry(
      async () => {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: truncatedText
        });

        const duration = (Date.now() - startTime) / 1000;
        embeddingGenerationDuration.observe({ batch_size: '1' }, duration);
        recordOpenAICall('embeddings', 'success');

        return response.data[0].embedding;
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 10000,
        onRetry: (error: Error, attempt: number) => {
          logWarning(`[Embedding] Retry attempt ${attempt} after error: ${error.message}`);
        }
      }
    )
  );
}

/**
 * Generate embeddings for multiple texts (batched)
 * Processes in batches of 50 to optimize API usage
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!config.openai.apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  if (texts.length === 0) {
    return [];
  }

  const batchSize = 50; // Conservative batch size
  const allEmbeddings: number[][] = [];

  logInfo(`[Embedding] Generating embeddings for ${texts.length} texts in batches of ${batchSize}`);

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 8000));
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(texts.length / batchSize);

    logInfo(`[Embedding] Processing batch ${batchNumber}/${totalBatches} (${batch.length} texts)`);

    try {
      const embeddings = await limiter.schedule(() =>
        retry(
          async () => {
            const batchStartTime = Date.now();
            const response = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: batch
            });

            const duration = (Date.now() - batchStartTime) / 1000;
            embeddingGenerationDuration.observe({ batch_size: batch.length.toString() }, duration);
            recordOpenAICall('embeddings', 'success');

            return response.data.map(d => d.embedding);
          },
          {
            retries: 3,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 10000,
            onRetry: (error: Error, attempt: number) => {
              logWarning(`[Embedding] Batch ${batchNumber} retry attempt ${attempt}: ${error.message}`);
            }
          }
        )
      );

      if (Array.isArray(embeddings)) {
        allEmbeddings.push(...embeddings);
      }
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[Embedding] Failed to generate embeddings for batch ${batchNumber}` });
      recordOpenAICall('embeddings', 'error', error instanceof Error ? error.name : 'unknown');
      throw error;
    }
  }

  logInfo(`[Embedding] Generated ${allEmbeddings.filter(e => e.length > 0).length}/${texts.length} embeddings`);

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
