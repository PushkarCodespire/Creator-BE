// ===========================================
// MESSAGE REACTION CONTROLLER
// ===========================================

import { Response } from 'express';
import prisma from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

// ===========================================
// ADD REACTION
// ===========================================
export const addReaction = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== 'string') {
    throw new AppError('Emoji is required', 400);
  }

  // Validate emoji (simple check for single character or emoji)
  if (emoji.length > 10) {
    throw new AppError('Invalid emoji', 400);
  }

  // Check if message exists
  const message = await prisma.message.findUnique({
    where: { id: messageId as string },
    include: {
      conversation: true,
    },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Check if user has access to this conversation
  const conversation = message.conversation;
  if (conversation.userId && conversation.userId !== userId) {
    // User doesn't own conversation, check if they're allowed
    throw new AppError('Access denied', 403);
  }

  // Check if reaction already exists
  const existingReaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: messageId as string,
        userId,
        emoji,
      },
    },
  });

  if (existingReaction) {
    // Already reacted with this emoji, return existing
    res.json({
      success: true,
      data: existingReaction,
      message: 'Already reacted',
    });
    return;
  }

  // Create new reaction
  const reaction = await prisma.messageReaction.create({
    data: {
      messageId: messageId as string,
      userId,
      emoji,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: reaction,
  });
});

// ===========================================
// REMOVE REACTION
// ===========================================
export const removeReaction = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji) {
    throw new AppError('Emoji is required', 400);
  }

  // Check if reaction exists
  const reaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: messageId as string,
        userId,
        emoji,
      },
    },
  });

  if (!reaction) {
    throw new AppError('Reaction not found', 404);
  }

  // Delete reaction
  await prisma.messageReaction.delete({
    where: {
      id: reaction.id,
    },
  });

  res.json({
    success: true,
    message: 'Reaction removed',
  });
});

// ===========================================
// GET MESSAGE REACTIONS
// ===========================================
export const getMessageReactions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { messageId } = req.params;

  // Check if message exists
  const message = await prisma.message.findUnique({
    where: { id: messageId as string },
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Get all reactions for this message
  const reactions = await prisma.messageReaction.findMany({
    where: { messageId: messageId as string },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // Group reactions by emoji
  const groupedReactions: { [emoji: string]: Record<string, unknown>[] } = {};
  reactions.forEach((reaction) => {
    if (!groupedReactions[reaction.emoji]) {
      groupedReactions[reaction.emoji] = [];
    }
    groupedReactions[reaction.emoji].push({
      id: reaction.id,
      userId: reaction.userId,
      user: reaction.user,
      createdAt: reaction.createdAt,
    });
  });

  res.json({
    success: true,
    data: {
      reactions: groupedReactions,
      total: reactions.length,
    },
  });
});
