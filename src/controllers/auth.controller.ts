// ===========================================
// AUTH CONTROLLER
// ===========================================

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../prisma/client';
import { generateToken } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';
import { sendEmail } from '../utils/email';
import { EmailWorker } from '../workers/emailWorker';
import { logError, logDebug } from '../utils/logger';

// ===========================================
// REGISTER
// ===========================================

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name, role = 'USER', dateOfBirth, location, phone, redirectAfterVerification } = req.body;

  // Validate input
  if (!email || !password || !name) {
    throw new AppError('Email, password, and name are required', 400);
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Determine role (validate allowed roles for self-registration)
  let userRole: UserRole = UserRole.USER;
  if (role === 'CREATOR') {
    userRole = UserRole.CREATOR;
  } else if (role === 'COMPANY') {
    userRole = UserRole.COMPANY;
  }

  // Generate verification token
  const crypto = require('crypto');
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role: userRole,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      location: location || undefined,
      phone: phone ? phone.replace(/[\s\-\(\)\.]/g, '') : undefined,
      verificationToken,
      verificationExpiry
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true
    }
  });

  // Create subscription for all users
  await prisma.subscription.create({
    data: {
      userId: user.id,
      plan: 'FREE',
      status: 'ACTIVE'
    }
  });

  // Create creator profile if role is CREATOR
  if (userRole === UserRole.CREATOR) {
    await prisma.creator.create({
      data: {
        userId: user.id,
        displayName: name
      }
    });
  }

  // Create company profile if role is COMPANY
  if (userRole === UserRole.COMPANY) {
    await prisma.company.create({
      data: {
        userId: user.id,
        companyName: name
      }
    });
  }

  // Generate token
  const token = generateToken(user);

  // Send welcome email (non-blocking)
  EmailWorker.sendWelcomeEmail(user.id).catch((err) => {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Welcome email failed' });
    // Don't fail registration if email fails
  });

  // Send verification email (non-blocking)
  EmailWorker.sendVerificationEmail(user.email, verificationToken, user.name, redirectAfterVerification).catch((err) => {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Verification email failed' });
    // Don't fail registration if email fails
  });

  res.status(201).json({
    success: true,
    data: {
      user,
      token
    }
  });
});

// ===========================================
// LOGIN
// ===========================================

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          isVerified: true,
          isRejected: true,
          rejectionReason: true
        }
      },
      company: {
        select: {
          id: true,
          companyName: true,
          isVerified: true
        }
      },
      subscription: {
        select: {
          plan: true,
          status: true
        }
      }
    }
  });

  if (!user || !user.password) {
    throw new AppError('Invalid email or password', 401);
  }

  // ============================================
  // DEMO MODE: Simple password validation
  // ============================================
  // For demo/development, bypass bcrypt for test accounts
  // This makes login "very very easy" as requested
  let isPasswordValid = false;

  const isDemoMode = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'development';

  // Check bcrypt first to see if they're using a custom password
  isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid && isDemoMode) {
    // If bcrypt failed but we're in demo mode, check for demo defaults
    // ONLY if the user hasn't set a custom password yet (lastPasswordResetAt is null)
    if (!user.lastPasswordResetAt) {
      const emailDomain = email.split('@')[1];
      const simplePasswordMap: { [key: string]: string } = {
        'platform.com': 'admin123',
        'creator.com': 'creator123',
        'test.com': 'user123',
        'company.com': 'company123'
      };

      const expectedPassword = simplePasswordMap[emailDomain];

      if (expectedPassword && password === expectedPassword) {
        // Demo password matched
        isPasswordValid = true;
        logDebug(`Demo mode login: ${email}`);
      }
    }
  }

  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  // -------------------------------------------------
  // Compute simple profile completion flag for creators
  // Used by frontend to know if creator onboarding
  // profile step is done right after login
  // -------------------------------------------------
  let isProfileComplete = false;

  if (user.role === UserRole.CREATOR) {
    const creatorProfile = await prisma.creator.findUnique({
      where: { userId: user.id },
      select: {
        bio: true,
        category: true,
        profileImage: true,
      },
    });

    if (creatorProfile) {
      // Profile is complete if at least bio OR category is set
      // (profileImage is optional — shouldn't block dashboard access)
      isProfileComplete = !!(
        creatorProfile.bio ||
        creatorProfile.category
      );
    }
  } else if (user.role === UserRole.USER) {
    // For regular users, profile is complete once fitness onboarding is done
    isProfileComplete = user.onboardingCompleted ?? false;
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  // Generate token
  const token = generateToken(user);

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user;
  const userWithRejection = userWithoutPassword.creator
    ? {
        ...userWithoutPassword,
        creator: {
          ...userWithoutPassword.creator,
          rejected: Boolean(userWithoutPassword.creator.isRejected),
          rejectionReason: userWithoutPassword.creator.rejectionReason ?? null
        }
      }
    : userWithoutPassword;

  res.json({
    success: true,
    data: {
      user: userWithRejection,
      token,
      // Frontend flag: indicates whether creator profile
      // (bio + category + profile image) is fully set up
      isProfileComplete,
    }
  });
});

