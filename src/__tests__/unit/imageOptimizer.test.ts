// ===========================================
// IMAGE OPTIMIZER UNIT TESTS
// ===========================================

const mockMetadata = jest.fn();
const mockResize = jest.fn();
const mockJpeg = jest.fn();
const mockPng = jest.fn();
const mockWebp = jest.fn();
const mockAvif = jest.fn();
const mockToBuffer = jest.fn();
const mockComposite = jest.fn();
const mockStats = jest.fn();

const mockSharpInstance = {
  metadata: mockMetadata,
  resize: mockResize,
  jpeg: mockJpeg,
  png: mockPng,
  webp: mockWebp,
  avif: mockAvif,
  toBuffer: mockToBuffer,
  composite: mockComposite,
  stats: mockStats,
};

// Each method returns the instance for chaining
mockResize.mockReturnValue(mockSharpInstance);
mockJpeg.mockReturnValue(mockSharpInstance);
mockPng.mockReturnValue(mockSharpInstance);
mockWebp.mockReturnValue(mockSharpInstance);
mockAvif.mockReturnValue(mockSharpInstance);
mockComposite.mockReturnValue(mockSharpInstance);

const mockSharp = jest.fn().mockReturnValue(mockSharpInstance);

jest.mock('sharp', () => ({
  __esModule: true,
  default: mockSharp,
}));

