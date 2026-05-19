// ===========================================
// FILE UPLOAD MIDDLEWARE
// ===========================================

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Request } from 'express';
import { config } from '../config';
import { buildUploadUrl } from '../utils/uploadPaths';
import { logError } from '../utils/logger';
import { isCloudinaryConfigured } from '../utils/cloudinary';

// Ensure upload directories exist
const uploadDirs = ['avatars', 'content', 'documents', 'temp', 'chat'];
uploadDirs.forEach(dir => {
  const fullPath = path.join(config.upload.dir, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// ===========================================
// STORAGE CONFIGURATION
// ===========================================

const createStorage = (_subDir: string) => {
  if (isCloudinaryConfigured) {
    return multer.memoryStorage();
  }
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(config.upload.dir, _subDir);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  });
};

// ===========================================
// FILE FILTERS
// ===========================================

const imageFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => { void req;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
  }
};

const documentFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => { void req;
  const allowedTypes = [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only document files (PDF, TXT, DOC, DOCX) are allowed'));
  }
};

const chatMediaFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => { void req;
  const allowedTypes = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    // Videos
    'video/mp4',
    'video/mpeg',
    'video/webm',
    'video/quicktime',
    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/webm',
    'audio/ogg'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image, video, and audio files are allowed'));
  }
};

// ===========================================
// UPLOAD CONFIGURATIONS
// ===========================================

// Avatar upload (single image) - strictly expects 'avatar' field
export const uploadAvatar = multer({
  storage: createStorage('avatars'),
  fileFilter: imageFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).single('avatar');

// Content upload (documents/text)
export const uploadContent = multer({
  storage: createStorage('content'),
  fileFilter: documentFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).single('file');

// Single image upload (for cover images) - strictly expects 'cover' field
export const uploadImage = multer({
  storage: createStorage('content'),
  fileFilter: imageFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).single('cover');

// Multiple images
export const uploadImages = multer({
  storage: createStorage('content'),
  fileFilter: imageFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).array('images', 10);

// Chat media upload (images, videos, audio)
export const uploadChatMedia = multer({
  storage: createStorage('chat'),
  fileFilter: chatMediaFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).array('media', 5); // Max 5 files per upload

// Voice clone upload — always disk storage (file.path required by voice cloning services)
const _voiceAudioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(config.upload.dir, 'chat');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const _voiceAudioFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => { void req;
  // Strip codec params before matching — browsers send "audio/webm;codecs=opus"
  // for recorded blobs, which breaks exact-match checks.
  const baseMime = file.mimetype.split(';')[0].trim();
  const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
  if (audioTypes.includes(baseMime)) {
    cb(null, true);
  } else {
    cb(new Error('Only audio files (MP3, WAV, M4A, WebM) are allowed'));
  }
};

// Single-file variant (legacy / compact mode)
export const uploadVoiceAudio = multer({
  storage: _voiceAudioStorage,
  fileFilter: _voiceAudioFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('audio');

// Multi-file variant — up to 10 samples for higher-quality voice cloning
export const uploadVoiceAudioMulti = multer({
  storage: _voiceAudioStorage,
  fileFilter: _voiceAudioFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
}).array('audio', 10);

// Post media upload (images, videos) - expects 'file' field
export const uploadPostMedia = multer({
  storage: createStorage('content'),
  fileFilter: chatMediaFilter,
  limits: {
    fileSize: config.upload.maxSize
  }
}).single('file');

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

export const deleteFile = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error deleting file' });
    return false;
  }
};

export const getFileUrl = (filename: string, subDir: string = '') => {
  const basePath = subDir ? `${subDir}/${filename}` : filename;
  return buildUploadUrl(basePath);
};