// ===========================================
// GET CURRENT USER
// ===========================================

export const getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      isVerified: true,
      createdAt: true,
      onboardingCompleted: true,
      ageRange: true,
      heightCm: true,
      weightKg: true,
      dietPreference: true,
      fitnessGoal: true,
      fitnessChallenge: true,
      coachStyle: true,
      creator: {
        select: {
          id: true,
          displayName: true,
          bio: true,
          profileImage: true,
          coverImage: true,
          youtubeUrl: true,
          instagramUrl: true,
          twitterUrl: true,
          websiteUrl: true,
          isVerified: true,
          isRejected: true,
          rejectionReason: true,
          rejectedAt: true,
          totalChats: true,
          totalEarnings: true,
          aiPersonality: true,
          aiTone: true,
          welcomeMessage: true,
          bankAccount: {
            select: {
              accountHolderName: true,
              accountNumber: true,
              ifscCode: true,
              bankName: true
            }
          }
        }
      },
      company: {
        select: {
          id: true,
          companyName: true,
          isVerified: true
        }
      },
      subscription: {
        select: {
          plan: true,
          status: true,
          messagesUsedToday: true,
          currentPeriodEnd: true
        }
      }
    }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const responseUser = user.creator
    ? {
        ...user,
        creator: {
          ...user.creator,
          rejected: Boolean(user.creator.isRejected),
          rejectionReason: user.creator.rejectionReason ?? null
        }
      }
    : user;

  res.json({
    success: true,
    data: responseUser
  });
});

// ===========================================
// UPDATE PROFILE
// ===========================================

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const { name, avatar } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(name && { name }),
      ...(avatar && { avatar })
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true
    }
  });

  res.json({
    success: true,
    data: user
  });
});

// ===========================================
// CHANGE PASSWORD
// ===========================================

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new passwords are required', 400);
  }

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }
  });

  if (!user || !user.password) {
    throw new AppError('Cannot change password for OAuth users', 400);
  }

  // Verify current password
  let isValid = await bcrypt.compare(currentPassword, user.password);

  // Demo mode bypass for changing initial password
  const isDemoMode = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV === 'development';
  if (!isValid && isDemoMode && !user.lastPasswordResetAt) {
    const emailDomain = user.email.split('@')[1];
    const simplePasswordMap: { [key: string]: string } = {
      'platform.com': 'admin123',
      'creator.com': 'creator123',
      'test.com': 'user123',
      'company.com': 'company123'
    };
    const expectedPassword = simplePasswordMap[emailDomain];
    if (expectedPassword && currentPassword === expectedPassword) {
      isValid = true;
    }
  }

  if (!isValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      password: hashedPassword,
      lastPasswordResetAt: new Date()
    }
  });

  res.json({
    success: true,
    message: 'Password updated successfully'
  });
});

