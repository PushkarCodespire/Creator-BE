// ===========================================
// TRENDING ROUTES
// ===========================================

import express from 'express';
import {
  getTrendingPostsController,
  getTrendingCreatorsController,
  getTrendingHashtagsController,
  getCategoryTrendingController,
  getTrendingStatsController,
} from '../controllers/trending.controller';

const router = express.Router();

// Get trending posts
router.get('/trending/posts', getTrendingPostsController);

// Get trending creators
router.get('/trending/creators', getTrendingCreatorsController);

// Get trending hashtags
router.get('/trending/hashtags', getTrendingHashtagsController);

// Get category-specific trending
router.get('/trending/category/:category', getCategoryTrendingController);

// Get trending stats overview
router.get('/trending/stats', getTrendingStatsController);

export default router;
