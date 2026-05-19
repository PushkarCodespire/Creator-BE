-- Add user fitness onboarding fields
ALTER TABLE "User" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "ageRange"           TEXT;
ALTER TABLE "User" ADD COLUMN "heightCm"           INTEGER;
ALTER TABLE "User" ADD COLUMN "weightKg"           INTEGER;
ALTER TABLE "User" ADD COLUMN "dietPreference"     TEXT;
ALTER TABLE "User" ADD COLUMN "fitnessGoal"        TEXT;
ALTER TABLE "User" ADD COLUMN "fitnessChallenge"   TEXT;
ALTER TABLE "User" ADD COLUMN "coachStyle"         TEXT;
