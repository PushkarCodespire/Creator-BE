// ===========================================
// IMAGE OPTIMIZATION UTILITY
// Using Sharp for resize, compress, and format conversion
// ===========================================

import sharp from 'sharp';
import { logInfo, logError } from './logger';

// Image optimization profiles
export interface ImageOptimizationProfile {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  progressive?: boolean;
}

// Predefined profiles
export const PROFILES = {
  AVATAR: {
    width: 400,
    height: 400,
    fit: 'cover' as const,
    quality: 85,
    format: 'webp' as const,
    progressive: true
  },
  THUMBNAIL: {
    width: 200,
    height: 200,
    fit: 'cover' as const,
    quality: 80,
    format: 'webp' as const,
    progressive: true
  },
  CONTENT_IMAGE: {
    width: 1200,
    height: undefined,  // Maintain aspect ratio
    fit: 'inside' as const,
    quality: 85,
    format: 'webp' as const,
    progressive: true
  },
  BANNER: {
    width: 1920,
    height: 400,
    fit: 'cover' as const,
    quality: 90,
    format: 'webp' as const,
    progressive: true
  }
};

/**
 * Optimize image with custom or predefined profile
 */
export async function optimizeImage(
  input: Buffer | string,
  profile: ImageOptimizationProfile | keyof typeof PROFILES
): Promise<Buffer> {
  try {
    // Resolve profile
    const opts = typeof profile === 'string' ? PROFILES[profile] : profile;

    // Initialize Sharp
    let pipeline = sharp(input);

    // Get metadata
    const metadata = await pipeline.metadata();
    const originalSize = Buffer.isBuffer(input) ? input.length : 0;

    // Resize if dimensions specified
    if (opts.width || opts.height) {
      pipeline = pipeline.resize({
        width: opts.width,
        height: opts.height,
        fit: opts.fit || 'cover',
        withoutEnlargement: true  // Don't upscale images
      });
    }

    // Format conversion
    switch (opts.format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality: opts.quality || 85,
          progressive: opts.progressive !== false,
          mozjpeg: true  // Better compression
        });
        break;

      case 'png':
        pipeline = pipeline.png({
          quality: opts.quality || 85,
          progressive: opts.progressive !== false,
          compressionLevel: 9
        });
        break;

      case 'webp':
        pipeline = pipeline.webp({
          quality: opts.quality || 85,
          effort: 6  // Compression effort (0-6, higher = better compression)
        });
        break;

      case 'avif':
        pipeline = pipeline.avif({
          quality: opts.quality || 85,
          effort: 4  // (0-9, higher = better compression but slower)
        });
        break;

      default:
        // Keep original format if not specified
        break;
    }

    // Execute pipeline
    const optimizedBuffer = await pipeline.toBuffer();

    const optimizedSize = optimizedBuffer.length;
    const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(1);

    logInfo(`Image optimized: ${metadata.width}x${metadata.height} → ${opts.width || metadata.width}x${opts.height || metadata.height}, ${(originalSize / 1024).toFixed(1)}KB → ${(optimizedSize / 1024).toFixed(1)}KB (${reduction}% reduction)`);

    return optimizedBuffer;
  } catch (error) {
    logError(error as Error, { context: 'Image optimization' });
    throw new Error('Failed to optimize image');
  }
}

/**
 * Generate multiple sizes of an image (for responsive images)
 */
export async function generateResponsiveSizes(
  input: Buffer | string,
  sizes: { name: string; width: number }[]
): Promise<{ name: string; buffer: Buffer }[]> {
  try {
    const results = await Promise.all(
      sizes.map(async ({ name, width }) => {
        const buffer = await optimizeImage(input, {
          width,
          fit: 'inside',
          quality: 85,
          format: 'webp'
        });
        return { name, buffer };
      })
    );

    logInfo(`Generated ${sizes.length} responsive sizes`);
    return results;
  } catch (error) {
    logError(error as Error, { context: 'Responsive image generation' });
    throw new Error('Failed to generate responsive images');
  }
}

/**
 * Extract dominant color from image
 */
export async function extractDominantColor(
  input: Buffer | string
): Promise<{ r: number; g: number; b: number }> {
  try {
    const { dominant } = await sharp(input).stats();

    return {
      r: dominant.r || 0,
      g: dominant.g || 0,
      b: dominant.b || 0
    };
  } catch (error) {
    logError(error as Error, { context: 'Dominant color extraction' });
    throw new Error('Failed to extract dominant color');
  }
}

