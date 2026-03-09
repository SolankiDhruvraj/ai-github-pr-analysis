import express from 'express';
import { getPullRequestFiles } from '../services/githubService.js';
import { getReviewForPullRequest } from '../services/reviewService.js';
import { callGeminiRaw } from '../services/aiService.js';

const router = express.Router();

/**
 * POST /github/chat
 * Ask questions about a specific PR.
 * Body: { owner, repo, pullNumber, question }
 */
router.post('/', async (req, res) => {
    const owner = req.body.owner;
    const repo = req.body.repo;
    const pullNumber = parseInt(req.body.pullNumber, 10);
    const question = req.body.question;

    if (!owner || !repo || !pullNumber || !question) {
        return res.status(400).json({
            error: 'Missing required fields: owner, repo, pullNumber, question'
        });
    }

    if (!process.env.GITHUB_TOKEN) {
        console.error('[Chat] Error: GITHUB_TOKEN is not configured on the server.');
        return res.status(500).json({ error: 'GitHub authentication is not configured on the server.' });
    }

    try {
        console.log(`[Chat] Querying PR context for #${pullNumber} in ${owner}/${repo}`);
        // 1. Resolve context with resilience
        let review = null;
        let files = [];

        try {
            review = await getReviewForPullRequest({ owner, repo, pullNumber });
            console.log(`[Chat] Context: Review found=${!!review}`);
        } catch (err) {
            console.warn(`[Chat] Failed to fetch review context:`, err.message);
        }

        try {
            files = await getPullRequestFiles({ owner, repo, pullNumber });
            console.log(`[Chat] Context: Files found=${files.length}`);
        } catch (err) {
            console.warn(`[Chat] Failed to fetch files context:`, err.message);
        }

        // 2. Limit context size to avoid token overflow
        const MAX_FILES = 20;
        const MAX_ISSUES = 15;

        const context = {
            files: files.slice(0, MAX_FILES).map(f => ({
                filename: f.filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions
            })),
            issues: (review?.issues || []).slice(0, MAX_ISSUES).map(i => ({
                category: i.category,
                type: i.type,
                message: i.message,
                file: i.file
            })),
            summary: review?.summary || {}
        };

        if (files.length > MAX_FILES) {
            console.log(`[Chat] Truncating files context from ${files.length} to ${MAX_FILES}`);
        }

        const prompt =
            `You are an AI Code Assistant focused on PR Analysis.\n` +
            `Context for PR #${pullNumber} in ${owner}/${repo}:\n` +
            `Summary: ${JSON.stringify(context.summary)}\n` +
            `Files (Top ${MAX_FILES}): ${JSON.stringify(context.files)}\n` +
            `Issues Detected (Top ${MAX_ISSUES}): ${JSON.stringify(context.issues)}\n\n` +
            `Developer Question: "${question}"\n\n` +
            `Provide a concise, helpful answer based on the code analysis and PR context. If they ask for fixes, refer to the detected issues.`;

        console.log(`[Chat] Calling Gemini for answer with prompt length: ${prompt.length}...`);

        // Final safety race to ensure the route never hangs indefinitely
        // Setting route timeout slightly LARGER than AI timeout to give it a chance to return 500 first
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('CHAT_TIMEOUT')), 60000)
        );

        const chatApiKey = process.env.CHAT_AI_API_KEY || process.env.OPENAI_API_KEY;
        const answer = await Promise.race([
            callGeminiRaw(prompt, 55000, chatApiKey), // 55s inner timeout
            timeoutPromise
        ]);

        if (!answer) {
            console.error(`[Chat] Error: AI service returned null or empty response.`);
            return res.status(500).json({ error: 'AI service failed to generate a response. This usually happens when the API key is invalid or quota is exhausted.' });
        }

        console.log(`[Chat] Gemini response received. Length=${answer.length}`);

        return res.status(200).json({ ok: true, answer });
    } catch (err) {
        console.error(`[Chat] Error processing request for ${owner}/${repo}#${pullNumber}:`, err.message);

        if (err.message === 'CHAT_TIMEOUT') {
            return res.status(503).json({ error: 'The AI assistant is taking longer than usual. Please try a simpler question.' });
        }

        if (err.message === 'AI_RATE_LIMIT' || err.message.includes('429')) {
            return res.status(429).json({ error: 'AI rate limit reached. Please wait a minute before asking another question.' });
        }

        return res.status(err.status || 500).json({
            error: err.message || 'Failed to generate chat response'
        });
    }
});

export default router;
