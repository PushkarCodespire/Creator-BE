// ===========================================
// CHAT TYPE DEFINITIONS
// ===========================================

import { MessageRole } from '@prisma/client';

// Conversation
export interface Conversation {
  id: string;
  userId?: string;
  creatorId: string;
  guestId?: string;
  isActive: boolean;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Message
export interface Message {
  id: string;
  conversationId: string;
  userId?: string;
  role: MessageRole;
  content: string;
  media?: MessageMedia[];
  tokensUsed?: number;
  modelUsed?: string;
  responseTimeMs?: number;
  isHidden: boolean;
  createdAt: Date;
}

// Message media
export interface MessageMedia {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  name?: string;
  size?: number;
}

// Chat message payload (WebSocket)
export interface ChatMessagePayload {
  conversationId: string;
  content: string;
  media?: MessageMedia[];
  guestId?: string;
}

// Chat response
export interface ChatResponse {
  messageId: string;
  content: string;
  tokensUsed: number;
  responseTimeMs: number;
  modelUsed: string;
}

// Conversation list item
export interface ConversationListItem {
  id: string;
  creator: {
    id: string;
    displayName: string;
    profileImage?: string;
    category?: string;
  };
  lastMessage?: {
    content: string;
    createdAt: Date;
    role: MessageRole;
  };
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Chat statistics
export interface ChatStats {
  totalConversations: number;
  totalMessages: number;
  avgResponseTime: number;
  satisfactionScore?: number;
}

// Message reaction
export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
}

// Message bookmark
export interface MessageBookmark {
  id: string;
  messageId: string;
  userId: string;
  note?: string;
  createdAt: Date;
}

// Chat folder
export interface ChatFolder {
  id: string;
  userId: string;
  name: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}