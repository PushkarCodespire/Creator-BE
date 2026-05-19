// ===========================================
// ROLE-BASED ACCESS CONTROL (RBAC)
// ===========================================
// Implements role hierarchy and permissions matrix

import { Request, Response, NextFunction } from 'express';
import prisma from '../../prisma/client';
import { verifyAccessToken } from '../utils/jwt';
import { UserRole } from '@prisma/client';
import { logError } from '../utils/logger';

// Define permission types
export type Permission = string;

// Define role hierarchy (higher roles inherit permissions from lower roles)
// Note: Only using roles that exist in the Prisma schema (no GUEST)
const ROLE_HIERARCHY: { [key: string]: string[] } = {
  [UserRole.ADMIN]: [UserRole.COMPANY, UserRole.CREATOR, UserRole.USER],
  [UserRole.COMPANY]: [UserRole.CREATOR, UserRole.USER],
  [UserRole.CREATOR]: [UserRole.USER],
  [UserRole.USER]: []  // USER is lowest, has no sub-roles
};

// Define permission matrix
const PERMISSION_MATRIX: { [key: string]: Permission[] } = {
  [UserRole.USER]: [
    'profile.read',
    'profile.write',
    'chat.read',
    'chat.write',
    'content.read',
    'creator.read',
    'follow.write',
    'notification.read',
    'bookmark.write'
  ],
  [UserRole.CREATOR]: [
    'profile.read',
    'profile.write',
    'content.read',
    'content.write',
    'content.delete',
    'analytics.read',
    'chat.read',
    'creator.read',
    'notification.read'
  ],
  [UserRole.COMPANY]: [
    'profile.read',
    'profile.write',
    'opportunity.read',
    'opportunity.write',
    'opportunity.delete',
    'creator.read',
    'deal.read'
  ],
  [UserRole.ADMIN]: [
    'user.read',
    'user.write',
    'user.delete',
    'content.read',
    'content.write',
    'content.delete',
    'creator.read',
    'creator.write',
    'opportunity.read',
    'opportunity.write',
    'opportunity.delete',
    'analytics.read',
    'moderation.write',
    'admin.write'
  ]
};

// Define resource-based permissions
const RESOURCE_PERMISSIONS: { [key: string]: ResourcePermission[] } = {
  [UserRole.USER]: [
    { resource: 'profile', action: 'read' },
    { resource: 'profile', action: 'write', condition: (req, owner) => req.user?.id === owner },
    { resource: 'chat', action: 'read' },
    { resource: 'chat', action: 'write' }
  ],
  [UserRole.CREATOR]: [
    { resource: 'profile', action: 'read' },
    { resource: 'profile', action: 'write', condition: (req, owner) => req.user?.id === owner },
    { resource: 'content', action: 'read' },
    { resource: 'content', action: 'write', condition: (req, owner) => req.user?.id === owner },
    { resource: 'content', action: 'delete', condition: (req, owner) => req.user?.id === owner },
    { resource: 'analytics', action: 'read', condition: (req, owner) => req.user?.id === owner }
  ],
  [UserRole.COMPANY]: [
    { resource: 'profile', action: 'read' },
    { resource: 'profile', action: 'write', condition: (req, owner) => req.user?.id === owner },
    { resource: 'opportunity', action: 'read' },
    { resource: 'opportunity', action: 'write', condition: (req, owner) => req.user?.id === owner },
    { resource: 'opportunity', action: 'delete', condition: (req, owner) => req.user?.id === owner }
  ],
  [UserRole.ADMIN]: [
    { resource: 'profile', action: 'read' },
    { resource: 'profile', action: 'write' },
    { resource: 'profile', action: 'delete' },
    { resource: 'content', action: 'read' },
    { resource: 'content', action: 'write' },
    { resource: 'content', action: 'delete' },
    { resource: 'analytics', action: 'read' },
    { resource: 'opportunity', action: 'read' },
    { resource: 'opportunity', action: 'write' },
    { resource: 'opportunity', action: 'delete' },
    { resource: 'user', action: 'read' },
    { resource: 'user', action: 'write' },
    { resource: 'user', action: 'delete' }
  ]
};

// Interface for resource permissions
interface ResourcePermission {
  resource: string;
  action: string;
  condition?: (req: Request, resourceOwner: string) => boolean;
}

