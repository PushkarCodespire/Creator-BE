// ===========================================
// YOUTUBE SERVICE (Enhanced with Caching)
// ===========================================
// Enhanced YouTube transcript fetching with Redis caching
// Based on Phase 3 of the implementation plan

import axios from 'axios';
import { fetchYouTubeTranscript, cleanTranscript, extractVideoId } from '../../utils/youtube';
import { getRedisClient, isRedisConnected } from '../../utils/redis';
import { AppError } from '../../utils/errors';
import { logDebug, logWarning, logInfo, logError } from '../../utils/logger';

const CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

/**
 * Call the Cloudflare Worker proxy to fetch a transcript.
 * Returns null if the worker is not configured or the request fails.
 */
async function fetchViaWorker(videoId: string): Promise<{
  videoId: string;
  transcript: string;
  segments: { text: string; offset: number; duration: number }[];
} | null> {
  const workerUrl = process.env.YOUTUBE_TRANSCRIPT_WORKER_URL?.trim().replace(/\/$/, '');
  const workerToken = process.env.YOUTUBE_TRANSCRIPT_WORKER_TOKEN?.trim();
  if (!workerUrl) return null;

  const headers: Record<string, string> = {};
  if (workerToken) headers['Authorization'] = `Bearer ${workerToken}`;

  const url = `${workerUrl}/transcript?videoId=${videoId}`;
  logInfo(`[YouTubeService] Calling worker: ${url}`);
  try {
    const resp = await axios.get(url, { headers, timeout: 20000 });
    const data = resp.data as { transcript?: string; segments?: { text: string; offset: number; duration: number }[]; videoId?: string };
    if (!data?.transcript) {
      logWarning(`[YouTubeService] Worker response missing transcript field: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }
    logInfo(`[YouTubeService] Worker returned transcript (${data.transcript.length} chars)`);
    return { videoId: data.videoId || videoId, transcript: data.transcript, segments: data.segments || [] };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logWarning(`[YouTubeService] Worker returned ${err.response?.status ?? 'no response'}: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 200)}`);
    } else {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[YouTubeService] Worker fetch failed' });
    }
    return null;
  }
}

/**
 * Fetch YouTube transcript with Redis caching.
 * Primary path: Cloudflare Worker (avoids GCP→YouTube IP block).
 * Fallback: direct YouTube fetch (may be blocked on GKE).
 */
export async function fetchCachedTranscript(url: string): Promise<{
  videoId: string;
  transcript: string;
  segments: { text: string; offset: number; duration: number }[];
  cached: boolean;
}> {
  const videoId = extractVideoId(url);

  if (!videoId) {
    throw new AppError('Invalid YouTube URL', 400);
  }

  const redis = getRedisClient();
  const cacheKey = `transcript:${videoId}`;

  // Try Redis cache first
  if (redis && isRedisConnected()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && typeof cached === 'string') {
        logDebug(`[YouTubeService] Cache hit for video: ${videoId}`);
        return { ...JSON.parse(cached), cached: true };
      }
    } catch (error) {
      logWarning(`[YouTubeService] Cache read error: ${error}`);
    }
  }

  // Try Cloudflare Worker (primary — avoids GCP IP block)
  logInfo(`[YouTubeService] Fetching transcript via worker for video: ${videoId}`);
  let rawTranscript: string;
  let rawSegments: { text: string; offset: number; duration: number }[];

  const workerResult = await fetchViaWorker(videoId);
  if (workerResult) {
    rawTranscript = workerResult.transcript;
    rawSegments = workerResult.segments;
  } else {
    // Fallback: direct YouTube fetch (blocked on GKE but kept for dev/non-GKE environments)
    logWarning(`[YouTubeService] Worker unavailable, falling back to direct fetch for video: ${videoId}`);
    const transcriptData = await fetchYouTubeTranscript(url);
    rawTranscript = transcriptData.transcript;
    rawSegments = transcriptData.segments || [];
  }

  const cleanedTranscript = cleanTranscript(rawTranscript);
  if (!cleanedTranscript) {
    throw new AppError('Transcript is empty or unavailable for this video', 400);
  }

  const result = { videoId, transcript: cleanedTranscript, segments: rawSegments, cached: false };

  // Store in Redis
  if (redis && isRedisConnected()) {
    try {
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(result));
      logDebug(`[YouTubeService] Cached transcript for video: ${videoId}`);
    } catch (error) {
      logWarning(`[YouTubeService] Cache write error: ${error}`);
    }
  }

  return result;
}

/**
 * Invalidate transcript cache
 */
export async function invalidateTranscriptCache(videoId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return;

  const cacheKey = `transcript:${videoId}`;
  await redis.del(cacheKey);
  logInfo(`[YouTubeService] Invalidated cache for video: ${videoId}`);
}
