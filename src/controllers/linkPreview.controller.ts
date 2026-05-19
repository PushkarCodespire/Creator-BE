// ===========================================
// LINK PREVIEW CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import ogs from 'open-graph-scraper';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { logError } from '../utils/logger';
import { generateChatCompletion } from '../utils/openai';

// ===========================================
// GET LINK PREVIEW
// ===========================================
export const getLinkPreview = asyncHandler(async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    throw new AppError('URL is required', 400);
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    throw new AppError('Invalid URL format', 400);
  }

  try {
    const options = {
      url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    };
    const { result, error } = await ogs(options);

    if (error) {
      throw new AppError('Failed to fetch link preview', 500);
    }

    // Extract relevant Open Graph data
    const preview = {
      url: result.ogUrl || url,
      title: result.ogTitle || result.twitterTitle || 'No title',
      description: result.ogDescription || result.twitterDescription || '',
      image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
      siteName: result.ogSiteName || result.ogTitle || 'Website',
      type: result.ogType || 'website',
      favicon: result.favicon || null,
    };

    res.json({
      success: true,
      data: preview,
    });
  } catch (error: unknown) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Link preview error' });

    // Return a minimal preview on error
    res.json({
      success: true,
      data: {
        url,
        title: url,
        description: '',
        image: null,
        siteName: new URL(url).hostname,
        type: 'website',
        favicon: null,
      },
    });
  }
});

// ===========================================
// GENERATE AI DESCRIPTION FROM URL
// ===========================================
export const generateDescriptionFromUrl = asyncHandler(async (req: Request, res: Response) => {
  const { url, title, siteName } = req.body;

  if (!url || typeof url !== 'string') {
    throw new AppError('URL is required', 400);
  }

  try {
    new URL(url);
  } catch {
    throw new AppError('Invalid URL format', 400);
  }

  const context = [
    `URL: ${url}`,
    title ? `Title: ${title}` : '',
    siteName ? `Site: ${siteName}` : '',
  ].filter(Boolean).join('\n');

  const { content } = await generateChatCompletion([
    {
      role: 'system',
      content: 'You write short, compelling product and program descriptions for fitness creators. Be specific and benefit-focused. Never use filler phrases like "this product" or "this program". Maximum 2 sentences.',
    },
    {
      role: 'user',
      content: `Write a concise description based on this info:\n${context}`,
    },
  ], { maxTokens: 120, temperature: 0.7 });

  res.json({ success: true, data: { description: content.trim() } });
});
