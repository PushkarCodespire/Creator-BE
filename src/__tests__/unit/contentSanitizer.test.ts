// ===========================================
// CONTENT SANITIZER UNIT TESTS
// ===========================================

import { sanitizeContent, sanitizeText, validateContentQuality } from '../../utils/contentSanitizer';

describe('Content Sanitizer Utils - Unit Tests', () => {
  describe('sanitizeContent', () => {
    it('should allow permitted HTML tags', () => {
      const input = '<p>Hello <strong>World</strong></p>';
      const result = sanitizeContent(input);
      expect(result).toBe('<p>Hello <strong>World</strong></p>');
    });

    it('should strip script tags', () => {
      const input = '<script>alert("XSS")</script><p>Safe</p>';
      const result = sanitizeContent(input);
      expect(result).toBe('<p>Safe</p>');
    });

    it('should strip disallowed tags like div, span, img', () => {
      const input = '<div><span>Text</span><img src="evil.jpg" /></div>';
      const result = sanitizeContent(input);
      expect(result).not.toContain('<div>');
      expect(result).not.toContain('<span>');
      expect(result).not.toContain('<img');
    });

    it('should strip all attributes from allowed tags', () => {
      const input = '<p class="evil" onclick="alert(1)">Text</p>';
      const result = sanitizeContent(input);
      expect(result).toBe('<p>Text</p>');
    });

    it('should allow list elements', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = sanitizeContent(input);
      expect(result).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    it('should allow heading tags h1, h2, h3', () => {
      const input = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
      const result = sanitizeContent(input);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<h2>Subtitle</h2>');
      expect(result).toContain('<h3>Section</h3>');
    });

    it('should strip iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>';
      const result = sanitizeContent(input);
      expect(result).not.toContain('<iframe');
      expect(result).toContain('<p>Safe</p>');
    });

    it('should allow br tags', () => {
      const input = 'Line 1<br>Line 2';
      const result = sanitizeContent(input);
      expect(result).toContain('<br');
    });

    it('should handle empty string', () => {
      const result = sanitizeContent('');
      expect(result).toBe('');
    });
  });

  describe('sanitizeText', () => {
    it('should strip all HTML tags', () => {
      const input = '<div>Hello <b>World</b></div>';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });

    it('should collapse excessive whitespace', () => {
      const input = 'Hello    World   Test';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World Test');
    });

    it('should remove control characters', () => {
      const input = 'Hello\x00\x01\x02World';
      const result = sanitizeText(input);
      expect(result).toBe('HelloWorld');
    });

    it('should trim leading and trailing whitespace', () => {
      const input = '   Hello World   ';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });

    it('should handle text with script tags', () => {
      const input = '<script>alert("XSS")</script>Hello';
      const result = sanitizeText(input);
      expect(result).not.toContain('<script>');
      expect(result).toContain('Hello');
    });

    it('should handle newlines and tabs as whitespace', () => {
      const input = 'Hello\n\t\tWorld';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });

    it('should preserve normal text unchanged', () => {
      const input = 'This is normal text';
      const result = sanitizeText(input);
      expect(result).toBe('This is normal text');
    });
  });

  describe('validateContentQuality', () => {
    it('should pass for valid content', () => {
      const text = 'This is a perfectly valid piece of content that has enough words and characters to pass all quality checks easily.';
      const result = validateContentQuality(text);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should fail for content shorter than 50 characters', () => {
      const text = 'Too short text here';
      const result = validateContentQuality(text);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Content is too short (minimum 50 characters)');
    });

    it('should fail for content with fewer than 10 words', () => {
      // 50 chars but less than 10 words
      const text = 'Aaaaaaaaaa Bbbbbbbbb Ccccccccc Ddddddddd Eeeeeeeee';
      const result = validateContentQuality(text);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Content must contain at least 10 words');
    });

    it('should fail for content with too many special characters', () => {
      const text = '!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()abc def ghi jkl mno pqr stu vxw yza bcd efg';
      const result = validateContentQuality(text);
      expect(result.issues).toContain('Content contains too many special characters');
    });

    it('should fail for content with excessive whitespace (three or more spaces)', () => {
      const text = 'This text has   three spaces which is excessive but enough words to pass the minimum word count requirement for the test here.';
      const result = validateContentQuality(text);
      expect(result.issues).toContain('Content contains excessive whitespace');
    });

    it('should fail for content with repeated characters', () => {
      const text = 'This is suspicious aaaaaaaaaaaaa content that has enough words and characters to be long enough for validation checks.';
      const result = validateContentQuality(text);
      expect(result.issues).toContain('Content contains suspicious patterns');
    });

    it('should fail for content with excessive caps', () => {
      const text = 'This has AAAAAAAAAAAAAAAAAAAAAAA excessive caps and enough words and characters to be long enough for validation checks.';
      const result = validateContentQuality(text);
      expect(result.issues).toContain('Content contains suspicious patterns');
    });

    it('should return multiple issues for badly formatted content', () => {
      const text = 'bad';
      const result = validateContentQuality(text);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
