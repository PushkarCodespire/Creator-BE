// ===========================================
// SOCKET.IO MAIN ENTRY POINT
// ===========================================
// Central socket handler that initializes all socket modules
// Exports setup function for use in server.ts

import { Server } from 'socket.io';
import { ChatSocketHandler } from './chat.socket';
import { NotificationSocketHandler } from './notification.socket';
import { ContentSocketHandler } from './content.socket';
import { logInfo } from '../utils/logger';

/**
 * Setup all socket handlers
 * @param io Socket.io server instance
 */
export function setupSocket(io: Server): void {
  logInfo('[Socket] Initializing socket handlers...');
  
  // Initialize chat socket handler
  ChatSocketHandler.initialize(io);
  logInfo('[Socket] Chat socket handler initialized');
  
  // Initialize notification socket handler
  NotificationSocketHandler.initialize(io);
  logInfo('[Socket] Notification socket handler initialized');
  
  // Initialize content processing socket handler
  ContentSocketHandler.initialize(io);
  logInfo('[Socket] Content processing socket handler initialized');
  
  logInfo('[Socket] All socket handlers ready');
}

// Export handlers for direct access if needed
export { ChatSocketHandler, NotificationSocketHandler, ContentSocketHandler };

// Export types
export type {
  JoinChatPayload,
  SendMessagePayload,
  TypingPayload
} from './chat.socket';

export type {
  UserPresencePayload,
  SubscribePayload
} from './notification.socket';

// Export helper functions
export { emitToConversation, emitToUser, emitToCreator, emitToAdmin, isUserOnline, getOnlineUserCount } from './notification.socket';

// Export vector count function
export { getVectorCount } from './notification.socket';