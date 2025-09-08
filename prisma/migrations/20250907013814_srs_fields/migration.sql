-- AlterTable
ALTER TABLE "public"."Card" ADD COLUMN     "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "interval" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN     "repetitions" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Card_deckId_dueAt_idx" ON "public"."Card"("deckId", "dueAt");
