// ===========================================
// CONTENT VALIDATION MIDDLEWARE UNIT TESTS
// ===========================================

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Mock transitive dependencies required by errorHandler -> monitoring
jest.mock('../../../utils/monitoring', () => ({
  trackError: jest.fn()
}));
jest.mock('../../../utils/apiResponse', () => ({
  sendError: jest.fn()
}));

const mockExtractVideoId = jest.fn();
jest.mock('../../../utils/youtube', () => ({
  extractVideoId: mockExtractVideoId
}));

import {
  youtubeUrlSchema,
  manualContentSchema,
  faqSchema,
  validateContent
} from '../../../middleware/content.validation';
import { AppError } from '../../../middleware/errorHandler';

const createMockReq = (body: any = {}): Request => ({
  headers: {},
  body,
  query: {},
  params: {}
} as unknown as Request);

const createMockRes = (): Response => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

describe('Content Validation Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractVideoId.mockImplementation((url: string) => {
      const match = url.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/);
      return match ? match[1] : null;
    });
  });

  // ===========================================
  // youtubeUrlSchema
  // ===========================================
  describe('youtubeUrlSchema', () => {
    it('should accept a valid YouTube URL', async () => {
      const result = await youtubeUrlSchema.parseAsync({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      });
      expect(result.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('should accept a valid YouTube URL with optional title', async () => {
      const result = await youtubeUrlSchema.parseAsync({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'My Video'
      });
      expect(result.title).toBe('My Video');
    });

    it('should reject empty URL', async () => {
      await expect(youtubeUrlSchema.parseAsync({ url: '' }))
        .rejects.toThrow();
    });

    it('should reject non-YouTube URL', async () => {
      await expect(youtubeUrlSchema.parseAsync({ url: 'https://vimeo.com/123' }))
        .rejects.toThrow();
    });

    it('should reject title longer than 200 characters', async () => {
      await expect(youtubeUrlSchema.parseAsync({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'A'.repeat(201)
      })).rejects.toThrow();
    });

    it('should accept youtu.be short URLs', async () => {
      const result = await youtubeUrlSchema.parseAsync({
        url: 'https://youtu.be/dQw4w9WgXcQ'
      });
      expect(result.url).toBeTruthy();
    });
  });

  // ===========================================
  // manualContentSchema
  // ===========================================
  describe('manualContentSchema', () => {
    const validContent = 'This is a test content piece that has enough words to pass the minimum requirement of twenty words and also meets the minimum character count for the validation schema. '.repeat(2);

    it('should accept valid content', async () => {
      const result = await manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: validContent
      });
      expect(result.title).toBe('Valid Title');
    });

    it('should reject title shorter than 5 characters', async () => {
      await expect(manualContentSchema.parseAsync({
        title: 'Hi',
        text: validContent
      })).rejects.toThrow();
    });

    it('should reject title longer than 200 characters', async () => {
      await expect(manualContentSchema.parseAsync({
        title: 'T'.repeat(201),
        text: validContent
      })).rejects.toThrow();
    });

    it('should reject text shorter than 100 characters', async () => {
      await expect(manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: 'Short text'
      })).rejects.toThrow();
    });

    it('should reject text with fewer than 20 words', async () => {
      // 100+ chars but < 20 words
      const fewWords = 'Longwordthatisreallylongandpadded '.repeat(5) + 'a'.repeat(50);
      await expect(manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: fewWords
      })).rejects.toThrow();
    });

    it('should reject text with excessive special characters', async () => {
      const specialText = '!@#$%^&*()'.repeat(50) + ' some words here and there for count';
      await expect(manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: specialText
      })).rejects.toThrow();
    });

    it('should reject text with excessive consecutive spaces', async () => {
      const spacedText = 'word   word '.repeat(30);
      await expect(manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: spacedText
      })).rejects.toThrow();
    });

    it('should reject text longer than 50000 characters', async () => {
      await expect(manualContentSchema.parseAsync({
        title: 'Valid Title',
        text: 'a '.repeat(25001)
      })).rejects.toThrow();
    });
  });

  // ===========================================
  // faqSchema
  // ===========================================
  describe('faqSchema', () => {
    it('should accept valid FAQ data', async () => {
      const result = await faqSchema.parseAsync({
        title: 'FAQ Title',
        faqs: [
          { question: 'What is this product about?', answer: 'It is great!' },
          { question: 'How do I use this product?', answer: 'Just click start.' }
        ]
      });
      expect(result.faqs).toHaveLength(2);
    });

    it('should reject empty FAQ array', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: []
      })).rejects.toThrow();
    });

    it('should reject duplicate questions', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: [
          { question: 'What is this product about?', answer: 'Answer 1' },
          { question: 'What is this product about?', answer: 'Answer 2' }
        ]
      })).rejects.toThrow();
    });

    it('should reject question shorter than 10 characters', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: [{ question: 'Short?', answer: 'Answer text' }]
      })).rejects.toThrow();
    });

    it('should reject answer shorter than 5 characters', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: [{ question: 'What is this product about?', answer: 'No' }]
      })).rejects.toThrow();
    });

    it('should reject question longer than 500 characters', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: [{ question: 'Q'.repeat(501), answer: 'Answer text' }]
      })).rejects.toThrow();
    });

    it('should reject answer longer than 2000 characters', async () => {
      await expect(faqSchema.parseAsync({
        title: 'FAQ',
        faqs: [{ question: 'What is this product about?', answer: 'A'.repeat(2001) }]
      })).rejects.toThrow();
    });

    it('should reject title longer than 200 characters', async () => {
      await expect(faqSchema.parseAsync({
        title: 'T'.repeat(201),
        faqs: [{ question: 'What is this product about?', answer: 'Answer text' }]
      })).rejects.toThrow();
    });
  });

  // ===========================================
  // validateContent middleware
  // ===========================================
  describe('validateContent', () => {
    it('should call next on valid data', async () => {
      const schema = z.object({ name: z.string().min(1) });
      const middleware = validateContent(schema);

      const req = createMockReq({ name: 'Test' });
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({ name: 'Test' });
    });

    it('should throw AppError on validation failure', async () => {
      const schema = z.object({ name: z.string().min(1) });
      const middleware = validateContent(schema);

      const req = createMockReq({ name: '' });
      const res = createMockRes();
      const next = jest.fn();

      await expect(middleware(req, res, next)).rejects.toThrow(AppError);
    });

    it('should include field-level errors in AppError details', async () => {
      const schema = z.object({
        name: z.string().min(5, 'Name too short'),
        email: z.string().email('Invalid email')
      });
      const middleware = validateContent(schema);

      const req = createMockReq({ name: 'Hi', email: 'bad' });
      const res = createMockRes();
      const next = jest.fn();

      try {
        await middleware(req, res, next);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'name' }),
            expect.objectContaining({ field: 'email' })
          ])
        );
      }
    });

    it('should pass non-Zod errors to next', async () => {
      const schema = {
        parseAsync: jest.fn().mockRejectedValue(new Error('unexpected'))
      } as unknown as z.ZodSchema;
      const middleware = validateContent(schema);

      const req = createMockReq({});
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
