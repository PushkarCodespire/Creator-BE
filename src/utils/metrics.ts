// ===========================================
// PROMETHEUS METRICS
// ===========================================
// Metrics collection for content processing monitoring
// Based on Phase 10 of the implementation plan

import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { logWarning } from './logger';

// Create a registry
export const metricsRegistry = new Registry();

// Content processing metrics
export const contentProcessingCounter = new Counter({
  name: 'content_processing_total',
  help: 'Total number of content processing jobs',
  labelNames: ['type', 'status'],
  registers: [metricsRegistry]
});

export const contentProcessingDuration = new Histogram({
  name: 'content_processing_duration_seconds',
  help: 'Duration of content processing in seconds',
  labelNames: ['type', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
  registers: [metricsRegistry]
});

export const contentChunksCreated = new Counter({
  name: 'content_chunks_created_total',
  help: 'Total number of content chunks created',
  labelNames: ['type'],
  registers: [metricsRegistry]
});

export const embeddingGenerationDuration = new Histogram({
  name: 'embedding_generation_duration_seconds',
  help: 'Duration of embedding generation in seconds',
  labelNames: ['batch_size'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry]
});

export const openaiApiCalls = new Counter({
  name: 'openai_api_calls_total',
  help: 'Total number of OpenAI API calls',
  labelNames: ['endpoint', 'status'],
  registers: [metricsRegistry]
});

export const openaiApiErrors = new Counter({
  name: 'openai_api_errors_total',
  help: 'Total number of OpenAI API errors',
  labelNames: ['error_type'],
  registers: [metricsRegistry]
});

export const queueSize = new Gauge({
  name: 'content_queue_size',
  help: 'Current size of content processing queue',
  labelNames: ['status'],
  registers: [metricsRegistry]
});

export const vectorStoreSize = new Gauge({
  name: 'vector_store_size',
  help: 'Current size of vector store',
  labelNames: ['creator_id'],
  registers: [metricsRegistry]
});

/**
 * Record content processing metrics
 */
export function recordContentProcessing(
  type: string,
  status: 'completed' | 'failed',
  duration: number,
  chunksCount?: number
): void {
  contentProcessingCounter.inc({ type, status });
  contentProcessingDuration.observe({ type, status }, duration);
  
  if (chunksCount) {
    contentChunksCreated.inc({ type }, chunksCount);
  }
}

/**
 * Record OpenAI API call
 */
export function recordOpenAICall(endpoint: string, status: 'success' | 'error', errorType?: string): void {
  openaiApiCalls.inc({ endpoint, status });
  
  if (status === 'error' && errorType) {
    openaiApiErrors.inc({ error_type: errorType });
  }
}

/**
 * Update queue size metric
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateQueueMetrics(contentQueue: any): Promise<void> {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      contentQueue.getWaitingCount(),
      contentQueue.getActiveCount(),
      contentQueue.getCompletedCount(),
      contentQueue.getFailedCount(),
      contentQueue.getDelayedCount()
    ]);

    queueSize.set({ status: 'waiting' }, waiting);
    queueSize.set({ status: 'active' }, active);
    queueSize.set({ status: 'completed' }, completed);
    queueSize.set({ status: 'failed' }, failed);
    queueSize.set({ status: 'delayed' }, delayed);
  } catch (error) {
    logWarning('[Metrics] Failed to update queue metrics: ' + String(error));
  }
}
