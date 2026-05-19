jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { logger } from '../../utils/logger';
import {
  logContentProcessing,
  logChunking,
  logEmbeddingGeneration,
  logContentCompletion,
  logContentFailure,
} from '../../utils/contentLogger';

const l = logger as jest.Mocked<typeof logger>;

describe('contentLogger', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('logContentProcessing', () => {
    it('logs info when no error provided', () => {
      logContentProcessing({
        contentId: 'c1',
        creatorId: 'cr1',
        type: 'FAQ',
        stage: 'chunking',
        message: 'Chunking started',
      });

      expect(l.info).toHaveBeenCalledWith(
        '[ContentProcessing] chunking - Chunking started',
        expect.objectContaining({ contentId: 'c1', creatorId: 'cr1', type: 'FAQ', stage: 'chunking' })
      );
    });

    it('logs error when error is provided', () => {
      const err = new Error('Test error');
      logContentProcessing({
        contentId: 'c1',
        creatorId: 'cr1',
        type: 'FAQ',
        stage: 'failed',
        message: 'Processing failed',
        error: err,
      });

      expect(l.error).toHaveBeenCalledWith(
        '[ContentProcessing] failed - Processing failed',
        expect.objectContaining({
          contentId: 'c1',
          error: expect.objectContaining({ message: 'Test error', name: 'Error' }),
        })
      );
    });

    it('includes metadata when provided', () => {
      logContentProcessing({
        contentId: 'c1',
        creatorId: 'cr1',
        type: 'FAQ',
        stage: 'embedding',
        message: 'Generating embeddings',
        metadata: { batchSize: 10 },
      });

      expect(l.info).toHaveBeenCalledWith(
        '[ContentProcessing] embedding - Generating embeddings',
        expect.objectContaining({ metadata: { batchSize: 10 } })
      );
    });

    it('omits metadata key when not provided', () => {
      logContentProcessing({
        contentId: 'c1',
        creatorId: 'cr1',
        type: 'FAQ',
        stage: 'start',
        message: 'Starting',
      });

      const call = (l.info as jest.Mock).mock.calls[0][1];
      expect(call).not.toHaveProperty('metadata');
    });

    it('includes timestamp in log data', () => {
      logContentProcessing({ contentId: 'c1', creatorId: 'cr1', type: 'FAQ', stage: 'start', message: 'msg' });
      const call = (l.info as jest.Mock).mock.calls[0][1];
      expect(call).toHaveProperty('timestamp');
      expect(typeof call.timestamp).toBe('string');
    });
  });

  describe('logChunking', () => {
    it('logs chunking info with correct message', () => {
      logChunking('c1', 'cr1', 5, 200);

      expect(l.info).toHaveBeenCalledWith(
        '[ContentProcessing] chunking - Created 5 chunks (avg size: 200 chars)',
        expect.objectContaining({
          metadata: { chunksCount: 5, avgChunkSize: 200 },
        })
      );
    });
  });

  describe('logEmbeddingGeneration', () => {
    it('logs embedding batch info', () => {
      logEmbeddingGeneration('c1', 'cr1', 2, 5, 10);

      expect(l.info).toHaveBeenCalledWith(
        '[ContentProcessing] embedding - Processing batch 2/5 (10 texts)',
        expect.objectContaining({
          metadata: { batchNumber: 2, totalBatches: 5, batchSize: 10 },
        })
      );
    });
  });

  describe('logContentCompletion', () => {
    it('logs completion with processing time formatted', () => {
      logContentCompletion('c1', 'cr1', 'FAQ', 3, 1.5);

      expect(l.info).toHaveBeenCalledWith(
        '[ContentProcessing] completed - Content processed successfully in 1.50s',
        expect.objectContaining({
          metadata: { chunksCount: 3, processingTimeSeconds: 1.5 },
        })
      );
    });
  });

  describe('logContentFailure', () => {
    it('logs failure with error and default stage', () => {
      const err = new Error('Processing failed');
      logContentFailure('c1', 'cr1', 'FAQ', err);

      expect(l.error).toHaveBeenCalledWith(
        '[ContentProcessing] failed - Content processing failed: Processing failed',
        expect.objectContaining({ error: expect.objectContaining({ message: 'Processing failed' }) })
      );
    });

    it('logs failure with custom stage', () => {
      const err = new Error('Chunk error');
      logContentFailure('c1', 'cr1', 'FAQ', err, 'chunking');

      expect(l.error).toHaveBeenCalledWith(
        '[ContentProcessing] chunking - Content processing failed: Chunk error',
        expect.anything()
      );
    });
  });
});
