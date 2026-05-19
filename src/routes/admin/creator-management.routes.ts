// ===========================================
// CREATOR MANAGEMENT ROUTES (ADMIN)
// ===========================================

import { Router } from 'express';
import * as controller from '../../controllers/admin/creator-management.controller';

const router = Router();

// Dashboard
router.get('/creators/dashboard', controller.getCreatorDashboard);

// Creator list & pending
router.get('/creators', controller.listCreators);
router.get('/creators/pending', controller.getPendingCreators);

// Creator details & updates
router.get('/creators/:creatorId', controller.getCreatorDetails);
router.put('/creators/:creatorId', controller.updateCreator);
router.put('/creators/:creatorId/profile', controller.updateCreatorProfile);
router.put('/creators/:creatorId/ai-config', controller.updateCreatorAIConfig);
router.post('/creators/:creatorId/verify', controller.verifyCreator);
router.patch('/creators/:creatorId/verify', controller.toggleCreatorVerification);
router.patch('/creators/:creatorId/status', controller.toggleCreatorStatus);
router.post('/creators/:creatorId/reject', controller.rejectCreator);

// Analytics
router.get('/creators/:creatorId/analytics', controller.getCreatorAnalytics);

// Subscribers
router.get('/creators/:creatorId/subscribers', controller.getCreatorSubscribers);

// Revenue
router.get('/creators/:creatorId/revenue', controller.getCreatorRevenue);

// Payout
router.get('/creators/:creatorId/payout-config', controller.getPayoutConfig);
router.put('/creators/:creatorId/payout-config', controller.updatePayoutConfig);
router.post('/creators/:creatorId/process-payout', controller.processManualPayout);

// Monitoring
router.get('/creators/:creatorId/conversations', controller.getCreatorConversations);
router.get('/conversations/:conversationId/messages', controller.getConversationDetails);

// Testing
router.post('/creators/:creatorId/test-chat', controller.testCreatorAI);

// Pricing
router.get('/creators/:creatorId/pricing', controller.getPricingConfig);
router.put('/creators/:creatorId/pricing', controller.updatePricingConfig);
router.get('/creators/:creatorId/pricing-history', controller.getPricingHistory);

// Content
router.get('/creators/:creatorId/content', controller.getCreatorContent);
router.get('/creators/:creatorId/contents', controller.getCreatorContent);
router.delete('/creators/:creatorId/content/:contentId', controller.deleteCreatorContent);

export default router;
