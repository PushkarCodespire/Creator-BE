// ===========================================
// CONTENT SANITIZER
// ===========================================
// Sanitize user-submitted content to prevent XSS and ensure quality

import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize HTML content
 */
export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'],
    allowedAttributes: {},
    allowedIframeHostnames: []
  });
}

/**
 * Sanitize plain text content
 */
export function sanitizeText(text: string): string {
  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');
  
  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Remove control characters (intentional — stripping C0 and DEL ranges from input)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F]/g, '');
  
  // Trim
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Validate content quality
 */
export function validateContentQuality(text: string): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check minimum length
  if (text.length < 50) {
    issues.push('Content is too short (minimum 50 characters)');
  }
  
  // Check word count
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 10) {
    issues.push('Content must contain at least 10 words');
  }
  
  // Check for excessive special characters.
  // \p{L} = letters, \p{N} = numbers, \p{M} = combining marks (Devanagari vowel signs,
  // Arabic diacritics, Thai tone marks, etc. — all required for non-Latin scripts).
  const specialCharCount = (text.match(/[^\p{L}\p{N}\p{M}\s]/gu) || []).length;
  const specialCharRatio = specialCharCount / text.length;
  if (specialCharRatio > 0.4) {
    issues.push('Content contains too many special characters');
  }
  
  // Check for excessive whitespace
  if (text.includes('   ')) {
    issues.push('Content contains excessive whitespace');
  }
  
  // Check for suspicious patterns (basic spam detection)
  const suspiciousPatterns = [
    /(.)\1{10,}/, // Repeated characters
    /(http|https|www\.){3,}/i, // Multiple URLs
    /[A-Z]{20,}/, // Excessive caps
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) {
      issues.push('Content contains suspicious patterns');
      break;
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}
