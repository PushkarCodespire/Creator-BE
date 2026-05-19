// ===========================================
// MILESTONE ROUTES
// ===========================================
// Mounted at /api (not /api/milestones) so the endpoints live at:
//   GET    /api/deals/:dealId/milestones
//   POST   /api/deals/:dealId/milestones
//   PATCH  /api/milestones/:id
//   DELETE /api/milestones/:id
// ===========================================

import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone
} from '../controllers/milestone.controller';

const router = Router();

const dealIdValidation = [
  param('dealId').isUUID().withMessage('Valid deal ID is required')
];

const milestoneIdValidation = [
  param('id').isUUID().withMessage('Valid milestone ID is required')
];

// Deal-scoped — list + create
router.get('/deals/:dealId/milestones', authenticate, validate(dealIdValidation), listMilestones);
router.post('/deals/:dealId/milestones', authenticate, validate(dealIdValidation), createMilestone);

// Milestone-scoped — update + delete
router.patch('/milestones/:id', authenticate, validate(milestoneIdValidation), updateMilestone);
router.delete('/milestones/:id', authenticate, validate(milestoneIdValidation), deleteMilestone);

export default router;
