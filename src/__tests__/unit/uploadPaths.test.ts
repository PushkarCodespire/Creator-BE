// ===========================================
// UPLOAD PATHS UNIT TESTS
// ===========================================

jest.mock('../../config', () => ({
  config: {
    upload: {
      dir: '/tmp/uploads',
      publicPath: '/api/upload/image',
      publicUrl: undefined,
    },
  },
}));

import { buildUploadUrl, buildDownloadUrl, getUploadPathPrefixes } from '../../utils/uploadPaths';

describe('Upload Paths Utils - Unit Tests', () => {
  describe('buildUploadUrl', () => {
    it('should build URL with query param when publicPath ends with /api/upload/image', () => {
      const url = buildUploadUrl('avatars/my-photo.jpg');
      expect(url).toBe('/api/upload/image?file=avatars%2Fmy-photo.jpg');
    });

    it('should strip leading slashes from relative path', () => {
      const url = buildUploadUrl('/avatars/photo.jpg');
      expect(url).toBe('/api/upload/image?file=avatars%2Fphoto.jpg');
    });

    it('should handle empty relative path', () => {
      const url = buildUploadUrl('');
      expect(url).toContain('/api/upload/image');
    });

    it('should handle nested paths', () => {
      const url = buildUploadUrl('users/123/profile/avatar.webp');
      expect(url).toBe('/api/upload/image?file=users%2F123%2Fprofile%2Favatar.webp');
    });

    it('should handle filenames with special characters', () => {
      const url = buildUploadUrl('files/my file (1).jpg');
      expect(url).toContain('my%20file%20(1).jpg');
    });
  });

  describe('buildDownloadUrl', () => {
    it('should append download=true query param', () => {
      const url = buildDownloadUrl('avatars/photo.jpg');
      expect(url).toContain('download=true');
    });

    it('should append with & when URL already has query params', () => {
      const url = buildDownloadUrl('avatars/photo.jpg');
      // Since buildUploadUrl already adds ?file=..., download should use &
      expect(url).toContain('&download=true');
    });

    it('should handle paths with special characters', () => {
      const url = buildDownloadUrl('docs/report (final).pdf');
      expect(url).toContain('download=true');
      expect(url).toContain('report%20(final).pdf');
    });
  });

  describe('getUploadPathPrefixes', () => {
    it('should return an array of prefixes', () => {
      const prefixes = getUploadPathPrefixes();
      expect(Array.isArray(prefixes)).toBe(true);
      expect(prefixes.length).toBeGreaterThan(0);
    });

    it('should include the configured public path', () => {
      const prefixes = getUploadPathPrefixes();
      expect(prefixes.some((p) => p.includes('/api/upload/image'))).toBe(true);
    });

    it('should include common upload paths', () => {
      const prefixes = getUploadPathPrefixes();
      const allPrefixes = prefixes.join(' ');
      expect(allPrefixes).toContain('/uploads');
      expect(allPrefixes).toContain('/api/uploads');
    });

    it('should end each prefix with a trailing slash', () => {
      const prefixes = getUploadPathPrefixes();
      prefixes.forEach((prefix) => {
        expect(prefix.endsWith('/')).toBe(true);
      });
    });

    it('should not contain duplicates', () => {
      const prefixes = getUploadPathPrefixes();
      const uniquePrefixes = [...new Set(prefixes)];
      expect(prefixes.length).toBe(uniquePrefixes.length);
    });

    it('should filter out falsy values', () => {
      const prefixes = getUploadPathPrefixes();
      prefixes.forEach((prefix) => {
        expect(prefix).toBeTruthy();
      });
    });
  });
});
