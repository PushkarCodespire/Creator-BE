// ===========================================
// AUTH ROUTES
// ===========================================

import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  getCurrentUser,
  updateProfile,
  changePassword,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  becomeCreator
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// Validation rules
const registerValidation = [
  body('email')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail()
    .custom(async (value: string) => {
      const domain = value.split('@')[1]?.toLowerCase();
      if (!domain) throw new Error('Please enter a valid email address');

      // Reject known disposable/temporary email providers
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const disposable = require('disposable-email-domains') as string[];
      if (disposable.includes(domain)) {
        throw new Error('Disposable email addresses are not allowed. Please use a real email address.');
      }

      // Reject obscure/low-quality free email providers not covered by the disposable list
      const supplementaryBlocklist = new Set([
        'email.com', 'mail.com', 'inbox.com', 'gmx.com', 'gmx.net', 'gmx.de',
        'fastmail.cn', 'hailmail.net', 'iname.com', 'inoutbox.com', 'internetemails.net',
        'mailandftp.com', 'mailbolt.com', 'mailc.net', 'mailite.com', 'mailsent.net',
        'mailservice.ms', 'mailvault.com', 'ml1.net', 'mm.st', 'myfastmail.com',
        'proinbox.com', 'promessage.com', 'realemail.net', 'speedymail.org',
        'swift-mail.com', 'the-fastest.net', 'xsmail.com', 'yepmail.net', 'your-mail.com',
      ]);
      if (supplementaryBlocklist.has(domain)) {
        throw new Error('Please use a widely recognised email provider (e.g. Gmail, Outlook, Yahoo).');
      }

      // Detect typos of popular email providers using Levenshtein distance
      const popularDomains = [
        'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
        'live.com', 'msn.com', 'apple.com', 'protonmail.com', 'zoho.com',
        'aol.com', 'ymail.com', 'googlemail.com', 'me.com', 'mac.com',
      ];
      const lev = (a: string, b: string): number => {
        const m = a.length, n = b.length;
        const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
          Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= m; i++)
          for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1]
              ? dp[i - 1][j - 1]
              : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        return dp[m][n];
      };
      // Collapse repeated consecutive characters before distance check
      // e.g. giiimail.com → gimail.com, hotmaill.com → hotmail.com
      const normalize = (s: string) => s.replace(/(.)\1+/g, '$1');
      const normalizedDomain = normalize(domain);
      if (!popularDomains.includes(domain)) {
        for (const popular of popularDomains) {
          if (lev(normalizedDomain, popular) <= 2) {
            throw new Error(`Please check your email address — did you mean @${popular}?`);
          }
        }
      }

      // Verify the domain has MX records (can actually receive email)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dns = require('dns').promises as { resolveMx: (d: string) => Promise<{ exchange: string }[]> };

      // Known domain-parking MX providers — these accept mail for squatted/typo domains
      const parkingMxPatterns = [
        'above.com', 'sedoparking.com', 'parkingcrew.net', 'bodis.com',
        'smartname.com', 'afternic.com', 'hugedomains.com', 'sav.com',
        'domaincontrol.com', 'parklogic.com', 'parked.com', 'namedrive.com',
      ];

      try {
        const records = await Promise.race([
          dns.resolveMx(domain),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), 3000)
          ),
        ]);
        if (!Array.isArray(records) || records.length === 0) {
          throw new Error('This email domain cannot receive email. Please use a valid email address.');
        }
        // Reject domains whose MX points to a parking service
        const isParked = records.some(r =>
          parkingMxPatterns.some(p => r.exchange.toLowerCase().endsWith(p))
        );
        if (isParked) {
          throw new Error('This email domain does not exist. Please use a valid email address.');
        }
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'TIMEOUT') return true; // Don't block on slow DNS
        if (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'ESERVFAIL') {
          throw new Error('This email domain does not exist. Please use a valid email address.');
        }
        // Re-throw our own validation errors
        if (e.message && !e.code) throw err;
        // For other unexpected DNS errors be lenient — don't block registration
      }
      return true;
    }),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('role')
    .optional()
    .isIn(['USER', 'CREATOR', 'COMPANY'])
    .withMessage('Role must be USER, CREATOR, or COMPANY'),
  body('dateOfBirth')
    .notEmpty().withMessage('Date of birth is required')
    .custom((value: string) => {
      const dob = new Date(value);
      if (isNaN(dob.getTime())) throw new Error('Invalid date of birth');
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      if (age < 18) throw new Error('You must be at least 18 years old to register.');
      if (age > 100) throw new Error('Please enter a valid date of birth.');
      return true;
    }),
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .custom((value: string) => {
      const cleaned = value.replace(/[\s\-\(\)\.]/g, '');
      if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
        throw new Error('Please enter a valid phone number (e.g. +91 9876543210)');
      }
      return true;
    }),
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('avatar')
    .optional()
    .isURL()
    .withMessage('Avatar must be a valid URL'),
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain uppercase, lowercase, and number')
    .custom((value, { req }) => value !== req.body.currentPassword)
    .withMessage('New password must be different from current password'),
];

const verifyEmailValidation = [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required')
    .isLength({ min: 32, max: 128 })
    .withMessage('Invalid token format'),
];

const forgotPasswordValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
];

const resetPasswordValidation = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 32, max: 128 })
    .withMessage('Invalid token format'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
];

// Public routes
router.post('/register', validate(registerValidation), register);
router.post('/login', validate(loginValidation), login);
router.post('/verify-email', validate(verifyEmailValidation), verifyEmail);
router.post('/forgot-password', validate(forgotPasswordValidation), forgotPassword);
router.post('/reset-password', validate(resetPasswordValidation), resetPassword);

// Protected routes
router.get('/me', authenticate, getCurrentUser);
router.put('/profile', authenticate, validate(updateProfileValidation), updateProfile);
router.put('/password', authenticate, validate(changePasswordValidation), changePassword);
router.post('/resend-verification', authenticate, resendVerification);
router.post('/become-creator', authenticate, becomeCreator);

export default router;
