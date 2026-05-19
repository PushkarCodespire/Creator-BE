// ===========================================
// UPLOAD ROUTES
// ===========================================
// Handle file uploads (avatar, cover, documents)

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, requireAdmin } from '../middleware/auth';
import { uploadAvatar, uploadImage, uploadContent, uploadChatMedia, uploadPostMedia } from '../middleware/upload';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import prisma from '../../prisma/client';
import { sendError } from '../utils/apiResponse';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { buildUploadUrl } from '../utils/uploadPaths';
import { config } from '../config';
import { logInfo, logWarning, logDebug, logError } from '../utils/logger';
import { isCloudinaryConfigured, uploadToCloudinary } from '../utils/cloudinary';

// Upload a multer file to Cloudinary (if configured) or return local disk URL
const saveFile = async (file: Express.Multer.File, folder: string): Promise<string> => {
  if (isCloudinaryConfigured) {
    const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'auto';
    return uploadToCloudinary(file.buffer, folder, resourceType);
  }
  return buildUploadUrl(`${folder}/${file.filename}`);
};

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

const logUploadSaved = (folder: string, filename: string) => {
  if (isCloudinaryConfigured) {
    logInfo('Upload saved (Cloudinary)', { folder, filename });
    return;
  }
  const resolvedPath = path.resolve(config.upload.dir, folder, filename);
  const exists = fs.existsSync(resolvedPath);
  logInfo('Upload saved', { folder, filename, exists, path: resolvedPath });
};

// Auth middleware will be applied to specific routes (see below)

// ===========================================
// MULTER ERROR HANDLER
// ===========================================

const handleMulterError = (expectedField: string) => {
  return (err: Error | null, req: Request, res: Response, next: (err?: unknown) => void) => {
    if (err instanceof multer.MulterError) {
      const multerErr = err as multer.MulterError;
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 400, 'FILE_TOO_LARGE', 'File too large', err.message);
      }
      if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
        return sendError(
          res,
          400,
          'UNEXPECTED_FIELD',
          `Unexpected field name. Please use field name "${expectedField}"`,
          { details: err.message, expectedField }
        );
      }
      return sendError(res, 400, 'UPLOAD_ERROR', 'Upload error', { details: err.message, expectedField });
    }
    if (err) {
      // Check if it's an "Unexpected field" error
      if (err.message && err.message.includes('Unexpected field')) {
        return sendError(
          res,
          400,
          'UNEXPECTED_FIELD',
          `Unexpected field name. Please use field name "${expectedField}"`,
          { details: err.message, expectedField }
        );
      }
      return sendError(res, 400, 'UPLOAD_FAILED', err.message || 'Upload failed', { expectedField });
    }
    next();
  };
};

// ===========================================
// UPLOAD AVATAR
// ===========================================

router.post(
  '/avatar',
  authenticate,
  uploadAvatar,
  handleMulterError('avatar'),
  asyncHandler(async (req: Request, res: Response) => {
    // Debug: Log what we received
    logDebug('Avatar upload - req.files: ' + JSON.stringify(req.files));
    logDebug('Avatar upload - req.file: ' + JSON.stringify(req.file));
    logDebug('Avatar upload - req.body: ' + JSON.stringify(req.body));

    const file = req.file;

    if (!file) {
      throw new AppError('No file uploaded. Please use field name "avatar"', 400);
    }
    logUploadSaved('avatars', file.filename ?? file.originalname);
    const userId = req.user!.id;
    const avatarUrl = await saveFile(file, 'avatars');

    // Update user avatar in database
    await prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl }
    });

    // Also update creator profileImage if user is a creator
    const creator = await prisma.creator.findUnique({
      where: { userId }
    });

    if (creator) {
      await prisma.creator.update({
        where: { id: creator.id },
        data: { profileImage: avatarUrl }
      });
    }

    res.json({
      success: true,
      data: {
        url: avatarUrl,
        filename: file.filename,
        size: file.size
      }
    });
  })
);

// ===========================================
// UPLOAD COVER IMAGE
// ===========================================

router.post(
  '/cover',
  authenticate,
  uploadImage,
  handleMulterError('cover'),
  asyncHandler(async (req: Request, res: Response) => {
    // Debug: Log what we received
    logDebug('Cover upload - req.files: ' + JSON.stringify(req.files));
    logDebug('Cover upload - req.file: ' + JSON.stringify(req.file));
    logDebug('Cover upload - req.body: ' + JSON.stringify(req.body));

    const file = req.file;

    if (!file) {
      throw new AppError('No file uploaded. Please use field name "cover"', 400);
    }
    logUploadSaved('content', file.filename ?? file.originalname);
    const userId = req.user!.id;
    const coverUrl = await saveFile(file, 'content');

    // Update creator cover image if user is a creator
    const creator = await prisma.creator.findUnique({
      where: { userId }
    });

    if (creator) {
      await prisma.creator.update({
        where: { id: creator.id },
        data: { coverImage: coverUrl }
      });
    }

    res.json({
      success: true,
      data: {
        url: coverUrl,
        filename: file.filename,
        size: file.size
      }
    });
  })
);