/**
 * Get image metadata without processing
 */
export async function getImageMetadata(input: Buffer | string) {
  try {
    const metadata = await sharp(input).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size,
      space: metadata.space,
      hasAlpha: metadata.hasAlpha,
      orientation: metadata.orientation
    };
  } catch (error) {
    logError(error as Error, { context: 'Image metadata extraction' });
    throw new Error('Failed to extract image metadata');
  }
}

/**
 * Validate image and check dimensions
 */
export async function validateImage(
  input: Buffer | string,
  options: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    allowedFormats?: string[];
  } = {}
): Promise<{ valid: boolean; error?: string; metadata?: Record<string, unknown> }> {
  try {
    const metadata = await getImageMetadata(input);

    if (options.minWidth && metadata.width! < options.minWidth) {
      return { valid: false, error: `Image width must be at least ${options.minWidth}px` };
    }

    if (options.minHeight && metadata.height! < options.minHeight) {
      return { valid: false, error: `Image height must be at least ${options.minHeight}px` };
    }

    if (options.maxWidth && metadata.width! > options.maxWidth) {
      return { valid: false, error: `Image width must not exceed ${options.maxWidth}px` };
    }

    if (options.maxHeight && metadata.height! > options.maxHeight) {
      return { valid: false, error: `Image height must not exceed ${options.maxHeight}px` };
    }

    if (options.allowedFormats && !options.allowedFormats.includes(metadata.format!)) {
      return { valid: false, error: `Image format must be one of: ${options.allowedFormats.join(', ')}` };
    }

    return { valid: true, metadata };
  } catch (_error) {
    return { valid: false, error: 'Invalid image file' };
  }
}

/**
 * Create circular avatar from image
 */
export async function createCircularAvatar(
  input: Buffer | string,
  size: number = 400
): Promise<Buffer> {
  try {
    // Create circular mask
    const circle = Buffer.from(
      `<svg><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" /></svg>`
    );

    const buffer = await sharp(input)
      .resize(size, size, { fit: 'cover' })
      .composite([{
        input: circle,
        blend: 'dest-in'
      }])
      .webp({ quality: 90 })
      .toBuffer();

    logInfo(`Created circular avatar: ${size}x${size}`);
    return buffer;
  } catch (error) {
    logError(error as Error, { context: 'Circular avatar creation' });
    throw new Error('Failed to create circular avatar');
  }
}

/**
 * Add watermark to image
 */
export async function addWatermark(
  input: Buffer | string,
  watermarkText: string,
  options: {
    position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    opacity?: number;
    fontSize?: number;
  } = {}
): Promise<Buffer> {
  try {
    const metadata = await sharp(input).metadata();
    const width = metadata.width || 1200;
    const height = metadata.height || 800;

    // Create SVG watermark
    const fontSize = options.fontSize || Math.floor(width * 0.05);
    const opacity = options.opacity || 0.3;

    let x = width / 2;
    let y = height / 2;
    let anchor = 'middle';

    switch (options.position) {
      case 'top-left':
        x = 50;
        y = 50;
        anchor = 'start';
        break;
      case 'top-right':
        x = width - 50;
        y = 50;
        anchor = 'end';
        break;
      case 'bottom-left':
        x = 50;
        y = height - 50;
        anchor = 'start';
        break;
      case 'bottom-right':
        x = width - 50;
        y = height - 50;
        anchor = 'end';
        break;
    }

    const watermarkSvg = Buffer.from(
      `<svg width="${width}" height="${height}">
        <text x="${x}" y="${y}"
              font-size="${fontSize}"
              text-anchor="${anchor}"
              fill="white"
              opacity="${opacity}"
              font-family="Arial, sans-serif"
              font-weight="bold">
          ${watermarkText}
        </text>
      </svg>`
    );

    const buffer = await sharp(input)
      .composite([{
        input: watermarkSvg,
        gravity: 'center'
      }])
      .toBuffer();

    logInfo('Watermark added to image');
    return buffer;
  } catch (error) {
    logError(error as Error, { context: 'Watermark addition' });
    throw new Error('Failed to add watermark');
  }
}

// Export profile types
export type ProfileName = keyof typeof PROFILES;
