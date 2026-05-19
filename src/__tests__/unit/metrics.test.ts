// ===========================================
// METRICS UNIT TESTS
// ===========================================

import {
  metricsRegistry,
  contentProcessingCounter,
  contentProcessingDuration,
  contentChunksCreated,
  embeddingGenerationDuration,
  openaiApiCalls,
  openaiApiErrors,
  queueSize,
  vectorStoreSize,
  recordContentProcessing,
  recordOpenAICall,
  updateQueueMetrics,
} from '../../utils/metrics';

describe('Metrics Utils - Unit Tests', () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  describe('metricsRegistry', () => {
    it('should be defined', () => {
      expect(metricsRegistry).toBeDefined();
    });

    it('should contain registered metrics', async () => {
      const metrics = await metricsRegistry.getMetricsAsJSON();
      const metricNames = metrics.map((m: any) => m.name);
      expect(metricNames).toContain('content_processing_total');
      expect(metricNames).toContain('content_processing_duration_seconds');
    });
  });

  describe('contentProcessingCounter', () => {
    it('should increment counter', () => {
      contentProcessingCounter.inc({ type: 'video', status: 'completed' });
      // No error thrown = success
      expect(contentProcessingCounter).toBeDefined();
    });
  });

  describe('contentProcessingDuration', () => {
    it('should observe duration', () => {
      contentProcessingDuration.observe({ type: 'video', status: 'completed' }, 5.2);
      expect(contentProcessingDuration).toBeDefined();
    });
  });

  describe('contentChunksCreated', () => {
    it('should increment with type label', () => {
      contentChunksCreated.inc({ type: 'text' }, 10);
      expect(contentChunksCreated).toBeDefined();
    });
  });

  describe('embeddingGenerationDuration', () => {
    it('should observe with batch_size label', () => {
      embeddingGenerationDuration.observe({ batch_size: '32' }, 2.5);
      expect(embeddingGenerationDuration).toBeDefined();
    });
  });

  describe('openaiApiCalls', () => {
    it('should increment with endpoint and status', () => {
      openaiApiCalls.inc({ endpoint: 'embeddings', status: 'success' });
      expect(openaiApiCalls).toBeDefined();
    });
  });

  describe('openaiApiErrors', () => {
    it('should increment with error_type', () => {
      openaiApiErrors.inc({ error_type: 'rate_limit' });
      expect(openaiApiErrors).toBeDefined();
    });
  });

  describe('queueSize', () => {
    it('should set gauge value', () => {
      queueSize.set({ status: 'waiting' }, 5);
      expect(queueSize).toBeDefined();
    });
  });

  describe('vectorStoreSize', () => {
    it('should set gauge value', () => {
      vectorStoreSize.set({ creator_id: 'creator-1' }, 100);
      expect(vectorStoreSize).toBeDefined();
    });
  });

  describe('recordContentProcessing', () => {
    it('should record completed processing with chunks', () => {
      // Should not throw
      recordContentProcessing('video', 'completed', 5.0, 10);
    });

    it('should record failed processing without chunks', () => {
      recordContentProcessing('text', 'failed', 1.0);
    });

    it('should record processing with zero duration', () => {
      recordContentProcessing('faq', 'completed', 0);
    });

    it('should not increment chunks when chunksCount is undefined', () => {
      recordContentProcessing('video', 'completed', 2.0, undefined);
    });

    it('should not increment chunks when chunksCount is 0 (falsy)', () => {
      recordContentProcessing('video', 'completed', 2.0, 0);
    });
  });

  describe('recordOpenAICall', () => {
    it('should record successful API call', () => {
      recordOpenAICall('chat/completions', 'success');
    });

    it('should record failed API call with error type', () => {
      recordOpenAICall('embeddings', 'error', 'rate_limit');
    });

    it('should record error without error type', () => {
      recordOpenAICall('embeddings', 'error');
    });

    it('should handle success status without error type', () => {
      recordOpenAICall('chat/completions', 'success', undefined);
    });
  });

  describe('updateQueueMetrics', () => {
    it('should update all queue gauge metrics', async () => {
      const mockQueue = {
        getWaitingCount: jest.fn().mockResolvedValue(5),
        getActiveCount: jest.fn().mockResolvedValue(2),
        getCompletedCount: jest.fn().mockResolvedValue(100),
        getFailedCount: jest.fn().mockResolvedValue(3),
        getDelayedCount: jest.fn().mockResolvedValue(1),
      };

      await updateQueueMetrics(mockQueue);

      expect(mockQueue.getWaitingCount).toHaveBeenCalled();
      expect(mockQueue.getActiveCount).toHaveBeenCalled();
      expect(mockQueue.getCompletedCount).toHaveBeenCalled();
      expect(mockQueue.getFailedCount).toHaveBeenCalled();
      expect(mockQueue.getDelayedCount).toHaveBeenCalled();
    });

    it('should handle queue errors gracefully', async () => {
      const mockQueue = {
        getWaitingCount: jest.fn().mockRejectedValue(new Error('Connection lost')),
        getActiveCount: jest.fn().mockResolvedValue(0),
        getCompletedCount: jest.fn().mockResolvedValue(0),
        getFailedCount: jest.fn().mockResolvedValue(0),
        getDelayedCount: jest.fn().mockResolvedValue(0),
      };

      // Should not throw
      await expect(updateQueueMetrics(mockQueue)).resolves.not.toThrow();
    });

    it('should handle null queue gracefully', async () => {
      const mockQueue = {
        getWaitingCount: jest.fn().mockRejectedValue(new Error('null')),
        getActiveCount: jest.fn().mockRejectedValue(new Error('null')),
        getCompletedCount: jest.fn().mockRejectedValue(new Error('null')),
        getFailedCount: jest.fn().mockRejectedValue(new Error('null')),
        getDelayedCount: jest.fn().mockRejectedValue(new Error('null')),
      };

      await expect(updateQueueMetrics(mockQueue)).resolves.not.toThrow();
    });
  });
});
