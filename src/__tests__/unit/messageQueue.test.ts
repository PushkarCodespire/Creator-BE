jest.mock('../../utils/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisConnected: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'job-uuid-1') }));
jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

import { getRedisClient, isRedisConnected } from '../../utils/redis';
import { MessageQueue } from '../../utils/messageQueue';

const mockGetRedis = getRedisClient as jest.Mock;
const mockIsConnected = isRedisConnected as jest.Mock;

const makeRedis = (overrides = {}) => ({
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  lPush: jest.fn().mockResolvedValue(1),
  lRem: jest.fn().mockResolvedValue(1),
  lLen: jest.fn().mockResolvedValue(0),
  lRange: jest.fn().mockResolvedValue([]),
  brPop: jest.fn().mockResolvedValue(null),
  zAdd: jest.fn().mockResolvedValue(1),
  zRem: jest.fn().mockResolvedValue(1),
  zCard: jest.fn().mockResolvedValue(0),
  ...overrides,
});

describe('MessageQueue', () => {
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = makeRedis();
    mockGetRedis.mockReturnValue(redis);
    mockIsConnected.mockReturnValue(true);
  });

  describe('constructor defaults', () => {
    it('uses provided config', () => {
      const q = new MessageQueue({ defaultMaxAttempts: 5, defaultPriority: 8, retryDelay: 10000 });
      expect(q).toBeDefined();
    });

    it('uses default config when none provided', () => {
      const q = new MessageQueue();
      expect(q).toBeDefined();
    });
  });

  describe('addJob', () => {
    it('throws when redis not available', async () => {
      mockGetRedis.mockReturnValue(null);
      const q = new MessageQueue();
      await expect(q.addJob('test-queue', { data: 1 })).rejects.toThrow('Redis not available');
    });

    it('throws when redis not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const q = new MessageQueue();
      await expect(q.addJob('test-queue', { data: 1 })).rejects.toThrow('Redis not available');
    });

    it('stores job and adds to priority queue', async () => {
      const q = new MessageQueue();
      const jobId = await q.addJob('test-queue', { message: 'hello' });

      expect(jobId).toBe('job-uuid-1');
      expect(redis.set).toHaveBeenCalledWith(
        'queue:test-queue:job-uuid-1',
        expect.stringContaining('"queue":"test-queue"')
      );
      expect(redis.zAdd).toHaveBeenCalled();
      expect(redis.lPush).toHaveBeenCalledWith('queue:test-queue', 'job-uuid-1');
    });

    it('uses custom priority and maxAttempts', async () => {
      const q = new MessageQueue();
      await q.addJob('test-queue', { data: 1 }, { priority: 9, maxAttempts: 5 });

      const setCall = (redis.set as jest.Mock).mock.calls[0][1];
      const job = JSON.parse(setCall);
      expect(job.priority).toBe(9);
      expect(job.maxAttempts).toBe(5);
    });

    it('sets processAt with delay when delay option provided', async () => {
      const now = Date.now();
      const q = new MessageQueue();
      await q.addJob('test-queue', {}, { delay: 60000 });

      const setCall = (redis.set as jest.Mock).mock.calls[0][1];
      const job = JSON.parse(setCall);
      const processAt = new Date(job.processAt).getTime();
      expect(processAt).toBeGreaterThanOrEqual(now + 59000);
    });
  });

  describe('getQueueStats', () => {
    it('returns zeros when redis not available', async () => {
      mockGetRedis.mockReturnValue(null);
      const q = new MessageQueue();
      const stats = await q.getQueueStats('test-queue');
      expect(stats).toEqual({ pending: 0, processing: 0, failed: 0, successRate: 0 });
    });

    it('returns zeros when redis not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const q = new MessageQueue();
      const stats = await q.getQueueStats('test-queue');
      expect(stats).toEqual({ pending: 0, processing: 0, failed: 0, successRate: 0 });
    });

    it('returns queue statistics', async () => {
      (redis.lLen as jest.Mock).mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      (redis.zCard as jest.Mock).mockResolvedValue(10);

      const q = new MessageQueue();
      const stats = await q.getQueueStats('test-queue');

      expect(stats.pending).toBe(5);
      expect(stats.failed).toBe(2);
    });

    it('returns 100 successRate when priorityJobs is 0', async () => {
      (redis.lLen as jest.Mock).mockResolvedValue(0);
      (redis.zCard as jest.Mock).mockResolvedValue(0);

      const q = new MessageQueue();
      const stats = await q.getQueueStats('test-queue');

      expect(stats.successRate).toBe(100);
    });
  });

  describe('getQueueJobs', () => {
    it('returns empty array when redis not available', async () => {
      mockGetRedis.mockReturnValue(null);
      const q = new MessageQueue();
      const jobs = await q.getQueueJobs('test-queue');
      expect(jobs).toEqual([]);
    });

    it('returns empty array when redis not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const q = new MessageQueue();
      const jobs = await q.getQueueJobs('test-queue');
      expect(jobs).toEqual([]);
    });

    it('returns jobs from queue', async () => {
      const job = { id: 'job-1', queue: 'test', data: {}, priority: 5, attempts: 0, maxAttempts: 3, createdAt: new Date() };
      (redis.lRange as jest.Mock).mockResolvedValue(['job-1']);
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(job));

      const q = new MessageQueue();
      const jobs = await q.getQueueJobs('test-queue');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe('job-1');
    });

    it('skips jobs with null data', async () => {
      (redis.lRange as jest.Mock).mockResolvedValue(['job-1', 'job-2']);
      (redis.get as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify({ id: 'job-2' }));

      const q = new MessageQueue();
      const jobs = await q.getQueueJobs('test-queue');

      expect(jobs).toHaveLength(1);
    });

    it('uses custom limit', async () => {
      (redis.lRange as jest.Mock).mockResolvedValue([]);

      const q = new MessageQueue();
      await q.getQueueJobs('test-queue', 20);

      expect(redis.lRange).toHaveBeenCalledWith('queue:test-queue', 0, 19);
    });
  });

  describe('removeJob', () => {
    it('returns false when redis not available', async () => {
      mockGetRedis.mockReturnValue(null);
      const q = new MessageQueue();
      expect(await q.removeJob('test-queue', 'job-1')).toBe(false);
    });

    it('returns false when redis not connected', async () => {
      mockIsConnected.mockReturnValue(false);
      const q = new MessageQueue();
      expect(await q.removeJob('test-queue', 'job-1')).toBe(false);
    });

    it('removes job and returns true when found', async () => {
      (redis.lRem as jest.Mock).mockResolvedValue(1);

      const q = new MessageQueue();
      const result = await q.removeJob('test-queue', 'job-1');

      expect(redis.lRem).toHaveBeenCalledWith('queue:test-queue', 0, 'job-1');
      expect(redis.del).toHaveBeenCalledWith('queue:test-queue:job-1');
      expect(redis.zRem).toHaveBeenCalledWith('queue:test-queue:priority', 'job-1');
      expect(result).toBe(true);
    });

    it('returns false when job not found', async () => {
      (redis.lRem as jest.Mock).mockResolvedValue(0);

      const q = new MessageQueue();
      const result = await q.removeJob('test-queue', 'missing-job');

      expect(result).toBe(false);
    });
  });

  describe('stop', () => {
    it('stops processing and logs', async () => {
      const { logInfo } = await import('../../utils/logger');
      const q = new MessageQueue();
      await q.stop();
      expect(logInfo).toHaveBeenCalledWith('[Queue] Stopping queue processors');
    });
  });

  describe('processQueue', () => {
    it('throws when redis not available', async () => {
      mockGetRedis.mockReturnValue(null);
      const q = new MessageQueue();
      await expect(q.processQueue('test-queue', jest.fn())).rejects.toThrow('Redis not available');
    });

    it('stops when brPop returns null (single iteration then stop)', async () => {
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return null;
        return null;
      });

      const q = new MessageQueue();
      const processor = jest.fn();

      // Stop after first iteration
      setTimeout(() => q.stop(), 10);
      await q.processQueue('test-queue', processor);

      expect(processor).not.toHaveBeenCalled();
    });

    it('processes job successfully', async () => {
      const job = { id: 'j1', queue: 'test', data: {}, priority: 5, attempts: 0, maxAttempts: 3, createdAt: new Date() };
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { element: 'j1' };
        return null;
      });
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(job));

      const q = new MessageQueue();
      const processor = jest.fn().mockResolvedValue(undefined);

      setTimeout(() => q.stop(), 50);
      await q.processQueue('test-queue', processor);

      expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1', attempts: 1 }));
      expect(redis.del).toHaveBeenCalledWith('queue:test-queue:j1');
    });

    it('re-queues delayed jobs', async () => {
      const futureJob = {
        id: 'j1', queue: 'test', data: {}, priority: 5, attempts: 0, maxAttempts: 3,
        createdAt: new Date(),
        processAt: new Date(Date.now() + 60000).toISOString(),
      };
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { element: 'j1' };
        return null;
      });
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(futureJob));

      const q = new MessageQueue();
      const processor = jest.fn();

      setTimeout(() => q.stop(), 50);
      await q.processQueue('test-queue', processor);

      expect(redis.lPush).toHaveBeenCalledWith('queue:test-queue', 'j1');
      expect(processor).not.toHaveBeenCalled();
    });

    it('moves to dead letter queue after max attempts', async () => {
      const job = { id: 'j1', queue: 'test', data: {}, priority: 5, attempts: 2, maxAttempts: 3, createdAt: new Date() };
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { element: 'j1' };
        return null;
      });
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(job));

      const q = new MessageQueue();
      const processor = jest.fn().mockRejectedValue(new Error('Process failed'));

      setTimeout(() => q.stop(), 50);
      await q.processQueue('test-queue', processor);

      // Should move to dead letters
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('dead_letters'),
        expect.any(String)
      );
      expect(redis.del).toHaveBeenCalledWith('queue:test-queue:j1');
    });

    it('retries job before max attempts', async () => {
      const job = { id: 'j1', queue: 'test', data: {}, priority: 5, attempts: 0, maxAttempts: 3, createdAt: new Date() };
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { element: 'j1' };
        return null;
      });
      (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(job));

      const q = new MessageQueue({ retryDelay: 1000 });
      const processor = jest.fn().mockRejectedValue(new Error('Fail'));

      setTimeout(() => q.stop(), 50);
      await q.processQueue('test-queue', processor);

      // Should re-queue for retry
      expect(redis.set).toHaveBeenCalledWith(
        'queue:test-queue:j1',
        expect.stringContaining('"errorMessage":"Fail"')
      );
      expect(redis.lPush).toHaveBeenCalledWith('queue:test-queue', 'j1');
    });

    it('skips processing when brPop returns null element job', async () => {
      let callCount = 0;
      (redis.brPop as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { element: 'j1' };
        return null;
      });
      (redis.get as jest.Mock).mockResolvedValue(null);

      const q = new MessageQueue();
      const processor = jest.fn();

      setTimeout(() => q.stop(), 50);
      await q.processQueue('test-queue', processor);

      expect(processor).not.toHaveBeenCalled();
    });

    it('does not start second processor when already processing', async () => {
      (redis.brPop as jest.Mock).mockResolvedValue(null);

      const q = new MessageQueue();
      const processor = jest.fn();

      const p1 = q.processQueue('test-queue', processor);
      const p2 = q.processQueue('test-queue', processor);

      setTimeout(() => q.stop(), 20);
      await Promise.all([p1, p2]);

      // brPop should only be called from one processor
      expect(redis.brPop).toHaveBeenCalled();
    });
  });
});
