// ===========================================
// ROLE-BASED PERMISSIONS CONFIGURATION
// ===========================================
// This file defines features and accessible pages for each user role
// Based on the role-based access control requirements

import { UserRole } from '@prisma/client';
// eslint-disable-next-line no-duplicate-imports
import { SubscriptionPlan } from '@prisma/client';

export interface FeaturePermission {
  allowed: boolean;
  description?: string;
}

export interface RoleFeatures {
  chatAccess: {
    canChatWithCreators: FeaturePermission;
    messageLimit: number | 'unlimited';
    messageHistory: FeaturePermission;
    bookmarking: FeaturePermission;
    editDeleteOwnMessages: FeaturePermission;
  };
  contentAccess: {
    viewCreatorProfiles: FeaturePermission;
    browseCreatorGallery: FeaturePermission;
    viewPublicContent: FeaturePermission;
    followCreators: FeaturePermission;
    searchCreators: FeaturePermission;
    viewTrendingContent: FeaturePermission;
    participateInCommunity: FeaturePermission;
  };
  socialFeatures: {
    likePosts: FeaturePermission;
    commentOnPosts: FeaturePermission;
    shareContent: FeaturePermission;
    bookmarkPosts: FeaturePermission;
  };
  accountFeatures: {
    hasAccount: FeaturePermission;
    hasDashboard: FeaturePermission;
    hasSubscriptions: FeaturePermission;
    hasAnalytics: FeaturePermission;
    chatHistoryManagement: FeaturePermission;
    subscriptionManagement: FeaturePermission;
    personalAnalytics: FeaturePermission;
    recommendations: FeaturePermission;
  };
  contentManagement?: {
    uploadYouTubeVideos: FeaturePermission;
    addManualTextContent: FeaturePermission;
    manageFAQs: FeaturePermission;
    deleteEditContent: FeaturePermission;
    retrainAI: FeaturePermission;
  };
  profileManagement?: {
    editCreatorProfile: FeaturePermission;
    uploadProfileCoverImages: FeaturePermission;
    setPricing: FeaturePermission;
    configureAIPersonality: FeaturePermission;
    manageSocialLinks: FeaturePermission;
  };
  analyticsEarnings?: {
    viewRealTimeAnalytics: FeaturePermission;
    revenueTracking: FeaturePermission;
    engagementMetrics: FeaturePermission;
    userRetentionData: FeaturePermission;
    earningsDashboard: FeaturePermission;
    requestPayouts: FeaturePermission;
  };
  creatorFeatures?: {
    creatorDashboard: FeaturePermission;
    contentManagement: FeaturePermission;
    opportunityApplications: FeaturePermission;
    dealManagement: FeaturePermission;
    allUserPermissions: FeaturePermission;
  };
  opportunityManagement?: {
    postOpportunities: FeaturePermission;
    editOpportunities: FeaturePermission;
    closeOpportunities: FeaturePermission;
    reviewApplications: FeaturePermission;
    acceptRejectCreators: FeaturePermission;
  };
  creatorDiscovery?: {
    browseCreators: FeaturePermission;
    searchCreators: FeaturePermission;
    filterByCategory: FeaturePermission;
    viewCreatorProfiles: FeaturePermission;
    contactCreators: FeaturePermission;
  };
  dealManagement?: {
    createDeals: FeaturePermission;
    trackDealProgress: FeaturePermission;
    managePayments: FeaturePermission;
    completeDeals: FeaturePermission;
    viewDealHistory: FeaturePermission;
  };
  companyFeatures?: {
    companyDashboard: FeaturePermission;
    opportunityAnalytics: FeaturePermission;
    applicationTracking: FeaturePermission;
    allUserPermissions: FeaturePermission;
  };
  userManagement?: {
    viewAllUsers: FeaturePermission;
    editUserProfiles: FeaturePermission;
    suspendBanUsers: FeaturePermission;
    viewUserAnalytics: FeaturePermission;
    manageUserRoles: FeaturePermission;
  };
  creatorManagement?: {
    verifyCreators: FeaturePermission;
    approveRejectVerifications: FeaturePermission;
    viewCreatorAnalytics: FeaturePermission;
    moderateCreatorContent: FeaturePermission;
    manageCreatorAccounts: FeaturePermission;
  };
  platformManagement?: {
    viewPlatformStatistics: FeaturePermission;
    manageDeals: FeaturePermission;
    viewRevenueReports: FeaturePermission;
    contentModeration: FeaturePermission;
    systemConfiguration: FeaturePermission;
  };
  adminFeatures?: {
    adminDashboard: FeaturePermission;
    userManagement: FeaturePermission;
    creatorVerifications: FeaturePermission;
    revenueTracking: FeaturePermission;
    moderationTools: FeaturePermission;
    allOtherRolePermissions: FeaturePermission;
  };
}

