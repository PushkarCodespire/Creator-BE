// ===========================================
// CONTENT CONTROLLER
// Manages creator content for AI training
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { fetchCachedTranscript } from '../services/content/youtube.service';
import { deleteVectorsByContent } from '../utils/vectorStore';
import { contentQueue, isContentQueueEnabled } from '../services/queue/content-queue';
import { processContentJob } from '../services/queue/content-processor.worker';
import { sanitizeText, validateContentQuality } from '../utils/contentSanitizer';
import { logInfo, logError, logDebug } from '../utils/logger';

/**
 * Fire-and-forget content processing.
 * Responds to the client immediately, processes in background.
 */
function processInBackground(contentId: string, creatorId: string, userId: string, jobData: Record<string, unknown>) {
  logInfo(`[Content] Starting background processing for ${contentId}`);
  setImmediate(async () => {
    try {
      logInfo(`[Content] Background job executing for ${contentId}...`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await processContentJob({
        data: { contentId, creatorId, userId, ...jobData },
        progress: (value: number) => { logInfo(`[Content] Background progress ${contentId}: ${value}%`); }
      } as any);
      logInfo(`[Content] Background processing COMPLETED: ${contentId} (${result.chunksCreated} chunks)`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logError(error instanceof Error ? error : new Error(msg), { context: '[Content] Background processing FAILED', contentId });
      // eslint-disable-next-line no-console
      console.error('[Content] BACKGROUND PROCESSING FAILED:', contentId, msg);
      await prisma.creatorContent.update({
        where: { id: contentId },
        data: { status: 'FAILED', errorMessage: msg }
      }).catch(() => {});
    }
  });
}

// ===========================================
// ADD YOUTUBE VIDEO
// ===========================================

export const addYouTubeContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { url, title } = req.body;

  if (!url) {
    throw new AppError('YouTube URL is required', 400);
  }

  // Get creator
  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Rate limit: max 5 YouTube videos per creator per day
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = await prisma.creatorContent.count({
    where: {
      creatorId: creator.id,
      type: 'YOUTUBE_VIDEO',
      createdAt: { gte: dayStart }
    }
  });
  if (todayCount >= 5) {
    throw new AppError('Daily limit of 5 YouTube videos reached. Try again tomorrow.', 429);
  }

  let rawTranscriptText: string;

  // DB cache — reuse rawText from a COMPLETED record with the same URL
  const dbCached = await prisma.creatorContent.findFirst({
    where: { sourceUrl: url, type: 'YOUTUBE_VIDEO', status: 'COMPLETED' },
    select: { rawText: true }
  });

  if (dbCached?.rawText) {
    rawTranscriptText = dbCached.rawText;
  } else {
    // Fetch via Cloudflare Worker (primary) or direct YouTube (fallback)
    try {
      const result = await fetchCachedTranscript(url);
      rawTranscriptText = result.transcript;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('YouTube is blocking') ||
        errorMessage.includes('Could not extract functions') ||
        errorMessage.includes('YouTube may be blocking')
      ) {
        throw new AppError(
          'YouTube is blocking access to this video. Please use the "Manual Text" option instead.',
          400
        );
      }
      if (
        errorMessage.includes('Transcript is empty') ||
        errorMessage.includes('Transcript not available')
      ) {
        throw new AppError(
          'This video does not have a transcript available. Please ensure captions are enabled on YouTube.',
          400
        );
      }
      if (
        errorMessage.includes('Unable to fetch transcript') ||
        errorMessage.includes('Please use the "Manual Text"') ||
        errorMessage.includes('Please configure OPENAI_API_KEY')
      ) {
        throw new AppError(errorMessage, 400);
      }
      throw new AppError(
        `Unable to process this YouTube video: ${errorMessage}. Please try using the "Manual Text" option instead.`,
        400
      );
    }
  }

  // Sanitize and validate transcript
  const cleanedText = sanitizeText(rawTranscriptText);

  if (!cleanedText) {
    throw new AppError('Transcript is empty or unavailable for this video', 400);
  }

  // Validate content quality
  const qualityCheck = validateContentQuality(cleanedText);
  if (!qualityCheck.valid) {
    throw new AppError(`Content quality issues: ${qualityCheck.issues.join(', ')}`, 400);
  }

  // Create content record
  const content = await prisma.creatorContent.create({
    data: {
      creatorId: creator.id,
      title: title || `YouTube Video`,
      type: 'YOUTUBE_VIDEO',
      sourceUrl: url,
      rawText: cleanedText,
      status: 'PROCESSING'
    }
  });

  // Process content (synchronously if queue unavailable, async if available)
  if (isContentQueueEnabled) {
    // Add to Bull queue for background processing
    await contentQueue.add({
      contentId: content.id,
      creatorId: creator.id,
      userId: req.user!.id,
      type: 'YOUTUBE_VIDEO',
      url,
      title: title || `YouTube Video`
    }, {
      priority: 8, // High priority
      attempts: 3
    });

    res.status(201).json({
      success: true,
      data: content,
      message: 'Content added and processing started'
    });
  } else {
    // Process in background (no Redis available) — respond immediately
    processInBackground(content.id, creator.id, req.user!.id, { type: 'YOUTUBE_VIDEO' });

    res.status(201).json({
      success: true,
      data: content,
      message: 'Content added and processing started in background'
    });
  }
});

