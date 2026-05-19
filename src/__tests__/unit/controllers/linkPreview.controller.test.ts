// ===========================================
// LINK PREVIEW CONTROLLER UNIT TESTS
// ===========================================

jest.mock('../../../middleware/errorHandler', () => {
  class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) { super(message); this.statusCode = statusCode; }
  }
  return { AppError, asyncHandler: (fn: Function) => fn };
});

jest.mock('open-graph-scraper', () => jest.fn());
jest.mock('../../../utils/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../utils/openai', () => ({ generateChatCompletion: jest.fn() }));

import { Request, Response } from 'express';
import ogs from 'open-graph-scraper';
import { generateChatCompletion } from '../../../utils/openai';
import { getLinkPreview, generateDescriptionFromUrl } from '../../../controllers/linkPreview.controller';

const mockReq = (overrides = {}) =>
  ({ body: {}, params: {}, query: {}, user: { id: 'user-1' }, ...overrides } as unknown as Request);

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('LinkPreview Controller', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getLinkPreview', () => {
    it('should return link preview data', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: {
          ogTitle: 'Example',
          ogDescription: 'An example site',
          ogImage: [{ url: 'https://example.com/img.png' }],
          ogUrl: 'https://example.com',
          ogSiteName: 'Example',
          ogType: 'website'
        },
        error: false
      });

      await getLinkPreview(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ title: 'Example' })
        })
      );
    });

    it('should throw 400 when url is missing', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();

      await expect(getLinkPreview(req, res)).rejects.toThrow('URL is required');
    });

    it('should throw 400 for invalid URL format', async () => {
      const req = mockReq({ query: { url: 'not-a-url' } });
      const res = mockRes();

      await expect(getLinkPreview(req, res)).rejects.toThrow('Invalid URL format');
    });

    it('should return minimal preview on OGS error', async () => {
      const req = mockReq({ query: { url: 'https://broken.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({ result: {}, error: true });

      // The controller catches the internal throw and returns a minimal preview
      // Since the inner try/catch catches AppError and returns minimal, we test the JSON output
      await getLinkPreview(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ url: 'https://broken.com' })
        })
      );
    });

    // ===========================================
    // NEW BRANCH COVERAGE TESTS
    // ===========================================

    it('should fall back to twitterTitle when ogTitle is absent', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: { twitterTitle: 'Twitter Title', ogUrl: 'https://example.com' },
        error: false
      });

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.title).toBe('Twitter Title');
    });

    it('should use "No title" when neither ogTitle nor twitterTitle exist', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: { ogUrl: 'https://example.com' },
        error: false
      });

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.title).toBe('No title');
    });

    it('should fall back to twitterImage when ogImage is absent', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: { ogTitle: 'Title', twitterImage: [{ url: 'https://tw.com/img.png' }] },
        error: false
      });

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.image).toBe('https://tw.com/img.png');
    });

    it('should set image to null when no ogImage or twitterImage', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: { ogTitle: 'Title' },
        error: false
      });

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.image).toBeNull();
    });

    it('should use "Website" as siteName fallback when ogSiteName and ogTitle absent', async () => {
      const req = mockReq({ query: { url: 'https://example.com' } });
      const res = mockRes();

      (ogs as jest.Mock).mockResolvedValue({
        result: {},
        error: false
      });

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.siteName).toBe('Website');
    });

    it('should use hostname as siteName in minimal fallback preview', async () => {
      const req = mockReq({ query: { url: 'https://myfallback.io/page' } });
      const res = mockRes();

      (ogs as jest.Mock).mockRejectedValue(new Error('Network error'));

      await getLinkPreview(req, res);

      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.data.siteName).toBe('myfallback.io');
      expect(call.data.image).toBeNull();
    });
  });

  describe('generateDescriptionFromUrl', () => {
    it('should throw 400 when url is missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();

      await expect(generateDescriptionFromUrl(req, res)).rejects.toThrow('URL is required');
    });

    it('should throw 400 for invalid URL format', async () => {
      const req = mockReq({ body: { url: 'not-a-url' } });
      const res = mockRes();

      await expect(generateDescriptionFromUrl(req, res)).rejects.toThrow('Invalid URL format');
    });

    it('should call generateChatCompletion and return description', async () => {
      const req = mockReq({ body: { url: 'https://example.com', title: 'My Title', siteName: 'My Site' } });
      const res = mockRes();

      (generateChatCompletion as jest.Mock).mockResolvedValue({ content: '  Great program  ' });

      await generateDescriptionFromUrl(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { description: 'Great program' } })
      );
    });

    it('should build context without title/siteName when they are absent', async () => {
      const req = mockReq({ body: { url: 'https://example.com' } });
      const res = mockRes();

      (generateChatCompletion as jest.Mock).mockResolvedValue({ content: 'Short desc' });

      await generateDescriptionFromUrl(req, res);

      const aiCall = (generateChatCompletion as jest.Mock).mock.calls[0][0];
      const userMessage = aiCall.find((m: any) => m.role === 'user').content;
      expect(userMessage).toContain('https://example.com');
      expect(userMessage).not.toContain('Title:');
      expect(userMessage).not.toContain('Site:');
    });

    it('should include title in context when provided', async () => {
      const req = mockReq({ body: { url: 'https://example.com', title: 'FitPro' } });
      const res = mockRes();

      (generateChatCompletion as jest.Mock).mockResolvedValue({ content: 'desc' });

      await generateDescriptionFromUrl(req, res);

      const aiCall = (generateChatCompletion as jest.Mock).mock.calls[0][0];
      const userMessage = aiCall.find((m: any) => m.role === 'user').content;
      expect(userMessage).toContain('Title: FitPro');
    });
  });
});
