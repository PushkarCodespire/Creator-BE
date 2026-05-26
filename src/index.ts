// ===========================================
// CREATOR PLATFORM - MAIN SERVER
// ===========================================

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { getUploadPathPrefixes } from './utils/uploadPaths';
import { isCloudinaryConfigured, cleanupTtsAudio } from './utils/cloudinary';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import userDashboardRoutes from './routes/userDashboard.routes';
import creatorRoutes from './routes/creator.routes';
import chatRoutes from './routes/chat.routes';
import contentRoutes from './routes/content.routes';
import programRoutes from './routes/program.routes';
import bookingRoutes from './routes/booking.routes';
import homeRoutes from './routes/home.routes';
import newsletterRoutes from './routes/newsletter.routes';
import subscriptionRoutes from './routes/subscription.routes';
import paymentRoutes from './routes/payment.routes';
import payoutRoutes from './routes/payout.routes';
import reportRoutes from './routes/report.routes';
import companyRoutes from './routes/company.routes';
import opportunityRoutes from './routes/opportunity.routes';
import milestoneRoutes from './routes/milestone.routes';
import adminRoutes from './routes/admin.routes';
import aiModerationRoutes from './routes/admin/ai-moderation.routes';
import uploadRoutes from './routes/upload.routes';
import notificationRoutes from './routes/notification.routes';
import followRoutes from './routes/follow.routes';
import postRoutes from './routes/post.routes';
import commentRoutes from './routes/comment.routes';
import reactionRoutes from './routes/reaction.routes';
import linkPreviewRoutes from './routes/linkPreview.routes';
import bookmarkRoutes from './routes/bookmark.routes';
import trendingRoutes from './routes/trending.routes';
import searchRoutes from './routes/search.routes';
import recommendationRoutes from './routes/recommendation.routes';
import gamificationRoutes from './routes/gamification.routes';
import apiRoutes from './routes/api.routes';
import monitoringRoutes from './routes/monitoring.routes';
import mediaRoutes from './routes/media.routes';
import { updateQueueMetrics } from './utils/metrics';
import permissionsRoutes from './routes/permissions.routes';
import downloadRoutes from './routes/download.routes';
import instagramRoutes from './routes/instagram.routes';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { setupSocket } from './sockets';
import { performanceMonitoring } from './utils/monitoring';

// Import config
import { initializeVectorStore } from './utils/vectorStore';
import { logger, logInfo, logError, logWarning, logDebug } from './utils/logger';
import { connectRedis, isRedisConfigured } from './utils/redis';
import { contentQueue, isContentQueueEnabled } from './services/queue/content-queue';
import { processContentJob } from './services/queue/content-processor.worker';
import { chatQueue, isChatQueueEnabled } from './services/queue/chat-queue';
import { processChatJob } from './workers/chat-processing.worker';
import { sendError } from './utils/apiResponse';

const app = express();
const httpServer = createServer(app);

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// ===========================================
// MIDDLEWARE
// ===========================================

// Trust the first proxy hop (required on Render/Heroku/any load-balanced host)
// so express-rate-limit and req.ip read the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Security headers with Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin requests for uploads
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

// Performance monitoring
app.use(performanceMonitoring);

// Rate limiting - Prevent abuse while allowing legitimate traffic.
// Window and max are both configurable via env vars (RATE_LIMIT_WINDOW_MS /
// RATE_LIMIT_MAX). Default: 1 000 req per IP per minute ≈ 16 req/sec.
const limiter = rateLimit({
  windowMs: config.rateLimit.apiWindowMs,
  max: config.rateLimit.apiMaxRequests,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,  // Disable the `X-RateLimit-*` headers
  handler: (req, res, _next, options) => {
    return sendError(
      res,
      options.statusCode,
      'RATE_LIMIT_EXCEEDED',
      (options.message as string) || 'Too many requests from this IP, please try again later.'
    );
  }
});

// Apply rate limiting to all API routes
app.use('/api', limiter);

