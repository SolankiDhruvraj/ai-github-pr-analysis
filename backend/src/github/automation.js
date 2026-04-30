import express from 'express';
import {
  applyApprovedFix,
  buildFixApprovalRequest,
  generateReleaseNotes
} from '../services/agentService.js';

const router = express.Router();

function parseBooleanFlag(value) {
  return value === true || value === 'true';
}

function requireAutomationSecret(req, res, next) {
  const configuredSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!configuredSecret) return next();

  const providedSecret = req.header('x-automation-secret');
  if (providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Invalid automation secret' });
  }

  return next();
}

function pullRequestInputFromBody(body) {
  if (body?.pull_request && body?.repository) {
    return {
      owner: body.repository.owner?.login || body.repository.owner?.name,
      repo: body.repository.name,
      pullNumber: body.pull_request.number,
      action: body.action,
      merged: parseBooleanFlag(body.pull_request.merged) || body.pull_request.merged === true
    };
  }

  return {
    owner: body.owner,
    repo: body.repo,
    pullNumber: body.pullNumber || body.number,
    action: body.action,
    merged: parseBooleanFlag(body.merged) || body.merged === true
  };
}

router.use(requireAutomationSecret);

router.post('/release-notes', async (req, res) => {
  const input = pullRequestInputFromBody(req.body);

  if (!input.owner || !input.repo || !input.pullNumber) {
    return res.status(400).json({
      error: 'Missing PR details. Send a GitHub PR webhook payload or owner, repo, pullNumber.'
    });
  }

  if (input.action === 'closed' && input.merged === false) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'Pull request was closed without merge.'
    });
  }

  try {
    const result = await generateReleaseNotes({
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pullNumber,
      createGithubDraft: parseBooleanFlag(req.body.createGithubDraft),
      tagName: req.body.tagName
    });

    return res.status(200).json({
      ok: true,
      shouldPublish: true,
      ...result
    });
  } catch (err) {
    console.error('[Automation] Release notes failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate release notes' });
  }
});

router.post('/fix-approval-request', async (req, res) => {
  const { owner, repo, pullNumber, issueId } = req.body;

  if (!owner || !repo || !pullNumber || !issueId) {
    return res.status(400).json({
      error: 'Missing required fields: owner, repo, pullNumber, issueId'
    });
  }

  try {
    const approval = await buildFixApprovalRequest({ owner, repo, pullNumber, issueId });
    return res.status(200).json({ ok: true, approval });
  } catch (err) {
    console.error('[Automation] Fix approval request failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to build approval request' });
  }
});

router.post('/apply-approved-fix', async (req, res) => {
  try {
    const result = await applyApprovedFix({
      approved: parseBooleanFlag(req.body.approved),
      approver: req.body.approver,
      applyPayload: req.body.applyPayload || req.body
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Automation] Apply approved fix failed:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to apply approved fix' });
  }
});

export default router;
