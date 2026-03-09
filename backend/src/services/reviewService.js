import redis from '../redis/client.js';
import { reviewQueue } from '../queue/reviewQueue.js';
import { getPullRequestFiles, postPullRequestReview, buildReviewBody } from './githubService.js';
import { runAllAnalyses } from '../analysis/analysisEngine.js';
import { enrichIssuesWithAI } from './aiService.js';

const RISK_SCORE_THRESHOLD = parseInt(process.env.AUTO_REJECT_RISK_SCORE || '15', 10);
const HIGH_ISSUES_THRESHOLD = parseInt(process.env.AUTO_REJECT_HIGH_ISSUES || '3', 10);

import prisma from '../db/prisma.js';

// In-memory fallback for when Redis is unavailable
const inMemoryReviews = new Map();

function makeKey(owner, repo, pullNumber) {
  return `${owner}/${repo}#${pullNumber}`;
}

function shouldAutoReject(summary) {
  if (summary.riskScore >= RISK_SCORE_THRESHOLD) return true;
  if (summary.severityDistribution.HIGH >= HIGH_ISSUES_THRESHOLD) return true;
  return false;
}


export async function processReview({ owner, repo, pullNumber, startedAt }) {
  console.log(`[Processor] Processing PR #${pullNumber} in ${owner}/${repo}`);

  try {
    const files = await getPullRequestFiles({ owner, repo, pullNumber });
    const analysisResult = runAllAnalyses(files);
    const issuesWithAI = await enrichIssuesWithAI({
      owner,
      repo,
      number: pullNumber,
      files,
      issues: analysisResult.issues
    });

    let githubReviewStatus = 'SKIPPED';
    let githubReviewUrl = null;

    if (shouldAutoReject(analysisResult.summary)) {
      const reviewBody = buildReviewBody({
        summary: analysisResult.summary,
        issues: issuesWithAI,
        riskScore: analysisResult.summary.riskScore
      });

      try {
        const result = await postPullRequestReview({
          owner,
          repo,
          pullNumber,
          event: 'REQUEST_CHANGES',
          body: reviewBody
        });
        githubReviewStatus = 'REJECTED';
        githubReviewUrl = result.htmlUrl;
      } catch (err) {
        console.error(`[Processor] GitHub Review failed:`, err.message);
        githubReviewStatus = 'ERROR';
      }
    }

    return {
      id: makeKey(owner, repo, pullNumber),
      owner,
      repo,
      number: pullNumber,
      status: 'COMPLETED',
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      files,
      issues: issuesWithAI,
      summary: analysisResult.summary,
      githubReviewStatus,
      githubReviewUrl
    };
  } catch (err) {
    console.error(`[Processor] Error:`, err);
    return {
      id: makeKey(owner, repo, pullNumber),
      owner,
      repo,
      number: pullNumber,
      status: 'ERROR',
      createdAt: startedAt,
      updatedAt: new Date().toISOString(),
      files: [],
      issues: [],
      summary: {
        totalIssues: 0,
        riskScore: 0,
        severityDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
        filesAffected: []
      },
      githubReviewStatus: 'ERROR',
      githubReviewUrl: null
    };
  }
}

export async function startReviewForPullRequest({ owner, repo, pullNumber }) {
  const startedAt = new Date().toISOString();
  const redisKey = `review:${makeKey(owner, repo, pullNumber)}`;

  const pendingReview = {
    id: makeKey(owner, repo, pullNumber),
    owner,
    repo,
    number: pullNumber,
    status: 'PENDING',
    createdAt: startedAt,
    updatedAt: startedAt,
    files: [],
    issues: [],
    summary: {
      totalIssues: 0,
      riskScore: 0,
      severityDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      filesAffected: []
    },
    githubReviewStatus: null,
    githubReviewUrl: null
  };

  try {
    // Try to use Redis/BullMQ
    await redis.set(redisKey, JSON.stringify(pendingReview));
    await reviewQueue.add('review-job', { owner, repo, pullNumber, startedAt });
    console.log(`[Service] Enqueued PR #${pullNumber} via BullMQ.`);
    return pendingReview;
  } catch (err) {
    console.warn(`[Service] Redis unavailable, falling back to synchronous processing:`, err.message);

    inMemoryReviews.set(makeKey(owner, repo, pullNumber), pendingReview);

    (async () => {
      const completed = await processReview({ owner, repo, pullNumber, startedAt });
      inMemoryReviews.set(makeKey(owner, repo, pullNumber), completed);
    })();

    return pendingReview;
  }
}

export async function getReviewForPullRequest({ owner, repo, pullNumber }) {
  const key = makeKey(owner, repo, pullNumber);
  const redisKey = `review:${key}`;

  // 1. Try Redis
  try {
    const data = await redis.get(redisKey);
    if (data) return JSON.parse(data);
  } catch (err) {
    console.warn(`[Service] Redis error: ${err.message}`);
  }

  // 2. Try Memory
  const mem = inMemoryReviews.get(key);
  if (mem) return mem;

  // 3. Try Postgres (Permanent Storage)
  try {
    const dbReview = await prisma.pullRequestReview.findUnique({
      where: { id: key },
      include: { files: true }
    });
    if (dbReview) {
      return {
        ...dbReview,
        createdAt: dbReview.createdAt.toISOString(),
        updatedAt: dbReview.updatedAt.toISOString()
      };
    }
  } catch (err) {
    console.warn(`[Service] Postgres error: ${err.message}`);
  }

  return null;
}

export async function getRecentReviews(limit = 20) {
  let allReviews = [];

  // 1. Try Redis
  try {
    const keys = await redis.keys('review:*');
    if (keys.length > 0) {
      const rawReviews = await redis.mget(...keys);
      allReviews = rawReviews
        .filter((r) => r !== null)
        .map((r) => JSON.parse(r));
    }
  } catch (err) {
    console.warn(`[Service] Redis error:`, err.message);
  }

  // 2. Try Postgres
  try {
    const dbReviews = await prisma.pullRequestReview.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { files: true }
    });

    dbReviews.forEach(db => {
      if (!allReviews.find(r => r.id === db.id)) {
        allReviews.push({
          ...db,
          createdAt: db.createdAt.toISOString(),
          updatedAt: db.updatedAt.toISOString()
        });
      }
    });
  } catch (err) {
    console.warn(`[Service] Postgres error:`, err.message);
  }

  // 3. Try Memory
  const resolvedIds = new Set(allReviews.map(r => r.id));
  for (const [id, review] of inMemoryReviews.entries()) {
    if (!resolvedIds.has(id)) {
      allReviews.push(review);
    }
  }

  allReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return allReviews.slice(0, limit);
}