// ===========================================
// ADD MANUAL TEXT CONTENT
// ===========================================

export const addManualContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { title, text } = req.body;

  if (!title || !text) {
    throw new AppError('Title and text are required', 400);
  }

  // Get creator
  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Sanitize and validate content
  const sanitizedText = sanitizeText(text);
  const qualityCheck = validateContentQuality(sanitizedText);

  if (!qualityCheck.valid) {
    throw new AppError(`Content quality issues: ${qualityCheck.issues.join(', ')}`, 400);
  }

  // Create content record
  const content = await prisma.creatorContent.create({
    data: {
      creatorId: creator.id,
      title: sanitizeText(title),
      type: 'MANUAL_TEXT',
      rawText: sanitizedText,
      status: 'PROCESSING'
    }
  });

  // Process content (synchronously if queue unavailable, async if available)
  if (isContentQueueEnabled) {
    // Add to Bull queue for background processing
    await contentQueue.add({
      contentId: content.id,
      creatorId: creator.id,
      userId: req.user!.id,
      type: 'MANUAL_TEXT',
      text,
      title
    }, {
      priority: 7,
      attempts: 3
    });

    res.status(201).json({
      success: true,
      data: content,
      message: 'Content added and processing started'
    });
  } else {
    processInBackground(content.id, creator.id, req.user!.id, { type: 'MANUAL_TEXT', text, title });

    res.status(201).json({
      success: true,
      data: content,
      message: 'Content added and processing started in background'
    });
  }
});

// ===========================================
// ADD FAQ CONTENT
// ===========================================

export const addFAQContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { faqs } = req.body; // Array of { question, answer }

  if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
    throw new AppError('FAQs array is required', 400);
  }

  // Get creator
  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Sanitize and format FAQs as text
  const faqText = faqs
    .map((faq: { question: string; answer: string }) => {
      const sanitizedQ = sanitizeText(faq.question);
      const sanitizedA = sanitizeText(faq.answer);
      return `Q: ${sanitizedQ}\nA: ${sanitizedA}`;
    })
    .join('\n\n');

  // Validate FAQ content quality
  const qualityCheck = validateContentQuality(faqText);
  if (!qualityCheck.valid) {
    throw new AppError(`FAQ content quality issues: ${qualityCheck.issues.join(', ')}`, 400);
  }

  // Upsert: append to existing FAQ record if one exists, otherwise create
  const existing = await prisma.creatorContent.findFirst({
    where: { creatorId: creator.id, type: 'FAQ' },
    select: { id: true, rawText: true },
  });

  let content;
  let mergedText: string;

  if (existing) {
    mergedText = existing.rawText ? `${existing.rawText}\n\n${faqText}` : faqText;
    content = await prisma.creatorContent.update({
      where: { id: existing.id },
      data: { rawText: mergedText, status: 'PROCESSING' },
    });
  } else {
    mergedText = faqText;
    content = await prisma.creatorContent.create({
      data: {
        creatorId: creator.id,
        title: 'FAQs',
        type: 'FAQ',
        rawText: mergedText,
        status: 'PROCESSING',
      },
    });
  }

  // Re-process so the updated text gets re-embedded
  if (isContentQueueEnabled) {
    await contentQueue.add({
      contentId: content.id,
      creatorId: creator.id,
      userId: req.user!.id,
      type: 'FAQ',
      text: mergedText,
      title: 'FAQs'
    }, {
      priority: 7,
      attempts: 3
    });

    res.status(201).json({
      success: true,
      data: content,
      message: 'FAQs added and processing started'
    });
  } else {
    processInBackground(content.id, creator.id, req.user!.id, { type: 'FAQ', text: mergedText, title: 'FAQs' });

    res.status(201).json({
      success: true,
      data: content,
      message: 'FAQs added and processing started in background'
    });
  }
});

