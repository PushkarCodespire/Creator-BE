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

/**
 * instagram_business_basic is the only scope needed to read post captions and media.
 * The other instagram_business_* scopes (manage_messages, manage_comments,
 * content_publish, manage_insights) require Meta App Review (Advanced Access).
 * Requesting unapproved advanced scopes in a Live app causes the token to be
 * issued in a broken state where all graph.instagram.com calls return
 * "Unsupported request - method type: get" — even for /me.
 * Until those scopes are approved through App Review, request only the base scope.
 */
const SCOPES = 'instagram_business_basic';

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
    // enable_fb_login=0 forces Instagram credentials (not Facebook login).
    // Without this, Meta lets users authenticate via Facebook session, which
    // produces a Facebook-session-backed IGAAR token that graph.instagram.com
    // rejects for all data calls ("Unsupported request - method type: get").
    // Meta's own "API setup with Instagram login" embed URL always includes this.
    enable_fb_login: '0',
    force_authentication: '1',
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

  logInfo(`[Instagram] Exchanging code — client_id=${config.instagram.clientId} redirect_uri=${config.instagram.redirectUri}`);
  let shortRes;
  try {
    shortRes = await axios.post<ShortLivedToken>(IG_TOKEN_URL, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: unknown; status?: number } };
    logError(new Error(`[Instagram] Token exchange HTTP error: status=${axiosErr?.response?.status} body=${JSON.stringify(axiosErr?.response?.data)}`), { context: '[Instagram] short-lived token' });
    throw err;
  }

  const shortToken = shortRes.data.access_token;
  const instagramUserId = String(shortRes.data.user_id);
  logInfo(`[Instagram] Short-lived token obtained for IG user ${instagramUserId} (prefix: ${shortToken.slice(0, 8)}...)`);

  // 2. Exchange short-lived (1h) for long-lived token (60 days).
  // Required: graph.instagram.com data endpoints reject short-lived tokens.
  let accessToken = shortToken;
  let expiresAt = new Date(Date.now() + 60 * 60 * 1000); // fallback: 1 hour

  // Try POST first (Instagram Business Login API may require POST, not GET).
  // The GET form is documented but returns "Unsupported request - method type: get"
  // for IGAAR-type tokens, so we try both.
  const exchangeParams = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_id: config.instagram.clientId,
    client_secret: config.instagram.clientSecret,
    access_token: shortToken
  });

  let exchangeSucceeded = false;

  // Attempt 1: POST (form-encoded)
  try {
    const longRes = await axios.post<LongLivedToken>(IG_LONG_TOKEN_URL, exchangeParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
    accessToken = longRes.data.access_token;
    expiresAt = new Date(Date.now() + longRes.data.expires_in * 1000);
    logInfo(`[Instagram] Long-lived token obtained via POST — expires in ${Math.round(longRes.data.expires_in / 86400)}d (prefix: ${accessToken.slice(0, 8)}...)`);
    exchangeSucceeded = true;
  } catch (postErr: unknown) {
    const ae = postErr as { response?: { data?: unknown; status?: number } };
    logWarning(`[Instagram] POST exchange failed: status=${ae?.response?.status} body=${JSON.stringify(ae?.response?.data)} — trying GET`);
  }

  // Attempt 2: GET (documented form)
  if (!exchangeSucceeded) {
    try {
      const longRes = await axios.get<LongLivedToken>(IG_LONG_TOKEN_URL, {
        params: {
          grant_type: 'ig_exchange_token',
          client_id: config.instagram.clientId,
          client_secret: config.instagram.clientSecret,
          access_token: shortToken
        },
        timeout: 15000
      });
      accessToken = longRes.data.access_token;
      expiresAt = new Date(Date.now() + longRes.data.expires_in * 1000);
      logInfo(`[Instagram] Long-lived token obtained via GET — expires in ${Math.round(longRes.data.expires_in / 86400)}d (prefix: ${accessToken.slice(0, 8)}...)`);
      exchangeSucceeded = true;
    } catch (getErr: unknown) {
      const ae = getErr as { response?: { data?: unknown; status?: number } };
      logWarning(`[Instagram] GET exchange failed: status=${ae?.response?.status} body=${JSON.stringify(ae?.response?.data)} — trying Facebook exchange`);
    }
  }

  // Attempt 3: Facebook Graph API exchange using parent Facebook App credentials.
  // Apps configured with "Facebook Login for Business" + Instagram permissions may issue
  // IGAAR tokens whose long-lived exchange endpoint is graph.facebook.com, not
  // graph.instagram.com.  Uses fb_exchange_token grant with the Facebook App ID/secret.
  if (!exchangeSucceeded && config.instagram.facebookAppId && config.instagram.facebookAppSecret) {
    try {
      const longRes = await axios.get<LongLivedToken>('https://graph.facebook.com/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: config.instagram.facebookAppId,
          client_secret: config.instagram.facebookAppSecret,
          access_token: shortToken
        },
        timeout: 15000
      });
      accessToken = longRes.data.access_token;
      expiresAt = new Date(Date.now() + longRes.data.expires_in * 1000);
      logInfo(`[Instagram] Long-lived token obtained via Facebook exchange — expires in ${Math.round(longRes.data.expires_in / 86400)}d (prefix: ${accessToken.slice(0, 8)}...)`);
      exchangeSucceeded = true;
    } catch (fbErr: unknown) {
      const ae = fbErr as { response?: { data?: unknown; status?: number } };
      logError(
        new Error(`[Instagram] Long-lived token exchange failed (POST, GET, and Facebook): status=${ae?.response?.status} body=${JSON.stringify(ae?.response?.data)}`),
        { context: '[Instagram] long-lived token exchange' }
      );
      logWarning('[Instagram] Falling back to short-lived token (1h) — reconnect required within the hour, and account must be Instagram Business/Creator type');
    }
  } else if (!exchangeSucceeded) {
    logError(
      new Error('[Instagram] Long-lived token exchange failed (POST and GET) and Facebook App credentials are not configured'),
      { context: '[Instagram] long-lived token exchange' }
    );
    logWarning('[Instagram] Falling back to short-lived token — data API calls will likely fail');
  }

  return { accessToken, instagramUserId, expiresAt };
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
 *
 * Tries graph.instagram.com first (correct for Instagram Business Login tokens).
 * Falls back to graph.facebook.com if the Instagram endpoint rejects the request —
 * this covers apps configured with Facebook Login for Business + Instagram permissions,
 * where the token may only be accepted on the Facebook Graph API.
 *
 * The Instagram user ID is used in the path (/{id}/media) rather than /me/media
 * because Business Login tokens do not resolve /me on graph.instagram.com.
 */
