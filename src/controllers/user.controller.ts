// ===========================================
// USER CONTROLLER
// Handle user profile and preferences
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

// ===========================================
// GET USER PROFILE
// GET /api/users/profile
// ===========================================

export const getUserProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      interests: true,
      createdAt: true,
      creator: {
        select: {
          id: true,
          displayName: true,
          profileImage: true,
          isVerified: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: user,
  });
});

// ===========================================
// UPDATE USER INTERESTS
// PUT /api/users/interests
// ===========================================

export const updateUserInterests = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { interests } = req.body;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  if (!interests || !Array.isArray(interests)) {
    throw new AppError('Interests must be an array', 400);
  }

  // Validate interests
  const validCategories = [
    'Fitness',
    'Tech',
    'Business',
    'Lifestyle',
    'Education',
    'Entertainment',
    'Health',
    'Finance',
    'Gaming',
    'Sports',
    'Travel',
    'Food',
    'Fashion',
    'Music',
    'Art',
    'Science',
  ];

  const invalidInterests = interests.filter(
    (interest: string) => !validCategories.includes(interest)
  );

  if (invalidInterests.length > 0) {
    throw new AppError(
      `Invalid interests: ${invalidInterests.join(', ')}. Valid categories: ${validCategories.join(', ')}`,
      400
    );
  }

  // Update user interests
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { interests },
    select: {
      id: true,
      interests: true,
    },
  });

  res.json({
    success: true,
    data: updatedUser,
    message: 'Interests updated successfully',
  });
});

// ===========================================
// GET USER INTERESTS
// GET /api/users/interests
// ===========================================

export const getUserInterests = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { interests: true },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: {
      interests: user.interests || [],
    },
  });
});

// ===========================================
// GET AVAILABLE CATEGORIES
// GET /api/users/categories
// ===========================================

export const getAvailableCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = [
    { value: 'Fitness', label: 'Fitness & Wellness', icon: '💪' },
    { value: 'Tech', label: 'Technology', icon: '💻' },
    { value: 'Business', label: 'Business & Entrepreneurship', icon: '💼' },
    { value: 'Lifestyle', label: 'Lifestyle', icon: '🌟' },
    { value: 'Education', label: 'Education & Learning', icon: '📚' },
    { value: 'Entertainment', label: 'Entertainment', icon: '🎬' },
    { value: 'Health', label: 'Health & Nutrition', icon: '🏥' },
    { value: 'Finance', label: 'Finance & Investing', icon: '💰' },
    { value: 'Gaming', label: 'Gaming & Esports', icon: '🎮' },
    { value: 'Sports', label: 'Sports', icon: '⚽' },
    { value: 'Travel', label: 'Travel & Adventure', icon: '✈️' },
    { value: 'Food', label: 'Food & Cooking', icon: '🍳' },
    { value: 'Fashion', label: 'Fashion & Beauty', icon: '👗' },
    { value: 'Music', label: 'Music & Audio', icon: '🎵' },
    { value: 'Art', label: 'Art & Design', icon: '🎨' },
    { value: 'Science', label: 'Science & Nature', icon: '🔬' },
  ];

  res.json({
    success: true,
    data: { categories },
  });
});

// ===========================================
// UPDATE USER PROFILE
// PUT /api/users/profile
// ===========================================

export const updateUserProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { name, avatar } = req.body;

  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataToUpdate: any = {};
  if (name) dataToUpdate.name = name;
  if (avatar !== undefined) dataToUpdate.avatar = avatar;

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: dataToUpdate,
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      interests: true,
    },
  });

  res.json({
    success: true,
    data: updatedUser,
    message: 'Profile updated successfully',
  });
});

// ===========================================
// COMPLETE USER ONBOARDING
// PATCH /api/users/onboarding
// ===========================================
export const completeOnboarding = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('Authentication required', 401);

  const { ageRange, heightCm, weightKg, dietPreference, fitnessGoal, fitnessChallenge, coachStyle } = req.body;

  if (!ageRange || !heightCm || !weightKg || !dietPreference || !fitnessGoal || !fitnessChallenge || !coachStyle) {
    throw new AppError('All onboarding fields are required', 400);
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ageRange,
      heightCm: Number(heightCm),
      weightKg: Number(weightKg),
      dietPreference,
      fitnessGoal,
      fitnessChallenge,
      coachStyle,
      onboardingCompleted: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      role: true,
      onboardingCompleted: true,
      ageRange: true,
      heightCm: true,
      weightKg: true,
      dietPreference: true,
      fitnessGoal: true,
      fitnessChallenge: true,
      coachStyle: true,
    },
  });

  res.json({ success: true, data: updatedUser, message: 'Onboarding completed' });
});
