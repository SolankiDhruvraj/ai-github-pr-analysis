import { callGeminiRaw } from './aiService.js';
import {
  applyPullRequestFix,
  createDraftRelease,
  getPullRequestDetails,
  getPullRequestFiles,
  postPullRequestComment
} from './githubService.js';
import {
  getReviewForPullRequest,
  startReviewForPullRequest
} from './reviewService.js';

function normalizePullNumber(value) {
  const pullNumber = Number(value);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error('pullNumber must be a positive integer');
  }
  return pullNumber;
}

function summarizeFiles(files = [], limit = 25) {
  return files.slice(0, limit).map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes
  }));
}

function summarizeIssues(issues = [], limit = 20) {
  return issues.slice(0, limit).map((issue) => ({
    id: issue.id,
    category: issue.category,
    type: issue.type,
    severity: issue.severity,
    file: issue.file,
    message: issue.message,
    suggestion: issue.aiFixSuggestion || issue.suggestion || null,
    hasFix: Boolean(issue.aiFixCode || issue.fixCode)
  }));
}

function severityRank(severity) {
  if (severity === 'HIGH') return 3;
  if (severity === 'MEDIUM') return 2;
  if (severity === 'LOW') return 1;
  return 0;
}

function getTopIssue(review) {
  return [...(review?.issues || [])].sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return String(a.id).localeCompare(String(b.id));
  })[0] || null;
}

function extractJsonObject(text) {
  if (!text) return null;

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  try {
    return JSON.parse(jsonText);
  } catch (_err) {
    return null;
  }
}

function fallbackAgentAnswer({ review, files, message }) {
  if (!review) {
    return {
      answer:
        'I do not have an analysis for this PR yet. Trigger a review first, then I can summarize risks, files, fixes, and next actions.',
      confidence: 'low',
      suggestedActions: [{ type: 'trigger_review', label: 'Run PR analysis', requiresApproval: false }]
    };
  }

  const summary = review.summary || {};
  const topIssue = getTopIssue(review);
  const highCount = summary.severityDistribution?.HIGH || 0;
  const mediumCount = summary.severityDistribution?.MEDIUM || 0;
  const lowCount = summary.severityDistribution?.LOW || 0;
  const changedFiles = files.length || review.files?.length || 0;

  const lines = [
    `PR #${review.number} in ${review.owner}/${review.repo} is ${review.status}.`,
    `Risk score: ${summary.riskScore || 0}. Issues: ${highCount} high, ${mediumCount} medium, ${lowCount} low across ${changedFiles} changed file(s).`
  ];

  if (topIssue) {
    lines.push(`Top issue: ${topIssue.severity} ${topIssue.type} in ${topIssue.file || 'unknown file'} - ${topIssue.message}`);
  }

  if (/fix|apply|patch/i.test(message || '') && topIssue?.aiFixCode) {
    lines.push('A fix is available, but it should go through the approval workflow before being committed.');
  }

  return {
    answer: lines.join('\n'),
    confidence: 'medium',
    suggestedActions: buildSuggestedActions({ review, message })
  };
}

function buildSuggestedActions({ review, message }) {
  const actions = [];
  const summary = review?.summary || {};
  const topFixableIssue = (review?.issues || []).find((issue) => issue.aiFixCode || issue.fixCode);

  if (!review) {
    return [{ type: 'trigger_review', label: 'Run PR analysis', requiresApproval: false }];
  }

  if ((summary.riskScore || 0) >= 10 || (summary.severityDistribution?.HIGH || 0) > 0) {
    actions.push({
      type: 'notify_team',
      label: 'Notify the team about this risky PR',
      requiresApproval: false
    });
  }

  if (topFixableIssue && /fix|apply|patch|approve/i.test(message || '')) {
    actions.push({
      type: 'request_fix_approval',
      label: `Request approval for ${topFixableIssue.id}`,
      issueId: topFixableIssue.id,
      requiresApproval: true
    });
  }

  if (/release|changelog|notes/i.test(message || '')) {
    actions.push({
      type: 'generate_release_notes',
      label: 'Generate release notes for this PR',
      requiresApproval: false
    });
  }

  return actions;
}