export async function fetchRecentPostCaptions(
  accessToken: string,
  instagramUserId: string,
  maxPosts = 50
): Promise<Array<{ id: string; caption: string; timestamp: string; permalink?: string }>> {

  // Determine which base URL to use: try IG first, fall back to FB.
  const candidates = [
    `${IG_GRAPH_BASE}/${instagramUserId}/media`,
    `https://graph.facebook.com/v21.0/${instagramUserId}/media`,
  ];

  const results: Array<{ id: string; caption: string; timestamp: string; permalink?: string }> = [];
  let lastError: unknown = null;

  for (const baseMediaUrl of candidates) {
    const domain = baseMediaUrl.includes('graph.facebook.com') ? 'facebook' : 'instagram';
    logInfo(`[Instagram] Starting media fetch via ${domain} — igUserId=${instagramUserId}`);

    let url: string | null =
      `${baseMediaUrl}?fields=id,caption,media_type,timestamp,permalink&limit=25&access_token=${accessToken}`;

    let pagesFetched = 0;
    let domainFailed = false;

    while (url && results.length < maxPosts) {
      logInfo(`[Instagram] Fetching media page via ${domain} (collected ${results.length} so far)`);
      const currentUrl: string = url;
      let res: { data: IgMediaResponse };
      try {
        res = await axios.get<IgMediaResponse>(currentUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000
        });
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: unknown; status?: number } };
        logError(new Error(`[Instagram] Media fetch error via ${domain}: status=${axiosErr?.response?.status} body=${JSON.stringify(axiosErr?.response?.data)}`), { context: `[Instagram] media fetch (${domain})` });
        lastError = err;
        domainFailed = true;
        break;
      }

      pagesFetched++;
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

    if (!domainFailed) {
      logInfo(`[Instagram] Fetched ${results.length} posts with captions via ${domain}`);
      return results; // Success — stop trying other domains
    }

    // First domain failed — try next candidate (results are still empty, reset for next attempt)
    logWarning(`[Instagram] ${domain} domain failed after ${pagesFetched} page(s) — ${candidates.indexOf(baseMediaUrl) < candidates.length - 1 ? 'trying fallback domain' : 'no more fallbacks'}`);
  }

  // Both domains failed
  if (lastError) throw lastError;
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
    // Business Login tokens require Authorization: Bearer instead of /me/
    // Use /me with Bearer auth; if the token is invalid the API returns 401/400.
    await axios.get(`${IG_GRAPH_BASE}/me`, {
      params: { fields: 'id', access_token: accessToken },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 8000
    });
    return true;
  } catch (err) {
    logWarning('[Instagram] Token validation failed: ' + (err instanceof Error ? err.message : String(err)));
    return false;
  }
}
