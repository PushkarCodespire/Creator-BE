// ===========================================
// CONTENT PROCESSOR WORKER — UNIT TESTS
// ===========================================

jest.mock('../../../../prisma/client', () => ({
  __esModule: true,
  default: {
    creatorContent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    contentChunk: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../../services/content/chunking.service', () => ({
  chunkContent: jest.fn(),
  validateChunks: jest.fn(),
}));

jest.mock('../../../services/content/embedding.service', () => ({
  generateEmbeddings: jest.fn(),
}));

jest.mock('../../../utils/vectorStore', () => ({
  storeVectors: jest.fn(),
  deleteVectorsByContent: jest.fn(),
}));

jest.mock('../../../sockets/content.socket', () => ({
  ContentSocketHandler: {
    emitProgress: jest.fn(),
    emitCompletion: jest.fn(),
    emitFailure: jest.fn(),
  },
}));

jest.mock('../../../utils/metrics', () => ({
  recordContentProcessing: jest.fn(),
  recordOpenAICall: jest.fn(),
}));

jest.mock('../../../utils/contentLogger', () => ({
  logContentProcessing: jest.fn(),
  logChunking: jest.fn(),
  logEmbeddingGeneration: jest.fn(),
  logContentCompletion: jest.fn(),
  logContentFailure: jest.fn(),
}));

import prisma from '../../../../prisma/client';
import { chunkContent, validateChunks } from '../../../services/content/chunking.service';
import { generateEmbeddings } from '../../../services/content/embedding.service';
import { storeVectors, deleteVectorsByContent } from '../../../utils/vectorStore';
import { ContentSocketHandler } from '../../../sockets/content.socket';
import { processContentJob } from '../../../services/queue/content-processor.worker';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('ContentProcessorWorker', () => {
  const mockJob = {
    data: {
      contentId: 'content-1',
      creatorId: 'creator-1',
      userId: 'user-1',
      type: 'YOUTUBE_VIDEO' as const,
    },
    progress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processContentJob', () => {
    it('should process content through full pipeline', async () => {
      // Setup mocks for the full pipeline
      (mockPrisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        id: 'content-1',
        rawText: 'A'.repeat(500) + ' ' + 'B'.repeat(500),
        title: 'Test Content',
        type: 'YOUTUBE_VIDEO',
      });

      (mockPrisma.contentChunk.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      (chunkContent as jest.Mock).mockReturnValue([
        { text: 'Chunk 1 text', index: 0, characterCount: 100, wordCount: 15 },
        { text: 'Chunk 2 text', index: 1, characterCount: 100, wordCount: 15 },
      ]);

      (validateChunks as jest.Mock).mockReturnValue({ valid: true, issues: [] });

      (mockPrisma.contentChunk.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'chunk-1' })
        .mockResolvedValueOnce({ id: 'chunk-2' });

      (generateEmbeddings as jest.Mock).mockResolvedValue([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);

      (mockPrisma.contentChunk.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      const result = await processContentJob(mockJob as any);

      expect(result.chunksCreated).toBe(2);
      expect(result.embeddingsGenerated).toBe(2);
      expect(result.processingTime).toBeGreaterThan(0);
      expect(deleteVectorsByContent).toHaveBeenCalledWith('content-1');
      expect(storeVectors).toHaveBeenCalled();
      expect(mockJob.progress).toHaveBeenCalledWith(100);
    });

    it('should throw error when content not found', async () => {
      (mockPrisma.creatorContent.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await expect(processContentJob(mockJob as any)).rejects.toThrow(
        'Content not found or empty'
      );

      expect(ContentSocketHandler.emitFailure).toHaveBeenCalledWith(
        'user-1',
        'content-1',
        'Content not found or empty'
      );
    });

    it('should throw error when rawText is empty', async () => {
      (mockPrisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        id: 'content-1',
        rawText: '',
      });
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await expect(processContentJob(mockJob as any)).rejects.toThrow(
        'Content not found or empty'
      );
    });

    it('should update content status to FAILED on error', async () => {
      (mockPrisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        id: 'content-1',
        rawText: 'Some text',
      });

      (mockPrisma.contentChunk.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (chunkContent as jest.Mock).mockImplementation(() => {
        throw new Error('Chunking failed');
      });
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await expect(processContentJob(mockJob as any)).rejects.toThrow('Chunking failed');

      expect(mockPrisma.creatorContent.update).toHaveBeenCalledWith({
        where: { id: 'content-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Chunking failed',
        }),
      });
    });

    it('should emit progress updates throughout processing', async () => {
      (mockPrisma.creatorContent.findUnique as jest.Mock).mockResolvedValue({
        id: 'content-1',
        rawText: 'Some text here',
        title: 'Test',
        type: 'MANUAL_TEXT',
      });

      (mockPrisma.contentChunk.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      (chunkContent as jest.Mock).mockReturnValue([
        { text: 'Chunk 1', index: 0, characterCount: 50, wordCount: 8 },
      ]);
      (validateChunks as jest.Mock).mockReturnValue({ valid: true, issues: [] });
      (mockPrisma.contentChunk.create as jest.Mock).mockResolvedValue({ id: 'chunk-1' });
      (generateEmbeddings as jest.Mock).mockResolvedValue([[0.1, 0.2]]);
      (mockPrisma.contentChunk.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.creatorContent.update as jest.Mock).mockResolvedValue({});

      await processContentJob(mockJob as any);

      // Should emit progress at 0, 10, 20, 30, 40, 70, 80, 90, 100
      expect(mockJob.progress).toHaveBeenCalledWith(0);
      expect(mockJob.progress).toHaveBeenCalledWith(100);
      expect(ContentSocketHandler.emitProgress).toHaveBeenCalled();
      expect(ContentSocketHandler.emitCompletion).toHaveBeenCalledWith(
        'user-1',
        'content-1',
        1 // 1 chunk
      );
    });
  });
});
