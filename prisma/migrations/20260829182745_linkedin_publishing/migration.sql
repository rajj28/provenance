-- CreateTable
CREATE TABLE "LinkedinAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personUrn" TEXT NOT NULL,
    "displayName" TEXT,
    "pictureUrl" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedinPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioItemId" TEXT,
    "postUrn" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "commentary" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedinPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinAccount_userId_key" ON "LinkedinAccount"("userId");

-- CreateIndex
CREATE INDEX "LinkedinAccount_expiresAt_idx" ON "LinkedinAccount"("expiresAt");

-- CreateIndex
CREATE INDEX "LinkedinPost_userId_createdAt_idx" ON "LinkedinPost"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LinkedinPost_portfolioItemId_idx" ON "LinkedinPost"("portfolioItemId");

-- AddForeignKey
ALTER TABLE "LinkedinAccount" ADD CONSTRAINT "LinkedinAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinPost" ADD CONSTRAINT "LinkedinPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinPost" ADD CONSTRAINT "LinkedinPost_portfolioItemId_fkey" FOREIGN KEY ("portfolioItemId") REFERENCES "PortfolioItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
