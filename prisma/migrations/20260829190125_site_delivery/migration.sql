-- CreateTable
CREATE TABLE "SiteTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "filePath" TEXT NOT NULL DEFAULT 'data/portfolio.json',
    "mode" TEXT NOT NULL DEFAULT 'pr',
    "encryptedToken" TEXT NOT NULL,
    "lastContentHash" TEXT,
    "lastCommitSha" TEXT,
    "lastCommitUrl" TEXT,
    "lastPublishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePublish" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "commitSha" TEXT,
    "url" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePublish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteTarget_userId_key" ON "SiteTarget"("userId");

-- CreateIndex
CREATE INDEX "SitePublish_userId_createdAt_idx" ON "SitePublish"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SiteTarget" ADD CONSTRAINT "SiteTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePublish" ADD CONSTRAINT "SitePublish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
