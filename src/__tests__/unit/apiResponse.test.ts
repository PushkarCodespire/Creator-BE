// ===========================================
// API RESPONSE UNIT TESTS
// ===========================================

import { sendError } from '../../utils/apiResponse';

describe('API Response Utils - Unit Tests', () => {
  const createMockResponse = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  };

  describe('sendError', () => {
    it('should send error response with correct status code', () => {
      const res = createMockResponse();
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input');

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [],
        },
      });
    });

    it('should send error response with details', () => {
      const res = createMockResponse();
      const details = [{ field: 'email', message: 'Email is required' }];
      sendError(res, 422, 'VALIDATION_ERROR', 'Validation failed', details);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      });
    });

    it('should default details to empty array when not provided', () => {
      const res = createMockResponse();
      sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            details: [],
          }),
        })
      );
    });

    it('should handle null details by defaulting to empty array', () => {
      const res = createMockResponse();
      sendError(res, 400, 'BAD_REQUEST', 'Bad request', null);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            details: [],
          }),
        })
      );
    });

    it('should send 404 not found error', () => {
      const res = createMockResponse();
      sendError(res, 404, 'NOT_FOUND', 'Resource not found');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          details: [],
        },
      });
    });

    it('should send 401 unauthorized error', () => {
      const res = createMockResponse();
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          details: [],
        },
      });
    });

    it('should always set success to false', () => {
      const res = createMockResponse();
      sendError(res, 200, 'OK', 'This is still an error');

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });
});
