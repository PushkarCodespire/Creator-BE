// ===========================================
// HOME PAGE ROUTES
// Public: GET /home/featured
// Admin:  GET  /admin/home/creators
//         PUT  /admin/home/featured
// ===========================================

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  getHomeFeatured,
  getAllCreatorsForHome,
  updateHomeFeatured,
} from '../controllers/home.controller';

const router = Router();

// Public
router.get('/home/featured', getHomeFeatured);

// Admin
router.get('/admin/home/creators', authenticate, requireAdmin, getAllCreatorsForHome);
router.put('/admin/home/featured', authenticate, requireAdmin, updateHomeFeatured);

export default router;
