// ===========================================
// SEARCH ROUTES
// ===========================================

import express from 'express';
import {
  globalSearch,
  autocompleteSearch,
  getPopularSearchesController,
  getSearchSuggestions,
} from '../controllers/search.controller';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Global search
router.get('/search', globalSearch);

// Autocomplete search
router.get('/search/autocomplete', autocompleteSearch);

// Get popular searches
router.get('/search/popular', getPopularSearchesController);

// Get personalized search suggestions
router.get('/search/suggestions', authenticate, getSearchSuggestions);

export default router;
