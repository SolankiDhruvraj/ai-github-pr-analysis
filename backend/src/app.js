import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import githubWebhookRouter from './github/webhook.js';
import githubTriggerRouter from './github/trigger.js';
import githubApplyRouter from './github/apply.js';
import githubChatRouter from './github/chat.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(
    bodyParser.json({
      type: ['application/json', 'application/*+json']
    })
  );

  // GitHub webhook endpoint (REST) - receives events from GitHub
  app.use('/github/webhook', githubWebhookRouter);

  // Manual trigger endpoint - use this when running locally (no live webhook)
  app.use('/github/trigger', githubTriggerRouter);

  // Apply fix endpoint - commits AI suggestions back to PR
  app.use('/github/apply-fix', githubApplyRouter);

  // Chat endpoint - interactive AI chat about the PR
  app.use('/github/chat', githubChatRouter);

  // Simple health check for the backend
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
