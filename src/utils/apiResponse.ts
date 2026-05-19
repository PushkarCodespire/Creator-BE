import { Response } from 'express';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Standard error response helper
 * Format:
 * {
 *   success: false,
 *   error: { code, message, details: [] }
 * }
 */
export const sendError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = []
) => {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details: details ?? []
    }
  });
};
