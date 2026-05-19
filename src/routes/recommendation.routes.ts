// ===========================================
// RECOMMENDATION ROUTES
// ===========================================

import express from 'express';
import {
  getRecommendedCreators,
  getSimilarCreatorsController,
  getRecommendedPostsController,
  getForYouRecommendations,
  getCategoryRecommendations,
} from '../controllers/recommendation.controller';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = express.Router();

// Get personalized creator recommendations (requires auth)
router.get('/recommendations/creators', authenticate, getRecommendedCreators);

// Get similar creators for a specific creator
router.get('/recommendations/creators/:creatorId/similar', getSimilarCreatorsController);

// Get recommended posts (requires auth)
router.get('/recommendations/posts', authenticate, getRecommendedPostsController);

// Get "For You" recommendations (works with or without auth)
router.get('/recommendations/for-you', optionalAuth, getForYouRecommendations);

// Get category-based recommendations
router.get('/recommendations/category/:category', getCategoryRecommendations);

export default router;