// ===========================================
// UPLOAD DOCUMENT (for creator content)
// ===========================================

router.post(
  '/document',
  authenticate,
  uploadContent,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }
    logUploadSaved('content', req.file.filename ?? req.file.originalname);

    const userId = req.user!.id;
    const documentUrl = await saveFile(req.file, 'content');

    // Verify user is a creator
    const creator = await prisma.creator.findUnique({
      where: { userId }
    });

    if (!creator) {
      throw new AppError('Only creators can upload content documents', 403);
    }

    res.json({
      success: true,
      data: {
        id: Date.now().toString(),
        url: documentUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  })
);

// ===========================================
// UPLOAD POST MEDIA (Image/Video)
// ===========================================

router.post(
  '/image',
  authenticate,
  uploadPostMedia,
  handleMulterError('file'),
  asyncHandler(async (req: Request, res: Response) => {
    // Debug: Log what we received
    logDebug('Post media upload - req.file: ' + JSON.stringify(req.file));

    const file = req.file;

    if (!file) {
      throw new AppError('No file uploaded. Please use field name "file"', 400);
    }
    logUploadSaved('content', file.filename ?? file.originalname);

    const fileUrl = await saveFile(file, 'content');

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size,
        type: file.mimetype.startsWith('video/') ? 'video' : 'image'
      }
    });
  })
);

// ===========================================
// UPLOAD CHAT MEDIA
// ===========================================

const _jwt = require('jsonwebtoken');

router.post(
  '/chat-media',
  uploadChatMedia,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      throw new AppError('No files uploaded', 400);
    }
    (req.files as Express.Multer.File[]).forEach((file: Express.Multer.File) =>
      logUploadSaved('chat', file.filename ?? file.originalname)
    );

    const user = req.user;
    const guestId = req.headers['x-guest-id'];
    if (!user && !guestId && !req.headers.authorization) {
      throw new AppError('Unauthorized: Token or Guest ID required', 401);
    }

    // Process uploaded files
    const mediaFiles = await Promise.all(
      (req.files as Express.Multer.File[]).map(async (file) => {
      const fileUrl = await saveFile(file, 'chat');
      let mediaType: 'image' | 'video' | 'audio' | 'file' = 'file';

      if (file.mimetype.startsWith('image/')) {
        mediaType = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        mediaType = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        mediaType = 'audio';
      }

      return {
        type: mediaType,
        url: fileUrl,
        name: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      };
    })
    );

    res.json({
      success: true,
      data: {
        media: mediaFiles
      }
    });
  })
);

// ===========================================
// SERVE UPLOADED FILES (NO NGINX CHANGE NEEDED)
// GET /api/upload/file/:folder/:filename
// ===========================================

router.get(
  '/file/:folder/:filename',
  asyncHandler(async (req: Request, res: Response) => {
    const rawFolder = Array.isArray(req.params.folder) ? req.params.folder[0] : req.params.folder;
    const rawFilename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const folder = rawFolder || '';
    const filename = rawFilename || '';
    logInfo('File access request', {
      route: 'upload.file',
      folder,
      filename,
      url: req.originalUrl
    });

    if (!allowedFolders.has(folder)) {
      logWarning('File access denied (folder)', { route: 'upload.file', folder, filename });
      return sendError(res, 404, 'NOT_FOUND', 'File not found');
    }

    if (!isSafeFilename(filename)) {
      logWarning('File access denied (filename)', { route: 'upload.file', folder, filename });
      return sendError(res, 400, 'INVALID_FILE', 'Invalid file name');
    }

    const rootDir = path.resolve(config.upload.dir);
    const filePath = path.resolve(rootDir, folder, filename);

    if (!filePath.startsWith(path.join(rootDir, folder))) {
      logWarning('File access denied (path)', { route: 'upload.file', folder, filename, filePath });
      return sendError(res, 400, 'INVALID_PATH', 'Invalid file path');
    }

    if (!fs.existsSync(filePath)) {
      logWarning('File not found', { route: 'upload.file', folder, filename, filePath });
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

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Failed to read file', filePath });
      if (!res.headersSent) {
        return sendError(res, 500, 'READ_ERROR', 'Failed to read file');
      }
      res.end();
    });

    stream.pipe(res);
  })
);

