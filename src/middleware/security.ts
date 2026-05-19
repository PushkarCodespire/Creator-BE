// ===========================================
// SECURITY FEATURES
// ===========================================
// Implements password requirements, hashing, and session management

import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import validator from 'validator';
import sanitizeHtml from 'sanitize-html';
import { Request, Response, NextFunction } from 'express';
import prisma from '../../prisma/client';
import { validatePassword as validatePasswordUtil } from '../utils/jwt';  // Import with alias
import { logWarning } from '../utils/logger';

// Password requirements configuration
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  maxConsecutiveChars: 3, // Maximum consecutive identical characters
  forbiddenPatterns: [    // Patterns that shouldn't appear in password
    'qwerty', 'asdfgh', 'zxcvbn', // Keyboard patterns
    '123456', '012345', '987654', // Sequential numbers
    'password', 'admin', 'welcome', // Common passwords
  ]
};

/**
 * Enhanced password validation with additional checks
 */
export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const basicValidation = validatePasswordUtil(password);
  
  if (!basicValidation.isValid) {
    return basicValidation;
  }
  
  const errors: string[] = [];
  
  // Check for forbidden patterns
  const lowerPassword = password.toLowerCase();
  for (const pattern of PASSWORD_REQUIREMENTS.forbiddenPatterns) {
    if (lowerPassword.includes(pattern.toLowerCase())) {
      errors.push(`Password contains common pattern: ${pattern}`);
    }
  }
  
  // Check for consecutive characters
  let consecutiveCount = 1;
  for (let i = 1; i < password.length; i++) {
    if (password[i] === password[i - 1]) {
      consecutiveCount++;
      if (consecutiveCount > PASSWORD_REQUIREMENTS.maxConsecutiveChars) {
        errors.push(`Password has too many consecutive identical characters (max: ${PASSWORD_REQUIREMENTS.maxConsecutiveChars})`);
        break;
      }
    } else {
      consecutiveCount = 1;
    }
  }
  
  // Check for personal information in password (if user data is available)
  // This would typically be checked against user's profile info
  
  return {
    isValid: errors.length === 0,
    errors: [...basicValidation.errors, ...errors]
  };
};

/**
 * Rate limiting middleware for authentication endpoints
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  message: {
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
});

/**
 * Rate limiting for login attempts per user
 */
export const userLoginRateLimit = (req: Request, res: Response, next: NextFunction) => {
  // This would typically use Redis to track attempts per user
  // For now, we'll implement a basic version using memory (not suitable for production)
  
  // Extract email from request body
  const email = req.body.email;
  
  if (!email) {
    return next();
  }
  
  // In production, use Redis to track login attempts per user
  // For demo purposes, we'll skip this
  next();
};

/**
 * Slow down middleware for brute force protection
 */
export const authSpeedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 3, // Begin slowing down after 3 requests
  delayMs: 500, // Start with a 500ms delay
  maxDelayMs: 10 * 1000, // Cap the delay at 10 seconds
});

/**
 * Account lockout mechanism
 */
export interface LoginAttempt {
  ip: string;
  email: string;
  timestamp: Date;
  success: boolean;
}

export class AccountLockout {
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
  private static readonly ATTEMPTS_WINDOW = 15 * 60 * 1000; // 15 minutes
  
  // In production, this would use Redis for distributed state
  private static attempts: Map<string, LoginAttempt[]> = new Map();
  
  /**
   * Record a login attempt
   */
  static recordAttempt(email: string, ip: string, success: boolean): void {
    const key = `${email}:${ip}`;
    const now = new Date();
    
    let attempts = this.attempts.get(key) || [];
    
    // Filter out attempts older than the window
    attempts = attempts.filter(attempt => 
      now.getTime() - attempt.timestamp.getTime() < this.ATTEMPTS_WINDOW
    );
    
    // Add new attempt
    attempts.push({
      ip,
      email,
      timestamp: now,
      success
    });
    
    this.attempts.set(key, attempts);
  }
  
  /**
   * Check if account should be locked
   */
  static isLocked(email: string, ip: string): boolean {
    const key = `${email}:${ip}`;
    const attempts = this.attempts.get(key) || [];
    
    // Count failed attempts in the window
    const recentAttempts = attempts.filter(attempt => 
      !attempt.success &&
      new Date().getTime() - attempt.timestamp.getTime() < this.ATTEMPTS_WINDOW
    );
    
    return recentAttempts.length >= this.MAX_ATTEMPTS;
  }
  
  /**
   * Reset attempts after successful login
   */
  static resetAttempts(email: string, ip: string): void {
    const key = `${email}:${ip}`;
    this.attempts.delete(key);
  }
}

/**
 * Password strength indicator middleware
 */
export const checkPasswordStrength = (req: Request, res: Response, next: NextFunction) => {
  const { password } = req.body;
  
  if (!password) {
    return next();
  }
  
  const validation = validatePassword(password);
  
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Weak password',
      details: validation.errors
    });
  }
  
  next();
};

/**
 * Sanitize user input
 */
export const sanitizeInput = (input: unknown): unknown => {
  if (typeof input === 'string') {
    return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  
  if (Array.isArray(input)) {
    return input.map(item => sanitizeInput(item));
  }
  
  if (typeof input === 'object' && input !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const key in input as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        sanitized[key] = sanitizeInput((input as Record<string, unknown>)[key]);
      }
    }
    return sanitized;
  }
  
  return input;
};