export interface AccessiblePage {
  path: string;
  name: string;
  description?: string;
}

export interface RolePermissions {
  role: string;
  roleLabel: string;
  description: string;
  features: RoleFeatures;
  accessiblePages: AccessiblePage[];
}

// Guest User Permissions
const guestFeatures: RoleFeatures = {
  chatAccess: {
    canChatWithCreators: { allowed: true },
    messageLimit: 3,
    messageHistory: { allowed: false },
    bookmarking: { allowed: false },
    editDeleteOwnMessages: { allowed: false },
  },
  contentAccess: {
    viewCreatorProfiles: { allowed: true },
    browseCreatorGallery: { allowed: true },
    viewPublicContent: { allowed: true },
    followCreators: { allowed: false },
    searchCreators: { allowed: false },
    viewTrendingContent: { allowed: false },
    participateInCommunity: { allowed: false },
  },
  socialFeatures: {
    likePosts: { allowed: false },
    commentOnPosts: { allowed: false },
    shareContent: { allowed: false },
    bookmarkPosts: { allowed: false },
  },
  accountFeatures: {
    hasAccount: { allowed: false },
    hasDashboard: { allowed: false },
    hasSubscriptions: { allowed: false },
    hasAnalytics: { allowed: false },
    chatHistoryManagement: { allowed: false },
    subscriptionManagement: { allowed: false },
    personalAnalytics: { allowed: false },
    recommendations: { allowed: false },
  },
};

const guestPages: AccessiblePage[] = [
  { path: '/', name: 'Landing Page' },
  { path: '/creators', name: 'Creator Gallery' },
  { path: '/creator/:id', name: 'Creator Profile' },
  { path: '/chat/:creatorId', name: 'Chat (Limited)' },
  { path: '/feed', name: 'Public Feed' },
  { path: '/pricing', name: 'Pricing Page' },
  { path: '/login', name: 'Login' },
  { path: '/register', name: 'Register' },
];

// Registered User (Free) Permissions
const userFreeFeatures: RoleFeatures = {
  chatAccess: {
    canChatWithCreators: { allowed: true },
    messageLimit: 5, // per day
    messageHistory: { allowed: true },
    bookmarking: { allowed: true },
    editDeleteOwnMessages: { allowed: true },
  },
  contentAccess: {
    viewCreatorProfiles: { allowed: true },
    browseCreatorGallery: { allowed: true },
    viewPublicContent: { allowed: true },
    followCreators: { allowed: true },
    searchCreators: { allowed: true },
    viewTrendingContent: { allowed: true },
    participateInCommunity: { allowed: true },
  },
  socialFeatures: {
    likePosts: { allowed: true },
    commentOnPosts: { allowed: true },
    shareContent: { allowed: true },
    bookmarkPosts: { allowed: true },
  },
  accountFeatures: {
    hasAccount: { allowed: true },
    hasDashboard: { allowed: true },
    hasSubscriptions: { allowed: true },
    hasAnalytics: { allowed: true },
    chatHistoryManagement: { allowed: true },
    subscriptionManagement: { allowed: true },
    personalAnalytics: { allowed: true },
    recommendations: { allowed: true },
  },
};

// Registered User (Premium) Permissions
const userPremiumFeatures: RoleFeatures = {
  ...userFreeFeatures,
  chatAccess: {
    ...userFreeFeatures.chatAccess,
    messageLimit: 'unlimited',
  },
};

