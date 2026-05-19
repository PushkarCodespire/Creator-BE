// ===========================================
// PAYOUT ROUTES
// ===========================================

import { Router } from 'express';
import { body } from 'express-validator';
import {
  addBankAccount,
  getBankAccount,
  requestPayout,
  getPayoutHistory,
  getPayoutDetails,
  cancelPayout,
  getEarnings,
  getEarningsLedger,
  handlePayoutWebhook
} from '../controllers/payout.controller';
import { authenticate, requireCreator } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// ===========================================
// VALIDATION RULES
// ===========================================

const bankAccountValidation = [
  body('accountHolderName')
    .trim()
    .notEmpty()
    .withMessage('Account holder name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Account holder name must be between 2 and 100 characters'),
  body('accountNumber')
    .trim()
    .notEmpty()
    .withMessage('Account number is required')
    .isLength({ min: 9, max: 18 })
    .withMessage('Invalid account number length')
    .matches(/^[0-9]+$/)
    .withMessage('Account number must contain only numbers'),
  body('ifscCode')
    .trim()
    .notEmpty()
    .withMessage('IFSC code is required')
    .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .withMessage('Invalid IFSC code format'),
  body('bankName')
    .trim()
    .notEmpty()
    .withMessage('Bank name is required'),
  body('accountType')
    .optional()
    .isIn(['SAVINGS', 'CURRENT'])
    .withMessage('Account type must be SAVINGS or CURRENT'),
  body('panNumber')
    .optional()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage('Invalid PAN number format'),
  body('aadharLast4')
    .optional()
    .matches(/^[0-9]{4}$/)
    .withMessage('Aadhar last 4 digits must be 4 numbers')
];

const requestPayoutValidation = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number')
];

// ===========================================
// ROUTES
// ===========================================

// Bank Account Management (Creator only)
router.post(
  '/bank-account',
  authenticate,
  requireCreator,
  validate(bankAccountValidation),
  addBankAccount
);

router.get(
  '/bank-account',
  authenticate,
  requireCreator,
  getBankAccount
);

// Payout Requests (Creator only)
router.post(
  '/request',
  authenticate,
  requireCreator,
  validate(requestPayoutValidation),
  requestPayout
);

router.get(
  '/',
  authenticate,
  requireCreator,
  getPayoutHistory
);

router.get(
  '/:id',
  authenticate,
  requireCreator,
  getPayoutDetails
);

router.delete(
  '/:id',
  authenticate,
  requireCreator,
  cancelPayout
);

// Earnings (Creator only)
router.get(
  '/earnings/breakdown',
  authenticate,
  requireCreator,
  getEarnings
);

router.get(
  '/earnings/ledger',
  authenticate,
  requireCreator,
  getEarningsLedger
);

// Webhook (Public - Razorpay will call this)
router.post('/webhook', handlePayoutWebhook);

export default router;
