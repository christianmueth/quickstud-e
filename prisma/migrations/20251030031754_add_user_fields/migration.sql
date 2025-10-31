/*
  Warnings:

  - You are about to drop the column `dueAt` on the `Card` table. All the data in the column will be lost.
  - You are about to drop the column `ease` on the `Card` table. All the data in the column will be lost.
  - You are about to drop the column `interval` on the `Card` table. All the data in the column will be lost.
  - You are about to drop the column `repetitions` on the `Card` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Card" DROP CONSTRAINT "Card_deckId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Deck" DROP CONSTRAINT "Deck_userId_fkey";

-- DropIndex
DROP INDEX "public"."Card_deckId_dueAt_idx";

-- AlterTable
ALTER TABLE "public"."Card" DROP COLUMN "dueAt",
DROP COLUMN "ease",
DROP COLUMN "interval",
DROP COLUMN "repetitions",
ADD COLUMN     "srsDueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "srsEase" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "srsIntervalDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "srsLapses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "srsReps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "dailyGoal" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "lastStudyDate" TIMESTAMP(3),
ADD COLUMN     "studyStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xpToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xpTodayDate" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "public"."Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "public"."Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
