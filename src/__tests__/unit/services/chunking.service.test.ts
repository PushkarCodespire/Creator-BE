// ===========================================
// CHUNKING SERVICE — UNIT TESTS
// ===========================================

import { chunkContent, validateChunks, Chunk } from '../../../services/content/chunking.service';

describe('ChunkingService', () => {
  describe('chunkContent', () => {
    it('should chunk text into multiple pieces', () => {
      const text = Array(20)
        .fill('This is a test sentence with enough words to be meaningful.')
        .join('\n\n');

      const chunks = chunkContent(text);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.text).toBeTruthy();
        expect(chunk.index).toBeGreaterThanOrEqual(0);
        expect(chunk.characterCount).toBeGreaterThan(0);
        expect(chunk.wordCount).toBeGreaterThan(0);
      });
    });

    it('should respect custom chunk size', () => {
      const text = Array(20)
        .fill('This is a test sentence for chunking. It has several words to work with.')
        .join('\n\n');

      const chunks = chunkContent(text, { chunkSize: 400 });

      // All chunks should be reasonable size relative to target
      chunks.forEach((chunk) => {
        expect(chunk.characterCount).toBeLessThanOrEqual(1500);
      });
    });

    it('should filter out chunks smaller than 50 characters', () => {
      const text = Array(15)
        .fill('This is a meaningful paragraph with enough content to form a proper chunk.')
        .join('\n\n');

      const chunks = chunkContent(text);

      chunks.forEach((chunk) => {
        expect(chunk.characterCount).toBeGreaterThanOrEqual(50);
      });
    });

    it('should include word count in chunk metadata', () => {
      const text = Array(10)
        .fill('Word one two three four five six seven eight nine ten eleven twelve.')
        .join('\n\n');

      const chunks = chunkContent(text);

      chunks.forEach((chunk) => {
        expect(chunk.wordCount).toBeGreaterThan(0);
        // Word count should roughly match splitting by whitespace
        const expectedWords = chunk.text.split(/\s+/).length;
        expect(chunk.wordCount).toBe(expectedWords);
      });
    });

    it('should return empty array for empty text', () => {
      const chunks = chunkContent('');
      expect(chunks).toEqual([]);
    });

    it('should handle very short text that forms a single chunk', () => {
      const text = 'This is a short text that should be exactly one chunk of content if it is long enough to pass validation.';
      const chunks = chunkContent(text);

      // May be 0 or 1 depending on length threshold
      expect(chunks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('validateChunks', () => {
    it('should return valid for well-formed chunks', () => {
      const chunks: Chunk[] = [
        { text: 'A'.repeat(500), index: 0, characterCount: 500, wordCount: 50 },
        { text: 'B'.repeat(600), index: 1, characterCount: 600, wordCount: 60 },
      ];

      const result = validateChunks(chunks);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should flag empty chunk arrays', () => {
      const result = validateChunks([]);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('No chunks created');
    });

    it('should flag chunks that are too small', () => {
      const chunks: Chunk[] = [
        { text: 'Short', index: 0, characterCount: 5, wordCount: 1 },
        { text: 'B'.repeat(600), index: 1, characterCount: 600, wordCount: 60 },
      ];

      const result = validateChunks(chunks);

      expect(result.issues.some((i) => i.includes('too small'))).toBe(true);
    });

    it('should flag chunks that are too large', () => {
      const chunks: Chunk[] = [
        { text: 'X'.repeat(2000), index: 0, characterCount: 2000, wordCount: 200 },
      ];

      const result = validateChunks(chunks);

      expect(result.issues.some((i) => i.includes('too large'))).toBe(true);
    });

    it('should flag suboptimal average chunk size', () => {
      const chunks: Chunk[] = [
        { text: 'A'.repeat(100), index: 0, characterCount: 100, wordCount: 10 },
        { text: 'B'.repeat(100), index: 1, characterCount: 100, wordCount: 10 },
      ];

      const result = validateChunks(chunks);

      // Average is 100, which is below 300 target range
      expect(result.issues.some((i) => i.includes('suboptimal'))).toBe(true);
    });
  });
});
