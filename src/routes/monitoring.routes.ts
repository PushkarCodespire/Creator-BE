// ===========================================
// MONITORING ROUTES
// ===========================================
// Prometheus metrics endpoint and health checks

import { Router, Request, Response } from 'express';
import { metricsRegistry } from '../utils/metrics';
import { getQueueStats } from '../services/queue/content-queue';
import { getVectorCount } from '../utils/vectorStore';
import { sendError } from '../utils/apiResponse';

const router = Router();

/**
 * Prometheus metrics endpoint
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    const metrics = await metricsRegistry.metrics();
    res.end(metrics);
  } catch (_error) {
    sendError(res, 500, 'METRICS_ERROR', 'Failed to generate metrics');
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const queueStats = await getQueueStats();
    const vectorCount = getVectorCount();
    
    res.json({
      success: true,
      status: 'healthy',
      data: {
        queue: queueStats,
        vectorStore: {
          totalVectors: vectorCount
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    sendError(res, 503, 'HEALTH_UNHEALTHY', (error as Error).message);
  }
});

export default router;
