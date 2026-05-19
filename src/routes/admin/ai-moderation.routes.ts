import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import {
  getAIModerationStats,
  testModeration,
  updateThresholds,
  getAIModerationLogs,
} from '../../controllers/admin/ai-moderation.controller';

const router = Router();

// All routes require admin authentication
router.use(authenticate, requireAdmin);

// GET /api/admin/ai-moderation/stats
router.get('/stats', getAIModerationStats);

// POST /api/admin/ai-moderation/test
router.post('/test', testModeration);

// PUT /api/admin/ai-moderation/thresholds
router.put('/thresholds', updateThresholds);

// GET /api/admin/ai-moderation/logs
router.get('/logs', getAIModerationLogs);

export default router;
