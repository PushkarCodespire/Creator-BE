// ===========================================
// STRUCTURED LOGGING UTILITY
// ===========================================
// Production-ready logging with Winston
// Replaces console.log for better debugging and monitoring

import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? format : consoleFormat,
  }),
];

// File logging is disabled by default to avoid filesystem permission issues
// Enable it explicitly with LOG_TO_FILE=true (optional LOG_DIR to set directory)
const enableFileLogging = process.env.LOG_TO_FILE === 'true';
if (enableFileLogging) {
  const logDir = process.env.LOG_DIR || 'logs';
  try {
    fs.mkdirSync(logDir, { recursive: true });

    // Error log file
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: format,
      })
    );

    // Combined log file
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: format,
      })
    );
  } catch (error) {
    // Fallback to console-only logging if we cannot create the log directory
    // eslint-disable-next-line no-console
    console.warn(`[Logger] File logging disabled. Could not create log dir "${logDir}".`, error);
  }
}

// Create the logger
export const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Create a stream object for Morgan HTTP logger
export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// Helper functions for common logging patterns
export const logApiRequest = (method: string, path: string, userId?: string) => {
  logger.http(`${method} ${path}`, { userId });
};

export const logApiResponse = (method: string, path: string, statusCode: number, responseTime: number) => {
  logger.http(`${method} ${path} ${statusCode} - ${responseTime}ms`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logError = (error: Error, context?: Record<string, any>) => {
  logger.error(error.message, {
    stack: error.stack,
    ...context,
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logInfo = (message: string, metadata?: Record<string, any>) => {
  logger.info(message, metadata);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logWarning = (message: string, metadata?: Record<string, any>) => {
  logger.warn(message, metadata);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logDebug = (message: string, metadata?: Record<string, any>) => {
  logger.debug(message, metadata);
};

export default logger;