async function getPrContext({ owner, repo, pullNumber }) {
  const [reviewResult, detailsResult] = await Promise.allSettled([
    getReviewForPullRequest({ owner, repo, pullNumber }),
    getPullRequestDetails({ owner, repo, pullNumber })
  ]);

  const review = reviewResult.status === 'fulfilled' ? reviewResult.value : null;
  const details = detailsResult.status === 'fulfilled' ? detailsResult.value : null;

  let files = review?.files || [];
  if (!files.length) {
    try {
      files = await getPullRequestFiles({ owner, repo, pullNumber });
    } catch (_err) {
      files = [];
    }
  }

  return { review, details, files };
}

export async function askPrAgent({ owner, repo, pullNumber, message, executeAutomation = false }) {
  const normalizedPullNumber = normalizePullNumber(pullNumber);
  if (!owner || !repo || !message) {
    throw new Error('Missing required fields: owner, repo, pullNumber, message');
  }

  const { review, details, files } = await getPrContext({
    owner,
    repo,
    pullNumber: normalizedPullNumber
  });

  const context = {
    pullRequest: details,
    review: review
      ? {
          id: review.id,
          status: review.status,
          summary: review.summary,
          githubReviewStatus: review.githubReviewStatus,
          githubReviewUrl: review.githubReviewUrl,
          issues: summarizeIssues(review.issues)
        }
      : null,
    files: summarizeFiles(files)
  };

  const prompt =
    `You are a careful PR analysis agent. Use the provided context only; do not invent repository facts.\n` +
    `Return ONLY JSON with this shape:\n` +
    `{"answer":"concise helpful answer","confidence":"low|medium|high","suggestedActions":[{"type":"notify_team|request_fix_approval|generate_release_notes|trigger_review","label":"short label","issueId":null,"requiresApproval":true}]}\n\n` +
    `User message: ${message}\n\n` +
    `PR context:\n${JSON.stringify(context)}`;

  let response = null;
  try {
    const raw = await callGeminiRaw(prompt, 35000);
    response = extractJsonObject(raw);
  } catch (err) {
    console.warn('[Agent] AI response failed, using deterministic fallback:', err.message);
  }

  const fallback = fallbackAgentAnswer({ review, files, message });
  const result = {
    answer: response?.answer || fallback.answer,
    confidence: response?.confidence || fallback.confidence,
    suggestedActions: Array.isArray(response?.suggestedActions)
      ? response.suggestedActions
      : fallback.suggestedActions,
    context: {
      hasReview: Boolean(review),
      reviewStatus: review?.status || null,
      riskScore: review?.summary?.riskScore || 0,
      totalIssues: review?.summary?.totalIssues || 0,
      changedFiles: files.length
    },
    automation: null
  };

  if (executeAutomation) {
    result.automation = await dispatchAgentAutomation({
      owner,
      repo,
      pullNumber: normalizedPullNumber,
      message,
      agentResult: result
    });
  }

  return result;
}

export async function dispatchAgentAutomation(payload) {
  if (!process.env.N8N_AGENT_WEBHOOK_URL) {
    return {
      executed: false,
      reason: 'N8N_AGENT_WEBHOOK_URL is not configured'
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.N8N_WEBHOOK_SECRET) {
    headers['x-automation-secret'] = process.env.N8N_WEBHOOK_SECRET;
  }

  const response = await fetch(process.env.N8N_AGENT_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`n8n agent webhook failed (${response.status}): ${body}`);
  }

  return {
    executed: true,
    status: response.status
  };
}

