// ===========================================
// POST ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { autoModerateContent, checkUserModeration } from '../middleware/ai-moderation.middleware';
import * as postController from '../controllers/post.controller';

const router = Router();

// Post CRUD (requires authentication for create/update/delete)
router.post('/', authenticate, checkUserModeration, autoModerateContent('content', 'POST'), postController.createPost);
router.get('/', postController.getFeed); // Optional auth for personalized feed
router.get('/stats/overview', authenticate, postController.getCreatorPostStats);
router.get('/:id', postController.getPost);
router.put('/:id', authenticate, postController.updatePost);
router.delete('/:id', authenticate, postController.deletePost);

// Like functionality (requires authentication)
router.post('/:id/like', authenticate, postController.likePost);
router.delete('/:id/like', authenticate, postController.unlikePost);
router.get('/:id/likes', postController.getPostLikes);

export default router;
