// ===========================================
// COMMENT CONTROLLER
// ===========================================

import { Response } from 'express';
import prisma from '../../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

// ===========================================
// CREATE COMMENT
// ===========================================
export const createComment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { postId } = req.params;
  const { content, parentId } = req.body;

  if (!content || content.trim().length === 0) {
    throw new AppError('Comment content is required', 400);
  }

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId as string },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // If parentId provided, check if parent comment exists
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
    });

    if (!parentComment) {
      throw new AppError('Parent comment not found', 404);
    }

    // Ensure parent comment belongs to the same post
    if (parentComment.postId !== postId) {
      throw new AppError('Parent comment does not belong to this post', 400);
    }
  }

  // Create comment
  const comment = await prisma.comment.create({
    data: {
      userId,
      postId: postId as string,
      content: content.trim(),
      parentId: parentId || null,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  // Update post commentsCount
  await prisma.post.update({
    where: { id: postId as string },
    data: {
      commentsCount: {
        increment: 1,
      },
    },
  });

  // Create notification for post creator (if not self-comment)
  const postCreator = await prisma.creator.findUnique({
    where: { id: post.creatorId },
    select: { userId: true },
  });

  if (postCreator && postCreator.userId !== userId) {
    await prisma.notification.create({
      data: {
        userId: postCreator.userId,
        type: 'CHAT_MESSAGE', // Reusing existing type, could add COMMENT type later
        title: 'New Comment',
        message: `Someone commented on your post: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
        actionUrl: `/posts/${postId}`,
        priority: 'LOW',
      },
    });
  }

  // If it's a reply, notify parent comment author
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { userId: true },
    });

    if (parentComment && parentComment.userId !== userId) {
      await prisma.notification.create({
        data: {
          userId: parentComment.userId,
          type: 'CHAT_MESSAGE',
          title: 'New Reply',
          message: `Someone replied to your comment: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
          actionUrl: `/posts/${postId}`,
          priority: 'LOW',
        },
      });
    }
  }

  res.status(201).json({
    success: true,
    data: comment,
  });
});

// ===========================================
// GET COMMENTS FOR POST
// ===========================================
export const getComments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { postId } = req.params;
  const { page = '1', limit = '20', sort = 'newest' } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId as string },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // Build orderBy based on sort
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = { createdAt: 'desc' };
  if (sort === 'oldest') {
    orderBy = { createdAt: 'asc' };
  } else if (sort === 'popular') {
    orderBy = { likesCount: 'desc' };
  }

  // Get only top-level comments (no parent)
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where: {
        postId: postId as string,
        parentId: null,
      },
      skip,
      take: limitNum,
      orderBy,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            replies: true,
          },
        },
      },
    }),
    prisma.comment.count({
      where: {
        postId: postId as string,
        parentId: null,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      comments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});

// ===========================================
// GET REPLIES FOR COMMENT
// ===========================================
export const getReplies = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { commentId } = req.params;
  const { page = '1', limit = '10' } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Check if comment exists
  const comment = await prisma.comment.findUnique({
    where: { id: commentId as string },
  });

  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  const [replies, total] = await Promise.all([
    prisma.comment.findMany({
      where: {
        parentId: commentId as string,
      },
      skip,
      take: limitNum,
      orderBy: { createdAt: 'asc' }, // Replies chronologically
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            replies: true,
          },
        },
      },
    }),
    prisma.comment.count({
      where: {
        parentId: commentId as string,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      replies,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});

// ===========================================
// UPDATE COMMENT
// ===========================================
export const updateComment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const { commentId } = req.params;
  const { content } = req.body;

  if (!content || content.trim().length === 0) {
    throw new AppError('Comment content is required', 400);
  }

  // Check if comment exists and user owns it
  const comment = await prisma.comment.findUnique({
    where: { id: commentId as string },
  });

  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  if (comment.userId !== userId) {
    throw new AppError('You can only edit your own comments', 403);
  }

  // Update comment
  const updatedComment = await prisma.comment.update({
    where: { id: commentId as string },
    data: {
      content: content.trim(),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: updatedComment,
  });
});

// ===========================================
// DELETE COMMENT
// ===========================================
export const deleteComment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id!;
  const userRole = req.user?.role;
  const { commentId } = req.params;

  // Check if comment exists
  const comment = await prisma.comment.findUnique({
    where: { id: commentId as string },
    include: {
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  // Check ownership or admin rights
  if (comment.userId !== userId && userRole !== 'ADMIN') {
    throw new AppError('You can only delete your own comments', 403);
  }

  // Count total comments to delete (including nested replies)
  const countCommentsToDelete = async (commentId: string): Promise<number> => {
    const replies = await prisma.comment.findMany({
      where: { parentId: commentId },
      select: { id: true },
    });

    let count = 1; // Current comment
    for (const reply of replies) {
      count += await countCommentsToDelete(reply.id);
    }
    return count;
  };

  const totalToDelete = await countCommentsToDelete(commentId as string);

  // Delete comment (cascade will delete all replies)
  await prisma.comment.delete({
    where: { id: commentId as string },
  });

  // Update post commentsCount
  await prisma.post.update({
    where: { id: comment.postId },
    data: {
      commentsCount: {
        decrement: totalToDelete,
      },
    },
  });

  res.json({
    success: true,
    message: 'Comment deleted successfully',
  });
});

// ===========================================
// LIKE COMMENT
// ===========================================
export const likeComment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const _userId = req.user?.id!;
  const { commentId } = req.params;

  // Check if comment exists
  const comment = await prisma.comment.findUnique({
    where: { id: commentId as string },
  });

  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  // Increment likesCount
  const updatedComment = await prisma.comment.update({
    where: { id: commentId as string },
    data: {
      likesCount: {
        increment: 1,
      },
    },
  });

  res.json({
    success: true,
    data: {
      likesCount: updatedComment.likesCount,
    },
  });
});

// ===========================================
// UNLIKE COMMENT
// ===========================================
export const unlikeComment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const _userId = req.user?.id!;
  const { commentId } = req.params;

  // Check if comment exists
  const comment = await prisma.comment.findUnique({
    where: { id: commentId as string },
  });

  if (!comment) {
    throw new AppError('Comment not found', 404);
  }

  // Decrement likesCount (ensure it doesn't go below 0)
  const updatedComment = await prisma.comment.update({
    where: { id: commentId as string },
    data: {
      likesCount: {
        decrement: comment.likesCount > 0 ? 1 : 0,
      },
    },
  });

  res.json({
    success: true,
    data: {
      likesCount: updatedComment.likesCount,
    },
  });
});
