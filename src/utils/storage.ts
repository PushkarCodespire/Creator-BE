// ===========================================
// STORAGE UTILITY (PVC / Local Filesystem)
// GCP deployment: PVC-backed disk storage only.
// ===========================================

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logInfo, logError } from './logger';
import { buildUploadUrl, getUploadPathPrefixes } from './uploadPaths';

/**
 * Upload file to local filesystem (PVC in GKE, local dir in dev).
 */
export async function uploadFile(
  file: Express.Multer.File,
  folder: string
): Promise<{ url: string }> {
  try {
    return uploadToLocal(file, folder);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'File upload', file: file.originalname });
    throw error;
  }
}

function uploadToLocal(
  file: Express.Multer.File,
  folder: string
): { url: string } {
  const uploadDir = path.join(config.upload.dir, folder);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const filename = `${Date.now()}-${file.originalname}`;
  const filePath = path.join(uploadDir, filename);

  if (file.path && fs.existsSync(file.path)) {
    fs.renameSync(file.path, filePath);
  } else if (file.buffer) {
    fs.writeFileSync(filePath, file.buffer);
  } else {
    throw new Error('No file data available');
  }

  const url = buildUploadUrl(`${folder}/${filename}`);
  logInfo(`File uploaded: ${url}`);
  return { url };
}

/**
 * Delete file from local filesystem.
 */
export async function deleteFile(
  fileIdentifier: string,
  folder?: string
): Promise<boolean> {
  try {
    return deleteFromLocal(fileIdentifier, folder);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'File deletion', file: fileIdentifier });
    return false;
  }
}

function deleteFromLocal(filename: string, folder?: string): boolean {
  const filePath = folder
    ? path.join(config.upload.dir, folder, filename)
    : path.join(config.upload.dir, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logInfo(`File deleted: ${filePath}`);
    return true;
  }
  return false;
}

/**
 * Get full URL for a file. If the value already starts with a known
 * upload prefix, it is returned unchanged.
 */
export function getFileUrl(
  fileIdentifier: string,
  folder?: string
): string {
  if (getUploadPathPrefixes().some(prefix => fileIdentifier.startsWith(prefix))) {
    return fileIdentifier;
  }
  return folder ? buildUploadUrl(`${folder}/${fileIdentifier}`) : buildUploadUrl(fileIdentifier);
}

/**
 * Get storage provider info (always PVC/local).
 */
export function getStorageInfo() {
  return {
    provider: 'local' as const,
    isCloud: false,
    s3Configured: false,
    cloudinaryConfigured: false,
  };
}

export const STORAGE_PROVIDER = 'local' as const;
