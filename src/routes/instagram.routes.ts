// ===========================================
// INSTAGRAM OAUTH ROUTES
// GET /api/instagram/auth-url   → authenticated (creator only)
// GET /api/instagram/callback   → public (called by Instagram)
// GET /api/instagram/status     → authenticated (creator only)
// POST /api/instagram/sync      → authenticated, fetch latest posts
// DELETE /api/instagram/disconnect → authenticated (creator only)
// ===========================================

import { Router, Request, Response } from 'express';
import { authenticate, requireCreator } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  buildAuthUrl,
  verifyStateToken,
  exchangeCodeForTokens,
  fetchRecentPostCaptions,
  validateToken
} from '../services/content/instagram.service';
import { processContentJob } from '../services/queue/content-processor.worker';
import { contentQueue, isContentQueueEnabled } from '../services/queue/content-queue';
import prisma from '../../prisma/client';
import { config } from '../config';
import { logInfo, logError, logWarning } from '../utils/logger';

const router = Router();

// ─── GET /api/instagram/auth-url ─────────────────────────────────────────────
// Returns the Instagram OAuth authorization URL for this creator.
// Creator clicks it → redirected to Instagram → grants permissions →
// Instagram sends them back to the callback URL with ?code=...

router.get(
  '/auth-url',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.instagram.clientId) {
      throw new AppError('Instagram integration is not configured on this server', 503);
    }
    const userId = req.user!.id;
    const url = buildAuthUrl(userId);
    res.json({ success: true, data: { url } });
  })
);

// ─── GET /api/instagram/callback ─────────────────────────────────────────────
// PUBLIC — called by Instagram after the user grants permission.
// Exchanges the code for tokens, stores them, kicks off a post import,
// then redirects the creator back to the frontend.

router.get(
  '/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, error: igError, error_reason: igErrorReason } = req.query as Record<string, string>;

    const frontendBase = config.frontendUrl.replace(/\/+$/, '');

    // Instagram returned an error (e.g. user denied permission)
    if (igError) {
      logWarning(`[Instagram] OAuth denied: ${igError} — ${igErrorReason}`);
      return res.redirect(`${frontendBase}/creator/your-ai?ig_error=${encodeURIComponent(igError)}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendBase}/creator/your-ai?ig_error=missing_params`);
    }

    // Verify state → recover userId
    let userId: string;
    try {
      userId = verifyStateToken(state);
    } catch {
      return res.redirect(`${frontendBase}/creator/your-ai?ig_error=invalid_state`);
    }

    // Look up creator
    const creator = await prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      return res.redirect(`${frontendBase}/creator/your-ai?ig_error=creator_not_found`);
    }

    // Exchange code for tokens
    let tokens: { accessToken: string; instagramUserId: string; expiresAt: Date };
    try {
      tokens = await exchangeCodeForTokens(code);
    } catch (err) {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[Instagram] Token exchange failed' });
      return res.redirect(`${frontendBase}/creator/your-ai?ig_error=token_exchange_failed`);
    }

    // Store tokens on creator record
    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        instagramUserId: tokens.instagramUserId,
        instagramAccessToken: tokens.accessToken,
        instagramTokenExpiresAt: tokens.expiresAt
      }
    });

    logInfo(`[Instagram] Connected for creator ${creator.id} (IG user ${tokens.instagramUserId})`);

    // Kick off background post import
    setImmediate(() => importInstagramPosts(creator.id, userId, tokens.accessToken).catch(err => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[Instagram] Background import failed', creatorId: creator.id });
    }));

    return res.redirect(`${frontendBase}/creator/your-ai?ig_connected=1`);
  })
);

// ─── GET /api/instagram/status ────────────────────────────────────────────────
// Returns whether the creator's Instagram is connected and token validity.

