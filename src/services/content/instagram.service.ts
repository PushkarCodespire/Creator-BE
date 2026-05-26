// ===========================================
// INSTAGRAM SERVICE
// OAuth flow + media fetching using
// Instagram API with Instagram Login (2024)
// ===========================================

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { logInfo, logError, logWarning } from '../../utils/logger';

const IG_AUTH_BASE = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_TOKEN_URL = 'https://graph.instagram.com/access_token';
const IG_GRAPH_BASE = 'https://graph.instagram.com/v21.0';

/** Scopes required for reading posts */
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'].join(',');

// ─── State token (short-lived JWT encoding userId) ───────────────────────────

const STATE_SECRET = config.jwt.secret + '_ig_state';
const STATE_TTL = 10 * 60; // 10 minutes

export function generateStateToken(userId: string): string {
  return jwt.sign({ userId, iat: Math.floor(Date.now() / 1000) }, STATE_SECRET, {
    expiresIn: STATE_TTL
  });
}

export function verifyStateToken(state: string): string {
  try {
    const payload = jwt.verify(state, STATE_SECRET) as { userId: string };
    return payload.userId;
  } catch {
    throw new Error('Invalid or expired OAuth state token');
  }
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

export function buildAuthUrl(userId: string): string {
  const state = generateStateToken(userId);
  const params = new URLSearchParams({
    client_id: config.instagram.clientId,
    redirect_uri: config.instagram.redirectUri,
    scope: SCOPES,
    response_type: 'code',
    state
  });
  return `${IG_AUTH_BASE}?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

interface ShortLivedToken {
  access_token: string;
  user_id: string; // Instagram user ID (numeric string)
}

interface LongLivedToken {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

/** Exchange authorization code for a short-lived token, then upgrade to long-lived */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  instagramUserId: string;
  expiresAt: Date;
}> {
  // 1. Short-lived token (POST to /oauth/access_token)
  const form = new URLSearchParams({
    client_id: config.instagram.clientId,
    client_secret: config.instagram.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.instagram.redirectUri,
    code
  });

  logInfo('[Instagram] Exchanging authorization code for short-lived token');
  const shortRes = await axios.post<ShortLivedToken>(IG_TOKEN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  const shortToken = shortRes.data.access_token;
  const instagramUserId = String(shortRes.data.user_id);

  // 2. Long-lived token (GET /access_token)
  logInfo('[Instagram] Upgrading to long-lived token');
  const longRes = await axios.get<LongLivedToken>(IG_LONG_TOKEN_URL, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: config.instagram.clientSecret,
      access_token: shortToken
    },
    timeout: 15000
  });

  const expiresAt = new Date(Date.now() + longRes.data.expires_in * 1000);

  return {
    accessToken: longRes.data.access_token,
    instagramUserId,
    expiresAt
  };
}

// ─── Media fetching ───────────────────────────────────────────────────────────

interface IgMediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  timestamp: string;
  permalink?: string;
}

interface IgMediaResponse {
  data: IgMediaItem[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Fetch recent media items (up to maxPosts) that have a caption.
 * Stops when it has collected enough or the API has no more pages.
 */
export async function fetchRecentPostCaptions(
  accessToken: string,
  maxPosts = 50
): Promise<Array<{ id: string; caption: string; timestamp: string; permalink?: string }>> {
  const results: Array<{ id: string; caption: string; timestamp: string; permalink?: string }> = [];
  let url: string | null =
    `${IG_GRAPH_BASE}/me/media?fields=id,caption,media_type,timestamp,permalink&limit=25&access_token=${accessToken}`;

  while (url && results.length < maxPosts) {
    logInfo(`[Instagram] Fetching media page (collected ${results.length} so far)`);
    const currentUrl: string = url;
    const res: { data: IgMediaResponse } = await axios.get<IgMediaResponse>(currentUrl, { timeout: 15000 });
    const items = res.data.data ?? [];

    for (const item of items) {
      if (item.caption && item.caption.trim()) {
        results.push({
          id: item.id,
          caption: item.caption.trim(),
          timestamp: item.timestamp,
          permalink: item.permalink
        });
      }
      if (results.length >= maxPosts) break;
    }

    url = res.data.paging?.next ?? null;
  }

  logInfo(`[Instagram] Fetched ${results.length} posts with captions`);
  return results;
}

// ─── Token refresh ────────────────────────────────────────────────────────────

interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Refresh a long-lived token before it expires (valid within 60 days of issue) */
export async function refreshLongLivedToken(accessToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  logInfo('[Instagram] Refreshing long-lived token');
  const res = await axios.get<RefreshResponse>(`${IG_GRAPH_BASE}/refresh_access_token`, {
    params: { grant_type: 'ig_refresh_token', access_token: accessToken },
    timeout: 15000
  });

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return { accessToken: res.data.access_token, expiresAt };
}

// ─── Validate token still works ───────────────────────────────────────────────

export async function validateToken(accessToken: string): Promise<boolean> {
  try {
    await axios.get(`${IG_GRAPH_BASE}/me`, {
      params: { fields: 'id', access_token: accessToken },
      timeout: 8000
    });
    return true;
  } catch (err) {
    logWarning('[Instagram] Token validation failed: ' + (err instanceof Error ? err.message : String(err)));
    return false;
  }
}
