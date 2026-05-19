// ===========================================
// NOTIFICATION SOCKET HANDLER
// ===========================================
// Real-time notification system using Socket.io
// Handles push notifications, alerts, and user presence

import { Server, Socket } from 'socket.io';
import prisma from '../../prisma/client';
import { NotificationType } from '@prisma/client';
import { trackBusinessEvent } from '../utils/monitoring';
import { logDebug, logError, logInfo } from '../utils/logger';

export interface UserPresencePayload {
  userId: string;
  status: 'online' | 'offline' | 'away';
}

export interface SubscribePayload {
  userId: string;
  topics: string[];
}

export class NotificationSocketHandler {
  private static io: Server;
  private static userSockets: Map<string, string> = new Map(); // userId -> socketId
  private static userPresence: Map<string, 'online' | 'offline' | 'away'> = new Map();

  static initialize(io: Server): void {
    this.io = io;
    
    // Handle socket connections
    io.on('connection', (socket: Socket) => {
      logDebug(`[NotificationSocket] User connected: ${socket.id}`);
      
      // User authentication
      socket.on('authenticate', async (payload: { userId: string }) => {
        await this.handleAuthentication(socket, payload.userId);
      });

      // User presence update
      socket.on('update_presence', async (payload: UserPresencePayload) => {
        await this.handlePresenceUpdate(socket, payload);
      });

      // Subscribe to notification topics
      socket.on('subscribe', async (payload: SubscribePayload) => {
        await this.handleSubscribe(socket, payload);
      });

      // Unsubscribe from topics
      socket.on('unsubscribe', async (payload: SubscribePayload) => {
        await this.handleUnsubscribe(socket, payload);
      });

      // Mark notification as read
      socket.on('mark_read', async (payload: { notificationId: string }) => {
        await this.handleMarkRead(socket, payload.notificationId);
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Error handling
      socket.on('error', (error) => {
        logError(error instanceof Error ? error : new Error(String(error)), { context: `[NotificationSocket] Socket error for ${socket.id}` });
      });
    });
  }

  /**
   * Handle user authentication
   */
  private static async handleAuthentication(
    socket: Socket,
    userId: string
  ): Promise<void> {
    try {
      // Validate user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true }
      });

      if (!user) {
        socket.emit('auth_error', { message: 'User not found' });
        return;
      }

      // Store user connection
      socket.data.userId = userId;
      this.userSockets.set(userId, socket.id);
      
      // Set user as online
      this.userPresence.set(userId, 'online');
      this.updateUserPresenceInDB(userId, 'online');

      // Join user's private room
      socket.join(`user_${userId}`);
      // Backward/alternate namespace support
      socket.join(`user:${userId}`);
      
      // Emit authentication success
      socket.emit('auth_success', {
        userId: user.id,
        userName: user.name,
        userRole: user.role
      });

      // Emit updated presence to connected users
      this.broadcastPresence(userId, 'online');

      logDebug(`[NotificationSocket] User authenticated: ${userId}`);

      // Track authentication event
      await trackBusinessEvent(
        'socket',
        'user_connected',
        userId,
        { socketId: socket.id }
      );

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[NotificationSocket] Error authenticating user' });
      socket.emit('auth_error', { 
        message: error instanceof Error ? error.message : 'Authentication failed' 
      });
    }
  }

  /**
   * Handle user presence update
   */
  private static async handlePresenceUpdate(
    socket: Socket,
    payload: UserPresencePayload
  ): Promise<void> {
    const { userId, status } = payload;
    
    if (socket.data.userId !== userId) {
      socket.emit('error', { message: 'Unauthorized presence update' });
      return;
    }

    // Update presence
    this.userPresence.set(userId, status);
    this.updateUserPresenceInDB(userId, status);
    
    // Broadcast to connected users
    this.broadcastPresence(userId, status);
    
    logDebug(`[NotificationSocket] User ${userId} is now ${status}`);
  }

  /**
   * Handle subscription to notification topics
   */
  private static async handleSubscribe(
    socket: Socket,
    payload: SubscribePayload
  ): Promise<void> {
    const { userId, topics } = payload;
    
    if (socket.data.userId !== userId) {
      socket.emit('error', { message: 'Unauthorized subscription' });
      return;
    }

    // Join topic rooms
    for (const topic of topics) {
      socket.join(`topic_${topic}`);
      logDebug(`[NotificationSocket] User ${userId} subscribed to ${topic}`);
    }

    socket.emit('subscribed', { topics });
  }

