// ===========================================
// YOUTUBE API INTEGRATION
// ===========================================
// Fetches transcripts, video info, and metadata from YouTube

import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// youtube-transcript v1.3 is ESM-only; use dynamic import for CJS compat
let fetchTranscriptV2: typeof import('youtube-transcript').fetchTranscript | undefined;
import('youtube-transcript')
  .then(mod => { fetchTranscriptV2 = mod.fetchTranscript; })
  .catch(() => { /* optional — other methods still work */ });
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ytdl from '@distube/ytdl-core';
import { openai, isOpenAIConfigured } from './openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logInfo, logWarning, logError, logDebug } from './logger';

// Default cookie to bypass YouTube consent/age walls (helps in EU regions / some cloud DCs)
const DEFAULT_CONSENT_COOKIE = 'CONSENT=YES+1';

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: string;
  viewCount: number;
  likeCount: number;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  tags: string[];
  category: string;
}

// ===========================================
// YOUTUBE NETWORK CONFIG
// ===========================================

type YtdlCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
};

const YOUTUBE_COOKIE_ENV = (process.env.YOUTUBE_COOKIE || '').trim();
const YOUTUBE_COOKIES_ENV = (process.env.YOUTUBE_COOKIES || '').trim();
const YOUTUBE_COOKIES_PATH = (process.env.YOUTUBE_COOKIES_PATH || '').trim();
const YOUTUBE_PROXY = (process.env.YOUTUBE_PROXY || '').trim();
const YOUTUBE_PLAYER_CLIENTS = (process.env.YOUTUBE_PLAYER_CLIENTS || '').trim();
const YOUTUBE_TRANSCRIPT_WORKER_URL = (process.env.YOUTUBE_TRANSCRIPT_WORKER_URL || '').trim();
const YOUTUBE_TRANSCRIPT_WORKER_TOKEN = (process.env.YOUTUBE_TRANSCRIPT_WORKER_TOKEN || '').trim();

// Log YouTube configuration status on startup
function logYouTubeConfigStatus() {
  const hasProxy = !!YOUTUBE_PROXY;
  const hasCookies = !!(YOUTUBE_COOKIE_ENV || YOUTUBE_COOKIES_ENV || YOUTUBE_COOKIES_PATH);
  const hasPlayerClients = !!YOUTUBE_PLAYER_CLIENTS;

  logInfo('[YouTube] Configuration status');
  logInfo(`  Proxy: ${hasProxy ? 'Configured' : 'Not configured'}${hasProxy ? ` (${YOUTUBE_PROXY.substring(0, 20)}...)` : ''}`);
  logInfo(`  Cookies: ${hasCookies ? 'Configured' : 'Not configured'}`);
  logInfo(`  Player Clients: ${hasPlayerClients ? `Configured (${YOUTUBE_PLAYER_CLIENTS})` : 'Not configured (using defaults)'}`);

  if (!hasProxy && !hasCookies) {
    logWarning('[YouTube] No proxy or cookies configured! This may cause transcript fetching to fail in cloud/production environments.');
    logWarning('[YouTube] Please configure one of: YOUTUBE_PROXY, YOUTUBE_COOKIE/YOUTUBE_COOKIES, or YOUTUBE_PLAYER_CLIENTS');
  }
}

// Call on module load
logYouTubeConfigStatus();

let cachedYtdlAgent: ytdl.Agent | null = null;
let cachedCookieHeader: string | null = null;
let youtubeFetchPatched = false;

function ensureYouTubeFetchPatched() {
  if (youtubeFetchPatched) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typedGlobal = globalThis as Record<string, any>;
  if (typeof typedGlobal.fetch !== 'function') return;

  const realFetch = typedGlobal.fetch;
  const consentCookie = getCookieHeader() || DEFAULT_CONSENT_COOKIE;
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typedGlobal.fetch = (input: any, init: any = {}) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input && input.url) || '';

      const lower = typeof url === 'string' ? url.toLowerCase() : '';
      const isYouTubeHost =
        lower.includes('youtube.com') ||
        lower.includes('youtu.be') ||
        lower.includes('googlevideo.com') ||
        lower.includes('ytimg.com');

      if (isYouTubeHost) {
        const headers: Record<string, string> = {};
        const initHeaders = init.headers;

        if (initHeaders) {
          if (typeof initHeaders.forEach === 'function') {
            initHeaders.forEach((v: string, k: string) => { headers[k] = v; });
          } else if (Array.isArray(initHeaders)) {
            for (const [k, v] of initHeaders) headers[k as string] = v as string;
          } else {
            Object.assign(headers, initHeaders as Record<string, string>);
          }
        }

        const hasHeader = (name: string) =>
          Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase());

        if (consentCookie && !hasHeader('cookie')) {
          headers['Cookie'] = consentCookie;
        }
        if (!hasHeader('user-agent')) {
          headers['User-Agent'] = defaultHeaders['User-Agent'];
        }
        if (!hasHeader('accept-language')) {
          headers['Accept-Language'] = defaultHeaders['Accept-Language'];
        }

        init = { ...init, headers };
      }
    } catch {
      // If patching fails, fall back to original fetch silently
    }

    return realFetch(input, init);
  };

  youtubeFetchPatched = true;
}

function readCookiesFromFile(filePath: string): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    logWarning('[YouTube] Failed to read cookies file: ' + String(error));
    return null;
  }
}

function parseCookieHeader(header: string): YtdlCookie[] {
  if (!header) return [];
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eq = part.indexOf('=');
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name || !value) return null;
      return { name, value };
    })
    .filter(Boolean) as YtdlCookie[];
}

function parseCookiesJson(raw: string): YtdlCookie[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const name = item.name || item.key;
        const value = item.value;
        if (!name || !value) return null;
        return {
          name,
          value,
          domain: item.domain,
          path: item.path,
          secure: item.secure,
          httpOnly: item.httpOnly,
          hostOnly: item.hostOnly,
          sameSite: item.sameSite,
          expirationDate: item.expirationDate
        } as YtdlCookie;
      })
      .filter(Boolean) as YtdlCookie[];
  } catch {
    return [];
  }
}

