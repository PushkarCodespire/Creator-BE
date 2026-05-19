// ===========================================
// MESSAGE REACTION ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  addReaction,
  removeReaction,
  getMessageReactions,
} from '../controllers/reaction.controller';

const router = Router();

// All reaction routes require authentication
router.use(authenticate);

router.post('/messages/:messageId/reactions', addReaction);           // Add reaction
router.delete('/messages/:messageId/reactions', removeReaction);      // Remove reaction
router.get('/messages/:messageId/reactions', getMessageReactions);    // Get reactions

export default router;