// Stricter rate limiting for authentication routes — brute-force protection.
// Longer window discourages credential stuffing. Default: 100 req per IP per 15 min.
// Configurable via AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW_MS.
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMaxRequests,
  skipSuccessfulRequests: true, // Only failed attempts count toward the limit
  handler: (req, res, _next, options) => {
    return sendError(
      res,
      options.statusCode,
      'RATE_LIMIT_EXCEEDED',
      (options.message as string) || 'Too many login attempts, please try again later.'
    );
  }
});

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Static files for uploads
// Use the configured upload directory so it stays in sync with the PVC mount.
const uploadsPath = config.upload.dir;
logDebug('Uploads path: ' + uploadsPath);
try {
  if (!fs.existsSync(uploadsPath)) {
    logWarning('Uploads folder not found, creating:', { path: uploadsPath });
    fs.mkdirSync(uploadsPath, { recursive: true });
    logInfo('✅ Uploads folder created:', { path: uploadsPath });
  } else {
    logInfo('✅ Serving uploads from:', { path: uploadsPath });
  }
} catch (error) {
  logWarning('⚠️ Could not create uploads directory:', { error, path: uploadsPath });
  // Continue anyway - the volume mount should handle this
}

const uploadsDebugEnabled = process.env.UPLOAD_DEBUG === 'true' || config.nodeEnv === 'development';
const uploadStaticOptions = uploadsDebugEnabled
  ? {
    setHeaders: (res: { setHeader: (name: string, value: string) => void }, filePath: string) => {
      res.setHeader('X-Uploads-Root', uploadsPath);
      res.setHeader('X-Uploads-Path', filePath);
    }
  }
  : undefined;

app.use('/uploads', express.static(uploadsPath, uploadStaticOptions));

// Custom serving that supports ?download=true headers at the configured public path
app.use(config.upload.publicPath, downloadRoutes);

// Back-compat aliases (so older URLs keep working even if publicPath changes)
const downloadAliases = ['/api/uploads', '/api/download', '/api/file'];
downloadAliases.forEach((alias) => {
  if (alias !== config.upload.publicPath) {
    app.use(alias, downloadRoutes);
  }
});

logInfo('Upload access paths', {
  uploadDir: uploadsPath,
  publicPath: config.upload.publicPath,
  publicUrl: config.upload.publicUrl || null,
  staticPath: '/uploads',
  aliases: downloadAliases.filter((alias) => alias !== config.upload.publicPath),
  queryFileEndpoint: '/api/upload/image?file=content/<filename>',
  debugEndpoints: [
    `${config.upload.publicPath}/_debug`,
    '/api/debug/uploads'
  ]
});

const handleUploadsDebug = (req: express.Request, res: express.Response) => {
  if (!uploadsDebugEnabled) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  const pickQueryValue = (value: unknown) => (Array.isArray(value) ? value[0] : value) as string | undefined;
  const fileParam = pickQueryValue(req.query.file);
  const urlParam = pickQueryValue(req.query.url);

  let relativePath: string | null = null;

  if (fileParam) {
    relativePath = fileParam.replace(/^\/+/, '');
  } else if (urlParam) {
    try {
      const parsed = new URL(urlParam, 'http://localhost');
      const pathname = parsed.pathname;
      const prefixes = getUploadPathPrefixes();
      for (const prefix of prefixes) {
        if (pathname.startsWith(prefix)) {
          relativePath = pathname.substring(prefix.length);
          break;
        }
      }
    } catch {
      // Ignore invalid url
    }
  }

  const resolvedPath = relativePath ? path.join(uploadsPath, relativePath) : null;
  const exists = resolvedPath ? fs.existsSync(resolvedPath) : false;
  const stat = exists && resolvedPath ? fs.statSync(resolvedPath) : null;

  return res.json({
    success: true,
    data: {
      uploadDir: uploadsPath,
      publicPath: config.upload.publicPath,
      publicUrl: config.upload.publicUrl || null,
      fileParam: fileParam || null,
      urlParam: urlParam || null,
      resolvedRelativePath: relativePath,
      resolvedPath,
      exists,
      size: stat?.size || null,
      lastModified: stat?.mtime?.toISOString?.() || null
    }
  });
};

// Debug endpoint to verify upload path resolution (enabled in dev or when UPLOAD_DEBUG=true)
app.get(`${config.upload.publicPath}/_debug`, handleUploadsDebug);
// Alternate debug path to bypass any /api/uploads filter rules
app.get('/api/debug/uploads', handleUploadsDebug);

