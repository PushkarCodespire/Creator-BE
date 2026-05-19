// ===========================================
// CONTENT PROCESSING LOGGER
// ===========================================
// Enhanced logging for content processing operations
// Based on Phase 9 of the implementation plan

import { logger } from './logger';

export interface ContentProcessingLog {
  contentId: string;
  creatorId: string;
  type: string;
  stage: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  error?: Error;
}

/**
 * Log content processing events
 */
export function logContentProcessing(log: ContentProcessingLog): void {
  const logData = {
    contentId: log.contentId,
    creatorId: log.creatorId,
    type: log.type,
    stage: log.stage,
    message: log.message,
    ...(log.metadata && { metadata: log.metadata }),
    timestamp: new Date().toISOString()
  };

  if (log.error) {
    logger.error(`[ContentProcessing] ${log.stage} - ${log.message}`, {
      ...logData,
      error: {
        message: log.error.message,
        stack: log.error.stack,
        name: log.error.name
      }
    });
  } else {
    logger.info(`[ContentProcessing] ${log.stage} - ${log.message}`, logData);
  }
}

/**
 * Log chunking operations
 */
export function logChunking(contentId: string, creatorId: string, chunksCount: number, avgSize: number): void {
  logContentProcessing({
    contentId,
    creatorId,
    type: 'chunking',
    stage: 'chunking',
    message: `Created ${chunksCount} chunks (avg size: ${avgSize} chars)`,
    metadata: {
      chunksCount,
      avgChunkSize: avgSize
    }
  });
}

/**
 * Log embedding generation
 */
export function logEmbeddingGeneration(
  contentId: string,
  creatorId: string,
  batchNumber: number,
  totalBatches: number,
  batchSize: number
): void {
  logContentProcessing({
    contentId,
    creatorId,
    type: 'embedding',
    stage: 'embedding',
    message: `Processing batch ${batchNumber}/${totalBatches} (${batchSize} texts)`,
    metadata: {
      batchNumber,
      totalBatches,
      batchSize
    }
  });
}

/**
 * Log content completion
 */
export function logContentCompletion(
  contentId: string,
  creatorId: string,
  type: string,
  chunksCount: number,
  processingTime: number
): void {
  logContentProcessing({
    contentId,
    creatorId,
    type,
    stage: 'completed',
    message: `Content processed successfully in ${processingTime.toFixed(2)}s`,
    metadata: {
      chunksCount,
      processingTimeSeconds: processingTime
    }
  });
}

/**
 * Log content failure
 */
export function logContentFailure(
  contentId: string,
  creatorId: string,
  type: string,
  error: Error,
  stage?: string
): void {
  logContentProcessing({
    contentId,
    creatorId,
    type,
    stage: stage || 'failed',
    message: `Content processing failed: ${error.message}`,
    error
  });
}
