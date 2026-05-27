// ===========================================
// INSTAGRAM ROUTES
// GET  /api/instagram/auth-url       → authenticated (creator only)
// GET  /api/instagram/callback       → public (called by Instagram)
// GET  /api/instagram/status         → authenticated (creator only)
// POST /api/instagram/sync           → authenticated, re-fetch latest posts
// POST /api/instagram/upload-export  → authenticated, parse IG data export ZIP
// DELETE /api/instagram/disconnect   → authenticated (creator only)
// ===========================================

import { Router, Request, Response } from 'express';
import axios from 'axios';
import multer from 'multer';
import AdmZip from 'adm-zip';
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

// Multer: accept only ZIP files in memory (max 100 MB)
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are accepted'));
    }
  }
});

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
    setImmediate(() => importInstagramPosts(creator.id, userId, tokens.accessToken, tokens.instagramUserId).catch(err => {
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

// ─── GET /api/instagram/debug ─────────────────────────────────────────────────
// Temporary diagnostic endpoint — tests what the stored token can actually access.
// Helps distinguish scope issues from endpoint issues.
// Only available in non-production environments.

router.get(
  '/debug',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    if (config.nodeEnv === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }

    const creator = await prisma.creator.findUnique({
      where: { userId: req.user!.id },
      select: { instagramAccessToken: true, instagramUserId: true }
    });

    if (!creator?.instagramAccessToken) {
      return res.json({ error: 'Instagram not connected' });
    }

    const token = creator.instagramAccessToken;
    const igUserId = creator.instagramUserId;
    const IG_BASE = 'https://graph.instagram.com/v21.0';

    const tryGet = async (label: string, url: string, extraHeaders?: Record<string, string>) => {
      try {
        const r = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
          timeout: 10000
        });
        return { label, status: r.status, data: r.data };
      } catch (e: unknown) {
        const ae = e as { response?: { status?: number; data?: unknown } };
        return { label, status: ae.response?.status, error: ae.response?.data };
      }
    };

    const IG_BASE_PLAIN = 'https://graph.instagram.com';
    const FB_BASE = 'https://graph.facebook.com/v21.0';

    // Decode what type of token this is from the prefix
    const prefix = token.slice(0, 8);
    const tokenType = prefix.startsWith('IGAAR') ? 'Instagram Business Login (IGAAR)'
      : prefix.startsWith('IGQV') ? 'Instagram Basic Display API (IGQV — DEPRECATED)'
      : prefix.startsWith('EAA') ? 'Facebook Extended Access Token (EAA)'
      : `Unknown (prefix: ${prefix})`;

    // ── graph.instagram.com paths ─────────────────────────────────────────────
    const igResults = await Promise.all([
      tryGet('ig /me (query param + bearer)', `${IG_BASE}/me?fields=id,username,name,account_type,media_count&access_token=${token}`),
      tryGet(`ig /${igUserId} (query param + bearer)`, `${IG_BASE}/${igUserId}?fields=id,username,account_type&access_token=${token}`),
      tryGet(`ig /${igUserId}/media (query param + bearer)`, `${IG_BASE}/${igUserId}/media?fields=id&limit=1&access_token=${token}`),
      tryGet('ig /me (bearer only)', `${IG_BASE_PLAIN}/v21.0/me?fields=id,username,account_type`),
      tryGet(`ig /${igUserId}/media (bearer only)`, `${IG_BASE_PLAIN}/v21.0/${igUserId}/media?fields=id&limit=1`),
    ]);

    // ── graph.facebook.com — get the FB user ID first (may differ from IG user ID) ──
    const fbMeResult = await tryGet('fb /me', `${FB_BASE}/me?fields=id,name&access_token=${token}`);
    const fbUserId = (fbMeResult.data as { id?: string } | undefined)?.id ?? null;

    const fbResults = await Promise.all([
      Promise.resolve(fbMeResult),
      tryGet('fb /me instagram_business_account', `${FB_BASE}/me?fields=instagram_business_account{id,username,name,account_type}&access_token=${token}`),
      // Test with the IG user ID (numeric) in case it's the correct FB entity
      tryGet(`fb /${igUserId}/media`, `${FB_BASE}/${igUserId}/media?fields=id,caption&limit=1&access_token=${token}`),
      // Test with the Facebook user ID (may be different from IG user ID)
      ...(fbUserId && fbUserId !== igUserId
        ? [tryGet(`fb /${fbUserId} (fb user id)`, `${FB_BASE}/${fbUserId}?fields=id,name&access_token=${token}`)]
        : []
      ),
    ]);

    return res.json({
      instagramUserId: igUserId,
      facebookUserId: fbUserId,
      tokenPrefix: token.slice(0, 12) + '...',
      tokenType,
      note: 'If all ig/* fail but fb/* succeed → update IG_GRAPH_BASE to graph.facebook.com. If ALL fail → Instagram account must be Business/Creator type (not Personal).',
      igResults,
      fbResults,
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
    setImmediate(() => importInstagramPosts(creator.id, userId, creator.instagramAccessToken!, creator.instagramUserId!).catch(err => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: '[Instagram] Manual sync failed', creatorId: creator.id });
    }));

    res.json({ success: true, message: 'Instagram sync started. Posts will appear shortly.' });
  })
);