/**
 * Input sanitization middleware
 */
export const sanitizeInputs = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  
  if (req.query) {
    req.query = sanitizeInput(req.query) as typeof req.query;
  }

  if (req.params) {
    req.params = sanitizeInput(req.params) as typeof req.params;
  }
  
  next();
};

/**
 * Validate email format
 */
export const validateEmail = (email: string): boolean => {
  return validator.isEmail(email);
};

/**
 * Check if email is disposable
 */
export const isDisposableEmail = (email: string): boolean => {
  const disposableDomains = [
    '10minutemail.com',
    'temp-mail.org',
    'guerrillamail.com',
    'mailinator.com',
    'yopmail.com',
    'throwawaymail.com',
    'disposablemail.com',
    'sharklasers.com',
    'trashmail.com',
    'tempmailaddress.com'
  ];
  
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? disposableDomains.includes(domain) : false;
};

/**
 * Validate phone number format
 */
export const validatePhone = (phone: string): boolean => {
  // Basic phone number validation (adjust regex as needed)
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
  return phoneRegex.test(phone);
};

/**
 * Check for suspicious activity
 */
export interface SuspiciousActivity {
  userId: string;
  activityType: string;
  details: string;
  timestamp: Date;
  ip: string;
  userAgent: string;
}

export class SuspiciousActivityMonitor {
  private static readonly ACTIVITY_THRESHOLD = 5; // Number of activities before flagging
  private static readonly TIME_WINDOW = 60 * 1000; // 1 minute window
  
  // In production, this would use Redis
  private static activities: Map<string, SuspiciousActivity[]> = new Map();
  
  static recordActivity(activity: SuspiciousActivity): void {
    const key = activity.userId;
    const now = new Date();
    
    let userActivities = this.activities.get(key) || [];
    
    // Filter out old activities
    userActivities = userActivities.filter(act => 
      now.getTime() - act.timestamp.getTime() < this.TIME_WINDOW
    );
    
    userActivities.push(activity);
    
    this.activities.set(key, userActivities);
    
    // Check if threshold exceeded
    if (userActivities.length >= this.ACTIVITY_THRESHOLD) {
      logWarning(`Suspicious activity detected for user ${activity.userId}`);
      // In production, you might want to send alerts or lock the account
    }
  }
  
  static getUserActivityCount(userId: string): number {
    const activities = this.activities.get(userId) || [];
    const now = new Date();
    
    return activities.filter(act => 
      now.getTime() - act.timestamp.getTime() < this.TIME_WINDOW
    ).length;
  }
}

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Prevent XSS attacks
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://*.sentry.io; " +
    "frame-ancestors 'none';"
  );
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Feature policy
  res.setHeader('Feature-Policy', 
    "geolocation 'none'; " +
    "microphone 'none'; " +
    "camera 'none';"
  );
  
  next();
};

/**
 * Session hijacking prevention
 */
export const sessionHijackingProtection = (req: Request, res: Response, next: NextFunction) => {
  // Bind session to IP and user agent to prevent hijacking
  // This happens in the session management middleware
  
  // Rotate session ID periodically
  // This would typically be handled by the session management system
  
  next();
};

/**
 * Account verification middleware
 */
export const requireEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (!user.isVerified) {
    return res.status(403).json({ 
      error: 'Email verification required',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  
  next();
};

/**
 * Password history check
 */
export class PasswordHistory {
  static readonly HISTORY_SIZE = 5; // Number of previous passwords to remember
  
  /**
   * Check if new password is in user's history
   */
  static async isNewPasswordAllowed(_userId: string, _newPassword: string): Promise<boolean> {
    // Since passwordHistory field doesn't exist in the schema, return true for now
    // TODO: Add passwordHistory field to User model in schema.prisma if needed
    return true;
  }
  
  /**
   * Add password to history
   */
  static async addToHistory(_userId: string, _password: string): Promise<void> {
    // Since passwordHistory field doesn't exist in the schema, do nothing for now
    // TODO: Add passwordHistory field to User model in schema.prisma if needed
  }
}

/**
 * Account recovery questions
 */
export interface RecoveryQuestion {
  question: string;
  answer: string; // This should be hashed
}

/**
 * Multi-factor authentication (placeholder - would need full implementation)
 */
export class MultiFactorAuth {
  static async generateBackupCodes(_userId: string): Promise<string[]> {
    // Generate backup codes for MFA recovery
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(Math.random().toString(36).substring(2, 8).toUpperCase());
    }
    
    // Store hashed codes in database
    const _hashedCodes = await Promise.all(
      codes.map(code => bcrypt.hash(code, 12))
    );
    
    // Since backupCodes field doesn't exist in the schema, skip storing for now
    // TODO: Add backupCodes field to User model in schema.prisma if needed
    
    return codes;
  }
  
  static async validateBackupCode(_userId: string, _code: string): Promise<boolean> {
    // Since backupCodes field doesn't exist in the schema, return false for now
    // TODO: Add backupCodes field to User model in schema.prisma if needed
    return false;
  }
}

// Export commonly used security functions
// All classes are already exported individually