/**
 * Check if a user has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  // Check direct permissions
  if (PERMISSION_MATRIX[role]?.includes(permission)) {
    return true;
  }
  
  // Check inherited permissions from role hierarchy
  const inheritedRoles = ROLE_HIERARCHY[role] || [];
  for (const inheritedRole of inheritedRoles) {
    if (PERMISSION_MATRIX[inheritedRole]?.includes(permission)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a user can access a specific resource
 */
export function canAccessResource(
  role: UserRole,
  resource: string,
  action: string,
  req: Request,
  resourceOwner?: string
): boolean {
  const permissions = RESOURCE_PERMISSIONS[role] || [];
  
  for (const perm of permissions) {
    if (perm.resource === resource && perm.action === action) {
      // If there's a custom condition, evaluate it
      if (perm.condition) {
        return perm.condition(req, resourceOwner || '');
      }
      // Otherwise, permission is granted
      return true;
    }
  }
  
  return false;
}

/**
 * Authentication middleware - verifies JWT token
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify token
    const payload = verifyAccessToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get user from database to ensure they exist and are active
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        creator: {
          select: { id: true }
        },
        company: {
          select: { id: true }
        }
      }
    });
    
    if (!user /*|| user.deletedAt*/) {  // Temporarily commented out deletedAt check since it doesn't exist in schema
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    
    // Attach user info to request object - need to match the auth.ts structure
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      creator: user.creator ? { id: user.creator.id } : null,
      company: user.company ? { id: user.company.id } : null
    };
    
    next();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), { context: 'Authentication error' });
    res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Authorization middleware - checks role-based permissions
 */
export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userRole = req.user.role as UserRole;
    
    // Check if user has any of the allowed roles
    const hasRole = allowedRoles.some(role => 
      role === userRole || ROLE_HIERARCHY[userRole]?.includes(role)
    );
    
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

/**
 * Permission-based authorization middleware
 */
export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userRole = req.user.role as UserRole;
    const hasPerm = hasPermission(userRole, permission);
    
    if (!hasPerm) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

/**
 * Resource-based authorization middleware
 */
export const requireResourceAccess = (
  resource: string,
  action: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ownerField: string = 'userId' // Field name that identifies resource owner
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // For resource-based checks, we might need to fetch the resource to check ownership
    let resourceOwner: string | undefined;
    
    // For now, we'll assume the resource ID is in the route parameters
    // and fetch the resource to get the owner
    if (req.params.id) {
      try {
        const resourceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        
        // This is a simplified approach - in practice, you'd have specific logic
        // for each resource type to fetch the owner
        if (resource === 'profile') {
          resourceOwner = resourceId || undefined; // Profile ID is user ID
        } else if (resource === 'content') {
          const content = await prisma.creatorContent.findUnique({
            where: { id: resourceId || '' },
            select: { creatorId: true }
          });
          resourceOwner = content?.creatorId;
        } else if (resource === 'opportunity') {
          const opportunity = await prisma.opportunity.findUnique({
            where: { id: resourceId || '' },
            select: { companyId: true }
          });
          resourceOwner = opportunity?.companyId;
        }
        // Add more resource types as needed
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), { context: 'Error checking resource access' });
        return res.status(500).json({ error: 'Error checking resource access' });
      }
    }
    
    const userRole = req.user.role as UserRole;
    const canAccess = canAccessResource(userRole, resource, action, req, resourceOwner);
    
    if (!canAccess) {
      return res.status(403).json({ error: 'Insufficient permissions to access this resource' });
    }
    
    next();
  };
};

/**
 * Helper function to check user's permissions
 */
export const getUserPermissions = (role: UserRole): Permission[] => {
  const permissions = [...PERMISSION_MATRIX[role]];
  
  // Add inherited permissions
  const inheritedRoles = ROLE_HIERARCHY[role] || [];
  for (const inheritedRole of inheritedRoles) {
    const inheritedPerms = PERMISSION_MATRIX[inheritedRole];
    for (const perm of inheritedPerms) {
      if (!permissions.includes(perm)) {
        permissions.push(perm);
      }
    }
  }
  
  return permissions;
};

/**
 * Get user's role hierarchy
 */
export const getUserRoleHierarchy = (role: UserRole): UserRole[] => {
  const roleHierarchy = ROLE_HIERARCHY[role] as UserRole[] || [];
  return [role, ...roleHierarchy];
};