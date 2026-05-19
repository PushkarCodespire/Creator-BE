// ===========================================
// SECURITY MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() }
  }
}));
const mockValidatePasswordUtil = jest.fn();
jest.mock('../../../utils/jwt', () => ({
  validatePassword: mockValidatePasswordUtil
}));

import {
  validatePassword,
  sanitizeInput,
  sanitizeInputs,
  validateEmail,
  isDisposableEmail,
  validatePhone,
  securityHeaders,
  checkPasswordStrength,
  userLoginRateLimit,
  sessionHijackingProtection,
  requireEmailVerification,
  AccountLockout,
  SuspiciousActivityMonitor,
  PasswordHistory,
  MultiFactorAuth,
  PASSWORD_REQUIREMENTS
} from '../../../middleware/security';
import prisma from '../../../../prisma/client';

const createMockReq = (overrides: Partial<Request> = {}): Request => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  ...overrides
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

const validatePasswordImpl = (password: string) => {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters long');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/\d/.test(password)) errors.push('Password must contain at least one number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least one special character');
  const common = ['password', '12345678', 'qwerty', 'admin'];
  if (common.some(c => password.toLowerCase().includes(c))) errors.push('Password is too common');
  return { isValid: errors.length === 0, errors };
};

describe('Security Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidatePasswordUtil.mockImplementation(validatePasswordImpl);
  });

  // ===========================================
  // sanitizeInput
  // ===========================================
  describe('sanitizeInput', () => {
    it('should strip HTML tags from strings', () => {
      const result = sanitizeInput('<script>alert("XSS")</script>Hello');
      expect(result).toBe('Hello');
    });

    it('should trim whitespace', () => {
      const result = sanitizeInput('  hello  ');
      expect(result).toBe('hello');
    });

    it('should sanitize nested objects', () => {
      const input = {
        name: '<b>John</b>',
        nested: { bio: '<script>alert("x")</script>Bio' }
      };
      const result = sanitizeInput(input) as any;
      expect(result.name).toBe('John');
      expect(result.nested.bio).toBe('Bio');
    });

    it('should sanitize arrays', () => {
      const input = ['<b>Hello</b>', '<script>XSS</script>World'];
      const result = sanitizeInput(input) as string[];
      expect(result).toEqual(['Hello', 'World']);
    });

    it('should return null for null input', () => {
      expect(sanitizeInput(null)).toBeNull();
    });

    it('should return undefined for undefined input', () => {
      expect(sanitizeInput(undefined)).toBeUndefined();
    });

    it('should return numbers unchanged', () => {
      expect(sanitizeInput(42)).toBe(42);
    });

    it('should return booleans unchanged', () => {
      expect(sanitizeInput(true)).toBe(true);
    });

    it('should handle empty string', () => {
      expect(sanitizeInput('')).toBe('');
    });
  });

  // ===========================================
  // sanitizeInputs middleware
  // ===========================================
  describe('sanitizeInputs', () => {
    it('should sanitize req.body', () => {
      const req = createMockReq({
        body: { name: '<script>XSS</script>John' }
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeInputs(req, res, next);

      expect(req.body.name).toBe('John');
      expect(next).toHaveBeenCalled();
    });

    it('should sanitize req.query', () => {
      const req = createMockReq({
        query: { search: '<b>query</b>' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeInputs(req, res, next);

      expect(req.query.search).toBe('query');
      expect(next).toHaveBeenCalled();
    });

    it('should sanitize req.params', () => {
      const req = createMockReq({
        params: { id: '<script>1</script>' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeInputs(req, res, next);

      expect(req.params.id).toBe('');
      expect(next).toHaveBeenCalled();
    });

    it('should handle missing body/query/params', () => {
      const req = { body: undefined, query: undefined, params: undefined } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      sanitizeInputs(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // validatePassword
  // ===========================================
  describe('validatePassword', () => {
    it('should accept a valid strong password', () => {
      const result = validatePassword('Str0ng!Pass');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject passwords with forbidden patterns', () => {
      // 'asdfgh' is in PASSWORD_REQUIREMENTS.forbiddenPatterns but NOT in the basic
      // mock's commonPasswords, so basic validation passes and the enhanced check catches it.
      const result = validatePassword('Asdfgh1!XXX');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('common pattern'))).toBe(true);
    });

    it('should reject passwords with too many consecutive characters', () => {
      // 4 consecutive 'a' chars exceeds maxConsecutiveChars (3); basic validation passes.
      const result = validatePassword('Aaaaa1!bc');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('consecutive'))).toBe(true);
    });

    it('should reject weak passwords from basic validation', () => {
      const result = validatePassword('short');
      expect(result.isValid).toBe(false);
    });
  });

  // ===========================================
  // validateEmail
  // ===========================================
  describe('validateEmail', () => {
    it('should accept valid email', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    it('should reject invalid email', () => {
      expect(validateEmail('not-an-email')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateEmail('')).toBe(false);
    });
  });

  // ===========================================
  // isDisposableEmail
  // ===========================================
  describe('isDisposableEmail', () => {
    it('should detect disposable email domains', () => {
      expect(isDisposableEmail('test@mailinator.com')).toBe(true);
      expect(isDisposableEmail('test@guerrillamail.com')).toBe(true);
      expect(isDisposableEmail('test@yopmail.com')).toBe(true);
    });

    it('should allow non-disposable email domains', () => {
      expect(isDisposableEmail('test@gmail.com')).toBe(false);
      expect(isDisposableEmail('test@example.com')).toBe(false);
    });

    it('should handle email without @ sign', () => {
      expect(isDisposableEmail('invalid-email')).toBe(false);
    });
  });

  // ===========================================
  // validatePhone
  // ===========================================
  describe('validatePhone', () => {
    it('should accept valid phone numbers', () => {
      expect(validatePhone('+1 234 567 8901')).toBe(true);
      expect(validatePhone('1234567890')).toBe(true);
      expect(validatePhone('+91-9876543210')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(validatePhone('123')).toBe(false);
      expect(validatePhone('abc')).toBe(false);
    });
  });

  // ===========================================
  // securityHeaders
  // ===========================================
  describe('securityHeaders', () => {
    it('should set all security headers', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      securityHeaders(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
      expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
      expect(res.setHeader).toHaveBeenCalledWith('Feature-Policy', expect.any(String));
      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // checkPasswordStrength
  // ===========================================
  describe('checkPasswordStrength', () => {
    it('should call next when no password in body', () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      const next = jest.fn();

      checkPasswordStrength(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 400 for weak passwords', () => {
      const req = createMockReq({ body: { password: '123' } });
      const res = createMockRes();
      const next = jest.fn();

      checkPasswordStrength(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next for strong passwords', () => {
      const req = createMockReq({ body: { password: 'Str0ng!Pass' } });
      const res = createMockRes();
      const next = jest.fn();

      checkPasswordStrength(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // userLoginRateLimit
  // ===========================================
  describe('userLoginRateLimit', () => {
    it('should call next when no email in body', () => {
      const req = createMockReq({ body: {} });
      const res = createMockRes();
      const next = jest.fn();

      userLoginRateLimit(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should call next when email is present', () => {
      const req = createMockReq({ body: { email: 'test@example.com' } });
      const res = createMockRes();
      const next = jest.fn();

      userLoginRateLimit(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // sessionHijackingProtection
  // ===========================================
  describe('sessionHijackingProtection', () => {
    it('should call next', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      sessionHijackingProtection(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // requireEmailVerification
  // ===========================================
  describe('requireEmailVerification', () => {
    it('should return 401 when no user', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await requireEmailVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 404 when user not found in DB', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await requireEmailVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 when email not verified', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', isVerified: false });

      await requireEmailVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should call next when email is verified', async () => {
      const req = createMockReq();
      (req as any).user = { id: 'user-1' };
      const res = createMockRes();
      const next = jest.fn();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', isVerified: true });

      await requireEmailVerification(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // AccountLockout
  // ===========================================
  describe('AccountLockout', () => {
    beforeEach(() => {
      // Reset internal state by resetting attempts via successful login
      AccountLockout.resetAttempts('test@example.com', '127.0.0.1');
    });

    it('should not be locked initially', () => {
      expect(AccountLockout.isLocked('fresh@example.com', '10.0.0.1')).toBe(false);
    });

    it('should lock after 5 failed attempts', () => {
      for (let i = 0; i < 5; i++) {
        AccountLockout.recordAttempt('locktest@example.com', '127.0.0.1', false);
      }
      expect(AccountLockout.isLocked('locktest@example.com', '127.0.0.1')).toBe(true);
    });

    it('should not lock after fewer than 5 failed attempts', () => {
      for (let i = 0; i < 4; i++) {
        AccountLockout.recordAttempt('fewtest@example.com', '127.0.0.1', false);
      }
      expect(AccountLockout.isLocked('fewtest@example.com', '127.0.0.1')).toBe(false);
    });

    it('should reset attempts', () => {
      for (let i = 0; i < 5; i++) {
        AccountLockout.recordAttempt('resettest@example.com', '127.0.0.1', false);
      }
      AccountLockout.resetAttempts('resettest@example.com', '127.0.0.1');
      expect(AccountLockout.isLocked('resettest@example.com', '127.0.0.1')).toBe(false);
    });
  });

  // ===========================================
  // SuspiciousActivityMonitor
  // ===========================================
  describe('SuspiciousActivityMonitor', () => {
    it('should record activity and track count', () => {
      const activity = {
        userId: 'sus-user-1',
        activityType: 'login',
        details: 'test',
        timestamp: new Date(),
        ip: '127.0.0.1',
        userAgent: 'test-agent'
      };

      SuspiciousActivityMonitor.recordActivity(activity);

      expect(SuspiciousActivityMonitor.getUserActivityCount('sus-user-1')).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 for unknown user', () => {
      expect(SuspiciousActivityMonitor.getUserActivityCount('unknown-user')).toBe(0);
    });
  });

  // ===========================================
  // PasswordHistory
  // ===========================================
  describe('PasswordHistory', () => {
    it('should always allow new password (stub)', async () => {
      const result = await PasswordHistory.isNewPasswordAllowed('user-1', 'NewPass1!');
      expect(result).toBe(true);
    });

    it('should not throw on addToHistory (stub)', async () => {
      await expect(PasswordHistory.addToHistory('user-1', 'Pass1!')).resolves.toBeUndefined();
    });
  });

  // ===========================================
  // MultiFactorAuth
  // ===========================================
  describe('MultiFactorAuth', () => {
    it('should generate 10 backup codes', async () => {
      const codes = await MultiFactorAuth.generateBackupCodes('user-1');
      expect(codes).toHaveLength(10);
      codes.forEach(code => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    }, 30000);

    it('should return false for validateBackupCode (stub)', async () => {
      const result = await MultiFactorAuth.validateBackupCode('user-1', 'CODE');
      expect(result).toBe(false);
    }, 30000);
  });

  // ===========================================
  // PASSWORD_REQUIREMENTS
  // ===========================================
  describe('PASSWORD_REQUIREMENTS', () => {
    it('should export expected configuration', () => {
      expect(PASSWORD_REQUIREMENTS.minLength).toBe(8);
      expect(PASSWORD_REQUIREMENTS.requireUppercase).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireLowercase).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireNumbers).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireSymbols).toBe(true);
      expect(PASSWORD_REQUIREMENTS.maxConsecutiveChars).toBe(3);
      expect(PASSWORD_REQUIREMENTS.forbiddenPatterns).toContain('qwerty');
    });
  });
});
