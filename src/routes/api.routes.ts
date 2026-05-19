// ===========================================
// PUBLIC API ROUTES
// RESTful API for third-party integrations
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { body, param, query } from 'express-validator';
import {
  createAPIKey,
  getAPIKeys,
  revokeAPIKey,
  getAPIUsage,
} from '../controllers/api.controller';

const router = Router();

// API Key Management (Protected)
router.post('/keys', authenticate, validate([
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('permissions').isArray(),
]), createAPIKey);

router.get('/keys', authenticate, getAPIKeys);

router.delete('/keys/:keyId', authenticate, validate([
  param('keyId').isUUID(),
]), revokeAPIKey);

router.get('/keys/:keyId/usage', authenticate, validate([
  param('keyId').isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
]), getAPIUsage);

// Public API endpoints (require API key authentication)
// These would be protected by API key middleware
router.get('/v1/creators', /* apiKeyAuth, */ (req, res) => {
  // Get creators endpoint
  res.json({ message: 'API endpoint - requires implementation' });
});

router.get('/v1/creators/:id', /* apiKeyAuth, */ (req, res) => {
  // Get single creator endpoint
  res.json({ message: 'API endpoint - requires implementation' });
});

router.get('/v1/creators/:id/conversations', /* apiKeyAuth, */ (req, res) => {
  // Get creator conversations (with proper permissions)
  res.json({ message: 'API endpoint - requires implementation' });
});

export default router;