  /**
   * Handle unsubscription from notification topics
   */
  private static async handleUnsubscribe(
    socket: Socket,
    payload: SubscribePayload
  ): Promise<void> {
    const { userId, topics } = payload;
    
    if (socket.data.userId !== userId) {
      socket.emit('error', { message: 'Unauthorized unsubscription' });
      return;
    }

    // Leave topic rooms
    for (const topic of topics) {
      socket.leave(`topic_${topic}`);
      logDebug(`[NotificationSocket] User ${userId} unsubscribed from ${topic}`);
    }

    socket.emit('unsubscribed', { topics });
  }

  /**
   * Handle marking notification as read
   */
  private static async handleMarkRead(
    socket: Socket,
    notificationId: string
  ): Promise<void> {
    try {
      const userId = socket.data.userId;
      if (!userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      // Update notification in database
      const notification = await prisma.notification.update({
        where: { id: notificationId },
        data: { 
          isRead: true,
          readAt: new Date()
        }
      });

      if (notification.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized to mark this notification' });
        return;
      }

      // Emit confirmation
      socket.emit('notification_marked_read', { notificationId });
      
      logDebug(`[NotificationSocket] Notification ${notificationId} marked as read by ${userId}`);

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[NotificationSocket] Error marking notification as read' });
      socket.emit('error', { 
        message: error instanceof Error ? error.message : 'Failed to mark notification as read' 
      });
    }
  }

  /**
   * Handle user disconnect
   */
  private static handleDisconnect(socket: Socket): void {
    const userId = socket.data.userId;

    if (userId) {
      // Remove from connections
      this.userSockets.delete(userId);

      // Set as offline
      this.userPresence.set(userId, 'offline');
      this.updateUserPresenceInDB(userId, 'offline');

      // Broadcast offline status
      this.broadcastPresence(userId, 'offline');

      logDebug(`[NotificationSocket] User disconnected: ${userId}`);

      // If the disconnecting user is a creator, auto-revert any of their
      // MANUAL-mode conversations back to AI mode. The fan should not be
      // left waiting for a human reply when the creator is offline.
      this.releaseManualConversationsForCreator(userId).catch((err) => {
        logError(err instanceof Error ? err : new Error(String(err)), { context: '[NotificationSocket] Failed to auto-release manual conversations' });
      });
    }
  }

  /**
   * If the given user owns a Creator profile, find every conversation
   * currently in MANUAL mode for that creator, flip it to AI, and
   * notify the conversation room (so the fan UI updates the badge).
   */
  private static async releaseManualConversationsForCreator(userId: string): Promise<void> {
    const creator = await prisma.creator.findUnique({
      where: { userId },
      select: { id: true, displayName: true }
    });
    if (!creator) return;

    const manualConvs = await prisma.conversation.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { creatorId: creator.id, chatMode: 'MANUAL' as any },
      select: { id: true }
    });
    if (manualConvs.length === 0) return;

