-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autopilotMinConfidence" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "autopilotMinSignificance" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "autopilotMode" TEXT NOT NULL DEFAULT 'review';
