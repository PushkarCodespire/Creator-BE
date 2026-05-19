// ===========================================
// CHAT SOCKET HANDLER
// ===========================================
// Real-time chat functionality using Socket.io
// Handles message sending, typing indicators, and presence

import { Server, Socket } from 'socket.io';
import prisma from '../../prisma/client';
import { MessageRole } from '@prisma/client';
import { generateCreatorResponse, ChatMessage } from '../utils/openai';
import { trackBusinessEvent } from '../utils/monitoring';
import { buildAttachmentContext } from '../services/media/media-processor.service';
import { logDebug, logError } from '../utils/logger';

export interface JoinChatPayload {
  conversationId: string;
  userId?: string;
  guestId?: string;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  media?: Array<{
    type: 'image' | 'video' | 'audio' | 'file';
    url: string;
    name?: string;
  }>;
  guestId?: string;
}

export interface TypingPayload {
  conversationId: string;
  isTyping: boolean;
}

export class ChatSocketHandler {
  private static io: Server;

  static initialize(io: Server): void {
    this.io = io;
    
    // Handle socket connections
    io.on('connection', (socket: Socket) => {
      logDebug(`[ChatSocket] User connected: ${socket.id}`);
      
      // Join chat room
      socket.on('join_chat', async (payload: JoinChatPayload) => {
        await this.handleJoinChat(socket, payload);
      });

      // Send message
      socket.on('send_message', async (payload: SendMessagePayload) => {
        await this.handleSendMessage(socket, payload);
      });

      // Typing indicator
      socket.on('typing', async (payload: TypingPayload) => {
        await this.handleTyping(socket, payload);
      });

      // Disconnect
      socket.on('disconnect', () => {
        logDebug(`[ChatSocket] User disconnected: ${socket.id}`);
      });

      // Error handling
      socket.on('error', (error) => {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[ChatSocket] Socket error for ${socket.id}` });
      });
    });
  }

  /**
   * Handle user joining a chat
   */
  private static async handleJoinChat(
    socket: Socket,
    payload: JoinChatPayload
  ): Promise<void> {
    try {
      const { conversationId, userId, guestId } = payload;

      // Validate conversation exists and user has access
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          creator: {
            select: {
              id: true,
              displayName: true,
              isVerified: true
            }
          }
        }
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      // Check user authorization
      if (userId && conversation.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized access to conversation' });
        return;
      }

      if (guestId && conversation.guestId !== guestId) {
        socket.emit('error', { message: 'Unauthorized access to conversation' });
        return;
      }

      // Join the conversation room
      socket.join(`conversation_${conversationId}`);
      
      // Emit conversation details
      socket.emit('chat_joined', {
        conversation: {
          id: conversation.id,
          creator: conversation.creator,
          createdAt: conversation.createdAt
        }
      });

      logDebug(`[ChatSocket] User ${userId || guestId} joined conversation ${conversationId}`);

      // Track join event
      await trackBusinessEvent(
        'chat',
        'user_joined',
        userId,
        { conversationId, guestId: guestId || undefined }
      );

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[ChatSocket] Error joining chat' });
      socket.emit('error', { 
        message: error instanceof Error ? error.message : 'Failed to join chat' 
      });
    }
  }

  /**
   * Handle sending a message
   */
  private static async handleSendMessage(
    socket: Socket,
    payload: SendMessagePayload
  ): Promise<void> {
    try {
      const { conversationId, content, media, guestId } = payload;

      // Validate input
      if (!content?.trim() && (!media || media.length === 0)) {
        socket.emit('error', { message: 'Message content or media is required' });
        return;
      }

      // Get conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          creator: {
            select: {
              id: true,
              userId: true,
              aiPersonality: true,
              aiTone: true,
              welcomeMessage: true
            }
          }
        }
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      // Determine message sender
      let userId: string | undefined;
      const messageRole: MessageRole = MessageRole.USER;

      if (guestId) {
        // Guest user
        if (conversation.guestId !== guestId) {
          socket.emit('error', { message: 'Unauthorized to send message' });
          return;
        }
      } else {
        // Registered user
        userId = conversation.userId || undefined;
        if (!userId) {
          socket.emit('error', { message: 'User not found' });
          return;
        }
      }

      // Create user message
      const userMessage = await prisma.message.create({
        data: {
          conversationId,
          userId,
          role: messageRole,
          content: (content || '').trim(),
          media: media ? JSON.stringify(media) : undefined
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          }
        }
      });

      // Update conversation last message timestamp
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { 
          lastMessageAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Emit user message to room
      this.io.to(`conversation_${conversationId}`).emit('message_received', {
        message: {
          id: userMessage.id,
          content: userMessage.content,
          role: userMessage.role,
          media: userMessage.media ? JSON.parse(userMessage.media as string) : undefined,
          createdAt: userMessage.createdAt,
          user: userMessage.user
        }
      });

      // Build combined prompt with attachments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { combined: attachmentContext } = await buildAttachmentContext(media as any);
      const combinedUserMessage = [
        (content || '').trim(),
        attachmentContext ? `Attachment context:\n${attachmentContext}` : ''
      ].filter(Boolean).join('\n\n');

      // Generate AI response
      const aiResponse = await this.generateAIResponse(
        conversation.creator,
        combinedUserMessage,
        conversationId
      );

      // Create AI message
      const aiMessage = await prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: aiResponse.content,
          tokensUsed: aiResponse.tokensUsed,
          modelUsed: aiResponse.modelUsed,
          responseTimeMs: aiResponse.responseTimeMs
        }
      });

      // Emit AI response
      this.io.to(`conversation_${conversationId}`).emit('message_received', {
        message: {
          id: aiMessage.id,
          content: aiMessage.content,
          role: aiMessage.role,
          tokensUsed: aiMessage.tokensUsed,
          modelUsed: aiMessage.modelUsed,
          responseTimeMs: aiMessage.responseTimeMs,
          createdAt: aiMessage.createdAt
        }
      });

      logDebug(`[ChatSocket] Message sent in conversation ${conversationId}`);

      // Track message events
      await trackBusinessEvent(
        'chat',
        'message_sent',
        userId,
        { 
          conversationId, 
          messageLength: (content || '').length,
          hasMedia: !!media,
          guestId: guestId || undefined
        }
      );

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[ChatSocket] Error sending message' });
      socket.emit('error', { 
        message: error instanceof Error ? error.message : 'Failed to send message' 
      });
    }
  }

  /**
   * Handle typing indicator
   */
  private static async handleTyping(
    socket: Socket,
    payload: TypingPayload
  ): Promise<void> {
    const { conversationId, isTyping } = payload;
    
    // Broadcast typing status to conversation room (except sender)
    socket.to(`conversation_${conversationId}`).emit('user_typing', {
      userId: socket.data.userId,
      guestId: socket.data.guestId,
      isTyping
    });
  }

  /**
   * Generate AI response for chat
   */
  private static async generateAIResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    creator: any,
    userMessage: string,
    conversationId: string
  ): Promise<{
    content: string;
    tokensUsed: number;
    modelUsed: string;
    responseTimeMs: number;
  }> {
    const startTime = Date.now();
    
    try {
      // Get conversation context (last 5 messages)
      const recentMessages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      const context = recentMessages.reverse().map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Generate response using OpenAI
      // Convert MessageRole to ChatMessage role
      const chatContext: ChatMessage[] = context.map(msg => ({
        role: msg.role === 'USER' ? 'user' : msg.role === 'ASSISTANT' ? 'assistant' : 'system',
        content: msg.content
      }));

      const response = await generateCreatorResponse(
        userMessage,
        {
          creatorName: creator.displayName,
          personality: creator.aiPersonality || undefined,
          tone: creator.aiTone || undefined,
          relevantChunks: [],
          conversationSummary: chatContext.map(c => c.content).join('\n')
        },
        chatContext
      );

      const responseTimeMs = Date.now() - startTime;

      return {
        content: response.content,
        tokensUsed: response.tokensUsed,
        modelUsed: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        responseTimeMs
      };

    } catch (_error) {
      const responseTimeMs = Date.now() - startTime;
      
      // Fallback response
      return {
        content: "I'm sorry, I'm having trouble responding right now. Please try again.",
        tokensUsed: 0,
        modelUsed: 'fallback',
        responseTimeMs
      };
    }
  }

  /**
   * Send system message to conversation
   */
  static async sendSystemMessage(
    conversationId: string,
    content: string
  ): Promise<void> {
    if (!this.io) return;

    // Create system message in database
    const systemMessage = await prisma.message.create({
      data: {
        conversationId,
        role: MessageRole.SYSTEM,
        content
      }
    });

    // Emit to conversation room
    this.io.to(`conversation_${conversationId}`).emit('message_received', {
      message: {
        id: systemMessage.id,
        content: systemMessage.content,
        role: systemMessage.role,
        createdAt: systemMessage.createdAt
      }
    });
  }

  /**
   * Notify user of new conversation
   */
  static async notifyNewConversation(
    userId: string,
    conversationId: string
  ): Promise<void> {
    if (!this.io) return;

    this.io.to(`user_${userId}`).emit('new_conversation', {
      conversationId
    });
  }
}
