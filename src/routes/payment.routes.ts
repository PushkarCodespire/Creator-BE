// ===========================================
// PAYMENT ROUTES - Razorpay Integration
// ===========================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createOrder,
  verifyPayment,
  handleWebhook,
  getPaymentStatus
} from '../controllers/payment.controller';

const router = Router();

// ===========================================
// PROTECTED ROUTES (Require Authentication)
// ===========================================

// Create payment order
router.post('/create-order', authenticate, createOrder);

// Verify payment after Razorpay checkout
router.post('/verify', authenticate, verifyPayment);

// Get payment status by order ID
router.get('/status/:orderId', authenticate, getPaymentStatus);

// ===========================================
// WEBHOOK ROUTE (No Authentication - Razorpay calls this)
// ===========================================

// Razorpay webhook for payment notifications
router.post('/webhook', handleWebhook);

export default router;