// ===========================================
// GET CREATOR CONTENT LIST
// ===========================================

export const getCreatorContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  const [contents, total] = await Promise.all([
    prisma.creatorContent.findMany({
      where: { creatorId: creator.id },
      select: {
        id: true,
        title: true,
        type: true,
        sourceUrl: true,
        status: true,
        errorMessage: true,
        rawText: true,
        createdAt: true,
        processedAt: true,
        _count: {
          select: { chunks: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.creatorContent.count({ where: { creatorId: creator.id } })
  ]);

  res.json({
    success: true,
    data: {
      contents,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  });
});

// ===========================================
// DELETE CONTENT
// ===========================================

export const deleteContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { contentId } = req.params as { contentId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Verify ownership
  const content = await prisma.creatorContent.findFirst({
    where: {
      id: contentId,
      creatorId: creator.id
    }
  });

  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Delete from vector store
  deleteVectorsByContent(contentId);

  // Delete from database (cascades to chunks)
  await prisma.creatorContent.delete({
    where: { id: contentId }
  });

  res.json({
    success: true,
    message: 'Content deleted successfully'
  });
});

// ===========================================
// RETRAIN CONTENT
// ===========================================

export const retrainContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { contentId } = req.params as { contentId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Verify ownership
  const content = await prisma.creatorContent.findFirst({
    where: {
      id: contentId,
      creatorId: creator.id
    }
  });

  if (!content) {
    throw new AppError('Content not found', 404);
  }

  // Update status
  await prisma.creatorContent.update({
    where: { id: contentId },
    data: {
      status: 'PROCESSING',
      errorMessage: null
    }
  });

  // Process content (synchronously if queue unavailable, async if available)
  if (isContentQueueEnabled) {
    // Add to Bull queue for reprocessing (high priority)
    await contentQueue.add({
      contentId,
      creatorId: creator.id,
      userId,
      type: content.type as 'YOUTUBE_VIDEO' | 'MANUAL_TEXT' | 'FAQ',
      url: content.sourceUrl || undefined,
      text: content.rawText || undefined,
      title: content.title
    }, {
      priority: 9, // Very high priority for retries
      attempts: 3
    });

    res.json({
      success: true,
      message: 'Content retraining started'
    });
  } else {
    processInBackground(contentId, creator.id, userId, { type: content.type });

    res.json({
      success: true,
      message: 'Content reprocessing started in background'
    });
  }
});

// ===========================================
// GET CONTENT DETAILS
// ===========================================

export const getContentDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { contentId } = req.params as { contentId: string };

  const creator = await prisma.creator.findUnique({
    where: { userId }
  });

  if (!creator) {
    throw new AppError('Creator profile not found', 404);
  }

  // Get content with chunks
  const content = await prisma.creatorContent.findFirst({
    where: {
      id: contentId,
      creatorId: creator.id
    },
    include: {
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          text: true,
          tokenCount: true,
          createdAt: true
        },
        orderBy: {
          chunkIndex: 'asc'
        }
      },
      _count: {
        select: {
          chunks: true
        }
      }
    }
  });

  if (!content) {
    throw new AppError('Content not found', 404);
  }

  res.json({
    success: true,
    data: {
      id: content.id,
      title: content.title,
      type: content.type,
      sourceUrl: content.sourceUrl,
      status: content.status,
      errorMessage: content.errorMessage,
      chunks: content.chunks.map(chunk => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''), // Preview only
        tokenCount: chunk.tokenCount,
        createdAt: chunk.createdAt
      })),
      chunksCount: content._count.chunks,
      createdAt: content.createdAt,
      processedAt: content.processedAt,
      updatedAt: content.updatedAt
    }
  });
});
