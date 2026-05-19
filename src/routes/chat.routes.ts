// ===========================================
// CHAT ROUTES
// ===========================================

import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  startConversation,
  getConversation,
  getUserConversations,
  editMessage,
  deleteMessage,
  sendMessage
} from '../controllers/chat.controller';
import { getRateLimitStatus } from '../controllers/chat/chat-request.controller';
import { authenticate, optionalAuth } from '../middleware/auth';
import { autoModerateContent, checkUserModeration } from '../middleware/ai-moderation.middleware';
import { validate } from '../middleware/validation';

const router = Router();

// Validation rules
const startConversationValidation = [
  body('creatorId')
    .isUUID()
    .withMessage('Valid creator ID is required'),
];

const sendMessageValidation = [
  body('conversationId')
    .isUUID()
    .withMessage('Valid conversation ID is required'),
  body('content')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Message must be less than 2000 characters'),
  body('media')
    .optional()
    .isArray()
    .withMessage('Media must be an array'),
  body().custom((value) => {
    if (!value.content && (!value.media || value.media.length === 0)) {
      throw new Error('Message content or media is required');
    }
    return true;
  }),
];

const conversationIdValidation = [
  param('conversationId')
    .isUUID()
    .withMessage('Valid conversation ID is required'),
];

const messageIdValidation = [
  param('messageId')
    .isUUID()
    .withMessage('Valid message ID is required'),
];

const editMessageValidation = [
  body('content')
    .trim()
    .notEmpty()
    .withMessage('Message content is required')
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters'),
];

// Start or get conversation (works for guests too)
router.post('/start', optionalAuth, validate(startConversationValidation), startConversation);
router.post('/conversations', optionalAuth, validate(startConversationValidation), startConversation);

// Send message (works for guests too)
router.post(
  '/message',
  optionalAuth,
  checkUserModeration,
  validate(sendMessageValidation),
  autoModerateContent('content', 'MESSAGE'),
  sendMessage
);

// Rate limits
router.get('/rate-limit/status', optionalAuth, getRateLimitStatus);

// Get specific conversation
router.get('/conversation/:conversationId', optionalAuth, validate(conversationIdValidation), getConversation);

// Get all user's conversations (requires auth)
router.get('/conversations', authenticate, getUserConversations);

// Edit message (requires auth)
router.put('/message/:messageId', authenticate, validate([...messageIdValidation, ...editMessageValidation]), editMessage);

// Delete message (requires auth)
router.delete('/message/:messageId', authenticate, validate(messageIdValidation), deleteMessage);

export default router;