router.get(
  '/status',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const creator = await prisma.creator.findUnique({
      where: { userId },
      select: { instagramUserId: true, instagramAccessToken: true, instagramTokenExpiresAt: true }
    });

    if (!creator || !creator.instagramUserId || !creator.instagramAccessToken) {
      return res.json({ success: true, data: { connected: false } });
    }

    // Check expiry
    const expired = creator.instagramTokenExpiresAt
      ? creator.instagramTokenExpiresAt < new Date()
      : false;

    return res.json({
      success: true,
      data: {
        connected: true,
        instagramUserId: creator.instagramUserId,
        expiresAt: creator.instagramTokenExpiresAt,
        expired
      }
    });
  })
);

// ─── POST /api/instagram/sync ─────────────────────────────────────────────────
// Manually re-trigger a post import for the connected account.

router.post(
  '/sync',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const creator = await prisma.creator.findUnique({
      where: { userId },
      select: { id: true, instagramAccessToken: true, instagramUserId: true }
    });

    if (!creator || !creator.instagramAccessToken) {
      throw new AppError('Instagram account not connected', 400);
    }

    const valid = await validateToken(creator.instagramAccessToken);
    if (!valid) {
      throw new AppError('Instagram token is no longer valid. Please reconnect your account.', 401);
    }

    // Fire off import in background
    setImmediate(() => importInstagramPosts(creator.id, userId, creator.instagramAccessToken!).catch(err => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[Instagram] Manual sync failed', creatorId: creator.id });
    }));

    res.json({ success: true, message: 'Instagram sync started. Posts will appear shortly.' });
  })
);

// ─── DELETE /api/instagram/disconnect ─────────────────────────────────────────
// Removes stored tokens (revocation happens on Meta's side when user removes app).

router.delete(
  '/disconnect',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const creator = await prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new AppError('Creator not found', 404);

    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        instagramUserId: null,
        instagramAccessToken: null,
        instagramTokenExpiresAt: null
      }
    });

    logInfo(`[Instagram] Disconnected for creator ${creator.id}`);
    res.json({ success: true, message: 'Instagram account disconnected.' });
  })
);

// ─── Helper: import posts as CreatorContent ────────────────────────────────────

async function importInstagramPosts(creatorId: string, userId: string, accessToken: string) {
  const posts = await fetchRecentPostCaptions(accessToken, 50);

  if (posts.length === 0) {
    logInfo(`[Instagram] No posts with captions found for creator ${creatorId}`);
    return;
  }

  logInfo(`[Instagram] Importing ${posts.length} posts for creator ${creatorId}`);

  // Fetch existing Instagram post source URLs so we don't duplicate
  const existing = await prisma.creatorContent.findMany({
    where: { creatorId, type: 'INSTAGRAM_POST' },
    select: { sourceUrl: true }
  });
  const existingUrls = new Set(existing.map(e => e.sourceUrl).filter(Boolean));

  let imported = 0;

  for (const post of posts) {
    const sourceUrl = post.permalink || `https://www.instagram.com/p/${post.id}/`;

    // Skip if already imported
    if (existingUrls.has(sourceUrl)) continue;

    // Create the content record
    const content = await prisma.creatorContent.create({
      data: {
        creatorId,
        title: `Instagram Post — ${new Date(post.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        type: 'INSTAGRAM_POST',
        sourceUrl,
        status: 'PROCESSING',
        rawText: post.caption
      }
    });

    // Queue / background-process for embedding.
    // The processor reads rawText from the DB record — we only need routing fields here.
    const jobData = { contentId: content.id, creatorId, userId, type: 'INSTAGRAM_POST' as const };

    if (isContentQueueEnabled && contentQueue) {
      await contentQueue.add('process-content', jobData);
    } else {
      setImmediate(async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await processContentJob({ data: jobData, progress: () => {} } as any);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await prisma.creatorContent.update({
            where: { id: content.id },
            data: { status: 'FAILED', errorMessage: msg }
          }).catch(() => {});
        }
      });
    }

    imported++;
  }

  logInfo(`[Instagram] Queued ${imported} new posts for creator ${creatorId}`);
}

export default router;
