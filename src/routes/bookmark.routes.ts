// ===========================================
// MESSAGE BOOKMARK ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  addBookmark,
  removeBookmark,
  getUserBookmarks,
  getBookmarkRecommendations,
} from '../controllers/bookmark.controller';

const router = Router();

// All bookmark routes require authentication
router.use(authenticate);

router.post('/messages/:messageId/bookmark', addBookmark);           // Add/update bookmark
router.delete('/messages/:messageId/bookmark', removeBookmark);      // Remove bookmark
router.get('/bookmarks', getUserBookmarks);                          // Get user's bookmarks
router.get('/bookmarks/recommendations', getBookmarkRecommendations); // Get bookmark recommendations

export default router;
