// ===========================================
// ERROR HANDLER MIDDLEWARE
// ===========================================

import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { trackError } from '../utils/monitoring';

import { AppError } from '../utils/errors';
export { AppError };
import { sendError } from '../utils/apiResponse';
import { logError } from '../utils/logger';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  // Track error for monitoring
  trackError(err, req);
  logError(err instanceof Error ? err : new Error(String(err)), { context: 'Error handler' });

  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code || 'APP_ERROR', err.message, err.details);
  }

  // Multer upload errors — return 400 with a readable message, not 500
  if (err instanceof multer.MulterError) {
    const me = err as multer.MulterError;
    const msg =
      me.code === 'LIMIT_FILE_SIZE'  ? 'File too large. Maximum 25 MB per audio clip.' :
      me.code === 'LIMIT_FILE_COUNT' ? 'Too many files. Maximum 10 audio clips allowed.' :
      me.message;
    return sendError(res, 400, 'UPLOAD_ERROR', msg);
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as unknown as Record<string, unknown>;
    const includeDetails =
      process.env.DEBUG_DB_ERRORS === 'true' ||
      process.env.NODE_ENV !== 'production';
    const details = includeDetails
      ? {
          prismaCode: prismaErr.code,
          prismaMessage: prismaErr.message,
          prismaMeta: prismaErr.meta
        }
      : [];
    return sendError(res, 400, 'DB_ERROR', 'Database operation failed', details);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 401, 'JWT_INVALID', 'Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return sendError(res, 401, 'JWT_EXPIRED', 'Token expired');
  }

  // Default error
  return sendError(
    res,
    500,
    'INTERNAL_ERROR',
    process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  );
};

// Async handler wrapper — generic so callers typing req as AuthRequest still see params/body/query
export const asyncHandler = <TReq extends Request = Request>(
  fn: (req: TReq, res: Response, next: NextFunction) => Promise<unknown> | unknown
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as TReq, res, next)).catch(next);
  };
};
