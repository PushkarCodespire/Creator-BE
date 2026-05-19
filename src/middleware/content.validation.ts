// ===========================================
// CONTENT VALIDATION SCHEMAS (Zod)
// ===========================================
// Type-safe schema validation for content endpoints
// Based on Phase 2 of the implementation plan

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { extractVideoId } from '../utils/youtube';

// YouTube URL validation schema
export const youtubeUrlSchema = z.object({
  url: z.string()
    .trim()
    .min(1, 'YouTube URL is required')
    .refine((url) => !!extractVideoId(url), 'Must be a valid YouTube video URL'),
  title: z.string()
    .min(1, 'Title must be at least 1 character')
    .max(200, 'Title must not exceed 200 characters')
    .optional()
});

// Manual text content schema
export const manualContentSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must not exceed 200 characters'),
  text: z.string()
    .min(100, 'Content must be at least 100 characters')
    .max(50000, 'Content must not exceed 50,000 characters')
    .refine((text) => {
      // Quality checks
      const words = text.trim().split(/\s+/);
      if (words.length < 20) return false;
      
      // Check for excessive special characters (\p{M} covers combining marks for non-Latin scripts)
      const specialCharCount = (text.match(/[^\p{L}\p{N}\p{M}\s]/gu) || []).length;
      const specialCharRatio = specialCharCount / text.length;
      if (specialCharRatio > 0.4) return false;
      
      // Check for excessive consecutive spaces
      if (text.includes('   ')) return false;
      
      return true;
    }, 'Content must contain meaningful text (minimum 20 words, not excessive special characters)')
});

// FAQ schema
export const faqSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must not exceed 200 characters'),
  faqs: z.array(
    z.object({
      question: z.string()
        .min(10, 'Question must be at least 10 characters')
        .max(500, 'Question must not exceed 500 characters'),
      answer: z.string()
        .min(5, 'Answer must be at least 5 characters')
        .max(2000, 'Answer must not exceed 2000 characters')
    })
  )
    .min(1, 'At least 1 FAQ pair is required')
    .refine((faqs) => {
      // Check for duplicate questions
      const questions = faqs.map(f => f.question.toLowerCase().trim());
      const uniqueQuestions = new Set(questions);
      return uniqueQuestions.size === questions.length;
    }, 'Duplicate questions are not allowed')
});

/**
 * Zod validation middleware
 */
export function validateContent(schema: z.ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));
        // Construct a detailed, human-readable message while also keeping structured details
        const errorMessage = errors.map(e => `${e.field}: ${e.message}`).join(', ');
        throw new AppError(errorMessage, 400, 'VALIDATION_ERROR', errors);
      }
      next(error);
    }
  };
}
