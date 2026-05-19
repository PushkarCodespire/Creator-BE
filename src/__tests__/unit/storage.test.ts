// ===========================================
// STORAGE UNIT TESTS (PVC / local filesystem only)
// ===========================================

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarning: jest.fn(),
}));

jest.mock('../../config', () => ({
  config: {
    upload: {
      dir: '/tmp/test-uploads',
      maxSize: 50000000,
      publicPath: '/api/upload/image',
      publicUrl: undefined,
    },
  },
}));

jest.mock('../../utils/uploadPaths', () => ({
  buildUploadUrl: jest.fn(),
  getUploadPathPrefixes: jest.fn(),
}));

import { getFileUrl, getStorageInfo, STORAGE_PROVIDER } from '../../utils/storage';
import { buildUploadUrl, getUploadPathPrefixes } from '../../utils/uploadPaths';

describe('Storage Utils - Unit Tests', () => {
  beforeEach(() => {
    (buildUploadUrl as jest.Mock).mockImplementation(
      (path: string) => `/api/upload/image?file=${encodeURIComponent(path)}`
    );
    (getUploadPathPrefixes as jest.Mock).mockReturnValue(['/api/upload/image/', '/uploads/']);
  });

  describe('getFileUrl', () => {
    it('should return a URL for a file', () => {
      const url = getFileUrl('test-file.jpg', 'avatars');
      expect(typeof url).toBe('string');
      expect(url).toContain('avatars');
    });

    it('should return known-prefix identifiers unchanged', () => {
      const url = getFileUrl('/api/upload/image/test.jpg');
      expect(url).toBe('/api/upload/image/test.jpg');
    });

    it('should handle identifiers without folder', () => {
      const url = getFileUrl('my-file.png');
      expect(typeof url).toBe('string');
    });
  });

  describe('getStorageInfo', () => {
    it('should always report local provider', () => {
      const info = getStorageInfo();
      expect(info.provider).toBe('local');
      expect(info.isCloud).toBe(false);
      expect(info.s3Configured).toBe(false);
      expect(info.cloudinaryConfigured).toBe(false);
    });
  });

  describe('STORAGE_PROVIDER', () => {
    it('is always "local"', () => {
      expect(STORAGE_PROVIDER).toBe('local');
    });
  });
});
