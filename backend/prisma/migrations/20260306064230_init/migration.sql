-- CreateTable
CREATE TABLE "PullRequestReview" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestFile" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "additions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "changes" INTEGER NOT NULL,
    "patch" TEXT,
    "reviewId" TEXT NOT NULL,

    CONSTRAINT "PullRequestFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PullRequestReview_owner_repo_number_idx" ON "PullRequestReview"("owner", "repo", "number");

-- AddForeignKey
ALTER TABLE "PullRequestFile" ADD CONSTRAINT "PullRequestFile_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PullRequestReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