jest.mock('../../utils/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

import {
  optimizeImage,
  generateResponsiveSizes,
  extractDominantColor,
  getImageMetadata,
  validateImage,
  PROFILES,
} from '../../utils/imageOptimizer';

describe('Image Optimizer Utils - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset chaining
    mockResize.mockReturnValue(mockSharpInstance);
    mockJpeg.mockReturnValue(mockSharpInstance);
    mockPng.mockReturnValue(mockSharpInstance);
    mockWebp.mockReturnValue(mockSharpInstance);
    mockAvif.mockReturnValue(mockSharpInstance);
    mockComposite.mockReturnValue(mockSharpInstance);
    mockSharp.mockReturnValue(mockSharpInstance);
  });

  describe('PROFILES', () => {
    it('should define AVATAR profile with correct dimensions', () => {
      expect(PROFILES.AVATAR).toEqual(
        expect.objectContaining({
          width: 400,
          height: 400,
          fit: 'cover',
          format: 'webp',
        })
      );
    });

    it('should define THUMBNAIL profile', () => {
      expect(PROFILES.THUMBNAIL).toEqual(
        expect.objectContaining({
          width: 200,
          height: 200,
        })
      );
    });

    it('should define CONTENT_IMAGE profile with no fixed height', () => {
      expect(PROFILES.CONTENT_IMAGE.width).toBe(1200);
      expect(PROFILES.CONTENT_IMAGE.height).toBeUndefined();
    });

    it('should define BANNER profile', () => {
      expect(PROFILES.BANNER).toEqual(
        expect.objectContaining({
          width: 1920,
          height: 400,
          fit: 'cover',
        })
      );
    });
  });

  describe('optimizeImage', () => {
    it('should optimize image with a named profile', async () => {
      const inputBuffer = Buffer.from('fake-image');
      mockMetadata.mockResolvedValue({ width: 800, height: 600 });
      mockToBuffer.mockResolvedValue(Buffer.from('optimized'));

      const result = await optimizeImage(inputBuffer, 'AVATAR');

      expect(mockSharp).toHaveBeenCalledWith(inputBuffer);
      expect(mockResize).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 400,
          height: 400,
          fit: 'cover',
          withoutEnlargement: true,
        })
      );
      expect(mockWebp).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should optimize image with a custom profile', async () => {
      const inputBuffer = Buffer.from('fake-image');
      mockMetadata.mockResolvedValue({ width: 1000, height: 1000 });
      mockToBuffer.mockResolvedValue(Buffer.from('optimized'));

      await optimizeImage(inputBuffer, {
        width: 500,
        height: 500,
        fit: 'contain',
        quality: 90,
        format: 'jpeg',
      });

      expect(mockResize).toHaveBeenCalledWith(
        expect.objectContaining({ width: 500, height: 500, fit: 'contain' })
      );
      expect(mockJpeg).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 90 })
      );
    });

    it('should use png format when specified', async () => {
      const inputBuffer = Buffer.from('fake-image');
      mockMetadata.mockResolvedValue({ width: 800, height: 600 });
      mockToBuffer.mockResolvedValue(Buffer.from('optimized'));

      await optimizeImage(inputBuffer, { format: 'png', quality: 80 });

      expect(mockPng).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 80 })
      );
    });

    it('should use avif format when specified', async () => {
      const inputBuffer = Buffer.from('fake-image');
      mockMetadata.mockResolvedValue({ width: 800, height: 600 });
      mockToBuffer.mockResolvedValue(Buffer.from('optimized'));

      await optimizeImage(inputBuffer, { format: 'avif', quality: 70 });

      expect(mockAvif).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 70 })
      );
    });

    it('should throw on processing failure', async () => {
      mockMetadata.mockRejectedValue(new Error('sharp failed'));

      await expect(
        optimizeImage(Buffer.from('bad'), 'AVATAR')
      ).rejects.toThrow('Failed to optimize image');
    });

    it('should not resize when no dimensions specified', async () => {
      mockMetadata.mockResolvedValue({ width: 800, height: 600 });
      mockToBuffer.mockResolvedValue(Buffer.from('optimized'));

      await optimizeImage(Buffer.from('img'), { quality: 85 });

      expect(mockResize).not.toHaveBeenCalled();
    });
  });

  describe('generateResponsiveSizes', () => {
    it('should generate multiple sizes', async () => {
      const inputBuffer = Buffer.from('fake-image');
      mockMetadata.mockResolvedValue({ width: 2000, height: 1500 });
      mockToBuffer.mockResolvedValue(Buffer.from('resized'));

      const sizes = [
        { name: 'small', width: 320 },
        { name: 'medium', width: 640 },
        { name: 'large', width: 1024 },
      ];

      const result = await generateResponsiveSizes(inputBuffer, sizes);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('small');
      expect(result[1].name).toBe('medium');
      expect(result[2].name).toBe('large');
      result.forEach((r) => expect(r.buffer).toBeInstanceOf(Buffer));
    });

    it('should throw on failure', async () => {
      mockMetadata.mockRejectedValue(new Error('failed'));

      await expect(
        generateResponsiveSizes(Buffer.from('img'), [{ name: 'sm', width: 200 }])
      ).rejects.toThrow('Failed to generate responsive images');
    });
  });

  describe('extractDominantColor', () => {
    it('should return dominant color', async () => {
      mockStats.mockResolvedValue({ dominant: { r: 128, g: 64, b: 32 } });

      const result = await extractDominantColor(Buffer.from('img'));

      expect(result).toEqual({ r: 128, g: 64, b: 32 });
    });

    it('should default to 0 for undefined color channels', async () => {
      mockStats.mockResolvedValue({ dominant: {} });

      const result = await extractDominantColor(Buffer.from('img'));

      expect(result).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('should throw on failure', async () => {
      mockStats.mockRejectedValue(new Error('failed'));

      await expect(
        extractDominantColor(Buffer.from('bad'))
      ).rejects.toThrow('Failed to extract dominant color');
    });
  });

  describe('getImageMetadata', () => {
    it('should return image metadata', async () => {
      mockMetadata.mockResolvedValue({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        size: 500000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await getImageMetadata(Buffer.from('img'));

      expect(result).toEqual({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        size: 500000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });
    });

    it('should throw on failure', async () => {
      mockMetadata.mockRejectedValue(new Error('corrupt'));

      await expect(
        getImageMetadata(Buffer.from('bad'))
      ).rejects.toThrow('Failed to extract image metadata');
    });
  });

  describe('validateImage', () => {
    it('should validate a valid image', async () => {
      mockMetadata.mockResolvedValue({
        width: 800,
        height: 600,
        format: 'jpeg',
        size: 100000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await validateImage(Buffer.from('img'));

      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
    });

    it('should fail if width is below minWidth', async () => {
      mockMetadata.mockResolvedValue({
        width: 100,
        height: 600,
        format: 'jpeg',
        size: 100000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await validateImage(Buffer.from('img'), { minWidth: 200 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 200px');
    });

    it('should fail if height is below minHeight', async () => {
      mockMetadata.mockResolvedValue({
        width: 800,
        height: 100,
        format: 'jpeg',
        size: 100000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await validateImage(Buffer.from('img'), { minHeight: 200 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('height must be at least 200px');
    });

    it('should fail if width exceeds maxWidth', async () => {
      mockMetadata.mockResolvedValue({
        width: 5000,
        height: 600,
        format: 'jpeg',
        size: 100000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await validateImage(Buffer.from('img'), { maxWidth: 4096 });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must not exceed 4096px');
    });

    it('should fail if format is not allowed', async () => {
      mockMetadata.mockResolvedValue({
        width: 800,
        height: 600,
        format: 'gif',
        size: 100000,
        space: 'srgb',
        hasAlpha: false,
        orientation: 1,
      });

      const result = await validateImage(Buffer.from('img'), {
        allowedFormats: ['jpeg', 'png', 'webp'],
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be one of');
    });

    it('should return invalid for corrupt image', async () => {
      mockMetadata.mockRejectedValue(new Error('corrupt'));

      const result = await validateImage(Buffer.from('corrupt'));

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid image file');
    });
  });
});
