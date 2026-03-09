import express from 'express';
import { applyPullRequestFix } from '../services/githubService.js';

const router = express.Router();

/**
 * POST /github/apply-fix
 * Commit an AI suggested fix directly to the PR branch.
 * Body: { owner, repo, pullNumber, filename, oldSnippet, newSnippet }
 */
router.post('/', async (req, res) => {
    const { owner, repo, pullNumber, filename, oldSnippet, newSnippet } = req.body;

    if (!owner || !repo || !pullNumber || !filename || !newSnippet) {
        return res.status(400).json({
            error: 'Missing required fields: owner, repo, pullNumber, filename, newSnippet'
        });
    }

    try {
        console.log(`[ApplyFix] Attempting to fix ${filename} on PR #${pullNumber}`);
        const result = await applyPullRequestFix({
            owner,
            repo,
            pullNumber: Number(pullNumber),
            filename,
            oldSnippet,
            newSnippet
        });

        return res.status(200).json({ ok: true, message: `Successfully committed fix to ${filename}` });
    } catch (err) {
        console.error('[ApplyFix] Error:', err.message);
        return res.status(500).json({ error: err.message || 'Failed to apply fix to GitHub' });
    }
});

export default router;
