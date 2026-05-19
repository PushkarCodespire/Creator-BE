// ===========================================
// ERROR HANDLER MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';

jest.mock('../../../utils/monitoring', () => ({
  trackError: jest.fn()
}));
jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

import { errorHandler, asyncHandler, AppError } from '../../../middleware/errorHandler';
import { trackError } from '../../../utils/monitoring';
import { sendError } from '../../../utils/apiResponse';

const createMockReq = (): Request => ({
  headers: {},
  body: {},
  query: {},
  params: {},
  originalUrl: '/api/test',
  method: 'GET',
  ip: '127.0.0.1',
  get: jest.fn()
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('Error Handler Middleware', () => {
  const mockNext = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (sendError as jest.Mock).mockImplementation((res: any, status: number, code: string, message: string, details?: any) => {
      res.status(status);
      res.json({ success: false, error: { code, message, details } });
      return res;
    });
    (trackError as jest.Mock).mockImplementation(() => {});
  });

  // ===========================================
  // errorHandler
  // ===========================================
  describe('errorHandler', () => {
    it('should handle AppError with custom status code and code', () => {
      const err = new AppError('Not found', 404, 'NOT_FOUND');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(trackError).toHaveBeenCalledWith(err, req);
      expect(sendError).toHaveBeenCalledWith(res, 404, 'NOT_FOUND', 'Not found', undefined);
    });

    it('should handle AppError with details', () => {
      const details = [{ field: 'email', message: 'Invalid' }];
      const err = new AppError('Validation error', 400, 'VALIDATION_ERROR', details);
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 400, 'VALIDATION_ERROR', 'Validation error', details);
    });

    it('should handle PrismaClientKnownRequestError', () => {
      const err = new Error('Prisma error');
      err.name = 'PrismaClientKnownRequestError';
      (err as any).code = 'P2002';
      (err as any).meta = { target: ['email'] };
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(
        res,
        400,
        'DB_ERROR',
        'Database operation failed',
        expect.any(Object)
      );
    });

    it('should include Prisma details in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const err = new Error('Prisma error');
      err.name = 'PrismaClientKnownRequestError';
      (err as any).code = 'P2002';
      (err as any).meta = { target: ['email'] };
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(
        res,
        400,
        'DB_ERROR',
        'Database operation failed',
        expect.objectContaining({ prismaCode: 'P2002' })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should hide Prisma details in production without DEBUG_DB_ERRORS', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalDebug = process.env.DEBUG_DB_ERRORS;
      process.env.NODE_ENV = 'production';
      delete process.env.DEBUG_DB_ERRORS;

      const err = new Error('Prisma error');
      err.name = 'PrismaClientKnownRequestError';
      (err as any).code = 'P2002';
      (err as any).meta = {};
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(
        res,
        400,
        'DB_ERROR',
        'Database operation failed',
        []
      );

      process.env.NODE_ENV = originalEnv;
      if (originalDebug !== undefined) process.env.DEBUG_DB_ERRORS = originalDebug;
    });

    it('should handle JsonWebTokenError', () => {
      const err = new Error('invalid token');
      err.name = 'JsonWebTokenError';
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'JWT_INVALID', 'Invalid token');
    });

    it('should handle TokenExpiredError', () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 401, 'JWT_EXPIRED', 'Token expired');
    });

    it('should handle generic Error in development with error message', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const err = new Error('Something broke');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 500, 'INTERNAL_ERROR', 'Something broke');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle generic Error in production with generic message', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const err = new Error('Something secret broke');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(sendError).toHaveBeenCalledWith(res, 500, 'INTERNAL_ERROR', 'Internal server error');

      process.env.NODE_ENV = originalEnv;
    });

    it('should always call trackError', () => {
      const err = new Error('any error');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(err, req, res, mockNext);

      expect(trackError).toHaveBeenCalledWith(err, req);
    });
  });

  // ===========================================
  // asyncHandler
  // ===========================================
  describe('asyncHandler', () => {
    it('should pass resolved promise result through', async () => {
      const fn = jest.fn().mockResolvedValue(undefined);
      const handler = asyncHandler(fn);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(fn).toHaveBeenCalledWith(req, res, next);
    });

    it('should catch rejected promise and call next with error', async () => {
      const err = new Error('async fail');
      const fn = jest.fn().mockRejectedValue(err);
      const handler = asyncHandler(fn);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });

    it('should handle synchronous functions', async () => {
      const fn = jest.fn();
      const handler = asyncHandler(fn);
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(fn).toHaveBeenCalledWith(req, res, next);
    });
  });

  // ===========================================
  // AppError
  // ===========================================
  describe('AppError', () => {
    it('should create error with correct properties', () => {
      const err = new AppError('Test error', 400, 'TEST_ERROR');
      expect(err.message).toBe('Test error');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('TEST_ERROR');
      expect(err.isOperational).toBe(true);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
    });

    it('should accept details parameter', () => {
      const details = { field: 'email' };
      const err = new AppError('Error', 400, 'ERR', details);
      expect(err.details).toEqual(details);
    });

    it('should use default code when not provided', () => {
      const err = new AppError('Error', 400);
      expect(err.code).toBe('APP_ERROR');
    });
  });
});
