// ===========================================
// CONTENT CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn() },
    creatorContent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('../../../services/content/youtube.service', () => ({
  fetchCachedTranscript: jest.fn()
}));

jest.mock('../../../utils/openai', () => ({
  generateEmbedding: jest.fn(),
  generateEmbeddings: jest.fn(),
  chunkText: jest.fn(),
  isOpenAIConfigured: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/vectorStore', () => ({
  storeVectors: jest.fn(),
  deleteVectorsByContent: jest.fn()
}));

jest.mock('../../../sockets/content.socket', () => ({
  ContentSocketHandler: { emitProgress: jest.fn() }
}));

jest.mock('../../../services/queue/content-queue', () => ({
  contentQueue: { add: jest.fn() },
  isContentQueueEnabled: false
}));

jest.mock('../../../services/queue/content-processor.worker', () => ({
  processContentJob: jest.fn().mockResolvedValue({ chunksCreated: 3 })
}));

jest.mock('../../../utils/contentSanitizer', () => ({
  sanitizeText: jest.fn((t: string) => t),
  validateContentQuality: jest.fn(() => ({ valid: true, issues: [] }))
}));

jest.mock('../../../utils/metrics', () => ({
  recordContentProcessing: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logInfo: jest.fn(), logError: jest.fn(), logDebug: jest.fn()
}));

