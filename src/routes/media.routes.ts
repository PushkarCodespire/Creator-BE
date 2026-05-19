// ===========================================
// MEDIA ROUTES
// Serve uploaded files via controlled API endpoint
// ===========================================

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { config } from '../config';
import { sendError } from '../utils/apiResponse';
import { logWarning } from '../utils/logger';

const router = Router();

const allowedFolders = new Set([
  'avatars',
  'content',
  'documents',
  'chat',
  'temp'
]);

const isSafeFilename = (filename: string) => {
  if (!filename) return false;
  if (filename.includes('..')) return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  if (path.isAbsolute(filename)) return false;
  return true;
};

router.get('/:folder/:filename', (req: Request, res: Response) => {
  const rawFolder = Array.isArray(req.params.folder) ? req.params.folder[0] : req.params.folder;
  const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const folder = rawFolder || '';
  const filename = rawFilename || '';

  if (!allowedFolders.has(folder)) {
    return sendError(res, 404, 'NOT_FOUND', 'File not found');
  }

  if (!isSafeFilename(filename)) {
    return sendError(res, 400, 'INVALID_FILE', 'Invalid file name');
  }

  const rootDir = path.resolve(config.upload.dir);
  const filePath = path.resolve(rootDir, folder, filename);

  if (!filePath.startsWith(path.join(rootDir, folder))) {
    return sendError(res, 400, 'INVALID_PATH', 'Invalid file path');
  }

  if (!fs.existsSync(filePath)) {
    return sendError(res, 404, 'NOT_FOUND', 'File not found');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return sendError(res, 404, 'NOT_FOUND', 'File not found');
  }

  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size.toString());
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    logWarning('Failed to read media file', { error, filePath });
    if (!res.headersSent) {
      return sendError(res, 500, 'READ_ERROR', 'Failed to read file');
    }
    res.end();
  });

  stream.pipe(res);
});

export default router;
