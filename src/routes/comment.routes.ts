// ===========================================
// COMMENT ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { autoModerateContent, checkUserModeration } from '../middleware/ai-moderation.middleware';
import {
  createComment,
  getComments,
  getReplies,
  updateComment,
  deleteComment,
  likeComment,
  unlikeComment,
} from '../controllers/comment.controller';

const router = Router();

// All comment routes require authentication
router.use(authenticate);

// Comment CRUD
router.post('/posts/:postId/comments', checkUserModeration, autoModerateContent('content', 'COMMENT'), createComment);           // Create comment
router.get('/posts/:postId/comments', getComments);              // Get comments for post
router.get('/comments/:commentId/replies', getReplies);          // Get replies for comment
router.put('/comments/:commentId', updateComment);               // Update comment
router.delete('/comments/:commentId', deleteComment);            // Delete comment

// Comment likes
router.post('/comments/:commentId/like', likeComment);           // Like comment
router.delete('/comments/:commentId/like', unlikeComment);       // Unlike comment

export default router;