import { Request, Response } from 'express';
import prisma from '../../../../prisma/client';
import { fetchCachedTranscript } from '../../../services/content/youtube.service';
import {
  addYouTubeContent,
  addManualContent,
  addFAQContent,
  getCreatorContent,
  deleteContent,
  retrainContent,
  getContentDetails
} from '../../../controllers/content.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1', role: 'CREATOR' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Content Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish mocks reset by resetMocks: true
    const { sanitizeText, validateContentQuality } = require('../../../utils/contentSanitizer');
    (sanitizeText as jest.Mock).mockImplementation((t: string) => t);
    (validateContentQuality as jest.Mock).mockReturnValue({ valid: true, issues: [] });
    const { processContentJob } = require('../../../services/queue/content-processor.worker');
    (processContentJob as jest.Mock).mockResolvedValue({ chunksCreated: 3 });
    const { deleteVectorsByContent } = require('../../../utils/vectorStore');
    (deleteVectorsByContent as jest.Mock).mockReturnValue(undefined);
  });

  describe('addYouTubeContent', () => {
    it('should throw 400 when url is missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(addYouTubeContent(req, res)).rejects.toThrow('YouTube URL is required');
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=abc' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(addYouTubeContent(req, res)).rejects.toThrow('Creator profile not found');
    });

    it('should create content and process synchronously', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=abc', title: 'Test' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockResolvedValue({ videoId: 'abc', transcript: 'Some meaningful transcript content here for testing purposes' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'cc-1', status: 'PROCESSING' });
      (prisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({ id: 'cc-1', status: 'COMPLETED', _count: { chunks: 3 } });

      await addYouTubeContent(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('addManualContent', () => {
    it('should throw 400 when title/text missing', async () => {
      const req = mockReq({ body: { title: 'T' } });
      const res = mockRes();

      await expect(addManualContent(req, res)).rejects.toThrow('Title and text are required');
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ body: { title: 'T', text: 'Some text' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(addManualContent(req, res)).rejects.toThrow('Creator profile not found');
    });

    it('should create manual content', async () => {
      const req = mockReq({ body: { title: 'T', text: 'Content text here' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'cc-1' });
      (prisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({ id: 'cc-1', _count: { chunks: 2 } });

      await addManualContent(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('addFAQContent', () => {
    it('should throw 400 when faqs missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(addFAQContent(req, res)).rejects.toThrow('FAQs array is required');
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ body: { faqs: [{ question: 'Q', answer: 'A' }] } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(addFAQContent(req, res)).rejects.toThrow('Creator profile not found');
    });
  });

  describe('getCreatorContent', () => {
    it('should return paginated content', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creatorContent.count as jest.Mock).mockResolvedValue(0);

      await getCreatorContent(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getCreatorContent(req, res)).rejects.toThrow('Creator profile not found');
    });
  });

  describe('deleteContent', () => {
    it('should delete content', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({ id: 'cc-1' });
      (prisma.creatorContent.delete as jest.Mock).mockResolvedValue({});

      await deleteContent(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when content not found', async () => {
      const req = mockReq({ params: { contentId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(deleteContent(req, res)).rejects.toThrow('Content not found');
    });
  });

  describe('retrainContent', () => {
    it('should retrain content', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({ id: 'cc-1', type: 'MANUAL_TEXT', rawText: 'text', title: 'T' });
      (prisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await retrainContent(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getContentDetails', () => {
    it('should return content details', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({
        id: 'cc-1', title: 'T', type: 'MANUAL_TEXT', status: 'COMPLETED',
        chunks: [], _count: { chunks: 0 }, createdAt: new Date(), processedAt: new Date(), updatedAt: new Date()
      });

      await getContentDetails(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should throw 404 when content not found', async () => {
      const req = mockReq({ params: { contentId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getContentDetails(req, res)).rejects.toThrow('Content not found');
    });

    it('should truncate chunk text longer than 200 chars in details response', async () => {
      const req = mockReq({ params: { contentId: 'cc-long' } });
      const res = mockRes();

      const longText = 'x'.repeat(300);
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({
        id: 'cc-long', title: 'Long', type: 'MANUAL_TEXT', status: 'COMPLETED',
        sourceUrl: null, errorMessage: null,
        chunks: [{ id: 'ch-1', chunkIndex: 0, text: longText, tokenCount: 100, createdAt: new Date() }],
        _count: { chunks: 1 },
        createdAt: new Date(), processedAt: new Date(), updatedAt: new Date()
      });

      await getContentDetails(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      const chunkText = callArg.data.chunks[0].text;
      expect(chunkText.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(chunkText.endsWith('...')).toBe(true);
    });

    it('should not append ellipsis when chunk text is 200 chars or fewer', async () => {
      const req = mockReq({ params: { contentId: 'cc-short' } });
      const res = mockRes();

      const shortText = 'Short content.';
      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({
        id: 'cc-short', title: 'Short', type: 'MANUAL_TEXT', status: 'COMPLETED',
        sourceUrl: null, errorMessage: null,
        chunks: [{ id: 'ch-2', chunkIndex: 0, text: shortText, tokenCount: 5, createdAt: new Date() }],
        _count: { chunks: 1 },
        createdAt: new Date(), processedAt: new Date(), updatedAt: new Date()
      });

      await getContentDetails(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.chunks[0].text).toBe(shortText);
    });

    it('should throw 404 when creator not found in getContentDetails', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getContentDetails(req, res)).rejects.toThrow('Creator profile not found');
    });
  });

  // ===========================================
  // ADD YOUTUBE CONTENT – additional branches
  // ===========================================
  describe('addYouTubeContent – additional branches', () => {
    it('should throw user-friendly error when YouTube is blocking access', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=blocked' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockRejectedValue(
        new Error('YouTube is blocking access to this video transcript')
      );

      await expect(addYouTubeContent(req, res)).rejects.toThrow(
        'YouTube is blocking access to this video'
      );
    });

    it('should throw user-friendly error when transcript is empty', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=empty' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockRejectedValue(
        new Error('Transcript is empty')
      );

      await expect(addYouTubeContent(req, res)).rejects.toThrow(
        'This video does not have a transcript available'
      );
    });

    it('should throw user-friendly error when OpenAI API key missing', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=nokey' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockRejectedValue(
        new Error('OpenAI API key is not configured')
      );

      await expect(addYouTubeContent(req, res)).rejects.toThrow(
        'OpenAI API key is not configured'
      );
    });

    it('should throw 400 when sanitized transcript is empty string', async () => {
      const { sanitizeText } = require('../../../utils/contentSanitizer');
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=abc' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockResolvedValue({ videoId: 'abc', transcript: 'raw' });
      (sanitizeText as jest.Mock).mockReturnValueOnce(''); // returns empty after sanitize

      await expect(addYouTubeContent(req, res)).rejects.toThrow(
        'Transcript is empty or unavailable for this video'
      );
    });

    it('should throw 400 when content quality check fails', async () => {
      const { validateContentQuality } = require('../../../utils/contentSanitizer');
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockResolvedValue({ videoId: 'bad', transcript: 'some text' });
      (validateContentQuality as jest.Mock).mockReturnValueOnce({ valid: false, issues: ['Too short'] });

      await expect(addYouTubeContent(req, res)).rejects.toThrow('Content quality issues');
    });

    it('should use videoId as default title when no title is supplied', async () => {
      const req = mockReq({ body: { url: 'https://youtube.com/watch?v=myid' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (fetchCachedTranscript as jest.Mock).mockResolvedValue({ videoId: 'myid', transcript: 'transcript text' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'cc-new', status: 'PROCESSING' });

      await addYouTubeContent(req, res);

      expect(prisma.creatorContent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'YouTube: myid' })
        })
      );
    });
  });

  // ===========================================
  // ADD MANUAL CONTENT – additional branches
  // ===========================================
  describe('addManualContent – additional branches', () => {
    it('should throw 400 when content quality check fails', async () => {
      const { validateContentQuality } = require('../../../utils/contentSanitizer');
      const req = mockReq({ body: { title: 'T', text: 'x' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (validateContentQuality as jest.Mock).mockReturnValueOnce({ valid: false, issues: ['Too short', 'No paragraphs'] });

      await expect(addManualContent(req, res)).rejects.toThrow('Content quality issues');
    });

    it('should sanitize both title and text before saving', async () => {
      const { sanitizeText } = require('../../../utils/contentSanitizer');
      const req = mockReq({ body: { title: '  My Title  ', text: '  Content body  ' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (sanitizeText as jest.Mock).mockImplementation((t: string) => t.trim());
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'cc-san', status: 'PROCESSING' });

      await addManualContent(req, res);

      expect(sanitizeText).toHaveBeenCalledWith('  My Title  ');
      expect(sanitizeText).toHaveBeenCalledWith('  Content body  ');
    });

    it('should respond 201 with success data', async () => {
      const req = mockReq({ body: { title: 'My Content', text: 'Text body' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'cc-ok', status: 'PROCESSING', type: 'MANUAL_TEXT' });

      await addManualContent(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ id: 'cc-ok' }) })
      );
    });
  });

  // ===========================================
  // ADD FAQ CONTENT – additional branches
  // ===========================================
  describe('addFAQContent – additional branches', () => {
    it('should throw 400 when faqs is an empty array', async () => {
      const req = mockReq({ body: { faqs: [] } });
      const res = mockRes();

      await expect(addFAQContent(req, res)).rejects.toThrow('FAQs array is required');
    });

    it('should throw 400 when faqs is not an array', async () => {
      const req = mockReq({ body: { faqs: 'not-an-array' } });
      const res = mockRes();

      await expect(addFAQContent(req, res)).rejects.toThrow('FAQs array is required');
    });

    it('should create FAQ content record and respond 201', async () => {
      const req = mockReq({ body: { faqs: [{ question: 'What?', answer: 'This.' }] } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'faq-1', type: 'FAQ', status: 'PROCESSING' });

      await addFAQContent(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should format multiple FAQs as Q:/A: text blocks', async () => {
      const req = mockReq({
        body: {
          faqs: [
            { question: 'Q1', answer: 'A1' },
            { question: 'Q2', answer: 'A2' }
          ]
        }
      });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.create as jest.Mock).mockResolvedValue({ id: 'faq-2', type: 'FAQ', status: 'PROCESSING' });

      await addFAQContent(req, res);

      const createCall = (prisma.creatorContent.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.rawText).toContain('Q: Q1');
      expect(createCall.data.rawText).toContain('A: A1');
      expect(createCall.data.rawText).toContain('Q: Q2');
    });
  });

  // ===========================================
  // GET CREATOR CONTENT – additional branches
  // ===========================================
  describe('getCreatorContent – additional branches', () => {
    it('should respect page and limit query params', async () => {
      const req = mockReq({ query: { page: '2', limit: '5' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creatorContent.count as jest.Mock).mockResolvedValue(12);

      await getCreatorContent(req, res);

      const findManyCall = (prisma.creatorContent.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.skip).toBe(5); // (page-1) * limit = 1 * 5
      expect(findManyCall.take).toBe(5);
    });

    it('should calculate totalPages correctly in pagination', async () => {
      const req = mockReq({ query: { page: '1', limit: '10' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.creatorContent.count as jest.Mock).mockResolvedValue(25);

      await getCreatorContent(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.pagination.totalPages).toBe(3); // ceil(25/10)
      expect(callArg.data.pagination.total).toBe(25);
    });

    it('should return contents array with pagination envelope', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      const fakeContent = [{ id: 'cc-a', title: 'A', type: 'MANUAL_TEXT', status: 'COMPLETED' }];

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findMany as jest.Mock).mockResolvedValue(fakeContent);
      (prisma.creatorContent.count as jest.Mock).mockResolvedValue(1);

      await getCreatorContent(req, res);

      const callArg = (res.json as jest.Mock).mock.calls[0][0];
      expect(callArg.data.contents).toEqual(fakeContent);
      expect(callArg.data.pagination).toBeDefined();
    });
  });

  // ===========================================
  // DELETE CONTENT – additional branches
  // ===========================================
  describe('deleteContent – additional branches', () => {
    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteContent(req, res)).rejects.toThrow('Creator profile not found');
    });

    it('should call deleteVectorsByContent with the contentId', async () => {
      const { deleteVectorsByContent } = require('../../../utils/vectorStore');
      const req = mockReq({ params: { contentId: 'cc-del' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({ id: 'cc-del' });
      (prisma.creatorContent.delete as jest.Mock).mockResolvedValue({});

      await deleteContent(req, res);

      expect(deleteVectorsByContent).toHaveBeenCalledWith('cc-del');
    });

    it('should call prisma.creatorContent.delete after finding content', async () => {
      const req = mockReq({ params: { contentId: 'cc-todel' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({ id: 'cc-todel' });
      (prisma.creatorContent.delete as jest.Mock).mockResolvedValue({});

      await deleteContent(req, res);

      expect(prisma.creatorContent.delete).toHaveBeenCalledWith({ where: { id: 'cc-todel' } });
    });
  });

  // ===========================================
  // RETRAIN CONTENT – additional branches
  // ===========================================
  describe('retrainContent – additional branches', () => {
    it('should throw 404 when creator not found', async () => {
      const req = mockReq({ params: { contentId: 'cc-1' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(retrainContent(req, res)).rejects.toThrow('Creator profile not found');
    });

    it('should throw 404 when content not found', async () => {
      const req = mockReq({ params: { contentId: 'bad' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(retrainContent(req, res)).rejects.toThrow('Content not found');
    });

    it('should set status to PROCESSING before dispatching background work', async () => {
      const req = mockReq({ params: { contentId: 'cc-rt' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({
        id: 'cc-rt', type: 'MANUAL_TEXT', rawText: 'text', title: 'T', sourceUrl: null
      });
      (prisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await retrainContent(req, res);

      expect(prisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PROCESSING', errorMessage: null })
        })
      );
    });

    it('should respond with success and background message when queue is disabled', async () => {
      const req = mockReq({ params: { contentId: 'cc-bg' } });
      const res = mockRes();

      (prisma.creator.findUnique as jest.Mock).mockResolvedValue({ id: 'cr-1' });
      (prisma.creatorContent.findFirst as jest.Mock).mockResolvedValue({
        id: 'cc-bg', type: 'YOUTUBE_VIDEO', rawText: null, title: 'T', sourceUrl: 'https://yt.com/v'
      });
      (prisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await retrainContent(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: expect.stringContaining('background') })
      );
    });
  });
});
