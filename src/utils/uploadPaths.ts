import { config } from '../config';

const trimSlashes = (value: string, type: 'leading' | 'trailing') => {
  if (!value) return value;
  if (type === 'leading') {
    return value.replace(/^\/+/, '');
  }
  return value.replace(/\/+$/, '');
};

export const buildUploadUrl = (relativePath: string) => {
  const baseSource = config.upload.publicUrl || config.upload.publicPath;
  const base = trimSlashes(baseSource, 'trailing');
  const cleanRelative = trimSlashes(relativePath, 'leading');
  if (base.endsWith('/api/upload/image')) {
    return `${base}?file=${encodeURIComponent(cleanRelative)}`;
  }
  return `${base}/${cleanRelative}`;
};

/**
 * Build a download URL for a file (forces browser download via Content-Disposition header)
 * For viewing/displaying files, use buildUploadUrl instead
 */
export const buildDownloadUrl = (relativePath: string) => {
  const url = buildUploadUrl(relativePath);
  // We use the configured public path, but with a query param
  // to trigger the Content-Disposition: attachment header
  return url.includes('?') ? `${url}&download=true` : `${url}?download=true`;
};

export const getUploadPathPrefixes = (): string[] => {
  const prefixes = new Set<string>([
    config.upload.publicPath,
    '/uploads',
    '/api/uploads',
    '/api/download',
    '/api/media',
    '/api/upload/file',
    '/api/file',
    '/api/upload/image'
  ]);

  if (config.upload.publicUrl) {
    prefixes.add(config.upload.publicUrl);
    try {
      const url = new URL(config.upload.publicUrl);
      if (url.pathname) {
        prefixes.add(url.pathname);
      }
    } catch {
      // Ignore invalid URL
    }
  }

  return Array.from(prefixes)
    .filter(Boolean)
    .map((prefix) => (prefix.endsWith('/') ? prefix : `${prefix}/`));
};
