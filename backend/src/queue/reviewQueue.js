import { Queue, Worker } from 'bullmq';
import redis, { queueRedis } from '../redis/client.js';
import { processReview } from '../services/reviewService.js';
import prisma from '../db/prisma.js';

const QUEUE_NAME = 'pr-reviews';

export const reviewQueue = new Queue(QUEUE_NAME, {
    connection: queueRedis,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
    }
});

function makeKey(owner, repo, pullNumber) {
    return `review:${owner}/${repo}#${pullNumber}`;
}

// Background worker
const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        const { owner, repo, pullNumber, startedAt } = job.data;
        const redisKey = makeKey(owner, repo, pullNumber);

        console.log(`[Worker] Started processing PR #${pullNumber} via BullMQ`);

        try {
            // Use the shared processor logic
            const completedReview = await processReview({ owner, repo, pullNumber, startedAt });

            // 1. Save to Redis (for immediate UI updates)
            await redis.set(redisKey, JSON.stringify(completedReview));

            // 2. Persist to Postgres (for permanent history)
            try {
                await prisma.pullRequestReview.upsert({
                    where: { id: completedReview.id },
                    update: {
                        status: completedReview.status,
                        updatedAt: new Date(completedReview.updatedAt),
                        issues: completedReview.issues,
                        summary: completedReview.summary,
                        githubReviewStatus: completedReview.githubReviewStatus,
                        githubReviewUrl: completedReview.githubReviewUrl,
                        files: {
                            deleteMany: {}, // Clear old files if re-analyzing
                            create: completedReview.files.map(f => ({
                                filename: f.filename,
                                status: f.status,
                                additions: f.additions,
                                deletions: f.deletions,
                                changes: f.changes,
                                patch: f.patch
                            }))
                        }
                    },
                    create: {
                        id: completedReview.id,
                        owner: completedReview.owner,
                        repo: completedReview.repo,
                        number: completedReview.number,
                        status: completedReview.status,
                        createdAt: new Date(completedReview.createdAt),
                        updatedAt: new Date(completedReview.updatedAt),
                        issues: completedReview.issues,
                        summary: completedReview.summary,
                        githubReviewStatus: completedReview.githubReviewStatus,
                        githubReviewUrl: completedReview.githubReviewUrl,
                        files: {
                            create: completedReview.files.map(f => ({
                                filename: f.filename,
                                status: f.status,
                                additions: f.additions,
                                deletions: f.deletions,
                                changes: f.changes,
                                patch: f.patch
                            }))
                        }
                    }
                });
                console.log(`[Worker] Persisted review for PR #${pullNumber} to Postgres.`);
            } catch (dbErr) {
                console.error(`[Worker] Database persistence failed for PR #${pullNumber}:`, dbErr.message);
            }

            console.log(`[Worker] Finished PR #${pullNumber}. Saved to Redis.`);

            return completedReview;
        } catch (err) {
            console.error(`[Worker] Error processing PR #${pullNumber}:`, err);

            // Try to mark as ERROR in Redis if possible
            try {
                const existing = await redis.get(redisKey);
                if (existing) {
                    const parsed = JSON.parse(existing);
                    parsed.status = 'ERROR';
                    parsed.updatedAt = new Date().toISOString();
                    await redis.set(redisKey, JSON.stringify(parsed));
                }
            } catch (redisErr) {
                // Ignore if redis is completely dead
            }
            throw err;
        }
    },
    { connection: queueRedis }
);

worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

export default worker;

// Export a helper to enqueue review jobs
export const enqueueReview = async (data) => {
    // data should contain {owner, repo, pullNumber, startedAt}
    await reviewQueue.add('review', data);
};
