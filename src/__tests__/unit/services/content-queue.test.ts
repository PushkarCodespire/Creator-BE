// ===========================================
// CONTENT QUEUE — UNIT TESTS
// ===========================================

// Ensure Redis is disabled so the queue falls back to the disabled implementation
const originalRedisUrl = process.env.REDIS_URL;
const originalRedisEnabled = process.env.REDIS_ENABLED;
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

import {
  contentQueue,
  isContentQueueEnabled,
  getQueueStats,
  ContentProcessingJobData,
} from '../../../services/queue/content-queue';

describe('ContentQueue', () => {
  afterAll(() => {
    process.env.REDIS_URL = originalRedisUrl;
    process.env.REDIS_ENABLED = originalRedisEnabled;
  });

  describe('isContentQueueEnabled', () => {
    it('should be false when Redis is disabled', () => {
      expect(isContentQueueEnabled).toBe(false);
    });
  });

  describe('disabled queue', () => {
    it('should return null when adding a job', async () => {
      const jobData: ContentProcessingJobData = {
        contentId: 'content-1',
        creatorId: 'creator-1',
        userId: 'user-1',
        type: 'YOUTUBE_VIDEO',
        url: 'https://youtube.com/watch?v=test',
      };

      const result = await contentQueue.add(jobData);
      expect(result).toBeNull();
    });

    it('should return 0 for all queue counts', async () => {
      expect(await contentQueue.getWaitingCount()).toBe(0);
      expect(await contentQueue.getActiveCount()).toBe(0);
      expect(await contentQueue.getCompletedCount()).toBe(0);
      expect(await contentQueue.getFailedCount()).toBe(0);
      expect(await contentQueue.getDelayedCount()).toBe(0);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await getQueueStats();

      expect(stats).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        total: 0,
      });
    });

    it('should calculate total as sum of all counts', async () => {
      const stats = await getQueueStats();
      expect(stats.total).toBe(
        stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed
      );
    });
  });

  // ===========================================
  // disabled queue — additional branches
  // ===========================================
  describe('disabled queue — additional branches', () => {
    it('process() should not throw', () => {
      expect(() => (contentQueue as any).process(() => {})).not.toThrow();
    });

    it('close() should resolve to undefined', async () => {
      await expect(contentQueue.close()).resolves.toBeUndefined();
    });

    it('add() with MANUAL_TEXT type returns null', async () => {
      const job: ContentProcessingJobData = {
        contentId: 'c-2',
        creatorId: 'cr-2',
        userId: 'u-2',
        type: 'MANUAL_TEXT',
        text: 'Some manual text'
      };
      const result = await contentQueue.add(job);
      expect(result).toBeNull();
    });

    it('add() with FAQ type returns null', async () => {
      const job: ContentProcessingJobData = {
        contentId: 'c-3',
        creatorId: 'cr-3',
        userId: 'u-3',
        type: 'FAQ',
        title: 'FAQ title',
        text: 'FAQ body'
      };
      const result = await contentQueue.add(job);
      expect(result).toBeNull();
    });

    it('add() with YOUTUBE_VIDEO and all optional fields returns null', async () => {
      const job: ContentProcessingJobData = {
        contentId: 'c-4',
        creatorId: 'cr-4',
        userId: 'u-4',
        type: 'YOUTUBE_VIDEO',
        url: 'https://youtube.com/watch?v=abc',
        title: 'My Video'
      };
      const result = await contentQueue.add(job);
      expect(result).toBeNull();
    });

    it('on() event registration does not throw', () => {
      expect(() => contentQueue.on('completed', (_job: any) => {})).not.toThrow();
      expect(() => contentQueue.on('failed', (_job: any, _err: any) => {})).not.toThrow();
      expect(() => contentQueue.on('stalled', (_job: any) => {})).not.toThrow();
    });

    it('getWaitingCount returns 0', async () => {
      expect(await contentQueue.getWaitingCount()).toBe(0);
    });

    it('getActiveCount returns 0', async () => {
      expect(await contentQueue.getActiveCount()).toBe(0);
    });

    it('getCompletedCount returns 0', async () => {
      expect(await contentQueue.getCompletedCount()).toBe(0);
    });

    it('getFailedCount returns 0', async () => {
      expect(await contentQueue.getFailedCount()).toBe(0);
    });

    it('getDelayedCount returns 0', async () => {
      expect(await contentQueue.getDelayedCount()).toBe(0);
    });
  });

  // ===========================================
  // getQueueStats — additional branches
  // ===========================================
  describe('getQueueStats — additional branches', () => {
    it('should return an object with all required keys', async () => {
      const stats = await getQueueStats();
      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('delayed');
      expect(stats).toHaveProperty('total');
    });

    it('total should always equal sum of individual counts', async () => {
      const stats = await getQueueStats();
      const expected = stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed;
      expect(stats.total).toBe(expected);
    });
  });
});
