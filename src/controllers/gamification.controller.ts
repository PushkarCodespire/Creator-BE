// ===========================================
// GAMIFICATION CONTROLLER
// Achievement system, leaderboards, points
// ===========================================

import { Request, Response } from 'express';
import prisma from '../../prisma/client';
import { asyncHandler, AppError } from '../middleware/errorHandler';

// ===========================================
// GET USER ACHIEVEMENTS
// ===========================================

export const getUserAchievements = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const userAchievements = await prisma.userAchievement.findMany({
    where: { userId },
    include: {
      achievement: true,
    },
    orderBy: [
      { isUnlocked: 'desc' },
      { unlockedAt: 'desc' },
    ],
  });

  res.json({
    success: true,
    data: userAchievements,
  });
});

// ===========================================
// GET LEADERBOARD
// ===========================================

export const getLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  const { type = 'users', period = 'all' } = req.query as { type?: string; period?: string };
  void period;

  if (type === 'users') {
    // User leaderboard (by messages sent)
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        avatar: true,
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy: {
        messages: {
          _count: "desc"
        }
      },
      take: 100,
    });

    res.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: users.map((user: any, index: number) => ({
        rank: index + 1,
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
        score: user._count.messages,
      })),
    });
  } else if (type === 'creators') {
    // Creator leaderboard (by earnings or chats)
    const creators = await prisma.creator.findMany({
      select: {
        id: true,
        displayName: true,
        profileImage: true,
        totalChats: true,
        totalEarnings: true,
      },
      where: {
        isActive: true,
        isVerified: true,
      },
      orderBy: {
        totalChats: 'desc',
      },
      take: 100,
    });

    res.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: creators.map((creator: any, index: number) => ({
        rank: index + 1,
        creatorId: creator.id,
        displayName: creator.displayName,
        profileImage: creator.profileImage,
        score: creator.totalChats,
        earnings: creator.totalEarnings,
      })),
    });
  } else {
    throw new AppError('Invalid leaderboard type', 400);
  }
});

// ===========================================
// CHECK AND UNLOCK ACHIEVEMENTS
// ===========================================

export const checkAchievements = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { eventType } = req.body;

  // Get all active achievements for this event type
  const achievements = await prisma.achievement.findMany({
    where: {
      isActive: true,
      category: eventType, // e.g., 'chat', 'streak', 'social'
    },
  });

  const unlockedAchievements = [];

  for (const achievement of achievements) {
    // Check if user already has this achievement
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId,
          achievementId: achievement.id,
        },
      },
    });

    if (existing?.isUnlocked) {
      continue; // Already unlocked
    }

    // Calculate progress based on event data
    let progress = 0;
    let shouldUnlock = false;

    switch (achievement.category) {
      case 'chat':
        // Check message count
        const messageCount = await prisma.message.count({
          where: {
            userId,
            role: 'USER',
          },
        });
        progress = Math.min((messageCount / 100) * 100, 100); // Example: 100 messages = 100%
        shouldUnlock = messageCount >= 100;
        break;

      case 'streak':
        // Check daily login streak
        // This would require additional tracking
        progress = 50; // Mock
        shouldUnlock = false;
        break;

      default:
        progress = 0;
    }

    if (existing) {
      // Update progress
      await prisma.userAchievement.update({
        where: { id: existing.id },
        data: {
          progress,
          isUnlocked: shouldUnlock,
          unlockedAt: // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (shouldUnlock ? new Date() : null) as any,
        },
      });

      if (shouldUnlock) {
        unlockedAchievements.push(achievement);
      }
    } else {
      // Create new user achievement
      await prisma.userAchievement.create({
        data: {
          userId,
          achievementId: achievement.id,
          progress,
          isUnlocked: shouldUnlock,
          unlockedAt: // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (shouldUnlock ? new Date() : null) as any,
        },
      });

      if (shouldUnlock) {
        unlockedAchievements.push(achievement);
      }
    }
  }

  res.json({
    success: true,
    data: {
      unlockedAchievements,
    },
  });
});



