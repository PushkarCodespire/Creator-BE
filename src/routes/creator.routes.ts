// ===========================================
// CREATOR ROUTES
// ===========================================

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  getCreators,
  getCreator,
  getCreatorDashboard,
  getOnboardingStatus,
  updateCreatorProfile,
  getCreatorAnalytics,
  getUserRetentionAnalytics,
  getRevenueForecast,
  getActivityHeatmap,
  getConversionFunnel,
  getComparativeAnalytics,
  getCategories,
  getCreatorContent,
  getCreatorApplications,
  getCreatorReviews,
  addCreatorReview,
  updateCreatorReview,
  deleteCreatorReview,
  getFollowers,
  removeFollower,
  getEngagementTrend,
  getMyConversations,
  getMyConversationDetails,
  setConversationMode,
  replyAsCreator,
  generateAiReplyForLastMessage,
  generateBio,
  generateAiPersonality
} from '../controllers/creator.controller';
import {
  getCorrections,
  saveCorrection,
  toggleCorrection,
  deleteCorrection,
  getTrainingStatus,
  startFineTune,
} from '../controllers/creator/training.controller';
import { authenticate, requireCreator } from '../middleware/auth';
import { autoModerateContent } from '../middleware/ai-moderation.middleware';
import { validate } from '../middleware/validation';
import { cacheMiddleware } from '../middleware/cache';

const router = Router();

// Validation rules
const getCreatorsValidation = [
  query('category').optional().trim().isLength({ max: 100 }),
  query('search').optional().trim().isLength({ max: 200 }),
  query('verified').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const creatorIdValidation = [
  param('id').isUUID().withMessage('Valid creator ID is required'),
];

const reviewQueryValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('sort').optional().isIn(['newest', 'oldest', 'highest', 'lowest'])
];

const reviewBodyValidation = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Comment must not exceed 2000 characters')
];

const followerIdValidation = [
  param('followerId').isUUID().withMessage('Valid follower ID is required'),
];

const engagementTrendValidation = [
  query('days').optional().isInt({ min: 1, max: 90 })
];

const updateProfileValidation = [
  body('displayName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Display name must be between 2 and 100 characters'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Bio must not exceed 1000 characters'),
  body('tagline')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Tagline must not exceed 200 characters'),
  body('category')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Category must not exceed 100 characters'),
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Maximum 10 tags allowed'),
  body('tags.*')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each tag must be between 1 and 50 characters'),
  body('youtubeUrl')
    .optional()
    .isURL()
    .withMessage('Valid YouTube URL required'),
  body('instagramUrl')
    .optional()
    .isURL()
    .withMessage('Valid Instagram URL required'),
  body('twitterUrl')
    .optional()
    .isURL()
    .withMessage('Valid Twitter URL required'),
  body('websiteUrl')
    .optional()
    .isURL()
    .withMessage('Valid website URL required'),
  body('profileImage')
    .optional()
    .custom((value) => {
      // If value is provided, validate it
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new Error('Profile image must be a non-empty string');
        }
        // Check if it's a valid URL
        try {
          new URL(value);
          return true; // Valid full URL
        } catch {
          // If not a full URL, check if it's a valid relative path
          if (value.startsWith('/') && value.length > 1) {
            return true; // Valid relative path
          }
          throw new Error('Profile image must be a valid URL or relative path (e.g., /uploads/avatars/filename.jpg or https://example.com/image.jpg)');
        }
      }
      return true; // Value is optional, so undefined/null is valid
    }),
  body('coverImage')
    .optional()
    .custom((value) => {
      // If value is provided, validate it
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new Error('Cover image must be a non-empty string');
        }
        // Check if it's a valid URL
        try {
          new URL(value);
          return true; // Valid full URL
        } catch {
          // If not a full URL, check if it's a valid relative path
          if (value.startsWith('/') && value.length > 1) {
            return true; // Valid relative path
          }
          throw new Error('Cover image must be a valid URL or relative path (e.g., /uploads/content/filename.jpg or https://example.com/image.jpg)');
        }
      }
      return true; // Value is optional, so undefined/null is valid
    }),
  body('aiPersonality')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('AI personality must not exceed 2000 characters'),
  body('aiTone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage('AI tone must not exceed 200 characters'),
  body('pricePerMessage')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Price per message must be a non-negative integer'),
  body('firstMessageFree')
    .optional()
    .isBoolean()
    .withMessage('firstMessageFree must be a boolean'),
  body('discountFirstFive')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Discount must be between 0 and 100'),
  body('welcomeMessage')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Welcome message must not exceed 500 characters'),
];

