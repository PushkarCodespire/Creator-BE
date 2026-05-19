// ===========================================
// CONTENT PROCESSOR WORKER — UNIT TESTS
// Targets: src/workers/contentProcessor.ts
// ===========================================

// ---- mocks declared before any imports ----

const mockPrisma = {
  creatorContent: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../../prisma/client', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../utils/youtube', () => ({
  fetchYouTubeTranscript: jest.fn(),
}));

jest.mock('../../utils/vectorStore', () => ({
  storeVectors: jest.fn(),
}));

jest.mock('../../utils/openai', () => ({
  chunkText: jest.fn(),
  generateEmbedding: jest.fn(),
}));

jest.mock('../../middleware/errorHandler', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.mock('../../utils/messageQueue', () => ({
  messageQueue: {
    addJob: jest.fn().mockResolvedValue('job-id-123'),
  },
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

import { ContentProcessor } from '../../workers/contentProcessor';
import { fetchYouTubeTranscript } from '../../utils/youtube';
import { storeVectors } from '../../utils/vectorStore';
import { chunkText, generateEmbedding } from '../../utils/openai';
import { messageQueue } from '../../utils/messageQueue';
import { ContentType, ContentStatus } from '@prisma/client';

// ---- helpers ----

const baseContent = {
  id: 'content-1',
  type: ContentType.YOUTUBE_VIDEO,
  sourceUrl: 'https://youtube.com/watch?v=abc',
  filePath: null,
  rawText: null,
  status: ContentStatus.PENDING,
  creator: { id: 'creator-1' },
};

// ===========================================================
describe('ContentProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- queueContent ----

  describe('queueContent', () => {
    it('adds job to messageQueue with correct parameters', async () => {
      await ContentProcessor.queueContent({
        contentId: 'content-1',
        type: ContentType.YOUTUBE_VIDEO,
        sourceUrl: 'https://youtube.com/watch?v=abc',
      });

      expect(messageQueue.addJob).toHaveBeenCalledWith(
        'content_processing',
        expect.objectContaining({ contentId: 'content-1' }),
        expect.objectContaining({ priority: 8, maxAttempts: 3 })
      );
    });

    it('propagates error when messageQueue.addJob throws', async () => {
      (messageQueue.addJob as jest.Mock).mockRejectedValue(new Error('Queue unavailable'));

      await expect(
        ContentProcessor.queueContent({ contentId: 'x', type: ContentType.MANUAL_TEXT })
      ).rejects.toThrow('Queue unavailable');
    });
  });

  // ---- processContent — YOUTUBE_VIDEO ----

  describe('processContent — YOUTUBE_VIDEO', () => {
    it('processes YouTube video: fetches transcript, stores vectors', async () => {
      (fetchYouTubeTranscript as jest.Mock).mockResolvedValue({
        videoId: 'abc',
        transcript: 'Full video transcript',
        segments: [],
      });
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        ...baseContent,
        creator: { id: 'creator-1' },
      });
      (chunkText as jest.Mock).mockReturnValue(['chunk1', 'chunk2']);
      (generateEmbedding as jest.Mock).mockResolvedValue([0.1, 0.2, 0.3]);

      await ContentProcessor.processContent({
        contentId: 'content-1',
        type: ContentType.YOUTUBE_VIDEO,
        sourceUrl: 'https://youtube.com/watch?v=abc',
      });

      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ContentStatus.PROCESSING }),
        })
      );
      expect(fetchYouTubeTranscript).toHaveBeenCalledWith('https://youtube.com/watch?v=abc');
      expect(storeVectors).toHaveBeenCalled();
    });

    it('throws AppError when sourceUrl is missing for YOUTUBE_VIDEO', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});

      await expect(
        ContentProcessor.processContent({
          contentId: 'content-1',
          type: ContentType.YOUTUBE_VIDEO,
          // no sourceUrl
        })
      ).rejects.toThrow('YouTube URL is required');

      // Status should be set to FAILED
      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ContentStatus.FAILED }),
        })
      );
    });
  });

  // ---- processContent — UPLOADED_FILE ----

  describe('processContent — UPLOADED_FILE', () => {
    it('processes uploaded file with placeholder text', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue(null); // not called for UPLOADED_FILE

      await expect(
        ContentProcessor.processContent({
          contentId: 'content-2',
          type: ContentType.UPLOADED_FILE,
          filePath: '/tmp/file.pdf',
        })
      ).resolves.not.toThrow();

      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ContentStatus.COMPLETED }),
        })
      );
    });

    it('throws AppError when filePath is missing for UPLOADED_FILE', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});

      await expect(
        ContentProcessor.processContent({
          contentId: 'content-2',
          type: ContentType.UPLOADED_FILE,
          // no filePath
        })
      ).rejects.toThrow('File path is required');
    });
  });

  // ---- processContent — MANUAL_TEXT ----

  describe('processContent — MANUAL_TEXT', () => {
    it('reads rawText from DB for MANUAL_TEXT', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique
        .mockResolvedValueOnce(null) // first call for update to PROCESSING (not called here)
        .mockResolvedValueOnce({
          id: 'content-3',
          rawText: 'Manually entered text',
          creator: { id: 'creator-1' },
        });
      // Actual sequence: findUnique is called in the MANUAL_TEXT branch
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'content-3',
        rawText: 'Manually entered text',
        creator: { id: 'creator-1' },
      });
      (chunkText as jest.Mock).mockReturnValue(['chunk1']);
      (generateEmbedding as jest.Mock).mockResolvedValue([0.1]);

      await ContentProcessor.processContent({
        contentId: 'content-3',
        type: ContentType.MANUAL_TEXT,
      });

      expect(mockPrisma.creatorContent.findUnique).toHaveBeenCalled();
      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ContentStatus.COMPLETED }),
        })
      );
    });

    it('processes FAQ content the same as MANUAL_TEXT', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'faq-1',
        rawText: 'FAQ content here',
        creator: { id: 'creator-1' },
      });
      (chunkText as jest.Mock).mockReturnValue(['faq-chunk']);
      (generateEmbedding as jest.Mock).mockResolvedValue([0.5]);

      await ContentProcessor.processContent({
        contentId: 'faq-1',
        type: ContentType.FAQ,
      });

      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ContentStatus.COMPLETED }),
        })
      );
    });
  });

  // ---- processContent — unsupported type ----

  describe('processContent — unsupported type', () => {
    it('throws AppError for unsupported content type', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});

      await expect(
        ContentProcessor.processContent({
          contentId: 'bad',
          type: 'INSTAGRAM_POST' as ContentType,
        })
      ).rejects.toThrow('Unsupported content type');
    });
  });

  // ---- processContent — embedding error path ----

  describe('processContent — embedding failures', () => {
    it('does not fail overall when embedding generation throws', async () => {
      (fetchYouTubeTranscript as jest.Mock).mockResolvedValue({
        videoId: 'abc',
        transcript: 'transcript text',
        segments: [],
      });
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue(null); // content not found in embeddings fn
      (chunkText as jest.Mock).mockReturnValue(['chunk1']);
      (generateEmbedding as jest.Mock).mockRejectedValue(new Error('Embedding API down'));

      // Should not throw — embedding errors are swallowed
      await expect(
        ContentProcessor.processContent({
          contentId: 'content-emb',
          type: ContentType.YOUTUBE_VIDEO,
          sourceUrl: 'https://youtube.com/watch?v=abc',
        })
      ).resolves.not.toThrow();
    });

    it('skips embedding when rawText is empty', async () => {
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'empty',
        rawText: '',
        creator: { id: 'c1' },
      });

      await ContentProcessor.processContent({
        contentId: 'empty',
        type: ContentType.MANUAL_TEXT,
      });

      expect(chunkText).not.toHaveBeenCalled();
    });
  });

  // ---- processPendingContent ----

  describe('processPendingContent', () => {
    it('finds and processes all pending content items', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([
        { id: 'p1', type: ContentType.MANUAL_TEXT, sourceUrl: null, filePath: null },
        { id: 'p2', type: ContentType.MANUAL_TEXT, sourceUrl: null, filePath: null },
      ]);
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'px',
        rawText: 'text',
        creator: { id: 'c1' },
      });
      (chunkText as jest.Mock).mockReturnValue([]);

      await ContentProcessor.processPendingContent();

      expect(mockPrisma.creatorContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: ContentStatus.PENDING } })
      );
    });

    it('continues processing other items when one fails', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([
        { id: 'fail1', type: ContentType.YOUTUBE_VIDEO, sourceUrl: null, filePath: null },
        { id: 'ok1', type: ContentType.MANUAL_TEXT, sourceUrl: null, filePath: null },
      ]);
      mockPrisma.creatorContent.update.mockResolvedValue({});
      // fail1 → YOUTUBE_VIDEO with no sourceUrl → throws AppError
      // ok1 → MANUAL_TEXT → reads rawText
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'ok1',
        rawText: 'some text',
        creator: { id: 'c1' },
      });
      (chunkText as jest.Mock).mockReturnValue([]);

      // Should not throw even if one item fails
      await expect(ContentProcessor.processPendingContent()).resolves.not.toThrow();
    });

    it('handles empty pending list gracefully', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([]);

      await expect(ContentProcessor.processPendingContent()).resolves.not.toThrow();
    });
  });

  // ---- retryFailedContent ----

  describe('retryFailedContent', () => {
    it('retries failed items from last 24 hours', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([
        { id: 'f1', type: ContentType.MANUAL_TEXT, sourceUrl: null, filePath: null },
      ]);
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'f1',
        rawText: 'retry text',
        creator: { id: 'c1' },
      });
      (chunkText as jest.Mock).mockReturnValue([]);

      await ContentProcessor.retryFailedContent();

      expect(mockPrisma.creatorContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: ContentStatus.FAILED }) })
      );
    });

    it('handles empty failed list gracefully', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([]);

      await expect(ContentProcessor.retryFailedContent()).resolves.not.toThrow();
    });

    it('continues when a retry item fails again', async () => {
      mockPrisma.creatorContent.findMany.mockResolvedValue([
        { id: 'retry-fail', type: ContentType.YOUTUBE_VIDEO, sourceUrl: null, filePath: null },
      ]);
      mockPrisma.creatorContent.update.mockResolvedValue({});

      await expect(ContentProcessor.retryFailedContent()).resolves.not.toThrow();
    });
  });

  // ---- generateContentEmbeddings via processContent ----

  describe('embedding generation via processContent', () => {
    it('stores one vector entry per chunk', async () => {
      (fetchYouTubeTranscript as jest.Mock).mockResolvedValue({
        videoId: 'v1',
        transcript: 'text',
        segments: [],
      });
      mockPrisma.creatorContent.update.mockResolvedValue({});
      mockPrisma.creatorContent.findUnique.mockResolvedValue({
        id: 'content-1',
        rawText: 'text',
        creator: { id: 'creator-1' },
      });
      (chunkText as jest.Mock).mockReturnValue(['chunk-a', 'chunk-b', 'chunk-c']);
      (generateEmbedding as jest.Mock).mockResolvedValue([0.1, 0.2]);

      await ContentProcessor.processContent({
        contentId: 'content-1',
        type: ContentType.YOUTUBE_VIDEO,
        sourceUrl: 'https://youtube.com/watch?v=v1',
      });

      expect(storeVectors).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ chunkIndex: 0 }),
          expect.objectContaining({ chunkIndex: 1 }),
          expect.objectContaining({ chunkIndex: 2 }),
        ])
      );
    });

    it('skips vector storage when content has no creator', async () => {
      (fetchYouTubeTranscript as jest.Mock).mockResolvedValue({
        videoId: 'v2',
        transcript: 'text',
        segments: [],
      });
      mockPrisma.creatorContent.update.mockResolvedValue({});
      // findUnique returns null → embedding fn throws, but is caught internally
      mockPrisma.creatorContent.findUnique.mockResolvedValue(null);
      (chunkText as jest.Mock).mockReturnValue(['chunk-x']);
      (generateEmbedding as jest.Mock).mockResolvedValue([0.5]);

      await expect(
        ContentProcessor.processContent({
          contentId: 'content-nocreator',
          type: ContentType.YOUTUBE_VIDEO,
          sourceUrl: 'https://youtube.com/watch?v=v2',
        })
      ).resolves.not.toThrow();
    });
  });
});