function getCookiesFromEnv(): YtdlCookie[] {
  const fileCookies = YOUTUBE_COOKIES_PATH ? readCookiesFromFile(YOUTUBE_COOKIES_PATH) : null;
  if (fileCookies) {
    const parsed = parseCookiesJson(fileCookies);
    if (parsed.length > 0) return parsed;
  }

  if (YOUTUBE_COOKIES_ENV) {
    const parsed = parseCookiesJson(YOUTUBE_COOKIES_ENV);
    if (parsed.length > 0) return parsed;
  }

  if (YOUTUBE_COOKIE_ENV) {
    const parsed = parseCookieHeader(YOUTUBE_COOKIE_ENV);
    if (parsed.length > 0) return parsed;
  }

  // Fallback consent cookie helps bypass EU/age consent pages in some regions
  return [{
    name: 'CONSENT',
    value: 'YES+1'
  }];
}

function getCookieHeader(): string | null {
  if (cachedCookieHeader !== null) return cachedCookieHeader;

  if (YOUTUBE_COOKIE_ENV) {
    cachedCookieHeader = YOUTUBE_COOKIE_ENV;
    return cachedCookieHeader;
  }

  const cookies = getCookiesFromEnv();
  if (cookies.length > 0) {
    cachedCookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return cachedCookieHeader;
  }

  cachedCookieHeader = DEFAULT_CONSENT_COOKIE;
  return cachedCookieHeader;
}

function getYtdlAgent(): ytdl.Agent | undefined {
  if (cachedYtdlAgent !== null) return cachedYtdlAgent || undefined;

  const cookies = getCookiesFromEnv();

  if (YOUTUBE_PROXY) {
    cachedYtdlAgent = cookies.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ytdl.createProxyAgent({ uri: YOUTUBE_PROXY }, cookies as any)
      : ytdl.createProxyAgent({ uri: YOUTUBE_PROXY });
    logInfo(`[YouTube] Using proxy for video fetch${cookies.length > 0 ? ` with ${cookies.length} cookies` : ''}`);
    return cachedYtdlAgent || undefined;
  }

  if (cookies.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedYtdlAgent = ytdl.createAgent(cookies as any);
    logInfo(`[YouTube] Using ${cookies.length} cookies for video fetch`);
    return cachedYtdlAgent || undefined;
  }

  cachedYtdlAgent = null;
  return undefined;
}

function getPlayerClients(): Array<'WEB_EMBEDDED' | 'TV' | 'IOS' | 'ANDROID' | 'WEB'> | undefined {
  if (!YOUTUBE_PLAYER_CLIENTS) return undefined;
  const clients = YOUTUBE_PLAYER_CLIENTS
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean) as Array<'WEB_EMBEDDED' | 'TV' | 'IOS' | 'ANDROID' | 'WEB'>;
  return clients.length > 0 ? clients : undefined;
}

function getAxiosConfigForYouTube() {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://www.youtube.com',
    'Referer': 'https://www.youtube.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };

  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = { headers };
  if (YOUTUBE_PROXY) {
    config.httpsAgent = new HttpsProxyAgent(YOUTUBE_PROXY);
  }

  return config;
}

export function extractVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const idPattern = /^[a-zA-Z0-9_-]{11}$/;

  // Allow passing a raw video ID
  if (idPattern.test(trimmed)) {
    return trimmed;
  }

  const tryParseUrl = (value: string): URL | null => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  };

  const url = tryParseUrl(trimmed) || tryParseUrl(`https://${trimmed}`);

  if (url) {
    const hostname = url.hostname.toLowerCase();
    const host = hostname.replace(/^www\./, '');
    const isYouTubeHost =
      host === 'youtu.be' ||
      host.endsWith('youtube.com') ||
      host.endsWith('youtube-nocookie.com');

    if (isYouTubeHost) {
      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        if (id && idPattern.test(id)) return id;
      }

      const pathname = url.pathname;
      if (pathname === '/watch' || pathname === '/watch/') {
        const id = url.searchParams.get('v');
        if (id && idPattern.test(id)) return id;
      }
      if (pathname.startsWith('/shorts/')) {
        const id = pathname.split('/')[2];
        if (id && idPattern.test(id)) return id;
      }
      if (pathname.startsWith('/live/')) {
        const id = pathname.split('/')[2];
        if (id && idPattern.test(id)) return id;
      }
      if (pathname.startsWith('/embed/')) {
        const id = pathname.split('/')[2];
        if (id && idPattern.test(id)) return id;
      }
      if (pathname.startsWith('/v/')) {
        const id = pathname.split('/')[2];
        if (id && idPattern.test(id)) return id;
      }
    }
  }

  // Fallback regex for non-standard inputs
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// ===========================================
// FETCH TRANSCRIPT
// ===========================================

interface YouTubeTimedTextEvent {
  segs?: { utf8?: string }[];
  tStartMs?: number;
  dDurationMs?: number;
}

interface YouTubeCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function fetchTranscriptViaTimedText(videoId: string): Promise<TranscriptSegment[]> {
  const languagesToTry = ['en', 'en-US', 'en-GB', 'hi', 'es', 'fr'];
  const formats = ['json3', 'srv1', 'srv3'] as const;
  const kinds = [undefined, 'asr'] as const; // prefer manual, then auto captions

  const axiosConfig = getAxiosConfigForYouTube();