    const now = new Date();
    await prisma.conversation.updateMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { creatorId: creator.id, chatMode: 'MANUAL' as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { chatMode: 'AI' as any, releasedAt: now }
    });

    logInfo(
      `[NotificationSocket] Auto-released ${manualConvs.length} manual conversation(s) for creator ${creator.displayName} (offline)`
    );

    // Notify each conversation room so the fan's badge flips back
    for (const conv of manualConvs) {
      this.io.to(`conversation_${conv.id}`).emit('conversation:mode-changed', {
        conversationId: conv.id,
        mode: 'AI',
        creatorDisplayName: creator.displayName,
        autoReleased: true
      });
    }
  }

  /**
   * Send notification to user
   */
  static async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    if (!this.io) return;

    try {
      // Create notification in database
      const notification = await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          data: data ? JSON.stringify(data) : undefined
        }
      });

      // Emit to user's socket if connected
      const socketId = this.userSockets.get(userId);
      if (socketId) {
        this.io.to(socketId).emit('notification', {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data ? JSON.parse(notification.data as string) : undefined,
          createdAt: notification.createdAt
        });
      }

      logDebug(`[NotificationSocket] Notification sent to user ${userId}: ${title}`);

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[NotificationSocket] Error sending notification' });
    }
  }

  /**
   * Send notification to topic subscribers
   */
  static async sendToTopic(
    topic: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    if (!this.io) return;

    // Emit to topic room
    this.io.to(`topic_${topic}`).emit('notification', {
      type,
      title,
      message,
      data
    });

    logDebug(`[NotificationSocket] Notification sent to topic ${topic}: ${title}`);
  }

  /**
   * Broadcast user presence to connected users
   */
  private static broadcastPresence(
    userId: string,
    status: 'online' | 'offline' | 'away'
  ): void {
    if (!this.io) return;

    // Emit to all connected users except the user themselves
    this.io.except(`user_${userId}`).emit('user_presence', {
      userId,
      status,
      timestamp: new Date()
    });
  }

  /**
   * Update user presence in database
   */
  private static async updateUserPresenceInDB(
    userId: string,
    status: 'online' | 'offline' | 'away'
  ): Promise<void> {
    try {
      // Update last seen timestamp
      await prisma.user.update({
        where: { id: userId },
        data: {
          lastLoginAt: status === 'online' ? new Date() : undefined
        }
      });

      // Track presence event
      await trackBusinessEvent(
        'user',
        `presence_${status}`,
        userId
      );

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), { context: '[NotificationSocket] Error updating user presence' });
    }
  }

  /**
   * Get user presence status
   */
  static getUserPresence(userId: string): 'online' | 'offline' | 'away' | null {
    return this.userPresence.get(userId) || null;
  }

  /**
   * Get all online users
   */
  static getOnlineUsers(): string[] {
    const onlineUsers: string[] = [];
    for (const [userId, status] of this.userPresence.entries()) {
      if (status === 'online') {
        onlineUsers.push(userId);
      }
    }
    return onlineUsers;
  }

  /**
   * Send system alert to all connected users
   */
  static sendSystemAlert(
    title: string,
    message: string,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): void {
    if (!this.io) return;

    this.io.emit('system_alert', {
      title,
      message,
      priority,
      timestamp: new Date()
    });

    logInfo(`[NotificationSocket] System alert sent: ${title}`);
  }

  // ===========================================
  // EMIT HELPERS
  // ===========================================

  static emitToConversation(
    conversationId: string,
    event: string,
    data: unknown
  ): void {
    if (!this.io) return;
    this.io.to(`conversation_${conversationId}`).emit(event, data);
  }

  static emitToUser(
    userId: string,
    event: string,
    data: unknown
  ): void {
    if (!this.io) return;
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  static emitToCreator(
    creatorId: string,
    event: string,
    data: unknown
  ): void {
    if (!this.io) return;
    this.io.to(`creator_${creatorId}`).emit(event, data);
  }

  static emitToAdmin(
    event: string,
    data: unknown
  ): void {
    if (!this.io) return;
    this.io.to('admin').emit(event, data);
  }

  static isUserOnline(userId: string): boolean {
    return this.userPresence.has(userId);
  }

  static getOnlineUserCount(): number {
    return this.userPresence.size;
  }
}

// Export helper functions
export function emitToConversation(
  conversationId: string,
  event: string,
  data: unknown
): void {
  NotificationSocketHandler.emitToConversation(conversationId, event, data);
}

export function emitToUser(
  userId: string,
  event: string,
  data: unknown
): void {
  NotificationSocketHandler.emitToUser(userId, event, data);
}

export function emitToCreator(
  creatorId: string,
  event: string,
  data: unknown
): void {
  NotificationSocketHandler.emitToCreator(creatorId, event, data);
}

export function emitToAdmin(
  event: string,
  data: unknown
): void {
  NotificationSocketHandler.emitToAdmin(event, data);
}

export function isUserOnline(userId: string): boolean {
  return NotificationSocketHandler.isUserOnline(userId);
}

export function getOnlineUserCount(): number {
  return NotificationSocketHandler.getOnlineUserCount();
}

export function getVectorCount(): number {
  // TODO: Implement vector count from vector DB helper
  return 0;
}