// ===========================================
// VERIFY EMAIL
// ===========================================

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;

  // Validate token format
  if (!token || typeof token !== 'string') {
    throw new AppError('Invalid verification token', 400);
  }

  // Find user by token
  const user = await prisma.user.findUnique({
    where: { verificationToken: token }
  });

  if (!user) {
    throw new AppError('Invalid or expired verification token', 400);
  }

  // Check expiry
  if (user.verificationExpiry && user.verificationExpiry < new Date()) {
    throw new AppError('Verification token expired. Request a new one.', 400);
  }

  // Already verified
  if (user.isVerified) {
    return res.json({
      success: true,
      message: 'Email already verified'
    });
  }

  // Verify user
  const verifiedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      isVerified: true,
      verifiedAt: new Date(),
      verificationToken: null,
      verificationExpiry: null
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  });

  const jwtToken = generateToken(verifiedUser);

  res.json({
    success: true,
    message: 'Email verified successfully',
    data: { verified: true, user: verifiedUser, token: jwtToken }
  });
});

// ===========================================
// RESEND VERIFICATION
// ===========================================

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.isVerified) {
    throw new AppError('Email already verified', 400);
  }

  // Generate new token
  const crypto = require('crypto');
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await prisma.user.update({
    where: { id: userId },
    data: {
      verificationToken,
      verificationExpiry
    }
  });

  // Send verification email
  const _verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
  await EmailWorker.sendVerificationEmail(user.email, verificationToken, user.name).catch(
    (err) => {
      logError(err instanceof Error ? err : new Error(String(err)), { context: 'Verification email failed' });
      throw new AppError('Failed to send verification email', 500);
    }
  );

  res.json({
    success: true,
    message: 'Verification email sent'
  });
});

// ===========================================
// FORGOT PASSWORD
// ===========================================

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  // Validate email
  if (!email) {
    throw new AppError('Email is required', 400);
  }

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new AppError('No account found with this email address', 404);
  }

  // Generate reset token
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: resetToken,
      resetPasswordExpiry: resetExpiry
    }
  });

  // Send email
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const { passwordResetEmail } = require('../utils/email');
  const emailTemplate = passwordResetEmail(user.name, resetUrl);

  await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text
  }).catch((err) => {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Password reset email failed' });
    // Don't fail the request if email fails
  });

  res.json({
    success: true,
    message: 'If that email exists, we sent a password reset link'
  });
});

// ===========================================
// RESET PASSWORD
// ===========================================

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  // Validate input
  if (!token || !newPassword) {
    throw new AppError('Token and new password are required', 400);
  }

  // Validate password strength
  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { resetPasswordToken: token }
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  // Check expiry
  if (user.resetPasswordExpiry && user.resetPasswordExpiry < new Date()) {
    throw new AppError('Reset token expired. Request a new one.', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpiry: null,
      lastPasswordResetAt: new Date()
    }
  });

  // Send confirmation email
  const { passwordChangedEmail } = require('../utils/email');
  const emailTemplate = passwordChangedEmail(user.name);

  sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text
  }).catch((err) => {
    logError(err instanceof Error ? err : new Error(String(err)), { context: 'Password changed email failed' });
    // Don't fail if email fails
  });

  res.json({
    success: true,
    message: 'Password reset successfully'
  });
});

// ===========================================
// BECOME A CREATOR (upgrade USER → CREATOR)
// ===========================================

export const becomeCreator = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { creator: true } });
  if (!user) throw new AppError('User not found', 404);
  if (user.role === 'CREATOR' && user.creator) throw new AppError('Already a creator', 400);

  // Update role to CREATOR
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { role: 'CREATOR' },
    select: { id: true, email: true, name: true, avatar: true, role: true },
  });

  // Create creator profile if it doesn't exist
  let creator = user.creator;
  if (!creator) {
    creator = await prisma.creator.create({
      data: {
        userId,
        displayName: user.name,
        bio: req.body.about || '',
        tagline: req.body.expertise || '',
        category: req.body.topics?.split(',')?.[0]?.trim() || '',
        tags: req.body.topics ? req.body.topics.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
      },
    });

    // Create default subscription
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, plan: 'FREE' },
      update: {},
    });
  }

  // Generate new token with updated role
  const token = generateToken(updatedUser);

  res.json({
    success: true,
    data: {
      user: { ...updatedUser, creator },
      token,
    },
  });
});