  for (const lang of languagesToTry) {
    for (const kind of kinds) {
      for (const fmt of formats) {
        const params: Record<string, string> = {
          v: videoId,
          lang,
          fmt
        };
        if (kind) params.kind = kind;

        try {
          const url = 'https://www.youtube.com/api/timedtext';
          const response = await axios.get(url, { ...axiosConfig, params });

          // json3 format
          if (fmt === 'json3' && response.data && response.data.events) {
            const segments: TranscriptSegment[] = response.data.events
              .filter((event: YouTubeTimedTextEvent) => event.segs && event.segs.some((s) => s.utf8 && s.utf8.trim().length > 0))
              .map((event: YouTubeTimedTextEvent) => ({
                text: (event.segs || []).map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim(),
                offset: event.tStartMs,
                duration: event.dDurationMs || 0
              }));
            if (segments.length > 0) {
              logInfo(`[YouTube] TimedText success via json3 (${lang}${kind ? `/${kind}` : ''})`);
              return segments;
            }
          }

          // srv1/srv3 XML
          if ((fmt === 'srv1' || fmt === 'srv3') && typeof response.data === 'string' && response.data.includes('<text')) {
            const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
            const matches = [...response.data.matchAll(RE_XML_TRANSCRIPT)];
            if (matches.length > 0) {
              logInfo(`[YouTube] TimedText success via ${fmt} (${lang}${kind ? `/${kind}` : ''})`);
              return matches.map((m) => ({
                text: decodeHtmlEntities(m[3]).replace(/\s+/g, ' ').trim(),
                offset: parseFloat(m[1]) * 1000,
                duration: parseFloat(m[2]) * 1000
              }));
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logWarning(`[YouTube] TimedText fmt=${fmt} lang=${lang}${kind ? `/${kind}` : ''} failed: ${msg}`);
          continue;
        }
      }
    }
  }

  return [];
}

export async function fetchYouTubeTranscript(url: string): Promise<{
  videoId: string;
  transcript: string;
  segments: TranscriptSegment[];
  videoInfo?: YouTubeVideoInfo;
}> {
  const videoId = extractVideoId(url);

  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  logInfo(`[YouTube] ========================================`);
  logInfo(`[YouTube] Starting transcript fetch for video: ${videoId}`);
  logInfo(`[YouTube] URL: ${url}`);
  logInfo(`[YouTube] Environment: ${process.env.NODE_ENV || 'development'}`);
  logInfo(`[YouTube] ========================================`);

  try {
    // Ensure fetch used by youtube-transcript carries consent cookies/UA in cloud regions
    ensureYouTubeFetchPatched();

    // Try to get video info first (optional)
    let videoInfo: YouTubeVideoInfo | null = null;
    try {
      if (isYouTubeAPIConfigured()) {
        logInfo(`[YouTube] Fetching video info via YouTube Data API...`);
        videoInfo = await getYouTubeVideoInfo(videoId);
        logInfo(`[YouTube] Video info retrieved: ${videoInfo.title}`);
      } else {
        logInfo(`[YouTube] YouTube Data API not configured, skipping video info`);
      }
    } catch (error: unknown) {
      logWarning(`[YouTube] Could not fetch video info: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Method W: Cloudflare Worker proxy (bypasses GCP IP blocking)
    if (YOUTUBE_TRANSCRIPT_WORKER_URL) {
      logInfo(`[YouTube] Method W: Cloudflare Worker proxy...`);
      try {
        const workerUrl = `${YOUTUBE_TRANSCRIPT_WORKER_URL}/transcript?videoId=${videoId}`;
        const headers: Record<string, string> = {};
        if (YOUTUBE_TRANSCRIPT_WORKER_TOKEN) {
          headers['Authorization'] = `Bearer ${YOUTUBE_TRANSCRIPT_WORKER_TOKEN}`;
        }
        const workerResp = await axios.get(workerUrl, { headers, timeout: 20000 });
        const { transcript: workerTranscript, segments: workerSegments } = workerResp.data;

        if (workerTranscript && workerTranscript.length >= 10) {
          logInfo(`[YouTube] Method W SUCCESS: Cloudflare Worker`);
          logInfo(`[YouTube] Transcript length: ${workerTranscript.length} characters, ${workerSegments?.length || 0} segments`);
          return {
            videoId,
            transcript: workerTranscript,
            segments: (workerSegments || []).map((s: { text: string; offset?: number; duration?: number }) => ({
              text: s.text,
              offset: s.offset || 0,
              duration: s.duration || 0,
            })),
            videoInfo: videoInfo || undefined,
          };
        }
        logWarning(`[YouTube] Method W: Worker returned empty transcript`);
      } catch (wErr: unknown) {
        logWarning(`[YouTube] Method W FAILED: ${wErr instanceof Error ? wErr.message : String(wErr)}`);
      }
    }

    // Method -2: Direct InnerTube API — most reliable from GCP (hitting Google's own servers)
    // Try multiple client types: Android, iOS, WEB, TV — different clients have different blocking
    const innerTubeClients = [
      {
        name: 'ANDROID',
        body: {
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.19.35',
              androidSdkVersion: 34,
              hl: 'en',
              gl: 'US',
              userAgent: 'com.google.android.youtube/20.19.35 (Linux; U; Android 14; en_US) gzip'
            }
          },
          videoId
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/20.19.35 (Linux; U; Android 14; en_US) gzip',
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': '20.19.35'
        }
      },
      {
        name: 'IOS',
        body: {
          context: {
            client: {
              clientName: 'IOS',
              clientVersion: '20.19.6',
              deviceMake: 'Apple',
              deviceModel: 'iPhone16,2',
              hl: 'en',
              gl: 'US',
              userAgent: 'com.google.ios.youtube/20.19.6 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
            }
          },
          videoId
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.ios.youtube/20.19.6 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
          'X-YouTube-Client-Name': '5',
          'X-YouTube-Client-Version': '20.19.6'
        }
      },
      {
        name: 'WEB',
        body: {
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20260418.01.00',
              hl: 'en',
              gl: 'US'
            }
          },
          videoId
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': '2.20260418.01.00',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/'
        }
      },
      {
        name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        body: {
          context: {
            client: {
              clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
              clientVersion: '2.0',
              hl: 'en',
              gl: 'US'
            },
            thirdParty: {
              embedUrl: 'https://www.google.com'
            }
          },
          videoId
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
          'X-YouTube-Client-Name': '85',
          'X-YouTube-Client-Version': '2.0'
        }
      }
    ];

    for (const client of innerTubeClients) {
      logInfo(`[YouTube] Method -2 (${client.name}): Direct InnerTube API...`);
      try {
        const cookieHeader = getCookieHeader();
        const reqHeaders = { ...client.headers } as Record<string, string>;
        if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;

        const proxyConfig = YOUTUBE_PROXY
          ? { httpsAgent: new HttpsProxyAgent(YOUTUBE_PROXY) }
          : {};

        const innerTubeRes = await axios.post(
          'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
          client.body,
          { headers: reqHeaders, timeout: 15000, ...proxyConfig }
        );

        const captionTracks = innerTubeRes.data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (captionTracks && captionTracks.length > 0) {
          const enTrack = captionTracks.find((t: { languageCode: string }) => t.languageCode === 'en') || captionTracks[0];
          const xmlRes = await axios.get(enTrack.baseUrl, {
            headers: { 'User-Agent': reqHeaders['User-Agent'] },
            timeout: 15000,
            ...proxyConfig
          });

          if (xmlRes.data && xmlRes.data.length > 0) {
            // Parse both <p> tags (new format) and <text> tags (old format)
            const pMatches = [...xmlRes.data.matchAll(/<p[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/p>/g)];
            const textMatches = [...xmlRes.data.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
            const matches = pMatches.length > 0 ? pMatches : textMatches;

            if (matches.length > 0) {
              const transcript = matches
                .map((m: RegExpMatchArray) => m[1].replace(/<[^>]+>/g, ''))
                .join(' ')
                .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

              if (transcript.length >= 10) {
                logInfo(`[YouTube] Method -2 (${client.name}) SUCCESS: ${transcript.length} chars, ${matches.length} segments`);
                return {
                  videoId,
                  transcript,
                  segments: matches.map((m: RegExpMatchArray) => ({
                    text: m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
                    offset: 0,
                    duration: 0
                  })),
                  videoInfo: videoInfo || { title: `YouTube: ${videoId}` } as YouTubeVideoInfo
                };
              }
            }
          }
        }
        logWarning(`[YouTube] Method -2 (${client.name}): No usable transcript`);
      } catch (error: unknown) {
        logWarning(`[YouTube] Method -2 (${client.name}) failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Method -1: youtube-transcript v1.3.0 (uses Android InnerTube API - library wrapper)
    logInfo(`[YouTube] Method -1: youtube-transcript v1.3.0 (Android InnerTube)...`);
    try {
      if (!fetchTranscriptV2) throw new Error('youtube-transcript module not loaded');
      const segments = await fetchTranscriptV2(videoId, { lang: 'en' });
      if (segments && segments.length > 0) {
        const transcript = segments
          .map((s: { text: string }) => s.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (transcript && transcript.length >= 10) {
          logInfo(`[YouTube] ✓ Method -1 SUCCESS: youtube-transcript v1.3.0`);
          logInfo(`[YouTube] Transcript length: ${transcript.length} characters, ${segments.length} segments`);
          return {
            videoId,
            transcript,
            segments: segments.map((s: { text: string; offset?: number; duration?: number }) => ({
              text: s.text,
              offset: s.offset || 0,
              duration: s.duration || 0,
            })),
            videoInfo: videoInfo || undefined
          };
        }
      }
      logWarning(`[YouTube] ✗ Method -1: No segments or empty transcript`);
    } catch (m1err: unknown) {
      logWarning(`[YouTube] ✗ Method -1 FAILED: ${m1err instanceof Error ? m1err.message : String(m1err)}`);
    }

    logInfo(`[YouTube] Method 0: Scraping watch page for caption tracks...`);
    try {
      const axiosConfig = getAxiosConfigForYouTube();
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const watchResp = await axios.get(watchUrl, { ...axiosConfig, responseType: 'text' });
      const html = typeof watchResp.data === 'string' ? watchResp.data : '';

      // Extract captionTracks from ytInitialPlayerResponse
      // Use [\s\S] instead of . with s-flag for cross-environment compatibility
      const startIdx = html.indexOf('ytInitialPlayerResponse');
      let playerRespMatch: RegExpMatchArray | null = null;
      if (startIdx !== -1) {
        // Find the JSON object by matching balanced braces from the start
        const jsonStart = html.indexOf('{', startIdx);
        if (jsonStart !== -1) {
          let depth = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < html.length; i++) {
            if (html[i] === '{') depth++;
            else if (html[i] === '}') depth--;
            if (depth === 0) { jsonEnd = i + 1; break; }
          }
          const jsonStr = html.substring(jsonStart, jsonEnd);
          playerRespMatch = [jsonStr, jsonStr] as unknown as RegExpMatchArray;
        }
      }
      if (playerRespMatch) {
        const playerResp = JSON.parse(playerRespMatch[0]);
        const captionTracks = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (captionTracks && captionTracks.length > 0) {
          // Prefer English, fall back to first available
          const enTrack = captionTracks.find((t: YouTubeCaptionTrack) => t.languageCode?.startsWith('en')) || captionTracks[0];
          const baseUrl = enTrack.baseUrl;
          if (baseUrl) {
            // Fetch the caption XML
            const captionUrl = baseUrl.includes('fmt=json3') ? baseUrl : `${baseUrl}&fmt=json3`;
            const captionResp = await axios.get(captionUrl, axiosConfig);

            if (captionResp.data?.events) {
              const segments: TranscriptSegment[] = captionResp.data.events
                .filter((e: YouTubeTimedTextEvent) => e.segs && e.segs.some((s) => s.utf8?.trim()))
                .map((e: YouTubeTimedTextEvent) => ({
                  text: (e.segs || []).map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim(),
                  offset: e.tStartMs || 0,
                  duration: e.dDurationMs || 0,
                }));
              if (segments.length > 0) {
                const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
                if (transcript.length >= 10) {
                  logInfo(`[YouTube] ✓ Method 0 SUCCESS: watch page scrape (${enTrack.languageCode})`);
                  logInfo(`[YouTube] Transcript length: ${transcript.length} characters`);
                  return { videoId, transcript, segments, videoInfo: videoInfo || undefined };
                }
              }
            }

            // Try XML format fallback
            const xmlUrl = baseUrl.includes('fmt=') ? baseUrl.replace(/fmt=[^&]+/, 'fmt=srv1') : `${baseUrl}&fmt=srv1`;
            const xmlResp = await axios.get(xmlUrl, { ...axiosConfig, responseType: 'text' });
            if (typeof xmlResp.data === 'string' && xmlResp.data.includes('<text')) {
              const RE = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
              const matches = [...xmlResp.data.matchAll(RE)];
              if (matches.length > 0) {
                const segments: TranscriptSegment[] = matches.map(m => ({
                  text: decodeHtmlEntities(m[3]).replace(/\s+/g, ' ').trim(),
                  offset: parseFloat(m[1]) * 1000,
                  duration: parseFloat(m[2]) * 1000,
                }));
                const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
                if (transcript.length >= 10) {
                  logInfo(`[YouTube] ✓ Method 0 SUCCESS: watch page scrape XML (${enTrack.languageCode})`);
                  return { videoId, transcript, segments, videoInfo: videoInfo || undefined };
                }
              }
            }
          }
        }
      }
      logWarning(`[YouTube] ✗ Method 0: No caption tracks found in page HTML`);
    } catch (m0err: unknown) {
      logWarning(`[YouTube] ✗ Method 0 FAILED: ${m0err instanceof Error ? m0err.message : String(m0err)}`);
    }

    // Method 1: Official timedtext endpoint (works in most regions, respects cookies/proxy)
    logInfo(`[YouTube] Method 1: Attempting timedtext API...`);
    try {
      const segments = await fetchTranscriptViaTimedText(videoId);
      if (segments && segments.length > 0) {
        const transcript = segments
          .map(s => s.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (transcript && transcript.length >= 10) {
          logInfo(`[YouTube] ✓ Method 1 SUCCESS: timedtext API`);
          logInfo(`[YouTube] Transcript length: ${transcript.length} characters, ${segments.length} segments`);
          return {
            videoId,
            transcript,
            segments,
            videoInfo: videoInfo || undefined
          };
        } else {
          logInfo(`[YouTube] Method 1 returned empty transcript, trying next method...`);
        }
      }
    } catch (timedErr: unknown) {
      const errorMsg = timedErr instanceof Error ? timedErr.message : String(timedErr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statusCode = (timedErr as any)?.response ? ((timedErr as any).response?.status || 'N/A') : 'N/A';
      logWarning(`[YouTube] ✗ Method 1 FAILED: timedtext API`);
      logWarning(`  Error: ${errorMsg}, HTTP Status: ${statusCode}`);
    }

    // Method 2: Manual fetch using ytdl-core player response
    logInfo(`[YouTube] Method 2: Attempting manual fetch via @distube/ytdl-core...`);
    try {
      const segments = await fetchTranscriptManually(videoId);
      if (segments && segments.length > 0) {
        const transcript = segments
          .map(s => s.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (transcript && transcript.length >= 10) {
          logInfo(`[YouTube] ✓ Method 2 SUCCESS: manual ytdl-core fetch`);
          logInfo(`[YouTube] Transcript length: ${transcript.length} characters, ${segments.length} segments`);
          return {
            videoId,
            transcript,
            segments,
            videoInfo: videoInfo || undefined
          };
        } else {
          logInfo(`[YouTube] Method 2 returned empty transcript, trying next method...`);
        }
      }
    } catch (manualError: unknown) {
      logWarning(`[YouTube] ✗ Method 2 FAILED: manual ytdl-core fetch`);
      logWarning(`  Error: ${manualError instanceof Error ? manualError.message : String(manualError)}`);
    }

    // Method 3: youtube-transcript library (as last resort; may be blocked in some regions)
    logInfo(`[YouTube] Method 3: Attempting youtube-transcript library...`);
    try {
      const languagesToTry = [undefined, 'en', 'en-US', 'en-GB', 'hi', 'hi-IN', 'es', 'fr'];
      let segments: TranscriptSegment[] = [];
      let lastError: unknown = null;

      for (const lang of languagesToTry) {
        try {
          if (lang) {
            segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
          } else {
            segments = await YoutubeTranscript.fetchTranscript(videoId);
          }

          if (segments && segments.length > 0) {
            logInfo(`[YouTube] Found transcript in ${lang || 'default'} language`);
            const transcript = segments
              .map(s => s.text)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();

            if (!transcript || transcript.length < 10) {
              throw new Error('Transcript is empty or too short from YouTube');
            }

            logInfo(`[YouTube] ✓ Method 3 SUCCESS: youtube-transcript library`);
            logInfo(`[YouTube] Transcript length: ${transcript.length} characters, ${segments.length} segments`);
            return {
              videoId,
              transcript,
              segments: segments.map(s => ({
                text: s.text,
                offset: s.offset,
                duration: s.duration
              })),
              videoInfo: videoInfo || undefined
            };
          }
        } catch (langError: unknown) {
          lastError = langError;
          continue;
        }
      }

      // If we reach here, library did not return usable transcript
      throw lastError || new Error('Transcript not available from youtube-transcript');
    } catch (transcriptError: unknown) {
      const errorMessage = transcriptError instanceof Error ? transcriptError.message : String(transcriptError);
      logWarning(`[YouTube] ✗ Method 3 FAILED: youtube-transcript library`);
      logWarning(`  Error: ${errorMessage}`);
      // Continue to next method
    }

    // Method 4: Fallback to audio transcription with Whisper
    if (isOpenAIConfigured()) {
      logInfo(`[YouTube] Method 4: Attempting Whisper audio transcription...`);
      try {
        const transcriptFromAudio = await transcribeYouTubeAudio(videoId);

        logInfo(`[YouTube] ✓ Method 4 SUCCESS: Whisper audio transcription`);
        logInfo(`[YouTube] Transcript length: ${transcriptFromAudio.length} characters`);
        return {
          videoId,
          transcript: transcriptFromAudio,
          segments: [],
          videoInfo: videoInfo || undefined
        };
      } catch (whisperError: unknown) {
        const whisperErrorMessage = whisperError instanceof Error ? whisperError.message : String(whisperError);
        logError(new Error('[YouTube] Method 4 FAILED: Whisper audio transcription'));
        logError(new Error(`[YouTube] Whisper error: ${whisperErrorMessage}`));
      }
    } else {
      logInfo(`[YouTube] Method 4 skipped: OpenAI not configured`);
    }

    // All methods failed - provide clear guidance
    logError(new Error('[YouTube] ========================================'));
    logError(new Error(`[YouTube] ALL METHODS FAILED for video: ${videoId}`));
    logError(new Error('[YouTube] ========================================'));
    logError(new Error('[YouTube] Environment check'));
    logError(new Error(`[YouTube] Environment: Proxy=${YOUTUBE_PROXY ? 'Yes' : 'No'}, Cookies=${(YOUTUBE_COOKIE_ENV || YOUTUBE_COOKIES_ENV) ? 'Yes' : 'No'}, Players=${YOUTUBE_PLAYER_CLIENTS || 'Default'}, OpenAI=${isOpenAIConfigured() ? 'Yes' : 'No'}`));
    logError(new Error('[YouTube] Troubleshooting'));
    logError(new Error('[YouTube] Troubleshooting: 1. Configure YOUTUBE_PROXY, 2. YOUTUBE_COOKIE/YOUTUBE_COOKIES, 3. YOUTUBE_PLAYER_CLIENTS, 4. OPENAI_API_KEY'));
    logError(new Error('[YouTube] ========================================'));

    const hasOpenAI = isOpenAIConfigured();
    const errorMsg = hasOpenAI
      ? 'Unable to fetch transcript from this video. YouTube may be blocking transcript access, or the video does not have captions enabled. Please use the "Manual Text" option to add your content manually.'
      : 'Unable to fetch transcript from this video. YouTube may be blocking transcript access, or the video does not have captions enabled. Please configure OPENAI_API_KEY to enable audio transcription fallback, or use the "Manual Text" option instead.';

    throw new Error(errorMsg);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // If the error already contains our custom message, pass it through without wrapping
    if (errorMessage.includes('Unable to fetch transcript') ||
      errorMessage.includes('YouTube may be blocking') ||
      errorMessage.includes('Please use the "Manual Text"') ||
      errorMessage.includes('Please configure OPENAI_API_KEY')) {
      throw error;
    }

    throw new Error(`Failed to fetch transcript: ${errorMessage}`);
  }
}

// ===========================================
// FALLBACK: AUDIO TRANSCRIPTION VIA OPENAI
// ===========================================

async function downloadYouTubeAudioToTempFile(videoId: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `yt-audio-${videoId}-${Date.now()}.mp3`);

  try {
    // Validate video URL first
    let info;
    try {
      const agent = getYtdlAgent();
      const playerClients = getPlayerClients();
      info = await ytdl.getInfo(videoId, {
        agent,
        playerClients
      });
      if (!info) {
        throw new Error('Video not found or unavailable');
      }
    } catch (infoError: unknown) {
      const errorMsg = infoError instanceof Error ? infoError.message : String(infoError);
      if (errorMsg.includes('Could not extract functions') ||
        errorMsg.includes('Sign in to confirm your age') ||
        errorMsg.includes('Private video') ||
        errorMsg.includes('Video unavailable')) {
        throw new Error(`YouTube is blocking access to this video. This is a known limitation. Please use manual text content instead or ensure the video has public transcripts enabled.`);
      }
      throw new Error(`Failed to get video info: ${errorMsg}`);
    }

    // Download audio with better error handling
    let audioStream;
    try {
      const agent = getYtdlAgent();
      const playerClients = getPlayerClients();
      audioStream = ytdl(url, {
        quality: 'lowestaudio',
        filter: 'audioonly',
        agent,
        playerClients
      });
    } catch (streamError: unknown) {
      const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
      if (errorMsg.includes('Could not extract functions')) {
        throw new Error(`YouTube is blocking audio download for this video. This is a known limitation. Please use manual text content instead.`);
      }
      throw new Error(`Failed to create audio stream: ${errorMsg}`);
    }

    const writeStream = fs.createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      let hasError = false;
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (_e) {
            // Ignore cleanup errors
          }
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      // Set a timeout for download (5 minutes max)
      timeoutId = setTimeout(() => {
        if (!hasError) {
          hasError = true;
          cleanup();
          reject(new Error('Audio download timeout. Video may be too long or connection is slow.'));
        }
      }, 5 * 60 * 1000);

      audioStream.on('error', (err: Error) => {
        if (!hasError) {
          hasError = true;
          cleanup();
          const errorMsg = err?.message || String(err);
          if (errorMsg.includes('Could not extract functions') ||
            errorMsg.includes('Sign in to confirm your age') ||
            errorMsg.includes('Private video')) {
            reject(new Error(`YouTube is blocking audio download. Please use manual text content instead.`));
          } else {
            reject(new Error(`Failed to download audio: ${errorMsg}`));
          }
        }
      });

      writeStream.on('error', (err) => {
        if (!hasError) {
          hasError = true;
          cleanup();
          reject(new Error(`Failed to write audio file: ${err.message}`));
        }
      });

      writeStream.on('finish', () => {
        if (!hasError) {
          clearTimeout(timeoutId);
          resolve();
        }
      });

      audioStream.pipe(writeStream);
    });

    // Verify file was created and has content
    if (!fs.existsSync(filePath)) {
      throw new Error('Audio file was not created');
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      fs.unlinkSync(filePath);
      throw new Error('Downloaded audio file is empty');
    }

    return filePath;
  } catch (error: unknown) {
    // Clean up on error
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_unlinkError) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

async function transcribeYouTubeAudio(videoId: string): Promise<string> {
  if (!isOpenAIConfigured()) {
    throw new Error('OpenAI API key not configured for audio transcription');
  }

  let filePath: string | null = null;

  try {
    logInfo(`[YouTube] Downloading audio for video: ${videoId}`);
    filePath = await downloadYouTubeAudioToTempFile(videoId);

    logInfo(`[YouTube] Transcribing audio with Whisper for video: ${videoId}`);
    const fileStream = fs.createReadStream(filePath);

    // OpenAI accepts a ReadStream directly
    const response = await openai.audio.transcriptions.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      file: fileStream as any,
      model: 'whisper-1',
      language: 'en' // Optional: specify language for better accuracy
    });

    const text = (response as unknown as { text?: string }).text?.trim() || '';

    if (!text || text.length < 10) {
      throw new Error('Audio transcription result is empty or too short');
    }

    logInfo(`[YouTube] Successfully transcribed audio (${text.length} characters)`);
    return text;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(new Error(`[YouTube] Audio transcription failed: ${errorMessage}`));

    // Provide more specific error messages
    if (errorMessage.includes('not found') || errorMessage.includes('unavailable')) {
      throw new Error('Video is not available or has been removed');
    }
    if (errorMessage.includes('private') || errorMessage.includes('restricted')) {
      throw new Error('Video is private or restricted and cannot be accessed');
    }
    if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later');
    }

    throw new Error(`Audio transcription failed: ${errorMessage}`);
  } finally {
    // Clean up temp file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        logWarning(`[YouTube] Failed to cleanup temp file: ${filePath}`, { error: String(unlinkError) });
      }
    }
  }
}

