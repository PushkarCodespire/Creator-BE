// ===========================================
// GAMIFICATION ROUTES
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getUserAchievements,
  getLeaderboard,
  checkAchievements,
} from '../controllers/gamification.controller';

const router = Router();

// Get user's achievements
router.get('/achievements', authenticate, getUserAchievements);

// Get leaderboard
router.get('/leaderboard', getLeaderboard);

// Check and unlock achievements (called after events)
router.post('/check', authenticate, checkAchievements);

export default router;



