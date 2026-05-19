// ===========================================
// VALIDATION UNIT TESTS
// ===========================================

import { sanitizeInput, sanitizeObject } from '../../middleware/validation';

describe('Validation Utils - Unit Tests', () => {
  describe('sanitizeInput', () => {
    it('should remove script tags', () => {
      const malicious = '<script>alert("XSS")</script>Hello';
      const result = sanitizeInput(malicious);
      expect(result).toBe('Hello');
    });

    it('should remove HTML tags', () => {
      const html = '<div>Hello <b>World</b></div>';
      const result = sanitizeInput(html);
      expect(result).toBe('Hello World');
    });

    it('should trim whitespace', () => {
      const text = '  Hello World  ';
      const result = sanitizeInput(text);
      expect(result).toBe('Hello World');
    });

    it('should handle empty strings', () => {
      const result = sanitizeInput('');
      expect(result).toBe('');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeInput(null as any)).toBe(null);
      expect(sanitizeInput(undefined as any)).toBe(undefined);
    });

    it('should preserve safe text', () => {
      const safe = 'This is safe text 123';
      const result = sanitizeInput(safe);
      expect(result).toBe(safe);
    });
  });

  describe('sanitizeObject', () => {
    it('should sanitize string values in object', () => {
      const obj = {
        name: '<script>alert("XSS")</script>John',
        bio: '<b>Developer</b>',
      };
      const result = sanitizeObject(obj);
      expect(result.name).toBe('John');
      expect(result.bio).toBe('Developer');
    });

    it('should sanitize nested objects', () => {
      const obj = {
        user: {
          name: '<script>XSS</script>Jane',
          profile: {
            bio: '<div>Hello</div>',
          },
        },
      };
      const result = sanitizeObject(obj);
      expect(result.user.name).toBe('Jane');
      expect(result.user.profile.bio).toBe('Hello');
    });

    it('should sanitize arrays', () => {
      const arr = ['<script>XSS</script>Hello', '<b>World</b>'];
      const result = sanitizeObject(arr);
      expect(result).toEqual(['Hello', 'World']);
    });

    it('should preserve non-string values', () => {
      const obj = {
        name: 'John',
        age: 30,
        isActive: true,
        score: 95.5,
      };
      const result = sanitizeObject(obj);
      expect(result).toEqual(obj);
    });

    it('should handle null and undefined values', () => {
      const obj = {
        name: 'John',
        middle: null,
        last: undefined,
      };
      const result = sanitizeObject(obj);
      expect(result.name).toBe('John');
      expect(result.middle).toBe(null);
      expect(result.last).toBe(undefined);
    });
  });
});
