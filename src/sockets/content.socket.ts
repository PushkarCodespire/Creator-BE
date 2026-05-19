// ===========================================
// CONTENT PROCESSING SOCKET HANDLER
// ===========================================
// Real-time updates for content processing status
// Emits progress updates during content chunking and embedding

import { Server, Socket } from 'socket.io';
import { logInfo, logWarning } from '../utils/logger';

export interface ContentProcessingUpdate {
  contentId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: {
    current: number;
    total: number;
    percentage: number;
    stage: 'chunking' | 'embedding' | 'storing' | 'complete';
  };
  message?: string;
  errorMessage?: string;
  chunksCount?: number;
  processedAt?: string;
}

export class ContentSocketHandler {
  private static io: Server;

  static initialize(io: Server): void {
    this.io = io;
    logInfo('[ContentSocket] Content processing socket handler initialized');
  }

  /**
   * Emit content processing update to creator
   * @param userId Creator's user ID
   * @param update Processing update data
   */
  static emitContentUpdate(userId: string, update: ContentProcessingUpdate): void {
    if (!this.io) {
      logWarning('[ContentSocket] Socket.io not initialized');
      return;
    }

    // Emit to user's private room (users join this room via NotificationSocketHandler)
    this.io.to(`user_${userId}`).emit('content_processing_update', update);
    
    // Also emit to creator-specific room if needed
    this.io.to(`creator_${userId}`).emit('content_processing_update', update);
  }

  /**
   * Emit progress update during processing
   * @param userId Creator's user ID
   * @param contentId Content ID
   * @param stage Current processing stage
   * @param current Current progress
   * @param total Total steps
   * @param message Optional message
   */
  static emitProgress(
    userId: string,
    contentId: string,
    stage: 'chunking' | 'embedding' | 'storing' | 'complete',
    current: number,
    total: number,
    message?: string
  ): void {
    const percentage = Math.round((current / total) * 100);
    
    this.emitContentUpdate(userId, {
      contentId,
      status: 'PROCESSING',
      progress: {
        current,
        total,
        percentage,
        stage
      },
      message
    });
  }

  /**
   * Emit completion status
   * @param userId Creator's user ID
   * @param contentId Content ID
   * @param chunksCount Number of chunks created
   */
  static emitCompletion(userId: string, contentId: string, chunksCount: number): void {
    this.emitContentUpdate(userId, {
      contentId,
      status: 'COMPLETED',
      progress: {
        current: 100,
        total: 100,
        percentage: 100,
        stage: 'complete'
      },
      message: `Content processed successfully. Created ${chunksCount} chunks.`,
      chunksCount,
      processedAt: new Date().toISOString()
    });
  }

  /**
   * Emit failure status
   * @param userId Creator's user ID
   * @param contentId Content ID
   * @param errorMessage Error message
   */
  static emitFailure(userId: string, contentId: string, errorMessage: string): void {
    this.emitContentUpdate(userId, {
      contentId,
      status: 'FAILED',
      errorMessage,
      message: 'Content processing failed'
    });
  }
}
