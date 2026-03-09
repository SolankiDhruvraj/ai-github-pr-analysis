import express from 'express';
import { startReviewForPullRequest } from '../services/reviewService.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const event = req.header('x-github-event');
  const deliveryId = req.header('x-github-delivery');

  // Only handle pull_request events for now
  if (event !== 'pull_request') {
    return res.status(200).json({ received: true, ignoredEvent: event });
  }

  const payload = req.body;
  const action = payload.action;

  if (!payload.pull_request || !payload.repository) {
    return res.status(400).json({ error: 'Invalid pull_request payload' });
  }

  const prNumber = payload.pull_request.number;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;


  if (action !== 'opened' && action !== 'synchronize') {
    return res.status(200).json({ received: true, action, ignored: true });
  }

  try {
    const review = await startReviewForPullRequest({ owner, repo, pullNumber: prNumber });

    console.log(
      `GitHub webhook ${deliveryId || ''} - review started for PR #${prNumber} in ${owner}/${repo}`
    );
    console.log(`Changed files count: ${review.files.length}`);

    return res.status(200).json({
      received: true,
      action,
      owner,
      repo,
      prNumber,
      review
    });
  } catch (err) {
    console.error('Error handling GitHub webhook', err);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export default router;

