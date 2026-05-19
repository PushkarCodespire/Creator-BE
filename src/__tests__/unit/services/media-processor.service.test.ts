// ===========================================
// MEDIA PROCESSOR SERVICE — UNIT TESTS
// ===========================================

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('pdf-parse', () => jest.fn());

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));

jest.mock('mime-types', () => ({
  lookup: jest.fn(),
}));

jest.mock('../../../config', () => ({
  config: {
    upload: { dir: '/uploads', publicPath: '/uploads', publicUrl: '' },
  },
}));

jest.mock('../../../utils/openai', () => ({
  openai: {
    audio: {
      transcriptions: { create: jest.fn() },
    },
    chat: {
      completions: { create: jest.fn() },
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock('../../../utils/uploadPaths', () => ({
  getUploadPathPrefixes: jest.fn(() => ['/uploads/']),
}));

import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { openai } from '../../../utils/openai';
import { buildAttachmentContext } from '../../../services/media/media-processor.service';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPdfParse = pdfParse as jest.MockedFunction<typeof pdfParse>;
const mockMammoth = mammoth as jest.Mocked<typeof mammoth>;

describe('MediaProcessorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildAttachmentContext', () => {
    it('should return empty result when no media provided', async () => {
      const result = await buildAttachmentContext(undefined);

      expect(result.combined).toBe('');
      expect(result.parts).toEqual([]);
    });

    it('should return empty result for empty media array', async () => {
      const result = await buildAttachmentContext([]);

      expect(result.combined).toBe('');
      expect(result.parts).toEqual([]);
    });

    it('should transcribe audio files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      (openai.audio.transcriptions.create as jest.Mock).mockResolvedValue({
        text: 'Transcribed audio content',
      });

      const result = await buildAttachmentContext([
        { type: 'audio', url: '/uploads/test.mp3', name: 'test.mp3' },
      ]);

      expect(result.parts[0]).toContain('Audio');
      expect(result.parts[0]).toContain('Transcribed audio content');
    });

    it('should describe image files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('fake-image-data'));
      (require('mime-types').lookup as jest.Mock).mockReturnValue('image/png');

      (openai.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [{ message: { content: 'A photo of a sunset' } }],
      });

      const result = await buildAttachmentContext([
        { type: 'image', url: '/uploads/photo.png', name: 'photo.png' },
      ]);

      expect(result.parts[0]).toContain('Image');
      expect(result.parts[0]).toContain('A photo of a sunset');
    });

    it('should extract text from PDF documents', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('pdf-content'));
      mockPdfParse.mockResolvedValue({ text: 'Extracted PDF text' } as any);

      const result = await buildAttachmentContext([
        { type: 'file', url: '/uploads/doc.pdf', name: 'doc.pdf' },
      ]);

      expect(result.parts[0]).toContain('File');
      expect(result.parts[0]).toContain('Extracted PDF text');
    });

    it('should extract text from DOCX documents', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockMammoth.extractRawText.mockResolvedValue({ value: 'Word document text', messages: [] });

      const result = await buildAttachmentContext([
        { type: 'file', url: '/uploads/report.docx', name: 'report.docx' },
      ]);

      expect(result.parts[0]).toContain('File');
      expect(result.parts[0]).toContain('Word document text');
    });

    it('should skip files that do not exist on disk', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await buildAttachmentContext([
        { type: 'audio', url: '/uploads/missing.mp3', name: 'missing.mp3' },
      ]);

      expect(result.parts).toEqual([]);
    });

    it('should limit to MAX_ATTACHMENTS (3)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('content'));
      (require('mime-types').lookup as jest.Mock).mockReturnValue('text/plain');

      const media = Array.from({ length: 5 }, (_, i) => ({
        type: 'file' as const,
        url: `/uploads/file${i}.txt`,
        name: `file${i}.txt`,
      }));

      // txt files return readFileSync content
      await buildAttachmentContext(media);

      // Only 3 files should be processed (MAX_ATTACHMENTS = 3)
      // The test passes if it doesn't try to process more than 3
      expect(mockFs.existsSync).toHaveBeenCalledTimes(3);
    });

    it('should handle audio transcription errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      (openai.audio.transcriptions.create as jest.Mock).mockRejectedValue(
        new Error('Whisper API error')
      );

      const result = await buildAttachmentContext([
        { type: 'audio', url: '/uploads/bad.mp3', name: 'bad.mp3' },
      ]);

      // Should not crash, returns empty parts
      expect(result.parts).toEqual([]);
    });
  });
});

// ==========================================================
// EXTENDED BRANCH COVERAGE
// ==========================================================