// ─── DELETE /api/instagram/content ───────────────────────────────────────────
// Removes ALL INSTAGRAM_POST content records for this creator.
// Used when the creator wants to clear exported/imported data and start fresh.

router.delete(
  '/content',
  authenticate,
  requireCreator,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const creator = await prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new AppError('Creator not found', 404);

    const { count } = await prisma.creatorContent.deleteMany({
      where: { creatorId: creator.id, type: 'INSTAGRAM_POST' }
    });

    logInfo(`[Instagram] Cleared ${count} content items for creator ${creator.id}`);
    res.json({
      success: true,
      message: `Removed ${count} Instagram content item${count !== 1 ? 's' : ''}.`,
      count
    });
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

// ─── POST /api/instagram/upload-export ────────────────────────────────────────
// Accepts an Instagram data export ZIP, extracts post captions and bio,
// and imports them into the creator's knowledge base as INSTAGRAM_POST entries.

router.post(
  '/upload-export',
  authenticate,
  requireCreator,
  zipUpload.single('export'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('No ZIP file uploaded', 400);
    }

    const userId = req.user!.id;
    const creator = await prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new AppError('Creator not found', 404);

    // Parse the ZIP in memory
    let zip: AdmZip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      throw new AppError('Invalid ZIP file — please upload your Instagram data export', 400);
    }

    const { items, username } = parseInstagramExportZip(zip);

    if (items.length === 0) {
      return res.json({
        success: true,
        message: 'No content found in this export. Make sure you selected "Posts", "Comments", and "Profile information" when requesting your data, and chose "All time" as the date range.',
        imported: 0,
        breakdown: { post: 0, reel: 0, igtv: 0, reply: 0, bio: 0 }
      });
    }

    // Deduplicate against already-imported content by raw text (not title —
    // multiple posts on the same day share a title, so title-based dedup
    // would both miss same-day posts and fail to block re-uploads correctly).
    const existing = await prisma.creatorContent.findMany({
      where: { creatorId: creator.id, type: 'INSTAGRAM_POST' },
      select: { rawText: true }
    });
    const existingTexts = new Set(existing.map(e => e.rawText).filter(Boolean) as string[]);

    const breakdown: Record<InstagramContentKind, number> = { post: 0, reel: 0, igtv: 0, reply: 0, bio: 0 };
    let imported = 0;

    for (const item of items) {
      const title = buildInstagramTitle(item);
      if (existingTexts.has(item.text)) continue;

      const content = await prisma.creatorContent.create({
        data: {
          creatorId: creator.id,
          title,
          type: 'INSTAGRAM_POST',
          sourceUrl: item.permalink || null,
          status: 'PROCESSING',
          rawText: item.text
        }
      });

      const jobData = { contentId: content.id, creatorId: creator.id, userId, type: 'INSTAGRAM_POST' as const };

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

      breakdown[item.kind]++;
      imported++;
    }

    // Human-readable breakdown for the response message
    const parts: string[] = [];
    if (breakdown.post  > 0) parts.push(`${breakdown.post} post${breakdown.post !== 1 ? 's' : ''}`);
    if (breakdown.reel  > 0) parts.push(`${breakdown.reel} reel${breakdown.reel !== 1 ? 's' : ''}`);
    if (breakdown.igtv  > 0) parts.push(`${breakdown.igtv} IGTV`);
    if (breakdown.reply > 0) parts.push(`${breakdown.reply} repl${breakdown.reply !== 1 ? 'ies' : 'y'}`);
    if (breakdown.bio   > 0) parts.push('bio');

    logInfo(`[Instagram Export] Imported ${imported} items for creator ${creator.id} — ${parts.join(', ') || 'none new'}`);
    res.json({
      success: true,
      message: imported > 0
        ? `Imported ${parts.join(', ')} — queued for AI training.`
        : 'No new content to import — everything already exists in your knowledge base.',
      imported,
      found: items.length,
      breakdown,
      username
    });
  })
);

