// ===========================================
// CONFIGURATION
// ===========================================

import dotenv from 'dotenv';
import path from 'path';
import { logWarning } from '../utils/logger';
dotenv.config();

const projectRoot = path.resolve(__dirname, '..', '..');

const resolvePath = (inputPath: string) => {
  if (!inputPath) return inputPath;
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(projectRoot, inputPath);
};

const normalizePublicPath = (inputPath?: string) => {
  const fallback = '/api/upload/image';
  if (!inputPath) return fallback;
  let normalized = inputPath.trim();
  if (!normalized) return fallback;
  if (/^https?:\/\//i.test(normalized)) {
    // If a full URL is provided, only return its pathname
    try {
      const url = new URL(normalized);
      normalized = url.pathname || fallback;
    } catch {
      // Fall through to path normalization
    }
  }
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || fallback;
};

const normalizePublicUrl = (inputUrl?: string) => {
  if (!inputUrl) return undefined;
  const trimmed = inputUrl.trim();
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, '');
};

export const config = {
  // Server
  port: parseInt(process.env.PORT || '5000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },

  // AI Moderation
  aiModeration: {
    enabled: process.env.AI_MODERATION_ENABLED !== 'false',
    failOpen: process.env.AI_MODERATION_FAIL_OPEN !== 'false'
  },

  // Razorpay (Optional)
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || ''
  },

  // File Upload
  upload: {
    // Use UPLOAD_DIR if set; otherwise fall back to UPLOAD_PATH (for backwards compat),
    // and finally default to a local ./uploads directory.
    // This keeps the physical upload directory in sync with the static serving root
    // configured in src/index.ts, which also respects UPLOAD_PATH.
    dir: resolvePath(process.env.UPLOAD_DIR || process.env.UPLOAD_PATH || './uploads'),
    maxSize: parseInt(process.env.MAX_FILE_SIZE || '50000000'), // 50MB
    publicPath: normalizePublicPath(process.env.UPLOAD_PUBLIC_PATH),
    publicUrl: normalizePublicUrl(process.env.UPLOAD_PUBLIC_URL)
  },

  // Vector Store
  vectorDb: {
    path: resolvePath(process.env.VECTOR_DB_PATH || './data/vectors.db')
  },

  // Rate Limiting
  rateLimit: {
    freeMessagesPerDay: parseInt(process.env.FREE_MESSAGES_PER_DAY || '5'),
    guestMessagesTotal: parseInt(process.env.GUEST_MESSAGES_TOTAL || '3'),
    // General API limiter — short window keeps per-IP throughput high while still
    // capping burst abuse. Default: 1 000 req / 1 min ≈ 16 req/sec per IP.
    apiMaxRequests: parseInt(process.env.RATE_LIMIT_MAX || '1000'),
    apiWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 1000)), // 1 minute
    // Auth limiter — longer window for brute-force protection on login/signup/reset.
    // Default: 100 req / 15 min per IP.
    authMaxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX || (process.env.NODE_ENV === 'production' ? '20' : '100')),
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000)) // 15 minutes
  },

  // Subscription Pricing (in INR paise)
  subscription: {
    premiumPrice: 79900, // ₹799
    creatorShare: 0.8,   // 80%
    platformShare: 0.2,  // 20%
    tokenGrant: parseInt(process.env.TOKEN_GRANT || '2000000'),          // tokens credited on premium purchase
    tokensPerMessage: parseInt(process.env.TOKENS_PER_MESSAGE || '800'), // tokens consumed per user message
    tokensPerVoice: parseInt(process.env.TOKENS_PER_VOICE_REQUEST || '1600'), // extra tokens consumed per voice reply
    freeVoiceTrials: parseInt(process.env.FREE_VOICE_TRIALS || '2')       // voice requests a free user gets before upgrade prompt
  },

  // Brand Deal Commission
  brandDeal: {
    platformCommission: 0.1 // 10%
  }
};

// Validation
export function validateConfig() {
  const required = ['databaseUrl'];
  const missing = required.filter(key => !config[key as keyof typeof config]);

  if (missing.length > 0) {
    logWarning(`Missing required config: ${missing.join(', ')}`);
  }

  if (!config.openai.apiKey) {
    logWarning('OpenAI API key not configured. AI features will not work.');
  }

  return missing.length === 0;
}
