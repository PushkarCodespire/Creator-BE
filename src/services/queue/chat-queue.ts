// ===========================================
// AI CHAT QUEUE CONFIGURATION (Bull)
// ===========================================

import Bull, { Queue } from 'bull';
import { logInfo, logError, logWarning } from '../../utils/logger';

// Job data interface
export interface ChatProcessingJobData {
    messageId: string;
    conversationId: string;
    userId: string | null;
    creatorId: string;
    userMessage: string;
    media?: Record<string, unknown>[];
}

const REDIS_URL = (
    (process.env.REDIS_URL || '').trim() ||
    (process.env.REDIS_HOST
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || '6379'}`
        : '')
).trim();
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

export const isChatQueueEnabled = REDIS_ENABLED && REDIS_URL.length > 0;

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
            warnOnce('[ChatQueue] Redis is not configured. Jobs will not be queued.');
            return null;
        },
        process: () => {
            warnOnce('[ChatQueue] Redis is not configured. Queue processing is disabled.');
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
        delay: 5000, // 5 seconds
    },
    removeOnComplete: true, // Clean up successful jobs
    removeOnFail: false,   // Keep failed jobs for debugging
};

export const chatQueue: Queue<ChatProcessingJobData> = isChatQueueEnabled
    ? new Bull<ChatProcessingJobData>('chat-processing', {
        redis: REDIS_URL,
        defaultJobOptions,
    })
    : (createDisabledQueue() as unknown as Queue<ChatProcessingJobData>);

// Event listeners for monitoring
chatQueue.on('error', (error) => {
    logError(error, { context: 'ChatQueue' });
});

chatQueue.on('waiting', (_jobId) => {
    // logInfo(`[ChatQueue] Job ${jobId} is waiting...`);
});

chatQueue.on('active', (_job) => {
    // logInfo(`[ChatQueue] Job ${job.id} started processing`);
});

chatQueue.on('completed', (job, _result) => {
    logInfo(`[ChatQueue] Job ${job.id} completed successfully`);
});

chatQueue.on('failed', (job, error) => {
    logError(error, { context: 'ChatQueue - Job Failed', jobId: job.id });
});

logInfo(`[ChatQueue] Initialization complete (${isChatQueueEnabled ? 'Enabled' : 'Disabled - Redis config missing'})`);