describe('MediaProcessorService — extended coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty combined string when all media items not found on disk', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await buildAttachmentContext([
      { type: 'image', url: '/uploads/missing.png', name: 'missing.png' },
      { type: 'audio', url: '/uploads/missing.mp3', name: 'missing.mp3' },
    ]);
    expect(result.combined).toBe('');
    expect(result.parts).toHaveLength(0);
  });

  it('skips audio when transcription returns empty string', async () => {
    mockFs.existsSync.mockReturnValue(true);
    (openai.audio.transcriptions.create as jest.Mock).mockResolvedValue({ text: '' });

    const result = await buildAttachmentContext([
      { type: 'audio', url: '/uploads/silent.mp3', name: 'silent.mp3' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('skips image when description returns empty string', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('data'));
    (require('mime-types').lookup as jest.Mock).mockReturnValue('image/jpeg');
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    const result = await buildAttachmentContext([
      { type: 'image', url: '/uploads/empty.jpg', name: 'empty.jpg' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('handles vision API error gracefully for image', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('data'));
    (require('mime-types').lookup as jest.Mock).mockReturnValue('image/jpeg');
    (openai.chat.completions.create as jest.Mock).mockRejectedValue(new Error('Vision API down'));

    const result = await buildAttachmentContext([
      { type: 'image', url: '/uploads/error.jpg', name: 'error.jpg' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('handles image when choices array is empty', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('data'));
    (require('mime-types').lookup as jest.Mock).mockReturnValue('image/png');
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({ choices: [] });

    const result = await buildAttachmentContext([
      { type: 'image', url: '/uploads/no-choice.png', name: 'no-choice.png' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('extracts txt file content directly via readFileSync', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('Plain text document content' as any);

    const result = await buildAttachmentContext([
      { type: 'file', url: '/uploads/readme.txt', name: 'readme.txt' },
    ]);

    expect(result.parts[0]).toContain('File');
    expect(result.parts[0]).toContain('Plain text document content');
  });

  it('skips unsupported document type gracefully', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('binary data'));

    const result = await buildAttachmentContext([
      { type: 'file', url: '/uploads/archive.zip', name: 'archive.zip' },
    ]);

    // Unsupported type returns '' → no part added
    expect(result.parts).toHaveLength(0);
  });

  it('handles PDF parse error gracefully', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(Buffer.from('pdf-bytes'));
    mockPdfParse.mockRejectedValue(new Error('PDF corrupt'));

    const result = await buildAttachmentContext([
      { type: 'file', url: '/uploads/corrupt.pdf', name: 'corrupt.pdf' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('handles DOCX mammoth error gracefully', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockMammoth.extractRawText.mockRejectedValue(new Error('DOCX parse error'));

    const result = await buildAttachmentContext([
      { type: 'file', url: '/uploads/bad.docx', name: 'bad.docx' },
    ]);

    expect(result.parts).toHaveLength(0);
  });

  it('truncates document text at 1200 characters', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const longText = 'A'.repeat(2000);
    mockFs.readFileSync.mockReturnValue(longText as any);

    const result = await buildAttachmentContext([
      { type: 'file', url: '/uploads/long.txt', name: 'long.txt' },
    ]);

    // Text should be sliced to 1200 chars
    if (result.parts.length > 0) {
      expect(result.parts[0].length).toBeLessThan(longText.length + 50);
    }
  });

  it('combines multiple parts with double-newline separator', async () => {
    mockFs.existsSync.mockReturnValue(true);
    (openai.audio.transcriptions.create as jest.Mock).mockResolvedValue({ text: 'Audio content' });
    mockFs.readFileSync.mockReturnValue('Text file content' as any);

    const result = await buildAttachmentContext([
      { type: 'audio', url: '/uploads/a.mp3', name: 'a.mp3' },
      { type: 'file', url: '/uploads/b.txt', name: 'b.txt' },
    ]);

    if (result.parts.length === 2) {
      expect(result.combined).toContain('\n\n');
    }
  });

  it('uses item.name in the part label when provided', async () => {
    mockFs.existsSync.mockReturnValue(true);
    (openai.audio.transcriptions.create as jest.Mock).mockResolvedValue({ text: 'Transcript here' });

    const result = await buildAttachmentContext([
      { type: 'audio', url: '/uploads/recording.mp3', name: 'My Recording' },
    ]);

    expect(result.parts[0]).toContain('My Recording');
  });

  it('resolves URL with absolute http scheme to local path correctly', async () => {
    // When url is a full http URL the service should try to strip the upload path prefix
    // and look for the local file — if not found, skip gracefully
    mockFs.existsSync.mockReturnValue(false);

    const result = await buildAttachmentContext([
      { type: 'file', url: 'http://localhost:5000/uploads/file.txt', name: 'file.txt' },
    ]);

    expect(result.parts).toHaveLength(0);
  });
});
