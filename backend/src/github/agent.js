import express from 'express';
import {
  askPrAgent,
  postAgentComment,
  triggerReviewFromAgent
} from '../services/agentService.js';

const router = express.Router();

function parseBooleanFlag(value) {
  return value === true || value === 'true';
}

router.post('/', async (req, res) => {
  const owner = req.body.owner;
  const repo = req.body.repo;
  const pullNumber = req.body.pullNumber;
  const message = req.body.message || req.body.question;

  if (!owner || !repo || !pullNumber || !message) {
    return res.status(400).json({
      error: 'Missing required fields: owner, repo, pullNumber, message'
    });
  }

  try {
    const result = await askPrAgent({
      owner,
      repo,
      pullNumber,
      message,
      executeAutomation: parseBooleanFlag(req.body.executeAutomation)
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[Agent] Error:', err.message);
    return res.status(err.status || 500).json({
      error: err.message || 'Failed to run PR agent'
    });
  }
});

router.post('/trigger-review', async (req, res) => {
  const { owner, repo, pullNumber } = req.body;

  if (!owner || !repo || !pullNumber) {
    return res.status(400).json({
      error: 'Missing required fields: owner, repo, pullNumber'
    });
  }

  try {
    const review = await triggerReviewFromAgent({ owner, repo, pullNumber });
    return res.status(200).json({ ok: true, review });
  } catch (err) {
    console.error('[Agent] Trigger review failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to trigger review' });
  }
});

router.post('/comment', async (req, res) => {
  const { owner, repo, pullNumber, body } = req.body;

  if (!owner || !repo || !pullNumber || !body) {
    return res.status(400).json({
      error: 'Missing required fields: owner, repo, pullNumber, body'
    });
  }

  try {
    const comment = await postAgentComment({ owner, repo, pullNumber, body });
    return res.status(200).json({ ok: true, comment });
  } catch (err) {
    console.error('[Agent] Post comment failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to post GitHub comment' });
  }
});

export default router;
