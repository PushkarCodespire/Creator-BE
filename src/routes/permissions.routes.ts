// ===========================================
// PERMISSIONS ROUTES
// ===========================================

import { Router } from 'express';
import {
  getRolePermissionsEndpoint,
  getSpecificRolePermissions,
} from '../controllers/permissions.controller';
import { optionalAuth } from '../middleware/auth';

const router = Router();

// Get current user's role permissions (works for guests too)
router.get('/', optionalAuth, getRolePermissionsEndpoint);

// Get permissions for a specific role (for frontend role comparison)
router.get('/:role', getSpecificRolePermissions);

export default router;
