-- AlterTable
ALTER TABLE "PullRequestReview" ADD COLUMN     "githubReviewStatus" TEXT,
ADD COLUMN     "githubReviewUrl" TEXT,
ADD COLUMN     "issues" JSONB,
ADD COLUMN     "summary" JSONB;
