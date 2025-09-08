-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Deck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Card" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "public"."User"("clerkUserId");

-- AddForeignKey
ALTER TABLE "public"."Deck" ADD CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "public"."Deck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
