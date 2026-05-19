import { v2 as cloudinary } from 'cloudinary';
import { logInfo, logWarning } from './logger';

export const isCloudinaryConfigured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export const uploadToCloudinary = (
  buffer: Buffer,
  folder: string,
  resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto',
  tags?: string[]
): Promise<string> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `creator-platform/${folder}`,
          resource_type: resourceType,
          ...(tags && tags.length ? { tags } : {}),
        },
        (error, result) => {
          if (error || !result) reject(error ?? new Error('Cloudinary upload failed'));
          else resolve(result.secure_url);
        }
      )
      .end(buffer);
  });

export const deleteFromCloudinary = async (url: string): Promise<void> => {
  if (!isCloudinaryConfigured) return;
  try {
    const match = url.match(/\/creator-platform\/([^.]+)/);
    if (match) {
      await cloudinary.uploader.destroy(`creator-platform/${match[1]}`);
    }
  } catch {
    // Non-critical — don't throw
  }
};

/**
 * Delete all Cloudinary resources tagged with `tts_audio` that are older than
 * `maxAgeMinutes` minutes. Called every 30 minutes to prevent storage bloat.
 */
export const cleanupTtsAudio = async (maxAgeMinutes = 30): Promise<void> => {
  if (!isCloudinaryConfigured) return;
  try {
    const cutoffUnix = Math.floor((Date.now() - maxAgeMinutes * 60 * 1000) / 1000);

    // Cloudinary search supports Unix timestamp comparisons
    const result = await cloudinary.search
      .expression(`tags=tts_audio AND created_at<${cutoffUnix}`)
      .max_results(500)
      .execute();

    const resources: { public_id: string }[] = result.resources ?? [];
    if (!resources.length) {
      logInfo('[Cloudinary] No stale TTS audio to clean up');
      return;
    }

    const publicIds = resources.map((r) => r.public_id);
    // delete_resources handles up to 100 ids at a time
    for (let i = 0; i < publicIds.length; i += 100) {
      await cloudinary.api.delete_resources(publicIds.slice(i, i + 100), { resource_type: 'video' });
    }

    logInfo(`[Cloudinary] Deleted ${publicIds.length} stale TTS audio file(s)`);
  } catch (err) {
    logWarning(`[Cloudinary] TTS cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};
