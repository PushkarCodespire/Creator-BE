// ===========================================
// CHAT QUEUE — UNIT TESTS
// ===========================================

// Save original env before mock setup
const originalRedisUrl = process.env.REDIS_URL;
const originalRedisEnabled = process.env.REDIS_ENABLED;

// Ensure Redis is disabled so the queue falls back to the disabled implementation
process.env.REDIS_URL = '';
process.env.REDIS_ENABLED = 'false';

jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    process: jest.fn(),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn().mockReturnThis(),
  }));
});

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarning: jest.fn(),
  logDebug: jest.fn(),
}));

import { chatQueue, isChatQueueEnabled, ChatProcessingJobData } from '../../../services/queue/chat-queue';

describe('ChatQueue', () => {
  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
    process.env.REDIS_ENABLED = originalRedisEnabled;
  });

  describe('isChatQueueEnabled', () => {
    it('should be false when Redis is disabled', () => {
      expect(isChatQueueEnabled).toBe(false);
    });
  });

  describe('disabled queue', () => {
    it('should return null when adding a job', async () => {
      const jobData: ChatProcessingJobData = {
        messageId: 'msg-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        creatorId: 'creator-1',
        userMessage: 'Hello',
      };

      const result = await chatQueue.add(jobData);
      expect(result).toBeNull();
    });

    it('should return 0 for all counts', async () => {
      expect(await chatQueue.getWaitingCount()).toBe(0);
      expect(await chatQueue.getActiveCount()).toBe(0);
      expect(await chatQueue.getCompletedCount()).toBe(0);
      expect(await chatQueue.getFailedCount()).toBe(0);
      expect(await chatQueue.getDelayedCount()).toBe(0);
    });

    it('should not throw on close', async () => {
      await expect(chatQueue.close()).resolves.toBeUndefined();
    });

    it('should support chaining on() calls', () => {
      const result = chatQueue.on('error', () => {});
      // The disabled queue returns itself for chaining
      expect(result).toBeDefined();
    });
  });

  // ===========================================
  // disabled queue — additional branches
  // ===========================================
  describe('disabled queue — additional branches', () => {
    it('process() should not throw', () => {
      expect(() => (chatQueue as any).process(() => {})).not.toThrow();
    });

    it('close() should resolve to undefined', async () => {
      await expect(chatQueue.close()).resolves.toBeUndefined();
    });

    it('add() should always return null regardless of job data', async () => {
      const minimalJob: ChatProcessingJobData = {
        messageId: 'msg-2',
        conversationId: 'conv-2',
        userId: null,
        creatorId: 'creator-2',
        userMessage: 'Test'
      };
      const result = await chatQueue.add(minimalJob);
      expect(result).toBeNull();
    });

    it('add() with media field should still return null', async () => {
      const jobWithMedia: ChatProcessingJobData = {
        messageId: 'msg-3',
        conversationId: 'conv-3',
        userId: 'user-3',
        creatorId: 'creator-3',
        userMessage: 'With media',
        media: [{ url: 'http://example.com/img.jpg', type: 'image' }]
      };
      const result = await chatQueue.add(jobWithMedia);
      expect(result).toBeNull();
    });

    it('warn-once: logWarning called only on first add()', async () => {
      const { logWarning } = require('../../../utils/logger');

      const jobData: ChatProcessingJobData = {
        messageId: 'msg-w1',
        conversationId: 'conv-w1',
        userId: 'u',
        creatorId: 'c',
        userMessage: 'Hi'
      };

      // First call may or may not warn (warned flag is module-level, already set by earlier tests),
      // but subsequent calls definitely must NOT call logWarning again.
      const callsBefore = (logWarning as jest.Mock).mock.calls.length;
      await chatQueue.add(jobData);
      await chatQueue.add(jobData);
      await chatQueue.add(jobData);
      const callsAfter = (logWarning as jest.Mock).mock.calls.length;

      // At most 1 new call (the first add, if the warn had not fired yet)
      expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
    });

    it('on() event handler can be registered without throwing', () => {
      expect(() => chatQueue.on('completed', (_job: any) => {})).not.toThrow();
      expect(() => chatQueue.on('failed', (_job: any, _err: any) => {})).not.toThrow();
      expect(() => chatQueue.on('active', (_job: any) => {})).not.toThrow();
    });

    it('getWaitingCount returns 0', async () => {
      expect(await chatQueue.getWaitingCount()).toBe(0);
    });

    it('getActiveCount returns 0', async () => {
      expect(await chatQueue.getActiveCount()).toBe(0);
    });

    it('getCompletedCount returns 0', async () => {
      expect(await chatQueue.getCompletedCount()).toBe(0);
    });

    it('getFailedCount returns 0', async () => {
      expect(await chatQueue.getFailedCount()).toBe(0);
    });

    it('getDelayedCount returns 0', async () => {
      expect(await chatQueue.getDelayedCount()).toBe(0);
    });
  });
});
