// ===========================================
// VALIDATION MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';

// Mock transitive dependencies required by errorHandler -> monitoring
jest.mock('../../../utils/monitoring', () => ({
  trackError: jest.fn()
}));
jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

// Mock express-validator
jest.mock('express-validator', () => {
  const mockValidationResult = jest.fn();
  return {
    validationResult: mockValidationResult,
    body: jest.fn().mockReturnValue({
      run: jest.fn().mockResolvedValue(undefined),
      isEmail: jest.fn().mockReturnThis(),
      isLength: jest.fn().mockReturnThis(),
      notEmpty: jest.fn().mockReturnThis(),
      withMessage: jest.fn().mockReturnThis()
    })
  };
});

import {
  validateRequest,
  validate,
  sanitizeInput,
  sanitizeObject,
  sanitizeBody,
  sanitizeQuery
} from '../../../middleware/validation';
import { AppError } from '../../../middleware/errorHandler';

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
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('Validation Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================
  // validateRequest
  // ===========================================
  describe('validateRequest', () => {
    it('should call next when no validation errors', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => []
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      validateRequest(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should throw AppError when validation fails', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          { msg: 'Email is required' },
          { msg: 'Password must be at least 8 characters' }
        ]
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      expect(() => validateRequest(req, res, next)).toThrow(AppError);
    });

    it('should include validation messages in AppError', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [
          { msg: 'Email is required' },
          { msg: 'Name too short' }
        ]
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      try {
        validateRequest(req, res, next);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toContain('Email is required');
        expect(err.message).toContain('Name too short');
        expect(err.details).toEqual(['Email is required', 'Name too short']);
      }
    });
  });

  // ===========================================
  // validate
  // ===========================================
  describe('validate', () => {
    it('should run all validations and call next on success', async () => {
      const mockChain = {
        run: jest.fn().mockResolvedValue(undefined)
      } as unknown as ValidationChain;

      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => []
      });

      const middleware = validate([mockChain, mockChain]);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(mockChain.run).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
    });

    it('should throw AppError when validations fail', async () => {
      const mockChain = {
        run: jest.fn().mockResolvedValue(undefined)
      } as unknown as ValidationChain;

      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [{ msg: 'Field is required' }]
      });

      const middleware = validate([mockChain]);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await expect(middleware(req, res, next)).rejects.toThrow(AppError);
    });

    it('should handle validation result entries without msg', async () => {
      const mockChain = {
        run: jest.fn().mockResolvedValue(undefined)
      } as unknown as ValidationChain;

      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [{ type: 'field', value: '', location: 'body' }]
      });

      const middleware = validate([mockChain]);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      try {
        await middleware(req, res, next);
      } catch (err: any) {
        expect(err.details).toContain('Validation error');
      }
    });
  });

  // ===========================================
  // sanitizeInput
  // ===========================================
  describe('sanitizeInput', () => {
    it('should strip HTML tags from strings', () => {
      expect(sanitizeInput('<script>alert("XSS")</script>Hello')).toBe('Hello');
    });

    it('should strip bold tags', () => {
      expect(sanitizeInput('<b>Bold</b> text')).toBe('Bold text');
    });

    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('should return empty string for empty input', () => {
      expect(sanitizeInput('')).toBe('');
    });

    it('should return falsy values as-is', () => {
      expect(sanitizeInput(null as any)).toBe(null);
      expect(sanitizeInput(undefined as any)).toBe(undefined);
    });

    it('should preserve safe text', () => {
      expect(sanitizeInput('Safe text 123')).toBe('Safe text 123');
    });

    it('should handle strings with only HTML', () => {
      expect(sanitizeInput('<div></div>')).toBe('');
    });
  });

  // ===========================================
  // sanitizeObject
  // ===========================================
  describe('sanitizeObject', () => {
    it('should sanitize string values in objects', () => {
      const obj = {
        name: '<script>XSS</script>John',
        bio: '<b>Developer</b>'
      };
      const result = sanitizeObject(obj);
      expect(result.name).toBe('John');
      expect(result.bio).toBe('Developer');
    });

    it('should sanitize nested objects', () => {
      const obj = {
        user: {
          name: '<div>Nested</div>',
          profile: {
            bio: '<img onerror="alert(1)">Hello'
          }
        }
      };
      const result = sanitizeObject(obj);
      expect(result.user.name).toBe('Nested');
      expect(result.user.profile.bio).toBe('Hello');
    });

    it('should sanitize arrays', () => {
      const arr = ['<b>Hello</b>', '<script>XSS</script>World'];
      const result = sanitizeObject(arr);
      expect(result).toEqual(['Hello', 'World']);
    });

    it('should preserve non-string values', () => {
      const obj = { count: 42, active: true, score: 9.5 };
      expect(sanitizeObject(obj)).toEqual(obj);
    });

    it('should handle null', () => {
      expect(sanitizeObject(null)).toBe(null);
    });

    it('should handle undefined', () => {
      expect(sanitizeObject(undefined)).toBe(undefined);
    });

    it('should handle number input', () => {
      expect(sanitizeObject(42)).toBe(42);
    });

    it('should handle boolean input', () => {
      expect(sanitizeObject(true)).toBe(true);
    });
  });

  // ===========================================
  // sanitizeBody
  // ===========================================
  describe('sanitizeBody', () => {
    it('should sanitize request body', () => {
      const req = createMockReq({
        body: { name: '<script>XSS</script>Alice' }
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeBody(req, res, next);

      expect(req.body.name).toBe('Alice');
      expect(next).toHaveBeenCalled();
    });

    it('should call next when body is empty', () => {
      const req = createMockReq({ body: undefined as any });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeBody(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // sanitizeQuery
  // ===========================================
  describe('sanitizeQuery', () => {
    it('should sanitize query parameters', () => {
      const req = createMockReq({
        query: { search: '<b>query</b>' } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeQuery(req, res, next);

      expect(req.query.search).toBe('query');
      expect(next).toHaveBeenCalled();
    });

    it('should call next when query is empty', () => {
      const req = createMockReq({ query: undefined as any });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeQuery(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // validateRequest — additional branches
  // ===========================================
  describe('validateRequest — additional branches', () => {
    it('should throw with single error message', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [{ msg: 'Only error' }]
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      expect(() => validateRequest(req, res, next)).toThrow('Only error');
    });

    it('should not call next on validation failure', () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [{ msg: 'Bad input' }]
      });

      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      try {
        validateRequest(req, res, next);
      } catch {
        // expected
      }

      expect(next).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // validate — additional branches
  // ===========================================
  describe('validate — additional branches', () => {
    it('should handle empty validation chain', async () => {
      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => true,
        array: () => []
      });

      const middleware = validate([]);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should collect messages from multiple failed chains', async () => {
      const chainA = { run: jest.fn().mockResolvedValue(undefined) } as unknown as ValidationChain;
      const chainB = { run: jest.fn().mockResolvedValue(undefined) } as unknown as ValidationChain;

      (validationResult as unknown as jest.Mock).mockReturnValue({
        isEmpty: () => false,
        array: () => [{ msg: 'Name required' }, { msg: 'Email invalid' }]
      });

      const middleware = validate([chainA, chainB]);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      try {
        await middleware(req, res, next);
      } catch (err: any) {
        expect(err.message).toContain('Name required');
        expect(err.message).toContain('Email invalid');
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ===========================================
  // sanitizeInput — additional branches
  // ===========================================
  describe('sanitizeInput — additional branches', () => {
    it('should strip event handler attributes', () => {
      expect(sanitizeInput('<img src="x" onerror="alert(1)">')).toBe('');
    });

    it('should strip style tags', () => {
      expect(sanitizeInput('<style>body{color:red}</style>Normal')).toBe('Normal');
    });

    it('should return number input as-is (non-string passthrough)', () => {
      expect(sanitizeInput(42 as any)).toBe(42);
    });
  });

  // ===========================================
  // sanitizeObject — additional branches
  // ===========================================
  describe('sanitizeObject — additional branches', () => {
    it('should sanitize array of objects', () => {
      const arr = [{ name: '<b>Alice</b>' }, { name: '<i>Bob</i>' }];
      const result = sanitizeObject(arr) as any[];
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
    });

    it('should handle empty object', () => {
      expect(sanitizeObject({})).toEqual({});
    });

    it('should handle empty array', () => {
      expect(sanitizeObject([])).toEqual([]);
    });

    it('should only sanitize own properties', () => {
      const proto = { inherited: '<script>bad</script>' };
      const obj = Object.create(proto);
      obj.own = '<b>Hi</b>';
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.own).toBe('Hi');
      expect(result.inherited).toBeUndefined();
    });
  });

  // ===========================================
  // sanitizeBody — additional branches
  // ===========================================
  describe('sanitizeBody — additional branches', () => {
    it('should sanitize nested body fields', () => {
      const req = createMockReq({
        body: {
          user: {
            name: '<script>XSS</script>Bob',
            tags: ['<b>tag1</b>', 'safe']
          }
        }
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeBody(req, res, next);

      expect((req.body as any).user.name).toBe('Bob');
      expect((req.body as any).user.tags[0]).toBe('tag1');
      expect((req.body as any).user.tags[1]).toBe('safe');
      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================
  // sanitizeQuery — additional branches
  // ===========================================
  describe('sanitizeQuery — additional branches', () => {
    it('should sanitize multiple query params', () => {
      const req = createMockReq({
        query: {
          q: '<script>alert()</script>hello',
          page: '1',
          tag: '<b>tech</b>'
        } as any
      });
      const res = createMockRes();
      const next = jest.fn();

      sanitizeQuery(req, res, next);

      expect(req.query.q).toBe('hello');
      expect(req.query.page).toBe('1');
      expect(req.query.tag).toBe('tech');
    });
  });
});
