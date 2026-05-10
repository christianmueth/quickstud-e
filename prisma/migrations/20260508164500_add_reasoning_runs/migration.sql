-- CreateTable
CREATE TABLE "public"."ReasoningRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deckId" TEXT,
    "mode" TEXT NOT NULL,
    "origin" TEXT,
    "title" TEXT,
    "prompt" TEXT,
    "finalAnswer" TEXT,
    "reasoning" TEXT,
    "confidence" DOUBLE PRECISION,
    "trajectoryScore" DOUBLE PRECISION,
    "searchDepth" INTEGER NOT NULL DEFAULT 0,
    "beamWidth" INTEGER,
    "candidatesGenerated" INTEGER,
    "candidatesSelected" INTEGER,
    "prunedCount" INTEGER,
    "verificationApplied" BOOLEAN NOT NULL DEFAULT true,
    "averageCandidateScore" DOUBLE PRECISION,
    "averageVerificationConfidence" DOUBLE PRECISION,
    "selectedCandidates" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReasoningRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReasoningRun_userId_createdAt_idx" ON "public"."ReasoningRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReasoningRun_deckId_createdAt_idx" ON "public"."ReasoningRun"("deckId", "createdAt");

-- CreateIndex
CREATE INDEX "ReasoningRun_mode_createdAt_idx" ON "public"."ReasoningRun"("mode", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."ReasoningRun" ADD CONSTRAINT "ReasoningRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReasoningRun" ADD CONSTRAINT "ReasoningRun_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "public"."Deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "public"."ReasoningCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "verificationConfidence" DOUBLE PRECISION,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "pruned" BOOLEAN NOT NULL DEFAULT false,
    "trajectoryDepth" INTEGER NOT NULL DEFAULT 0,
    "sourceAttempt" INTEGER,
    "difficulty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReasoningCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReasoningCandidate_runId_rank_idx" ON "public"."ReasoningCandidate"("runId", "rank");

-- CreateIndex
CREATE INDEX "ReasoningCandidate_runId_selected_idx" ON "public"."ReasoningCandidate"("runId", "selected");

-- AddForeignKey
ALTER TABLE "public"."ReasoningCandidate" ADD CONSTRAINT "ReasoningCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."ReasoningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;