// ===========================================
// REDIS MESSAGE QUEUE
// ===========================================
// Production-ready message queue using Redis
// Supports job prioritization, retries, and dead letter queues

import { getRedisClient, isRedisConnected } from './redis';
import { v4 as uuidv4 } from 'uuid';
import { logInfo, logError } from './logger';

export interface QueueJob {
  id: string;
  queue: string;
  data: unknown;
  priority: number; // 1-10 (10 = highest)
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processAt?: Date;
  processedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
}

export interface QueueConfig {
  defaultMaxAttempts?: number;
  defaultPriority?: number;
  retryDelay?: number; // ms
  deadLetterQueue?: string;
}

export class MessageQueue {
  private config: QueueConfig;
  private processing: boolean = false;

  constructor(config: QueueConfig = {}) {
    this.config = {
      defaultMaxAttempts: config.defaultMaxAttempts || 3,
      defaultPriority: config.defaultPriority || 5,
      retryDelay: config.retryDelay || 5000,
      deadLetterQueue: config.deadLetterQueue || 'dead_letters'
    };
  }

  /**
   * Add job to queue
   */
  async addJob(queueName: string, data: unknown, options: {
    priority?: number;
    delay?: number;
    maxAttempts?: number;
  } = {}): Promise<string> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      throw new Error('Redis not available');
    }

    const jobId = uuidv4();
    const job: QueueJob = {
      id: jobId,
      queue: queueName,
      data,
      priority: options.priority || (this.config.defaultPriority ?? 5),
      attempts: 0,
      maxAttempts: options.maxAttempts || (this.config.defaultMaxAttempts ?? 3),
      createdAt: new Date(),
      processAt: options.delay ? new Date(Date.now() + options.delay) : new Date()
    };

    const jobKey = `queue:${queueName}:${jobId}`;
    const queueKey = `queue:${queueName}`;
    const priorityKey = `queue:${queueName}:priority`;

    // Store job data
    await redis.set(jobKey, JSON.stringify(job));

    // Add to priority queue (using priority score)
    const priorityScore = (10 - job.priority) * 1000000 + Date.now();
    await redis.zAdd(priorityKey, {
      score: priorityScore,
      value: jobId
    });

    // Add to main queue
    await redis.lPush(queueKey, jobId);

    logInfo(`[Queue] Job ${jobId} added to queue ${queueName} (priority: ${job.priority})`);
    return jobId;
  }

  /**
   * Process jobs from queue
   */
  async processQueue(
    queueName: string,
    processor: (job: QueueJob) => Promise<void>
  ): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    logInfo(`[Queue] Starting processor for queue: ${queueName}`);

    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      this.processing = false;
      throw new Error('Redis not available');
    }

    try {
      while (this.processing) {
        // Get next job (blocking)
        const queueKey = `queue:${queueName}`;
        const result = await redis.brPop(queueKey, 1);
        
        if (!result) continue;

        const jobId = result.element;
        const jobKey = `queue:${queueName}:${jobId}`;
        const jobData = await redis.get(jobKey);

        if (!jobData) continue;

        const job: QueueJob = JSON.parse(jobData as string);
        
        // Check if job should be processed now
        if (job.processAt && new Date(job.processAt) > new Date()) {
          // Re-queue for later processing
          await redis.lPush(queueKey, jobId);
          continue;
        }

        try {
          job.attempts++;
          logInfo(`[Queue] Processing job ${jobId} (attempt ${job.attempts})`);
          
          await processor(job);
          
          // Success - remove job
          job.processedAt = new Date();
          await redis.del(jobKey);
          await redis.zRem(`queue:${queueName}:priority`, jobId);
          
          logInfo(`[Queue] Job ${jobId} completed successfully`);
          
        } catch (error) {
          logError(error instanceof Error ? error : new Error(String(error)), { context: `[Queue] Job ${jobId} failed` });
          
          job.errorMessage = (error as Error).message;
          
          if (job.attempts >= job.maxAttempts) {
            // Move to dead letter queue
            job.failedAt = new Date();
            await this.moveToDeadLetterQueue(queueName, job);
            await redis.del(jobKey);
            await redis.zRem(`queue:${queueName}:priority`, jobId);
            logInfo(`[Queue] Job ${jobId} moved to dead letter queue`);
          } else {
            // Retry with delay
            const retryDelay = this.config.retryDelay ?? 5000;
            job.processAt = new Date(Date.now() + retryDelay);
            await redis.set(jobKey, JSON.stringify(job));
            await redis.lPush(queueKey, jobId); // Re-queue
            logInfo(`[Queue] Job ${jobId} will retry in ${this.config.retryDelay}ms`);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Move failed job to dead letter queue
   */
  private async moveToDeadLetterQueue(queueName: string, job: QueueJob): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    const deadLetterKey = `queue:${this.config.deadLetterQueue}`;
    const deadLetterJobKey = `queue:${this.config.deadLetterQueue}:${job.id}`;
    
    await redis.set(deadLetterJobKey, JSON.stringify(job));
    await redis.lPush(deadLetterKey, job.id);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    pending: number;
    processing: number;
    failed: number;
    successRate: number;
  }> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      return { pending: 0, processing: 0, failed: 0, successRate: 0 };
    }

    const queueKey = `queue:${queueName}`;
    const deadLetterKey = `queue:${this.config.deadLetterQueue}`;
    const priorityKey = `queue:${queueName}:priority`;

    const [pending, failed, priorityJobs] = await Promise.all([
      redis.lLen(queueKey),
      redis.lLen(deadLetterKey),
      redis.zCard(priorityKey)
    ]);

    const successRate = priorityJobs > 0 
      ? ((priorityJobs - failed) / priorityJobs) * 100 
      : 100;

    return {
      pending,
      processing: priorityJobs - pending,
      failed,
      successRate: Math.round(successRate * 100) / 100
    };
  }

  /**
   * Get jobs in queue
   */
  async getQueueJobs(queueName: string, limit: number = 10): Promise<QueueJob[]> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return [];

    const queueKey = `queue:${queueName}`;
    const jobIds = await redis.lRange(queueKey, 0, limit - 1);

    const jobs: QueueJob[] = [];
    for (const jobId of jobIds) {
      const jobData = await redis.get(`queue:${queueName}:${jobId}`);
      if (jobData) {
        jobs.push(JSON.parse(jobData as string));
      }
    }

    return jobs;
  }

  /**
   * Stop processing
   */
  async stop(): Promise<void> {
    this.processing = false;
    logInfo('[Queue] Stopping queue processors');
  }

  /**
   * Remove job from queue
   */
  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) return false;

    const queueKey = `queue:${queueName}`;
    const jobKey = `queue:${queueName}:${jobId}`;
    const priorityKey = `queue:${queueName}:priority`;

    const result = await redis.lRem(queueKey, 0, jobId);
    await redis.del(jobKey);
    await redis.zRem(priorityKey, jobId);

    return result > 0;
  }
}

// Export singleton instance
export const messageQueue = new MessageQueue({
  defaultMaxAttempts: 3,
  defaultPriority: 5,
  retryDelay: 5000,
  deadLetterQueue: 'dead_letters'
});