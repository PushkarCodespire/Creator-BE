// ===========================================
// ERRORS UNIT TESTS
// ===========================================

import { AppError } from '../../utils/errors';

describe('Errors Utils - Unit Tests', () => {
  describe('AppError', () => {
    it('should create an error with message and status code', () => {
      const error = new AppError('Not found', 404);
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('APP_ERROR');
      expect(error.isOperational).toBe(true);
    });

    it('should create an error with custom code', () => {
      const error = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should create an error with details', () => {
      const details = [{ field: 'email', message: 'Required' }];
      const error = new AppError('Validation failed', 422, 'VALIDATION_ERROR', details);
      expect(error.details).toEqual(details);
    });

    it('should be an instance of Error', () => {
      const error = new AppError('Test', 500);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should have a stack trace', () => {
      const error = new AppError('Test error', 500);
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Test error');
    });

    it('should default code to APP_ERROR when not provided', () => {
      const error = new AppError('Test', 500);
      expect(error.code).toBe('APP_ERROR');
    });

    it('should default details to undefined when not provided', () => {
      const error = new AppError('Test', 400, 'TEST');
      expect(error.details).toBeUndefined();
    });

    it('should always be operational', () => {
      const error = new AppError('Internal error', 500, 'INTERNAL');
      expect(error.isOperational).toBe(true);
    });

    it('should preserve the error name as Error', () => {
      const error = new AppError('Test', 400);
      // The name comes from the Error prototype
      expect(error.name).toBe('Error');
    });

    it('should handle various status codes correctly', () => {
      const codes = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503];
      codes.forEach((code) => {
        const error = new AppError(`Error ${code}`, code);
        expect(error.statusCode).toBe(code);
      });
    });

    it('should handle complex details objects', () => {
      const details = {
        errors: [
          { field: 'name', message: 'Required', code: 'REQUIRED' },
          { field: 'email', message: 'Invalid format', code: 'INVALID' },
        ],
        timestamp: new Date().toISOString(),
      };
      const error = new AppError('Multiple errors', 400, 'MULTI_ERROR', details);
      expect(error.details).toEqual(details);
    });
  });
});