/**
 * Check if YouTube API is configured
 */
export function isYouTubeAPIConfigured(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

/**
 * Get YouTube video information using YouTube Data API
 */
export async function getYouTubeVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
  if (!isYouTubeAPIConfigured()) {
    throw new Error('YouTube API key not configured');
  }

  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          id: videoId,
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet,contentDetails,statistics',
        },
      }
    );

    const video = response.data.items[0];
    if (!video) {
      throw new Error('Video not found');
    }

    return {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      thumbnail: video.snippet.thumbnails.high.url,
      duration: video.contentDetails.duration,
      viewCount: parseInt(video.statistics.viewCount),
      likeCount: parseInt(video.statistics.likeCount || '0'),
      channelTitle: video.snippet.channelTitle,
      channelId: video.snippet.channelId,
      publishedAt: video.snippet.publishedAt,
      tags: video.snippet.tags || [],
      category: video.snippet.categoryId || 'unknown',
    };
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'YouTube API error' });
    throw new Error(`Failed to fetch video info: ${(error as Error).message}`);
  }
}

/**
 * Search for YouTube videos
 */
export async function searchYouTubeVideos(
  query: string,
  maxResults: number = 10
): Promise<YouTubeVideoInfo[]> {
  if (!isYouTubeAPIConfigured()) {
    throw new Error('YouTube API key not configured');
  }

  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/search`,
      {
        params: {
          q: query,
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet',
          type: 'video',
          maxResults: maxResults,
        },
      }
    );

    const videoIds = response.data.items.map((item: { id: { videoId: string } }) => item.id.videoId);

    if (videoIds.length === 0) {
      return [];
    }

    // Get detailed info for each video
    const videoDetails = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          id: videoIds.join(','),
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet,contentDetails,statistics',
        },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return videoDetails.data.items.map((video: any) => ({
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      thumbnail: video.snippet.thumbnails.high.url,
      duration: video.contentDetails.duration,
      viewCount: parseInt(video.statistics.viewCount),
      likeCount: parseInt(video.statistics.likeCount || '0'),
      channelTitle: video.snippet.channelTitle,
      channelId: video.snippet.channelId,
      publishedAt: video.snippet.publishedAt,
      tags: video.snippet.tags || [],
      category: video.snippet.categoryId || 'unknown',
    }));

  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'YouTube search error' });
    throw new Error(`Failed to search videos: ${(error as Error).message}`);
  }
}

/**
 * Get channel information
 */
export async function getYouTubeChannelInfo(channelId: string): Promise<unknown> {
  if (!isYouTubeAPIConfigured()) {
    throw new Error('YouTube API key not configured');
  }

  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/channels`,
      {
        params: {
          id: channelId,
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet,statistics,brandingSettings',
        },
      }
    );

    return response.data.items[0];
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'YouTube channel error' });
    throw new Error(`Failed to fetch channel info: ${(error as Error).message}`);
  }
}

