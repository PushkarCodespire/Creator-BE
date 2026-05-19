// ===========================================
// CONTENT PROCESSING QUEUE (Bull)
// ===========================================
// Production-ready job queue for content processing
// Based on Phase 7 of the implementation plan

import Bull, { Queue, Job } from 'bull';
import { logWarning, logInfo, logError } from '../../utils/logger';

export interface ContentProcessingJobData {
  contentId: string;
  creatorId: string;
  userId: string;
  type: 'YOUTUBE_VIDEO' | 'MANUAL_TEXT' | 'FAQ';
  url?: string;
  text?: string;
  title?: string;
}

const REDIS_URL = (process.env.REDIS_URL || '').trim();
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

export const isContentQueueEnabled = REDIS_ENABLED && REDIS_URL.length > 0;

type DisabledQueue = {
  add: (...args: unknown[]) => Promise<null>;
  process: (...args: unknown[]) => void;
  getWaitingCount: () => Promise<number>;
  getActiveCount: () => Promise<number>;
  getCompletedCount: () => Promise<number>;
  getFailedCount: () => Promise<number>;
  getDelayedCount: () => Promise<number>;
  close: () => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => DisabledQueue;
};

const createDisabledQueue = (): DisabledQueue => {
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    logWarning(message);
  };

  const queue: DisabledQueue = {
    add: async () => {
      warnOnce('[ContentQueue] Redis is not configured. Jobs will not be queued.');
      return null;
    },
    process: () => {
      warnOnce('[ContentQueue] Redis is not configured. Queue processing is disabled.');
    },
    getWaitingCount: async () => 0,
    getActiveCount: async () => 0,
    getCompletedCount: async () => 0,
    getFailedCount: async () => 0,
    getDelayedCount: async () => 0,
    close: async () => {},
    on: () => queue
  };

  return queue;
};

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000 // Initial delay: 5 seconds
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 1000 // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600 // Keep failed jobs for 7 days
  }
};

export const contentQueue: Queue<ContentProcessingJobData> = isContentQueueEnabled
  ? new Bull('content-processing', {
      redis: REDIS_URL,
      defaultJobOptions
    })
  : (createDisabledQueue() as unknown as Queue<ContentProcessingJobData>);

// Queue events
contentQueue.on('completed', (job: Job, _result: unknown) => {
  logInfo(`[ContentQueue] Job ${job.id} completed`);
});

contentQueue.on('failed', (job: Job | undefined, error: Error) => {
  logError(error, { context: `[ContentQueue] Job ${job?.id} failed` });
});

contentQueue.on('stalled', (job: Job) => {
  logWarning(`[ContentQueue] Job ${job.id} stalled`);
});

// Queue metrics
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    contentQueue.getWaitingCount(),
    contentQueue.getActiveCount(),
    contentQueue.getCompletedCount(),
    contentQueue.getFailedCount(),
    contentQueue.getDelayedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  };
}

// Clean up on shutdown
process.on('SIGTERM', async () => {
  logInfo('[ContentQueue] Closing queue...');
  await contentQueue.close();
});

export default contentQueue;
