// ===========================================
// FOLLOW ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as followController from '../controllers/follow.controller';

const router = Router();

// Follow/Unfollow (requires authentication)
router.post('/:creatorId', authenticate, followController.followCreator);
router.delete('/:creatorId', authenticate, followController.unfollowCreator);

// Check if following (optional authentication)
router.get('/check/:creatorId', followController.checkFollowing);

// Get followers/following lists
router.get('/users/:userId/followers', followController.getFollowers);
router.get('/users/:userId/following', followController.getFollowing);
router.get('/users/:userId/stats', followController.getFollowStats);

// Get creator suggestions (requires authentication)
router.get('/suggestions', authenticate, followController.getCreatorSuggestions);

export default router;