/**
 * Fetch captions using YouTube Data API v3 (official method)
 * Note: Downloading captions requires OAuth, but listing them only needs API key
 * For now, we'll skip this method as it requires OAuth setup which is complex
 * We'll rely on youtube-transcript library which works for public videos
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchCaptionsViaAPI(videoId: string): Promise<string> {
  if (!isYouTubeAPIConfigured()) {
    throw new Error('YouTube API key not configured');
  }

  try {
    // Step 1: Get caption track IDs (this works with API key)
    const captionsResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/captions`,
      {
        params: {
          videoId: videoId,
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet',
        },
      }
    );

    const captionTracks = captionsResponse.data.items;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No captions available for this video');
    }

    // Note: Downloading captions requires OAuth, not just API key
    // So we can't actually download them with just an API key
    // This method is here for future OAuth implementation
    throw new Error('Caption download requires OAuth authentication. Use youtube-transcript library instead.');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific API errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errAny = error as any;
    if (errAny.response?.status === 401 || errAny.response?.status === 403) {
      throw new Error('YouTube API authentication failed. Caption download requires OAuth, not just API key.');
    }
    if (errAny.response?.status === 404) {
      throw new Error('Captions not found for this video');
    }

    throw new Error(`Failed to fetch captions via API: ${errorMessage}`);
  }
}

/**
 * Parse SRT (SubRip) subtitle format and extract text
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseSRT(srtContent: string): string {
  // Remove SRT timing information and extract only text
  const lines = srtContent.split('\n');
  const textLines: string[] = [];
  let skipNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip sequence numbers and timestamps
    if (/^\d+$/.test(line)) {
      skipNext = true;
      continue;
    }
    if (skipNext && /^\d{2}:\d{2}:\d{2}/.test(line)) {
      skipNext = false;
      continue;
    }
    if (skipNext) {
      continue;
    }

    // Collect text lines (skip empty lines)
    if (line && !/^\d+$/.test(line) && !/^\d{2}:\d{2}:\d{2}/.test(line)) {
      // Remove HTML tags if present
      const cleanLine = line.replace(/<[^>]+>/g, '').trim();
      if (cleanLine) {
        textLines.push(cleanLine);
      }
    }
  }

  return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Manual transcript fetch fallback using @distube/ytdl-core
 * This directly accesses the caption tracks from player_response
 */
