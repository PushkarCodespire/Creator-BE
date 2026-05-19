// ===========================================
// PERMISSIONS CONTROLLER
// ===========================================
// Returns role-based permissions and accessible pages

import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getRolePermissions } from '../config/rolePermissions';
import { UserRole } from '@prisma/client';
// eslint-disable-next-line no-duplicate-imports
import { SubscriptionPlan } from '@prisma/client';
import prisma from '../../prisma/client';

// ===========================================
// GET ROLE PERMISSIONS
// GET /api/permissions
// ===========================================
// Returns permissions based on user role (or guest if not authenticated)
// For USER role, also considers subscription plan (FREE/PREMIUM)

export const getRolePermissionsEndpoint = asyncHandler(
  async (req: Request, res: Response) => {
    // Check if user is authenticated
    const user = req.user;

    if (!user) {
      // Guest user
      const guestPermissions = getRolePermissions('GUEST');
      return res.json({
        success: true,
        data: {
          role: 'GUEST',
          roleLabel: guestPermissions.roleLabel,
          description: guestPermissions.description,
          isAuthenticated: false,
          isGuest: true,
          isUser: false,
          isCreator: false,
          isCompany: false,
          isAdmin: false,
          subscriptionPlan: null,
          features: guestPermissions.features,
          accessiblePages: guestPermissions.accessiblePages,
        },
      });
    }

    // Get user's subscription plan if they are a USER
    let subscriptionPlan: SubscriptionPlan | undefined;
    if (user.role === UserRole.USER) {
      const subscription = await prisma.subscription.findUnique({
        where: { userId: user.id },
        select: { plan: true },
      });
      subscriptionPlan = subscription?.plan;
    }

    // Get permissions for the user's role
    const permissions = getRolePermissions(user.role, subscriptionPlan);

    // Determine role flags for easy frontend identification
    const isGuest = false;
    const isUser = user.role === UserRole.USER;
    const isCreator = user.role === UserRole.CREATOR;
    const isCompany = user.role === UserRole.COMPANY;
    const isAdmin = user.role === UserRole.ADMIN;
    const isPremium = subscriptionPlan === SubscriptionPlan.PREMIUM;
    const isFree = subscriptionPlan === SubscriptionPlan.FREE || !subscriptionPlan;

    res.json({
      success: true,
      data: {
        role: permissions.role,
        roleLabel: permissions.roleLabel,
        description: permissions.description,
        isAuthenticated: true,
        isGuest,
        isUser,
        isCreator,
        isCompany,
        isAdmin,
        isPremium,
        isFree,
        subscriptionPlan: subscriptionPlan || null,
        features: permissions.features,
        accessiblePages: permissions.accessiblePages,
      },
    });
  }
);

// ===========================================
// GET PERMISSIONS FOR SPECIFIC ROLE
// GET /api/permissions/:role
// ===========================================
// Returns permissions for a specific role (useful for frontend role comparison)
// Only accessible by authenticated users

export const getSpecificRolePermissions = asyncHandler(
  async (req: Request, res: Response) => {
    const roleParam = req.params.role;
    const role = Array.isArray(roleParam) ? roleParam[0] : roleParam;
    const subscriptionPlan = req.query.plan as SubscriptionPlan | undefined;

    // Validate role
    const validRoles = ['GUEST', 'USER', 'CREATOR', 'COMPANY', 'ADMIN'];
    const roleUpper = role.toUpperCase();
    if (!validRoles.includes(roleUpper)) {
      throw new AppError('Invalid role specified', 400);
    }

    const roleEnum = roleUpper as UserRole | 'GUEST';
    const permissions = getRolePermissions(roleEnum, subscriptionPlan);

    res.json({
      success: true,
      data: {
        role: permissions.role,
        roleLabel: permissions.roleLabel,
        description: permissions.description,
        features: permissions.features,
        accessiblePages: permissions.accessiblePages,
      },
    });
  }
);
