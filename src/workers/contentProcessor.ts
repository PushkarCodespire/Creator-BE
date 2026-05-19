// ===========================================
// CONTENT PROCESSOR WORKER
// ===========================================
// Background job for processing creator content
// Handles YouTube videos, Instagram posts, and uploaded files

import prisma from '../../prisma/client';
import { ContentStatus, ContentType } from '@prisma/client';
import { fetchYouTubeTranscript } from '../utils/youtube';
import { storeVectors, VectorEntry } from '../utils/vectorStore';
import { chunkText, generateEmbedding } from '../utils/openai';
import { AppError } from '../middleware/errorHandler';
import { messageQueue } from '../utils/messageQueue';
import { logInfo, logError } from '../utils/logger';

interface ContentProcessingJob {
  contentId: string;
  type: ContentType;
  sourceUrl?: string;
  filePath?: string;
}

export class ContentProcessor {
  /**
   * Process content in background
   */
  static async queueContent(job: ContentProcessingJob): Promise<void> {
    try {
      logInfo(`[ContentProcessor] Queueing content for processing: ${job.contentId}`);
      
      // Add to message queue
      await messageQueue.addJob('content_processing', job, {
        priority: 8, // High priority
        maxAttempts: 3
      });
      
      logInfo(`[ContentProcessor] Content queued successfully: ${job.contentId}`);
      
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Error queueing content ${job.contentId}` });
      throw error;
    }
  }

  static async processContent(job: ContentProcessingJob): Promise<void> {
    try {
      logInfo(`[ContentProcessor] Processing content: ${job.contentId}`);
      
      // Update status to processing
      await prisma.creatorContent.update({
        where: { id: job.contentId },
        data: { status: ContentStatus.PROCESSING }
      });

      let rawText = '';
      
      // Process based on content type
      switch (job.type) {
        case ContentType.YOUTUBE_VIDEO:
          if (!job.sourceUrl) {
            throw new AppError('YouTube URL is required', 400);
          }
          const transcriptData = await fetchYouTubeTranscript(job.sourceUrl);
          rawText = transcriptData.transcript;
          break;
          
        case ContentType.UPLOADED_FILE:
          if (!job.filePath) {
            throw new AppError('File path is required', 400);
          }
          // For file processing, we'd need to implement text extraction
          // This is a placeholder - you'd need a proper file text extraction library
          rawText = 'File content processing not implemented';
          break;
          
        case ContentType.MANUAL_TEXT:
        case ContentType.FAQ:
          // Text is already in the content, no processing needed
          const content = await prisma.creatorContent.findUnique({
            where: { id: job.contentId }
          });
          rawText = content?.rawText || '';
          break;
          
        default:
          throw new AppError('Unsupported content type', 400);
      }

      // Update with processed text
      await prisma.creatorContent.update({
        where: { id: job.contentId },
        data: {
          rawText,
          status: ContentStatus.COMPLETED,
          processedAt: new Date()
        }
      });

      // Generate embeddings for vector search
      if (rawText) {
        await this.generateContentEmbeddings(job.contentId, rawText);
      }

      logInfo(`[ContentProcessor] Content processed successfully: ${job.contentId}`);
      
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Error processing content ${job.contentId}` });
      
      // Update status to failed
      await prisma.creatorContent.update({
        where: { id: job.contentId },
        data: {
          status: ContentStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date()
        }
      });
      
      throw error;
    }
  }

  /**
   * Process all pending content
   */
  static async processPendingContent(): Promise<void> {
    const pendingContent = await prisma.creatorContent.findMany({
      where: { status: ContentStatus.PENDING },
      take: 10 // Process 10 items at a time
    });

    logInfo(`[ContentProcessor] Found ${pendingContent.length} pending content items`);
    
    for (const content of pendingContent) {
      try {
        await this.processContent({
          contentId: content.id,
          type: content.type,
          sourceUrl: content.sourceUrl || undefined,
          filePath: content.filePath || undefined
        });
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Failed to process content ${content.id}` });
        // Continue processing other items
      }
    }
  }

  /**
   * Retry failed content processing
   */
  static async retryFailedContent(): Promise<void> {
    const failedContent = await prisma.creatorContent.findMany({
      where: { 
        status: ContentStatus.FAILED,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      take: 5
    });

    logInfo(`[ContentProcessor] Retrying ${failedContent.length} failed content items`);
    
    for (const content of failedContent) {
      try {
        await this.processContent({
          contentId: content.id,
          type: content.type,
          sourceUrl: content.sourceUrl || undefined,
          filePath: content.filePath || undefined
        });
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Retry failed for content ${content.id}` });
      }
    }
  }

  /**
   * Generate embeddings for content
   */
  private static async generateContentEmbeddings(contentId: string, text: string): Promise<void> {
    try {
      // Get content to get creatorId
      const content = await prisma.creatorContent.findUnique({
        where: { id: contentId },
        include: { creator: true }
      });

      if (!content || !content.creator) {
        throw new Error('Content or creator not found');
      }

      // Split text into chunks
      const chunks = chunkText(text, 500, 100);
      
      // Generate embeddings for each chunk
      const vectorEntries: VectorEntry[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbedding(chunk);
        
        vectorEntries.push({
          id: `${contentId}_${i}`,
          creatorId: content.creator.id,
          contentId: contentId,
          chunkIndex: i,
          text: chunk,
          embedding: embedding,
          metadata: {
            source: 'content_processor',
            contentId: contentId,
            chunkIndex: i
          }
        });
      }
      
      // Store vectors
      storeVectors(vectorEntries);
      
      logInfo(`[ContentProcessor] Generated ${vectorEntries.length} embeddings for content ${contentId}`);
      
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Error generating embeddings for ${contentId}` });
      // Don't fail the whole process for embedding errors
    }
  }
}