async function fetchTranscriptManually(videoId: string): Promise<TranscriptSegment[]> {
  try {
    logInfo(`[YouTube] Manual fetch: getting video info for ${videoId}...`);
    // Pass custom agent/cookies if needed, but start simple
    const agent = getYtdlAgent();
    const playerClients = getPlayerClients();
    const info = await ytdl.getInfo(videoId, {
      agent,
      playerClients
    });

    // Extract caption tracks from player_response
    const captions = info.player_response?.captions?.playerCaptionsTracklistRenderer;
    const captionTracks = captions?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
      logWarning(`[YouTube] No caption tracks found in player_response for ${videoId}`);
      return [];
    }

    logInfo(`[YouTube] Found ${captionTracks.length} caption tracks. Available: ${captionTracks.map((t: YouTubeCaptionTrack) => t.languageCode).join(', ')}`);

    // Prioritize English, then whatever is first
    const sortedTracks = captionTracks.sort((a: YouTubeCaptionTrack, b: YouTubeCaptionTrack) => {
      const aEn = (a.languageCode || '').startsWith('en') ? 1 : 0;
      const bEn = (b.languageCode || '').startsWith('en') ? 1 : 0;
      if (aEn !== bEn) return bEn - aEn;

      const aManual = a.kind !== 'asr' ? 1 : 0;
      const bManual = b.kind !== 'asr' ? 1 : 0;
      return bManual - aManual;
    });

    const track = sortedTracks[0];
    logInfo(`[YouTube] Selected track: ${track.languageCode} (${track.kind || 'manual'})`);

    // Try multiple formats
    const formats = ['json3', 'srv1', 'srv3'];
    const axiosConfig = getAxiosConfigForYouTube();
    axiosConfig.headers['Referer'] = `https://www.youtube.com/watch?v=${videoId}`;

    for (const fmt of formats) {
      try {
        logInfo(`[YouTube] Attempting fetch with fmt=${fmt}...`);
        const transcriptUrl = `${track.baseUrl}&fmt=${fmt}`;
        const response = await axios.get(transcriptUrl, axiosConfig);

        if (fmt === 'json3' && response.data && response.data.events) {
          const segments: TranscriptSegment[] = response.data.events
            .filter((event: YouTubeTimedTextEvent) => event.segs && event.segs.some((s) => s.utf8 && s.utf8.trim().length > 0))
            .map((event: YouTubeTimedTextEvent) => ({
              text: (event.segs || []).map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim(),
              offset: event.tStartMs || 0,
              duration: event.dDurationMs || 0
            }));
          if (segments.length > 0) {
            logInfo(`[YouTube] Successfully fetched ${segments.length} segments via json3`);
            return segments;
          }
        } else if ((fmt === 'srv1' || fmt === 'srv3') && typeof response.data === 'string' && response.data.includes('<text')) {
          const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
          const results = [...response.data.matchAll(RE_XML_TRANSCRIPT)];
          if (results.length > 0) {
            logInfo(`[YouTube] Successfully fetched ${results.length} segments via ${fmt}`);
            return results.map((result) => ({
              text: result[3]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' '),
              offset: parseFloat(result[1]) * 1000,
              duration: parseFloat(result[2]) * 1000,
            }));
          }
        }
      } catch (e: unknown) {
        logWarning(`[YouTube] Format ${fmt} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: '[YouTube] fetchTranscriptManually critical failure' });
  }
  return [];
}

// ===========================================
// FETCH VIDEO METADATA
// ===========================================

export async function fetchVideoMetadata(videoId: string): Promise<{
  title: string;
  videoId: string;
}> {
  try {
    // Try to get full video info first
    if (isYouTubeAPIConfigured()) {
      const videoInfo = await getYouTubeVideoInfo(videoId);
      return {
        title: videoInfo.title,
        videoId
      };
    }
  } catch (error) {
    logWarning('Could not fetch detailed video info: ' + String(error));
  }

  // Fallback to basic info
  return {
    title: `YouTube Video: ${videoId}`,
    videoId
  };
}

// ===========================================
// PROCESS TRANSCRIPT FOR TRAINING
// ===========================================

export function cleanTranscript(transcript: string): string {
  return transcript
    // Remove [Music], [Applause], etc.
    .replace(/\[.*?\]/g, '')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Remove leading/trailing whitespace
    .trim();
}

export function segmentTranscriptByTime(
  segments: TranscriptSegment[],
  intervalSeconds: number = 60
): string[] {
  const groupedSegments: string[][] = [];
  let currentGroup: string[] = [];
  let currentStartTime = 0;

  for (const segment of segments) {
    if (segment.offset - currentStartTime >= intervalSeconds * 1000) {
      if (currentGroup.length > 0) {
        groupedSegments.push(currentGroup);
      }
      currentGroup = [];
      currentStartTime = segment.offset;
    }
    currentGroup.push(segment.text);
  }

  if (currentGroup.length > 0) {
    groupedSegments.push(currentGroup);
  }

  return groupedSegments.map(group =>
    cleanTranscript(group.join(' '))
  );
}
