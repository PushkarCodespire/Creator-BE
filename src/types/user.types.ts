// ===========================================
// USER TYPE DEFINITIONS
// ===========================================

import { UserRole } from '@prisma/client';

// Base user interface
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Subscription interface
export interface Subscription {
  id: string;
  userId: string;
  plan: string;
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// User with relations
export interface UserWithRelations extends User {
  creator?: CreatorProfile | null;
  company?: CompanyProfile | null;
  subscription?: Subscription | null;
}

// Creator profile
export interface CreatorProfile {
  id: string;
  userId: string;
  displayName: string;
  bio?: string;
  tagline?: string;
  profileImage?: string;
  coverImage?: string;
  category?: string;
  tags: string[];
  isVerified: boolean;
  isActive: boolean;
  isRejected?: boolean;
  rejected?: boolean;
  rejectionReason?: string | null;
  totalChats: number;
  totalMessages: number;
  totalEarnings: number;
  rating?: number;
  followersCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Company profile
export interface CompanyProfile {
  id: string;
  userId: string;
  companyName: string;
  logo?: string;
  website?: string;
  industry?: string;
  description?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Authentication tokens
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
}

// Registration data
export interface RegisterData {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

// Password reset
export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetData {
  token: string;
  newPassword: string;
}

// User preferences
export interface UserPreferences {
  emailNotifications: boolean;
  pushNotifications: boolean;
  darkMode: boolean;
  language: string;
  timezone: string;
}

// Profile update
export interface ProfileUpdate {
  name?: string;
  avatar?: string;
  bio?: string;
  interests?: string[];
}
