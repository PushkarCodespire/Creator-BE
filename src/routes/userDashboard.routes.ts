// ===========================================
// USER DASHBOARD ROUTES
// Centralized routes for user panel
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as dashboardController from '../controllers/userDashboard.controller';
import * as subscriptionController from '../controllers/subscription.controller';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

// ===========================================
// DASHBOARD OVERVIEW
// ===========================================
router.get('/dashboard/stats', dashboardController.getDashboardStats);
router.get('/dashboard/conversations/recent', dashboardController.getRecentConversations);
router.get('/dashboard/recommendations/creators', dashboardController.getRecommendedCreators);
router.get('/dashboard/activity-feed', dashboardController.getActivityFeed);

// ===========================================
// SUBSCRIPTION MANAGEMENT
// ===========================================
router.get('/subscription/details', subscriptionController.getSubscriptionDetails);
router.get('/subscription/features', subscriptionController.getPlanFeatures);
router.get('/subscription/transactions', subscriptionController.getTransactionHistory);
router.get('/subscription/usage-analytics', subscriptionController.getUsageAnalytics);

export default router;
