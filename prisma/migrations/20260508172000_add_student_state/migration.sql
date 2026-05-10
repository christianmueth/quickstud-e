-- CreateTable
CREATE TABLE "public"."StudentState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weakConcepts" JSONB,
    "misconceptionPatterns" JSONB,
    "confidenceProfile" JSONB,
    "retentionProfile" JSONB,
    "pacingProfile" JSONB,
    "preferredExplanationStyle" TEXT,
    "recentFailures" JSONB,
    "recentSuccesses" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentState_userId_key" ON "public"."StudentState"("userId");

-- AddForeignKey
ALTER TABLE "public"."StudentState" ADD CONSTRAINT "StudentState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;