const userPages: AccessiblePage[] = [
  { path: '/dashboard', name: 'User Dashboard' },
  { path: '/dashboard/chats', name: 'Chat History' },
  { path: '/dashboard/subscription', name: 'Subscription' },
  { path: '/chat/:creatorId', name: 'Chat Interface' },
  { path: '/creators', name: 'Creator Gallery' },
  { path: '/creator/:id', name: 'Creator Profile' },
  { path: '/feed', name: 'Social Feed' },
  { path: '/community', name: 'Community Forums' },
];

// Creator Permissions
const creatorFeatures: RoleFeatures = {
  ...userFreeFeatures, // Creators have all USER permissions
  contentManagement: {
    uploadYouTubeVideos: { allowed: true },
    addManualTextContent: { allowed: true },
    manageFAQs: { allowed: true },
    deleteEditContent: { allowed: true },
    retrainAI: { allowed: true },
  },
  profileManagement: {
    editCreatorProfile: { allowed: true },
    uploadProfileCoverImages: { allowed: true },
    setPricing: { allowed: true },
    configureAIPersonality: { allowed: true },
    manageSocialLinks: { allowed: true },
  },
  analyticsEarnings: {
    viewRealTimeAnalytics: { allowed: true },
    revenueTracking: { allowed: true },
    engagementMetrics: { allowed: true },
    userRetentionData: { allowed: true },
    earningsDashboard: { allowed: true },
    requestPayouts: { allowed: true },
  },
  creatorFeatures: {
    creatorDashboard: { allowed: true },
    contentManagement: { allowed: true },
    opportunityApplications: { allowed: true },
    dealManagement: { allowed: true },
    allUserPermissions: { allowed: true },
  },
};

const creatorPages: AccessiblePage[] = [
  { path: '/creator-dashboard', name: 'Creator Home' },
  { path: '/creator-dashboard/content', name: 'Content Management' },
  { path: '/creator-dashboard/analytics', name: 'Analytics' },
  { path: '/creator-dashboard/opportunities', name: 'Opportunities' },
  { path: '/creator-dashboard/payouts', name: 'Payouts' },
  { path: '/creator-dashboard/settings', name: 'Settings' },
  { path: '/dashboard', name: 'User Dashboard (also accessible)' },
];

// Company Permissions
const companyFeatures: RoleFeatures = {
  ...userFreeFeatures, // Companies have all USER permissions
  opportunityManagement: {
    postOpportunities: { allowed: true },
    editOpportunities: { allowed: true },
    closeOpportunities: { allowed: true },
    reviewApplications: { allowed: true },
    acceptRejectCreators: { allowed: true },
  },
  creatorDiscovery: {
    browseCreators: { allowed: true },
    searchCreators: { allowed: true },
    filterByCategory: { allowed: true },
    viewCreatorProfiles: { allowed: true },
    contactCreators: { allowed: true },
  },
  dealManagement: {
    createDeals: { allowed: true },
    trackDealProgress: { allowed: true },
    managePayments: { allowed: true },
    completeDeals: { allowed: true },
    viewDealHistory: { allowed: true },
  },
  companyFeatures: {
    companyDashboard: { allowed: true },
    opportunityAnalytics: { allowed: true },
    applicationTracking: { allowed: true },
    allUserPermissions: { allowed: true },
  },
};

const companyPages: AccessiblePage[] = [
  { path: '/company-dashboard', name: 'Company Home' },
  { path: '/company-dashboard/opportunities', name: 'Opportunities' },
  { path: '/company-dashboard/discover', name: 'Discover Creators' },
  { path: '/dashboard', name: 'User Dashboard (also accessible)' },
];