export async function generateReleaseNotes({ owner, repo, pullNumber, createGithubDraft = false, tagName = null }) {
  const normalizedPullNumber = normalizePullNumber(pullNumber);
  if (!owner || !repo) {
    throw new Error('Missing required fields: owner, repo, pullNumber');
  }

  const { review, details, files } = await getPrContext({
    owner,
    repo,
    pullNumber: normalizedPullNumber
  });

  const context = {
    pullRequest: details,
    review: review
      ? {
          status: review.status,
          summary: review.summary,
          issues: summarizeIssues(review.issues, 12)
        }
      : null,
    files: summarizeFiles(files, 40)
  };

  const fallbackTitle = details?.title || `PR #${normalizedPullNumber} release notes`;
  const fallbackMarkdown = [
    `## ${fallbackTitle}`,
    '',
    details?.body ? details.body : 'No PR description was provided.',
    '',
    '### Changed files',
    ...summarizeFiles(files, 15).map((file) => `- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`)
  ].join('\n');

  const prompt =
    `You are generating release notes from a merged pull request.\n` +
    `Return ONLY JSON with this shape:\n` +
    `{"title":"short title","summary":"2-3 sentence summary","highlights":["..."],"changedAreas":["..."],"riskNotes":["..."],"markdown":"markdown release note body","slackText":"short Slack-ready summary"}\n\n` +
    `Context:\n${JSON.stringify(context)}`;

  let generated = null;
  try {
    const raw = await callGeminiRaw(prompt, 35000);
    generated = extractJsonObject(raw);
  } catch (err) {
    console.warn('[ReleaseNotes] AI response failed, using deterministic fallback:', err.message);
  }

  const releaseNotes = {
    title: generated?.title || fallbackTitle,
    summary: generated?.summary || `PR #${normalizedPullNumber} changed ${files.length} file(s).`,
    highlights: Array.isArray(generated?.highlights) ? generated.highlights : [],
    changedAreas: Array.isArray(generated?.changedAreas) ? generated.changedAreas : summarizeFiles(files, 8).map((file) => file.filename),
    riskNotes: Array.isArray(generated?.riskNotes) ? generated.riskNotes : [],
    markdown: generated?.markdown || fallbackMarkdown,
    slackText:
      generated?.slackText ||
      `Merged PR #${normalizedPullNumber}: ${fallbackTitle}\nRisk score: ${review?.summary?.riskScore || 0}\nChanged files: ${files.length}`
  };

  let githubDraft = null;
  if (createGithubDraft) {
    const resolvedTagName = tagName || `pr-${normalizedPullNumber}-release-draft`;
    githubDraft = await createDraftRelease({
      owner,
      repo,
      tagName: resolvedTagName,
      targetCommitish: details?.headSha || undefined,
      name: releaseNotes.title,
      body: releaseNotes.markdown
    });
  }

  return {
    pullRequest: details,
    review,
    files: summarizeFiles(files, 100),
    releaseNotes,
    githubDraft
  };
}

export async function buildFixApprovalRequest({ owner, repo, pullNumber, issueId }) {
  const normalizedPullNumber = normalizePullNumber(pullNumber);
  const review = await getReviewForPullRequest({ owner, repo, pullNumber: normalizedPullNumber });

  if (!review) {
    throw new Error('No review found for this PR');
  }

  const issue = (review.issues || []).find((candidate) => candidate.id === issueId);
  if (!issue) {
    throw new Error(`Issue ${issueId} was not found in the review`);
  }

  const newSnippet = issue.aiFixCode || issue.fixCode;
  if (!newSnippet) {
    throw new Error(`Issue ${issueId} does not have an AI or template fix`);
  }

  return {
    owner,
    repo,
    pullNumber: normalizedPullNumber,
    issueId,
    title: `Approve AI fix for ${owner}/${repo}#${normalizedPullNumber}`,
    summary: `${issue.severity} ${issue.type} in ${issue.file || 'unknown file'}`,
    message: issue.message,
    explanation: issue.aiExplanation || issue.aiFixSuggestion || issue.suggestion || null,
    applyPayload: {
      owner,
      repo,
      pullNumber: normalizedPullNumber,
      filename: issue.file,
      oldSnippet: issue.codeSnippet,
      newSnippet
    }
  };
}

export async function applyApprovedFix({ approved, approver, applyPayload }) {
  if (!approved) {
    return {
      ok: true,
      applied: false,
      message: 'Approval was denied or missing; no fix was applied.'
    };
  }

  const { owner, repo, pullNumber, filename, oldSnippet, newSnippet } = applyPayload || {};
  if (!owner || !repo || !pullNumber || !filename || !newSnippet) {
    throw new Error('Missing required apply payload fields');
  }

  const result = await applyPullRequestFix({
    owner,
    repo,
    pullNumber: normalizePullNumber(pullNumber),
    filename,
    oldSnippet,
    newSnippet
  });

  return {
    ok: true,
    applied: true,
    approver: approver || null,
    result
  };
}

export async function triggerReviewFromAgent({ owner, repo, pullNumber }) {
  return startReviewForPullRequest({
    owner,
    repo,
    pullNumber: normalizePullNumber(pullNumber)
  });
}

export async function postAgentComment({ owner, repo, pullNumber, body }) {
  return postPullRequestComment({
    owner,
    repo,
    pullNumber: normalizePullNumber(pullNumber),
    body
  });
}
