// ===========================================
// CONTENT PROCESSOR WORKER (Bull Queue)
// ===========================================
// Background worker that processes content jobs
// Based on Phase 7 of the implementation plan

import { Job } from 'bull';
import prisma from '../../../prisma/client';
import { ContentSocketHandler } from '../../sockets/content.socket';
import { chunkContent, validateChunks } from '../content/chunking.service';
import { generateEmbeddings } from '../content/embedding.service';
import { storeVectors, storeVector, deleteVectorsByContent, vectorExists, VectorEntry } from '../../utils/vectorStore';
import { ContentProcessingJobData } from './content-queue';
import { recordContentProcessing, recordOpenAICall } from '../../utils/metrics';
import { logContentProcessing, logChunking, logEmbeddingGeneration, logContentCompletion, logContentFailure } from '../../utils/contentLogger';
import { logWarning, logInfo, logError } from '../../utils/logger';

/**
 * Process content job
 */
export async function processContentJob(job: Job<ContentProcessingJobData>): Promise<{
  chunksCreated: number;
  embeddingsGenerated: number;
  processingTime: number;
}> {
  const { contentId, creatorId, userId, type } = job.data;
  const startTime = Date.now();

  try {
    // Report progress: 0%
    job.progress(0);
    ContentSocketHandler.emitProgress(userId, contentId, 'chunking', 0, 100, 'Starting content processing...');
    logContentProcessing({
      contentId,
      creatorId,
      type,
      stage: 'starting',
      message: 'Content processing started'
    });

    // Get content
    const content = await prisma.creatorContent.findUnique({
      where: { id: contentId }
    });

    if (!content || !content.rawText) {
      throw new Error('Content not found or empty');
    }

    // Report progress: 10%
    job.progress(10);
    ContentSocketHandler.emitProgress(userId, contentId, 'chunking', 10, 100, 'Cleaning up existing data...');

    // Delete existing vectors and chunks
    deleteVectorsByContent(contentId);
    await prisma.contentChunk.deleteMany({
      where: { contentId }
    });

    // Report progress: 20%
    job.progress(20);
    ContentSocketHandler.emitProgress(userId, contentId, 'chunking', 20, 100, 'Splitting content into chunks...');

    // Chunk content — transcripts use sentence-aware chunking (idea units),
    // Instagram posts are short-form so use a low minimum chunk length,
    // everything else uses character-based recursive splitting.
    const isTranscript = content.type === 'YOUTUBE_VIDEO';
    const isShortForm  = content.type === 'INSTAGRAM_POST';
    const chunks = chunkContent(content.rawText, {
      chunkSize: 800,
      chunkOverlap: 100,
      contentType: isTranscript ? 'transcript' : 'text',
      minChunkLength: isShortForm ? 5 : 10,
    });

    // Validate chunks
    const validation = validateChunks(chunks);
    if (!validation.valid) {
      logWarning(`[ContentProcessor] Chunk validation issues: ${validation.issues.join(', ')}`);
    }

    // Guard: if the entire text is too short to produce any chunk (e.g. pure emoji),
    // fall back to storing the whole rawText as a single chunk so nothing is silently lost.
    if (chunks.length === 0 && content.rawText.trim().length > 0) {
      const fallback = content.rawText.trim();
      chunks.push({ text: fallback, index: 0, characterCount: fallback.length, wordCount: fallback.split(/\s+/).length });
      logWarning(`[ContentProcessor] ${contentId} produced 0 chunks — using raw text as single fallback chunk (${fallback.length} chars)`);
    }

    // Log chunking (guard divide-by-zero when rawText was genuinely empty)
    const avgChunkSize = chunks.length > 0
      ? chunks.reduce((sum, c) => sum + c.characterCount, 0) / chunks.length
      : 0;
    logChunking(contentId, creatorId, chunks.length, avgChunkSize);

    // Report progress: 30%
    job.progress(30);
    ContentSocketHandler.emitProgress(userId, contentId, 'chunking', 30, 100, `Created ${chunks.length} chunks`);

    // Generate embeddings BEFORE storing chunks — if OpenAI fails here,
    // no partial state is written to the DB and the job can be cleanly retried.
    const chunkTexts = chunks.map(c => c.text);
    const batchSize = 50;
    const totalBatches = Math.ceil(chunkTexts.length / batchSize);

    // Report progress: 40%
    job.progress(40);
    ContentSocketHandler.emitProgress(userId, contentId, 'embedding', 40, 100, 'Generating embeddings...');

    logEmbeddingGeneration(contentId, creatorId, 1, totalBatches, Math.min(batchSize, chunkTexts.length));

    const embeddings = await generateEmbeddings(chunkTexts);

    // Report progress: 70%
    job.progress(70);
    ContentSocketHandler.emitProgress(userId, contentId, 'embedding', 70, 100, `Generated ${embeddings.length} embeddings`);

    // Store chunks with embeddings in one pass — no separate update step needed
    const chunkRecords = await Promise.all(
      chunks.map((chunk, index) =>
        prisma.contentChunk.create({
          data: {
            contentId,
            chunkIndex: chunk.index,
            text: chunk.text,
            embedding: JSON.stringify(embeddings[index] ?? []),
            tokenCount: Math.ceil(chunk.wordCount * 1.3)
          }
        })
      )
    );

    // Report progress: 80%
    job.progress(80);
    ContentSocketHandler.emitProgress(userId, contentId, 'storing', 80, 100, 'Storing vectors...');

    // Store in vector store
    const vectorEntries: VectorEntry[] = chunks.map((chunk, index) => ({
      id: chunkRecords[index].id,
      creatorId,
      contentId,
      chunkIndex: chunk.index,
      text: chunk.text,
      embedding: embeddings[index],
      metadata: {
        contentTitle: content.title,
        contentType: content.type
      }
    }));

    storeVectors(vectorEntries);

    // Report progress: 90%
    job.progress(90);
    ContentSocketHandler.emitProgress(userId, contentId, 'storing', 90, 100, 'Finalizing...');

    // Update content status
    await prisma.creatorContent.update({
      where: { id: contentId },
      data: {
        status: 'COMPLETED',
        processedAt: new Date()
      }
    });

    // Report progress: 100%
    job.progress(100);
    const processingTime = Date.now() - startTime;

    // Emit completion
    ContentSocketHandler.emitCompletion(userId, contentId, chunks.length);

    const processingTimeSeconds = processingTime / 1000;
    logInfo(`Content processed: ${contentId} (${chunks.length} chunks, ${processingTimeSeconds.toFixed(2)}s)`);
    
    // Record metrics
    recordContentProcessing(type, 'completed', processingTimeSeconds, chunks.length);
    
    // Log completion
    logContentCompletion(contentId, creatorId, type, chunks.length, processingTimeSeconds);

    return {
      chunksCreated: chunks.length,
      embeddingsGenerated: embeddings.filter(e => e.length > 0).length,
      processingTime
    };

  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: `[ContentProcessor] Error processing content ${contentId}` });

    const errorMessage = error instanceof Error ? error.message : String(error);
    const processingTimeSeconds = (Date.now() - startTime) / 1000;
    
    // Record failure metrics
    recordContentProcessing(type, 'failed', processingTimeSeconds);
    
    // Record OpenAI errors if applicable
    if (errorMessage.includes('OpenAI') || errorMessage.includes('API')) {
      recordOpenAICall('embeddings', 'error', 'api_error');
    }
    
    // Log failure
    logContentFailure(contentId, creatorId, type, error as Error);

    // Update content status
    await prisma.creatorContent.update({
      where: { id: contentId },
      data: {
        status: 'FAILED',
        errorMessage
      }
    }).catch(err => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[ContentProcessor] Failed to update content status' });
    });

    // Emit failure
    ContentSocketHandler.emitFailure(userId, contentId, errorMessage);

    throw error;
  }
}