// ===========================================
// ROUTES
// ===========================================

// Health check (must be before other routes to avoid middleware)
// Simple health check for Kubernetes probes (doesn't check DB/Redis)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});


app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/user', userDashboardRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', homeRoutes); // handles /api/home/featured and /api/admin/home/*
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api', milestoneRoutes); // exposes /api/deals/:dealId/milestones + /api/milestones/:id
app.use('/api/admin/ai-moderation', aiModerationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/posts', postRoutes);
app.use('/api', commentRoutes);
app.use('/api', reactionRoutes);
app.use('/api', linkPreviewRoutes);
app.use('/api', bookmarkRoutes);
app.use('/api', trendingRoutes);
app.use('/api', searchRoutes);
app.use('/api', recommendationRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/api', apiRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/media', mediaRoutes);
// app.use('/api/download', downloadRoutes); // Moved directly to /api/uploads



// ===========================================
// ERROR HANDLING
// ===========================================

app.use(errorHandler);

// 404 handler (standardized error format)
app.use((req, res) => {
  return sendError(res, 404, 'NOT_FOUND', 'Route not found');
});

// ===========================================
// SOCKET.IO SETUP
// ===========================================

setupSocket(io);

// Make io accessible to routes
app.set('io', io);

// ===========================================
// SERVER START
// ===========================================

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // One-shot prod reset + seed (no-op after it's been run once).
    // TODO: remove this block after the prod DB is cleanly seeded.
    const { runProdResetIfNeeded } = await import('./bootstrap/prod-reset');
    await runProdResetIfNeeded();

    // Initialize vector store
    await initializeVectorStore();
    logInfo('✅ Vector store initialized');

    // Backfill any corrections saved before RAG indexing was deployed
    const { backfillCorrectionVectors } = await import('./controllers/creator/training.controller');
    backfillCorrectionVectors().catch((err: unknown) => logWarning('[Corrections] Backfill error: ' + String(err)));

    // Backfill content chunk vectors lost on server restart (embeddings live in Postgres; SQLite is ephemeral)
    const { backfillContentVectors } = await import('./services/queue/content-processor.worker');
    backfillContentVectors().catch((err: unknown) => logWarning('[ContentBackfill] Backfill error: ' + String(err)));

    // Initialize Redis cache (non-blocking - continues if Redis unavailable)
    await connectRedis();

    if (isContentQueueEnabled) {
      // Initialize Bull queue worker for content processing
      contentQueue.process(3, async (job) => {
        return await processContentJob(job);
      });
      logInfo('✅ Content processing queue worker initialized');

      // Start periodic metrics collection
      setInterval(async () => {
        try {
          await updateQueueMetrics(contentQueue);
        } catch (error) {
          logWarning('[Metrics] Failed to update queue metrics: ' + String(error));
        }
      }, 60000); // Update every minute
      logInfo('✅ Metrics collection initialized');
    } else {
      logInfo('Content processing queue disabled (REDIS_URL not set)');
    }

    if (isChatQueueEnabled) {
      // Initialize Bull queue worker for chat processing
      chatQueue.process(3, async (job) => {
        return await processChatJob(job);
      });
      logInfo('✅ Chat processing queue worker initialized');
    } else {
      logInfo('Chat processing queue disabled (REDIS_HOST/REDIS_URL not set)');
    }

    // Delete TTS audio older than 30 minutes from Cloudinary — runs on startup then every 30 min
    if (isCloudinaryConfigured) {
      cleanupTtsAudio(30).catch(() => {});
      setInterval(() => cleanupTtsAudio(30).catch(() => {}), 30 * 60 * 1000);
      logInfo('✅ Cloudinary TTS audio cleanup scheduled (30 min interval)');
    }

    // Start server
    httpServer.listen(PORT, () => {
      logger.info('='.repeat(50));
      logger.info('🚀 CREATOR PLATFORM SERVER STARTED');
      logger.info('='.repeat(50));
      logger.info(`📍 Server running on: http://localhost:${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔌 Socket.io enabled`);
      logger.info(`💾 Redis cache: ${isRedisConfigured() ? 'enabled' : 'disabled'}`);
      logger.info('='.repeat(50));
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Server startup' });
    process.exit(1);
  }
}

// Forced restart
startServer();

export { io };

