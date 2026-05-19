-- Add booking-related notification types to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_DECLINED';
