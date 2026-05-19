// ===========================================
// INPUT VALIDATION MIDDLEWARE
// ===========================================
// Centralized validation using express-validator
// Prevents XSS, injection attacks, and malformed data

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import sanitizeHtml from 'sanitize-html';
import { AppError } from './errorHandler';

/**
 * Middleware to check validation results
 * Returns 400 error if validation fails
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error) => error.msg);
    // Use the concrete validation messages as the main error message
    const message = errorMessages.join(', ');
    throw new AppError(message, 400, 'VALIDATION_ERROR', errorMessages);
  }

  next();
};

/**
 * Helper to run validations and return middleware
 * Usage: validate([body('email').isEmail(), ...])
 */
export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    // Check for errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error) => {
        if ('msg' in error) {
          return error.msg;
        }
        return 'Validation error';
      });
      // Surface specific validation messages in the main message key
      const message = errorMessages.join(', ');
      throw new AppError(message, 400, 'VALIDATION_ERROR', errorMessages);
    }

    next();
  };
};

/**
 * Sanitize input to prevent XSS attacks
 * Strips HTML tags and dangerous characters
 */
export const sanitizeInput = (input: string): string => {
  if (!input || typeof input !== 'string') return input;

  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
};

/**
 * Sanitize object recursively
 */
export const sanitizeObject = (obj: unknown): unknown => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        sanitized[key] = sanitizeObject(record[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize request body
 */
export const sanitizeBody = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  next();
};

/**
 * Middleware to sanitize query parameters
 */
export const sanitizeQuery = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.query) {
    req.query = sanitizeObject(req.query) as typeof req.query;
  }
  next();
};
