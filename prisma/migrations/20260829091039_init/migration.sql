-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "image" TEXT,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "targetRole" TEXT,
    "location" TEXT,
    "publicPortfolio" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "displayName" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL DEFAULT '',
    "profileUrl" TEXT,
    "encryptedCredentials" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncCursor" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "sourceType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "occurredAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Curation" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "significance" INTEGER NOT NULL,
    "roleRelevance" INTEGER NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "skills" JSONB NOT NULL,
    "potentialImpact" TEXT NOT NULL,
    "suggestedTitle" TEXT NOT NULL,
    "suggestedDescription" TEXT NOT NULL,
    "evidenceNotes" TEXT NOT NULL,
    "uncertainFields" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Curation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "skills" JSONB NOT NULL,
    "role" TEXT,
    "impact" TEXT,
    "links" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");

-- CreateIndex
CREATE INDEX "SourceConnection_userId_sourceType_idx" ON "SourceConnection"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "SourceConnection_status_lastSyncedAt_idx" ON "SourceConnection"("status", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConnection_userId_sourceType_externalUserId_key" ON "SourceConnection"("userId", "sourceType", "externalUserId");

-- CreateIndex
CREATE INDEX "Evidence_userId_status_occurredAt_idx" ON "Evidence"("userId", "status", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Evidence_userId_sourceType_kind_idx" ON "Evidence"("userId", "sourceType", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_userId_fingerprint_key" ON "Evidence"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Curation_evidenceId_key" ON "Curation"("evidenceId");

-- CreateIndex
CREATE INDEX "Curation_recommendation_significance_idx" ON "Curation"("recommendation", "significance" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioItem_evidenceId_key" ON "PortfolioItem"("evidenceId");

-- CreateIndex
CREATE INDEX "PortfolioItem_userId_published_sortOrder_idx" ON "PortfolioItem"("userId", "published", "sortOrder");

-- CreateIndex
CREATE INDEX "SyncLog_userId_createdAt_idx" ON "SyncLog"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SourceConnection" ADD CONSTRAINT "SourceConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Curation" ADD CONSTRAINT "Curation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