// GET /api/upload/image?file=content/<filename>
router.get(
  '/image',
  asyncHandler(async (req: Request, res: Response) => {
    const rawFile = Array.isArray(req.query.file) ? req.query.file[0] : req.query.file;
    const fileParam = typeof rawFile === 'string' ? rawFile : '';
    logInfo('File access request', {
      route: 'upload.image',
      fileParam,
      url: req.originalUrl
    });

    if (!fileParam) {
      logWarning('File access denied (missing query)', { route: 'upload.image', url: req.originalUrl });
      return sendError(res, 400, 'INVALID_FILE', 'File query param is required');
    }

    const cleanRelative = fileParam.replace(/^\/+/, '');
    const parts = cleanRelative.split('/').filter(Boolean);
    if (parts.length !== 2) {
      logWarning('File access denied (invalid path)', { route: 'upload.image', fileParam });
      return sendError(res, 400, 'INVALID_FILE', 'Invalid file path');
    }

    const [folder, filename] = parts;

    if (!allowedFolders.has(folder)) {
      logWarning('File access denied (folder)', { route: 'upload.image', folder, filename });
      return sendError(res, 404, 'NOT_FOUND', 'File not found');
    }

    if (!isSafeFilename(filename)) {
      logWarning('File access denied (filename)', { route: 'upload.image', folder, filename });
      return sendError(res, 400, 'INVALID_FILE', 'Invalid file name');
    }

    const rootDir = path.resolve(config.upload.dir);
    const filePath = path.resolve(rootDir, folder, filename);

    if (!filePath.startsWith(path.join(rootDir, folder))) {
      logWarning('File access denied (path)', { route: 'upload.image', folder, filename, filePath });
      return sendError(res, 400, 'INVALID_PATH', 'Invalid file path');
    }

    if (!fs.existsSync(filePath)) {
      logWarning('File not found', { route: 'upload.image', folder, filename, filePath });
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

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => {
      logError(error instanceof Error ? error : new Error(String(error)), { context: 'Failed to read file', filePath });
      if (!res.headersSent) {
        return sendError(res, 500, 'READ_ERROR', 'Failed to read file');
      }
      res.end();
    });

    stream.pipe(res);
  })
);

// ===========================================
// DELETE UPLOADED FILE
// ===========================================

router.delete(
  '/:filename',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { filename } = req.params;
    const userId = req.user!.id;

    // Verify file belongs to user (check user/creator records)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { creator: true }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Check if file is user's avatar or creator's cover
    const fileUrl = buildUploadUrl(filename as string);
    const isOwner =
      user.avatar === fileUrl ||
      (user.creator && user.creator.coverImage === fileUrl);

    if (!isOwner) {
      throw new AppError('Unauthorized to delete this file', 403);
    }

    // Delete file from filesystem
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(config.upload.dir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Update database
    if (user.avatar === fileUrl) {
      await prisma.user.update({
        where: { id: userId },
        data: { avatar: null }
      });
    }

    if (user.creator && user.creator.coverImage === fileUrl) {
      await prisma.creator.update({
        where: { id: user.creator.id },
        data: { coverImage: null }
      });
    }

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  })
);

// ===========================================
// ADMIN: CHANGE CREATOR AVATAR
// ===========================================

router.post(
  '/admin/creator/:creatorId/avatar',
  authenticate,
  requireAdmin,
  uploadAvatar,
  handleMulterError('avatar'),
  asyncHandler(async (req: Request, res: Response) => {
    const creatorId = req.params.creatorId as string;
    const file = req.file;

    if (!file) throw new AppError('No file uploaded. Please use field name "avatar"', 400);

    const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
    if (!creator) throw new AppError('Creator not found', 404);

    const avatarUrl = await saveFile(file, 'avatars');

    await Promise.all([
      prisma.creator.update({ where: { id: creatorId }, data: { profileImage: avatarUrl } }),
      prisma.user.update({ where: { id: creator.userId }, data: { avatar: avatarUrl } }),
    ]);

    res.json({ success: true, data: { url: avatarUrl } });
  })
);

// ===========================================
// ADMIN: CHANGE USER AVATAR
// ===========================================

router.post(
  '/admin/user/:userId/avatar',
  authenticate,
  requireAdmin,
  uploadAvatar,
  handleMulterError('avatar'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const file = req.file;

    if (!file) throw new AppError('No file uploaded. Please use field name "avatar"', 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const avatarUrl = await saveFile(file, 'avatars');

    await prisma.user.update({ where: { id: userId }, data: { avatar: avatarUrl } });

    // Also sync creator profileImage if the user is a creator
    const creator = await prisma.creator.findUnique({ where: { userId } });
    if (creator) {
      await prisma.creator.update({ where: { id: creator.id }, data: { profileImage: avatarUrl } });
    }

    res.json({ success: true, data: { url: avatarUrl } });
  })
);

export default router;