// Admin Permissions
const adminFeatures: RoleFeatures = {
  chatAccess: {
    canChatWithCreators: { allowed: true },
    messageLimit: 'unlimited',
    messageHistory: { allowed: true },
    bookmarking: { allowed: true },
    editDeleteOwnMessages: { allowed: true },
  },
  contentAccess: {
    viewCreatorProfiles: { allowed: true },
    browseCreatorGallery: { allowed: true },
    viewPublicContent: { allowed: true },
    followCreators: { allowed: true },
    searchCreators: { allowed: true },
    viewTrendingContent: { allowed: true },
    participateInCommunity: { allowed: true },
  },
  socialFeatures: {
    likePosts: { allowed: true },
    commentOnPosts: { allowed: true },
    shareContent: { allowed: true },
    bookmarkPosts: { allowed: true },
  },
  accountFeatures: {
    hasAccount: { allowed: true },
    hasDashboard: { allowed: true },
    hasSubscriptions: { allowed: true },
    hasAnalytics: { allowed: true },
    chatHistoryManagement: { allowed: true },
    subscriptionManagement: { allowed: true },
    personalAnalytics: { allowed: true },
    recommendations: { allowed: true },
  },
  userManagement: {
    viewAllUsers: { allowed: true },
    editUserProfiles: { allowed: true },
    suspendBanUsers: { allowed: true },
    viewUserAnalytics: { allowed: true },
    manageUserRoles: { allowed: true },
  },
  creatorManagement: {
    verifyCreators: { allowed: true },
    approveRejectVerifications: { allowed: true },
    viewCreatorAnalytics: { allowed: true },
    moderateCreatorContent: { allowed: true },
    manageCreatorAccounts: { allowed: true },
  },
  platformManagement: {
    viewPlatformStatistics: { allowed: true },
    manageDeals: { allowed: true },
    viewRevenueReports: { allowed: true },
    contentModeration: { allowed: true },
    systemConfiguration: { allowed: true },
  },
  adminFeatures: {
    adminDashboard: { allowed: true },
    userManagement: { allowed: true },
    creatorVerifications: { allowed: true },
    revenueTracking: { allowed: true },
    moderationTools: { allowed: true },
    allOtherRolePermissions: { allowed: true },
  },
};

const adminPages: AccessiblePage[] = [
  { path: '/admin', name: 'Admin Dashboard' },
  { path: '/admin/users', name: 'User Management' },
  { path: '/admin/creators', name: 'Creator Management' },
  { path: '/admin/deals', name: 'Deal Management' },
  { path: '/admin/revenue', name: 'Revenue Reports' },
  { path: '/admin/moderation', name: 'Content Moderation' },
  { path: '/admin/email-preview', name: 'Email Templates' },
];

// Export role permissions map
export const rolePermissionsMap: Record<string, RolePermissions> = {
  GUEST: {
    role: 'GUEST',
    roleLabel: 'Guest User',
    description: 'No account required - Limited access',
    features: guestFeatures,
    accessiblePages: guestPages,
  },
  USER_FREE: {
    role: 'USER',
    roleLabel: 'Registered User (Free)',
    description: 'Free subscription',
    features: userFreeFeatures,
    accessiblePages: userPages,
  },
  USER_PREMIUM: {
    role: 'USER',
    roleLabel: 'Registered User (Premium)',
    description: 'Premium subscription',
    features: userPremiumFeatures,
    accessiblePages: userPages,
  },
  CREATOR: {
    role: 'CREATOR',
    roleLabel: 'Creator',
    description: 'Content creators who monetize their expertise',
    features: creatorFeatures,
    accessiblePages: creatorPages,
  },
  COMPANY: {
    role: 'COMPANY',
    roleLabel: 'Company',
    description: 'Businesses looking to collaborate with creators',
    features: companyFeatures,
    accessiblePages: companyPages,
  },
  ADMIN: {
    role: 'ADMIN',
    roleLabel: 'Administrator',
    description: 'Full platform access and management',
    features: adminFeatures,
    accessiblePages: adminPages,
  },
};

/**
 * Get role permissions based on user role and subscription plan
 */
export function getRolePermissions(
  role: UserRole | 'GUEST',
  subscriptionPlan?: SubscriptionPlan
): RolePermissions {
  if (role === 'GUEST') {
    return rolePermissionsMap.GUEST;
  }

  if (role === UserRole.USER) {
    if (subscriptionPlan === SubscriptionPlan.PREMIUM) {
      return rolePermissionsMap.USER_PREMIUM;
    }
    return rolePermissionsMap.USER_FREE;
  }

  if (role === UserRole.CREATOR) {
    return rolePermissionsMap.CREATOR;
  }

  if (role === UserRole.COMPANY) {
    return rolePermissionsMap.COMPANY;
  }

  if (role === UserRole.ADMIN) {
    return rolePermissionsMap.ADMIN;
  }

  // Default to guest if role is unknown
  return rolePermissionsMap.GUEST;
}
