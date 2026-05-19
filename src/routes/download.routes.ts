// ===========================================
// FILE DOWNLOAD ROUTES
// ===========================================
// Explicit endpoints for downloading and viewing files from the uploads PVC.
// This route is designed to handle file serving from the configured public path
// (for example /api/download or /api/uploads) with custom header logic.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logInfo, logWarning, logError } from '../utils/logger';

const router = Router();

/**
 * GET /*path
 * Match all paths relative to the mount point (e.g. /api/download)
 * 
 * Examples:
 *   /api/download/content/abc123.webp -> req.params.path = ["content", "abc123.webp"]
 *   /api/download/avatars/xyz.png -> req.params.path = ["avatars", "xyz.png"]
 */
router.get('/*path', (req: Request, res: Response) => {
  // express.Router() mounts remove the prefix, so req.params.path contains the relative path
  const rawParam = (req.params as { path?: string | string[] }).path;
  const paramPath = Array.isArray(rawParam) ? rawParam.join('/') : rawParam;
  let relativePath = paramPath || req.path;
  logInfo('Download access request', { url: req.originalUrl, relativePath });

  // Strip query string if somehow present (though req.path usually does it)
  relativePath = relativePath.split('?')[0];

  if (!relativePath || relativePath === '/') {
    logWarning('Download access denied (missing path)', { url: req.originalUrl });
    return res.status(404).json({
      success: false,
      error: {
        code: 'FILE_NOT_FOUND',
        message: 'File path required'
      }
    });
  }

  try {
    // Prevent path traversal by normalizing and ensuring we stay under uploads root
    // Remove leading slashes
    const safeRelativePath = relativePath.replace(/^\/+/, '');

    // Construct absolute path
    const filePath = path.join(config.upload.dir, safeRelativePath);
    const uploadsRoot = path.resolve(config.upload.dir);
    const resolved = path.resolve(filePath);

    // Security check
    if (!resolved.startsWith(uploadsRoot)) {
      logWarning('Download access denied (path)', { url: req.originalUrl, resolved });
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PATH',
          message: 'Invalid file path'
        }
      });
    }

    // Check if file exists
    if (!fs.existsSync(resolved)) {
      logWarning('Download file not found', { url: req.originalUrl, resolved });
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found'
        }
      });
    }

    // Check if it's a directory (we don't serve directory listings)
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      logWarning('Download file is directory', { url: req.originalUrl, resolved });
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found'
        }
      });
    }

    // Determine content type
    const filename = path.basename(resolved);
    const ext = path.extname(filename).toLowerCase();

    // Add aggressive caching for images (1 year), similar to static server best practices
    // Cache-Control: public, max-age=31536000, immutable
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    // ✅ FORCE DOWNLOAD ONLY IF REQUESTED
    // If ?download=true is present, force "Save As". Otherwise, display inline (view mode).
    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      // Inline viewing (fixes the broken image issue)
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    // Send the file
    return res.sendFile(resolved);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Download error' });
    return res.status(500).json({
      success: false,
      error: {
        code: 'DOWNLOAD_ERROR',
        message: 'Failed to download file'
      }
    });
  }
});

export default router;
