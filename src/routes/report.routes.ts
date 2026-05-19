// ===========================================
// REPORT ROUTES (USER-FACING)
// ===========================================

import { Router } from 'express';
import { body } from 'express-validator';
import {
  reportMessage,
  reportUser,
  reportCreator,
  getMyReports
} from '../controllers/report.controller';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// ===========================================
// VALIDATION RULES
// ===========================================

const reportMessageValidation = [
  body('messageId')
    .notEmpty()
    .withMessage('Message ID is required')
    .isUUID()
    .withMessage('Invalid message ID'),
  body('reason')
    .notEmpty()
    .withMessage('Reason is required')
    .isIn(['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'SEXUAL_CONTENT', 'VIOLENCE', 'MISINFORMATION', 'IMPERSONATION', 'SCAM', 'COPYRIGHT', 'OTHER'])
    .withMessage('Invalid reason'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters')
];

const reportUserValidation = [
  body('targetUserId')
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('Invalid user ID'),
  body('reason')
    .notEmpty()
    .withMessage('Reason is required')
    .isIn(['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'SEXUAL_CONTENT', 'VIOLENCE', 'MISINFORMATION', 'IMPERSONATION', 'SCAM', 'COPYRIGHT', 'OTHER'])
    .withMessage('Invalid reason'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters')
];

const reportCreatorValidation = [
  body('creatorId')
    .notEmpty()
    .withMessage('Creator ID is required')
    .isUUID()
    .withMessage('Invalid creator ID'),
  body('reason')
    .notEmpty()
    .withMessage('Reason is required')
    .isIn(['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'SEXUAL_CONTENT', 'VIOLENCE', 'MISINFORMATION', 'IMPERSONATION', 'SCAM', 'COPYRIGHT', 'OTHER'])
    .withMessage('Invalid reason'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters')
];

// ===========================================
// ROUTES
// ===========================================

// Report message (optional auth for guests)
router.post(
  '/message',
  optionalAuth,
  validate(reportMessageValidation),
  reportMessage
);

// Report user (requires auth)
router.post(
  '/user',
  authenticate,
  validate(reportUserValidation),
  reportUser
);

// Report creator (optional auth)
router.post(
  '/creator',
  optionalAuth,
  validate(reportCreatorValidation),
  reportCreator
);

// Get my reports (requires auth)
router.get(
  '/my-reports',
  authenticate,
  getMyReports
);

export default router;
