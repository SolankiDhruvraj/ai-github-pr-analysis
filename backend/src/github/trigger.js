import express from 'express';
import { startReviewForPullRequest } from '../services/reviewService.js';

const router = express.Router();

/**
 * POST /github/trigger
 * Manually trigger a PR review without needing a live GitHub webhook.
 * Body: { owner, repo, pullNumber }
 */
router.post('/', async (req, res) => {
    const { owner, repo, pullNumber } = req.body;

    if (!owner || !repo || !pullNumber) {
        return res.status(400).json({
            error: 'Missing required fields: owner, repo, pullNumber'
        });
    }

    const prNum = Number(pullNumber);
    if (!Number.isInteger(prNum) || prNum <= 0) {
        return res.status(400).json({ error: 'pullNumber must be a positive integer' });
    }

    try {
        const review = await startReviewForPullRequest({ owner, repo, pullNumber: prNum });

        console.log(`Manual trigger: review started for PR #${prNum} in ${owner}/${repo}`);
        console.log(`Changed files count: ${review.files.length}`);

        return res.status(200).json({ ok: true, review });
    } catch (err) {
        console.error('Error in manual trigger', err);
        return res.status(500).json({ error: err.message || 'Failed to process pull request' });
    }
});

export default router;