// ─── Types: parsed Instagram export ──────────────────────────────────────────

type InstagramContentKind = 'post' | 'reel' | 'igtv' | 'reply' | 'bio';

interface ParsedInstagramItem {
  kind: InstagramContentKind;
  text: string;
  timestamp: number;    // Unix seconds; 0 for bio (no date)
  permalink?: string;
  videoTitle?: string;  // IGTV: used in content title
}

interface InstagramExportParsed {
  items: ParsedInstagramItem[];
  username: string | null;
}

// ─── Helper: build a human-readable content title ─────────────────────────────

function buildInstagramTitle(item: ParsedInstagramItem): string {
  const date = item.timestamp
    ? new Date(item.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Unknown Date';

  switch (item.kind) {
    case 'post':  return `Instagram Post — ${date}`;
    case 'reel':  return `Instagram Reel — ${date}`;
    case 'igtv':  return item.videoTitle ? `Instagram IGTV — ${item.videoTitle}` : `Instagram IGTV — ${date}`;
    case 'reply': return `Instagram Reply — ${date}`;
    case 'bio':   return 'Instagram Bio';
  }
}

// ─── Helper: extract Caption / URL / Title from label_values array ────────────
// Used by posts (new format), reels, and IGTV descriptions.

function extractLabelValues(labelValues: Record<string, unknown>[]): {
  caption?: string;
  permalink?: string;
  title?: string;
} {
  const find = (label: string): string | undefined =>
    (labelValues.find(lv => (lv?.label as string) === label)?.value as string | undefined)?.trim() || undefined;

  return { caption: find('Caption'), permalink: find('URL'), title: find('Title') };
}

// ─── Helper: safe JSON parse from ZIP entry ───────────────────────────────────

function parseZipEntry(entry: AdmZip.IZipEntry): unknown | null {
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch {
    logWarning(`[Instagram Export] Could not parse ${entry.entryName} — skipping`);
    return null;
  }
}

/**
 * Extracts all trainable text from an Instagram data export ZIP.
 *
 * Handles the following content kinds:
 *   post   — Feed post captions (old + new Accounts Center format)
 *   reel   — Reel captions
 *   igtv   — IGTV video descriptions (not subtitles)
 *   reply  — Creator's own replies on their posts (from post_comments)
 *   bio    — Creator's profile bio
 *
 * Export format variants:
 *   Old (pre-2024):    your_instagram_activity/posts/posts_N.json
 *                      caption in media[n].title
 *   New (2024+):       your_instagram_activity/media/posts(_N)?.json
 *                      caption in label_values[n].value where label === "Caption"
 *
 * Reels, IGTV, comments follow the same new-format shape.
 * Personal info provides the username used to filter own-post replies.
 */
function parseInstagramExportZip(zip: AdmZip): InstagramExportParsed {
  const items: ParsedInstagramItem[] = [];
  const seen = new Set<string>();
  let username: string | null = null;

  const add = (item: ParsedInstagramItem): void => {
    if (!item.text) return;
    const key = `${item.kind}:${item.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const entries = zip.getEntries();

  // ── Pass 1: personal info → username + bio ────────────────────────────────
  for (const entry of entries) {
    if (!/personal_information\/personal_information\.json$/i.test(entry.entryName)) continue;

    const data = parseZipEntry(entry) as Record<string, unknown> | null;
    if (!data) break;

    const profileUsers = (data?.profile_user as Record<string, unknown>[]) ?? [];
    for (const profile of profileUsers) {
      const sm = (profile?.string_map_data as Record<string, Record<string, unknown>>) ?? {};
      const uname = (sm?.Username?.value as string | undefined)?.trim();
      if (uname) username = uname;
      const bio = (sm?.Bio?.value as string | undefined)?.trim();
      if (bio) add({ kind: 'bio', text: bio, timestamp: 0 });
    }
    break; // only one personal info file
  }

  // ── Pass 2: posts, reels, IGTV, comments ─────────────────────────────────
  for (const entry of entries) {
    const n = entry.entryName;

    // ── Feed posts — old format ─────────────────────────────────────────────
    if (/your_instagram_activity\/posts\/posts_\d+\.json$/i.test(n)) {
      const data = parseZipEntry(entry);
      if (!Array.isArray(data)) continue;

      for (const post of data as Record<string, unknown>[]) {
        const ts: number = (post?.timestamp as number) ?? 0;

        // Old format: caption in media[n].title
        for (const item of (post?.media as Record<string, unknown>[]) ?? []) {
          const caption = (item?.title as string | undefined)?.trim();
          if (caption) add({ kind: 'post', text: caption, timestamp: (item?.creation_timestamp as number) ?? ts });
        }

        // New format embedded in old-path file: label_values
        const lvs = (post?.label_values as Record<string, unknown>[]) ?? [];
        if (lvs.length > 0) {
          const { caption, permalink } = extractLabelValues(lvs);
          if (caption) add({ kind: 'post', text: caption, timestamp: ts, permalink });

          // Some exports nest label_values inside label_values
          for (const lv of lvs) {
            const nested = (lv?.label_values as Record<string, unknown>[]) ?? [];
            if (nested.length > 0) {
              const { caption: nc } = extractLabelValues(nested);
              if (nc) add({ kind: 'post', text: nc, timestamp: ts });
            }
          }
        }
      }
      continue;
    }

    // ── Feed posts — new Accounts Center format ─────────────────────────────
    if (/your_instagram_activity\/media\/posts(_\d+)?\.json$/i.test(n)) {
      const data = parseZipEntry(entry);
      if (!Array.isArray(data)) continue;

      for (const post of data as Record<string, unknown>[]) {
        const ts: number = (post?.timestamp as number) ?? 0;
        const lvs = (post?.label_values as Record<string, unknown>[]) ?? [];

        if (lvs.length > 0) {
          const { caption, permalink } = extractLabelValues(lvs);
          if (caption) add({ kind: 'post', text: caption, timestamp: ts, permalink });

          for (const lv of lvs) {
            const nested = (lv?.label_values as Record<string, unknown>[]) ?? [];
            if (nested.length > 0) {
              const { caption: nc } = extractLabelValues(nested);
              if (nc) add({ kind: 'post', text: nc, timestamp: ts });
            }
          }
        }

        // Fallback: media[n].title (in case new-path file uses old shape)
        for (const item of (post?.media as Record<string, unknown>[]) ?? []) {
          const caption = (item?.title as string | undefined)?.trim();
          if (caption) add({ kind: 'post', text: caption, timestamp: (item?.creation_timestamp as number) ?? ts });
        }
      }
      continue;
    }

    // ── Reels ───────────────────────────────────────────────────────────────
    if (/your_instagram_activity\/media\/reels(_\d+)?\.json$/i.test(n)) {
      const data = parseZipEntry(entry);
      if (!Array.isArray(data)) continue;

      for (const reel of data as Record<string, unknown>[]) {
        const ts: number = (reel?.timestamp as number) ?? 0;

        const lvs = (reel?.label_values as Record<string, unknown>[]) ?? [];
        if (lvs.length > 0) {
          const { caption, permalink } = extractLabelValues(lvs);
          if (caption) add({ kind: 'reel', text: caption, timestamp: ts, permalink });
        }

        // Old format fallback
        for (const item of (reel?.media as Record<string, unknown>[]) ?? []) {
          const caption = (item?.title as string | undefined)?.trim();
          if (caption) add({ kind: 'reel', text: caption, timestamp: (item?.creation_timestamp as number) ?? ts });
        }
      }
      continue;
    }

    // ── IGTV descriptions ───────────────────────────────────────────────────
    // We extract the video description (Caption), NOT the subtitle/SRT content.
    // Subtitle SRT files are intentionally skipped as they often contain song lyrics.
    if (/your_instagram_activity\/media\/igtv_videos(_\d+)?\.json$/i.test(n)) {
      const raw = parseZipEntry(entry);
      // Some exports wrap the list in { ig_igtv_media: [...] }
      const data: unknown = Array.isArray(raw)
        ? raw
        : (raw as Record<string, unknown>)?.ig_igtv_media ?? null;
      if (!Array.isArray(data)) continue;

      for (const video of data as Record<string, unknown>[]) {
        const ts: number = (video?.timestamp as number) ?? 0;

        // New format: description in label_values Caption
        const lvs = (video?.label_values as Record<string, unknown>[]) ?? [];
        if (lvs.length > 0) {
          const { caption, permalink, title: videoTitle } = extractLabelValues(lvs);
          if (caption) add({ kind: 'igtv', text: caption, timestamp: ts, permalink, videoTitle });
        }
        // Old format: media[n].title is the video title only (no description field) — skip
      }
      continue;
    }

    // ── Comments / own-post replies ─────────────────────────────────────────
    // Filters to entries where Media Owner = creator's username (own-post replies).
    // If username could not be determined, imports all comments.
    if (/your_instagram_activity\/comments\/post_comments_\d+\.json$/i.test(n)) {
      const data = parseZipEntry(entry);
      if (!Array.isArray(data)) continue;

      for (const comment of data as Record<string, unknown>[]) {
        const sm = (comment?.string_map_data as Record<string, Record<string, unknown>>) ?? {};
        const text = (sm?.Comment?.value as string | undefined)?.trim();
        const ts: number = (sm?.Comment?.timestamp as number) ?? 0;
        const mediaOwner = (sm?.['Media Owner']?.value as string | undefined)?.trim();

        if (!text) continue;

        // post_comments_1.json contains comments the CREATOR wrote (their own words),
        // regardless of whose post they appear on. Import all of them.
        // If username is known, we additionally flag own-post replies — but either
        // way the text represents the creator's voice so we always import it.
        add({ kind: 'reply', text, timestamp: ts });
      }
      continue;
    }
  }

  const counts = {
    post:  items.filter(i => i.kind === 'post').length,
    reel:  items.filter(i => i.kind === 'reel').length,
    igtv:  items.filter(i => i.kind === 'igtv').length,
    reply: items.filter(i => i.kind === 'reply').length,
    bio:   items.filter(i => i.kind === 'bio').length,
  };
  logInfo(`[Instagram Export] Parsed — posts:${counts.post} reels:${counts.reel} igtv:${counts.igtv} replies:${counts.reply} bio:${counts.bio} username:${username ?? 'unknown'}`);

  return { items, username };
}

// ─── Helper: import posts as CreatorContent ────────────────────────────────────

async function importInstagramPosts(creatorId: string, userId: string, accessToken: string, instagramUserId: string) {
  const posts = await fetchRecentPostCaptions(accessToken, instagramUserId, 50);

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