// Protected routes that must come before /:id to avoid conflict
router.get('/applications', authenticate, requireCreator, getCreatorApplications);
router.get('/followers', authenticate, requireCreator, getFollowers);
router.delete('/followers/:followerId', authenticate, requireCreator, validate(followerIdValidation), removeFollower);

// Creator chat inbox (read-only) - must come before /:id to avoid conflict
router.get('/conversations/me', authenticate, requireCreator, getMyConversations);
router.get('/conversations/me/:conversationId', authenticate, requireCreator, getMyConversationDetails);

// Manual takeover: toggle AI/MANUAL mode + reply manually as the human creator
router.post('/conversations/me/:conversationId/mode', authenticate, requireCreator, setConversationMode);
router.post('/conversations/me/:conversationId/reply', authenticate, requireCreator, replyAsCreator);
// Generate an AI reply for a queued/unanswered fan message (post-MANUAL release)
router.post('/conversations/me/:conversationId/generate-ai-reply', authenticate, requireCreator, generateAiReplyForLastMessage);

// AI generation (must come before /:id to avoid conflict)
router.post('/generate-bio', authenticate, requireCreator, generateBio);
router.post('/generate-ai-personality', authenticate, requireCreator, generateAiPersonality);

// ── AI Training (corrections + fine-tune) ──────────────────────────────────
router.get('/training/corrections',                  authenticate, requireCreator, getCorrections);
router.post('/training/correct',                     authenticate, requireCreator, saveCorrection);
router.patch('/training/corrections/:id/toggle',     authenticate, requireCreator, toggleCorrection);
router.delete('/training/corrections/:id',           authenticate, requireCreator, deleteCorrection);
router.get('/training/status',                       authenticate, requireCreator, getTrainingStatus);
router.post('/training/fine-tune',                   authenticate, requireCreator, startFineTune);

// Public routes (with caching)
router.get('/', cacheMiddleware(300), validate(getCreatorsValidation), getCreators); // Cache 5 mins
router.get('/categories', cacheMiddleware(600), getCategories); // Cache 10 mins
router.put('/:id/reviews/:reviewId', authenticate, validate([...creatorIdValidation, param('reviewId').isUUID().withMessage('Valid review ID is required'), ...reviewBodyValidation]), updateCreatorReview);
router.delete('/:id/reviews/:reviewId', authenticate, validate([...creatorIdValidation, param('reviewId').isUUID().withMessage('Valid review ID is required')]), deleteCreatorReview);
router.get('/:id/reviews', cacheMiddleware(300), validate([...creatorIdValidation, ...reviewQueryValidation]), getCreatorReviews); // Cache 5 mins
router.post('/:id/reviews', authenticate, validate([...creatorIdValidation, ...reviewBodyValidation]), addCreatorReview);
router.get('/:id', cacheMiddleware(600), validate(creatorIdValidation), getCreator); // Cache 10 mins
router.get('/:id/content', cacheMiddleware(600), validate(creatorIdValidation), getCreatorContent); // Cache 10 mins

// Protected routes (Creator only)
router.get('/onboarding/status', authenticate, requireCreator, getOnboardingStatus); // No cache - real-time data
router.get('/dashboard/me', authenticate, requireCreator, getCreatorDashboard); // No cache - real-time data
router.put('/profile', authenticate, requireCreator, validate(updateProfileValidation), autoModerateContent('bio', 'CREATOR_BIO'), updateCreatorProfile);
router.get('/analytics/me', authenticate, requireCreator, cacheMiddleware(300), getCreatorAnalytics); // Cache 5 mins
router.get('/analytics/engagement', authenticate, requireCreator, cacheMiddleware(300), validate(engagementTrendValidation), getEngagementTrend); // Cache 5 mins

// Advanced analytics routes (Creator only)
router.get('/analytics/retention', authenticate, requireCreator, cacheMiddleware(600), getUserRetentionAnalytics); // Cache 10 mins
router.get('/analytics/forecast', authenticate, requireCreator, cacheMiddleware(600), getRevenueForecast); // Cache 10 mins
router.get('/analytics/activity-heatmap', authenticate, requireCreator, cacheMiddleware(300), getActivityHeatmap); // Cache 5 mins
router.get('/analytics/conversion-funnel', authenticate, requireCreator, cacheMiddleware(600), getConversionFunnel); // Cache 10 mins
router.get('/analytics/comparison', authenticate, requireCreator, cacheMiddleware(300), getComparativeAnalytics); // Cache 5 mins

export default router;