/**
 * On server startup, re-index any content chunks whose embeddings exist in
 * Postgres but are missing from the SQLite vector store (e.g. after a restart).
 *
 * Dimension-aware: if the embeddings stored in Postgres were generated by a
 * different provider (e.g. OpenAI 1536-dim) but the active provider now
 * produces a different dimension (e.g. Gemini 3072-dim), cosine similarity
 * returns 0 for every query and RAG silently breaks. In that case we
 * re-generate embeddings for every chunk using the current provider, write
 * them back to Postgres, and index them into SQLite.
 */
export async function backfillContentVectors(): Promise<void> {
  const { generateEmbedding } = await import('../../utils/openai');
  const { getExpectedEmbeddingDimension } = await import('../../utils/openai');
  const expectedDim = getExpectedEmbeddingDimension();

  const chunks = await prisma.contentChunk.findMany({
    where: {
      content: { status: 'COMPLETED' },
      embedding: { not: null },
    },
    select: {
      id: true,
      contentId: true,
      chunkIndex: true,
      text: true,
      embedding: true,
      content: {
        select: {
          creatorId: true,
          title: true,
          type: true,
        },
      },
    },
  });

  if (chunks.length === 0) {
    logInfo('[ContentBackfill] No content chunks found — nothing to backfill');
    return;
  }

  // ── Detect dimension mismatch on the first parseable embedding ──────────────
  let needsReEmbed = false;
  for (const chunk of chunks) {
    try {
      const emb = JSON.parse(chunk.embedding as string) as number[];
      if (Array.isArray(emb) && emb.length > 0) {
        if (emb.length !== expectedDim) {
          logWarning(
            `[ContentBackfill] Postgres embeddings are ${emb.length}-dim but current provider ` +
            `produces ${expectedDim}-dim. Re-embedding all ${chunks.length} chunks with new provider…`
          );
          needsReEmbed = true;
        }
        break; // only need to check one
      }
    } catch { /* skip */ }
  }

  if (needsReEmbed) {
    // Re-embed every chunk with the current provider, update Postgres, index in SQLite
    let reembedded = 0;
    let failed = 0;
    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk.text);
        // Persist new embedding back to Postgres so future restarts are fast
        await prisma.contentChunk.update({
          where: { id: chunk.id },
          data: { embedding: JSON.stringify(embedding) },
        });
        storeVector({
          id: chunk.id,
          creatorId: chunk.content.creatorId,
          contentId: chunk.contentId,
          chunkIndex: chunk.chunkIndex ?? undefined,
          text: chunk.text,
          embedding,
          metadata: {
            contentTitle: chunk.content.title,
            contentType: chunk.content.type,
          },
        });
        reembedded++;
        if (reembedded % 20 === 0) {
          logInfo(`[ContentBackfill] Re-embedded ${reembedded}/${chunks.length} chunks…`);
        }
        // Small delay to stay within Gemini free-tier rate limits (15 RPM)
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        failed++;
        logWarning(`[ContentBackfill] Failed to re-embed chunk ${chunk.id}: ${String(err)}`);
      }
    }
    logInfo(`[ContentBackfill] Re-embed complete — ${reembedded} succeeded, ${failed} failed.`);
    return;
  }

  // ── Normal path: restore missing vectors from existing Postgres embeddings ──
  const missing = chunks.filter(c => !vectorExists(c.id));
  if (missing.length === 0) {
    logInfo('[ContentBackfill] Vector store is up to date — no content chunks to backfill');
    return;
  }

  logInfo(`[ContentBackfill] Backfilling ${missing.length} chunk(s) into vector store…`);
  let reindexed = 0;
  for (const chunk of missing) {
    try {
      const embedding = JSON.parse(chunk.embedding as string) as number[];
      if (!Array.isArray(embedding) || embedding.length === 0) continue;
      storeVector({
        id: chunk.id,
        creatorId: chunk.content.creatorId,
        contentId: chunk.contentId,
        chunkIndex: chunk.chunkIndex ?? undefined,
        text: chunk.text,
        embedding,
        metadata: {
          contentTitle: chunk.content.title,
          contentType: chunk.content.type,
        },
      });
      reindexed++;
    } catch {
      // skip malformed embeddings
    }
  }
  logInfo(`[ContentBackfill] Complete — ${reindexed} chunk(s) re-indexed into vector store.`);
}
