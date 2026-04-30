# n8n Automation Setup

This project now exposes backend endpoints and importable n8n workflows for:

- release notes generation after a merged pull request
- AI-fix approval before committing to the PR branch
- agent-driven routing for Slack actions

## Backend endpoints

- `POST /github/agent`
- `POST /github/agent/trigger-review`
- `POST /github/agent/comment`
- `POST /automation/release-notes`
- `POST /automation/fix-approval-request`
- `POST /automation/apply-approved-fix`

If `N8N_WEBHOOK_SECRET` is set in the backend environment, send it as:

```text
x-automation-secret: <your-secret>
```

## Required backend environment

Add these to your backend environment before using the agent + n8n workflows:

```text
N8N_WEBHOOK_SECRET=replace-me
N8N_AGENT_WEBHOOK_URL=http://n8n:5678/webhook/pr-agent-router
```

Optional:

```text
CHAT_AI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash-lite
```

## Required n8n environment

Set these inside n8n:

```text
BACKEND_BASE_URL=http://backend:4000
N8N_BASE_URL=http://n8n:5678
N8N_WEBHOOK_SECRET=replace-me
SLACK_RELEASE_CHANNEL_ID=...
SLACK_APPROVAL_CHANNEL_ID=...
```

## Workflow files

- [release-notes-on-merge.json](/Users/dhruvrajsolanki/Desktop/pr-analysis/n8n/release-notes-on-merge.json)
- [fix-approval-slack.json](/Users/dhruvrajsolanki/Desktop/pr-analysis/n8n/fix-approval-slack.json)
- [pr-agent-router.json](/Users/dhruvrajsolanki/Desktop/pr-analysis/n8n/pr-agent-router.json)

## Import order

1. Import `fix-approval-slack.json`
2. Import `pr-agent-router.json`
3. Import `release-notes-on-merge.json`

The agent router references the fix approval webhook path, so importing the approval workflow first makes the relationship easier to configure.

## Recommended flow

### Release notes

GitHub merged PR webhook -> n8n `pr-release-notes` webhook -> backend `/automation/release-notes` -> Slack / optional GitHub draft release

### Approval flow

Dashboard or agent identifies a fixable issue -> n8n `pr-fix-approval` webhook -> backend `/automation/fix-approval-request` -> Slack approval message -> second approval step calls backend `/automation/apply-approved-fix`

### Agent flow

Frontend chat -> backend `/github/agent` -> optional n8n router via `N8N_AGENT_WEBHOOK_URL` -> Slack notification / approval request

## Notes

- `createGithubDraft` can be sent to `/automation/release-notes` to create a GitHub draft release. If no `tagName` is provided, the backend will create a fallback tag like `pr-42-release-draft`.
- The current backend still depends on Redis/BullMQ for the normal review queue path. In local validation, frontend build passed; backend import succeeded but Redis retries were expected when Redis was unavailable.
