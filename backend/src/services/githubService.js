import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GH_TOKEN
});

function normalizeFileStatus(status) {
  return status === 'removed' ? 'deleted' : status;
}

function decodeGitHubContent(encodedContent) {
  if (!encodedContent) return null;

  const text = Buffer.from(encodedContent.replace(/\n/g, ''), 'base64').toString('utf-8');

  // Skip obvious binary payloads so the analyzer does not scan gibberish.
  if (text.includes('\u0000')) {
    return null;
  }

  return text;
}

async function getPullRequestRefs({ owner, repo, pullNumber }) {
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  return {
    headRef: data.head.ref,
    headSha: data.head.sha
  };
}

async function getFileContentAtRef({ owner, repo, path, ref }) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref
    });

    if (Array.isArray(data) || data.type !== 'file') {
      return null;
    }

    return decodeGitHubContent(data.content);
  } catch (err) {
    const status = err?.status || err?.response?.status;

    if (status === 404 || status === 422) {
      return null;
    }

    console.warn(`[GitHub] Failed to fetch file contents for ${path}@${ref}: ${err.message}`);
    return null;
  }
}

export async function getPullRequestDetails({ owner, repo, pullNumber }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set in environment');
  }

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body || '',
    state: data.state,
    merged: Boolean(data.merged),
    mergedAt: data.merged_at,
    htmlUrl: data.html_url,
    author: data.user?.login || null,
    baseBranch: data.base?.ref || null,
    headBranch: data.head?.ref || null,
    headSha: data.head?.sha || null,
    labels: (data.labels || []).map((label) => label.name),
    additions: data.additions,
    deletions: data.deletions,
    changedFiles: data.changed_files
  };
}

export async function getPullRequestFiles({ owner, repo, pullNumber, maxPages = 10 }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set in environment');
  }

  const refs = await getPullRequestRefs({ owner, repo, pullNumber });
  const allFiles = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page
    });

    allFiles.push(...data);

    if (data.length < 100 || page >= maxPages) { // Limit to maxPages * 100 files
      break;
    }

    page += 1;
  }

  return Promise.all(
    allFiles.map(async (file) => {
      const status = normalizeFileStatus(file.status);
      const enrichedFile = {
        filename: file.filename,
        previousFilename: file.previous_filename || null,
        status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch || null
      };

      if (status === 'added' || (!enrichedFile.patch && status !== 'deleted')) {
        enrichedFile.content = await getFileContentAtRef({
          owner,
          repo,
          path: file.filename,
          ref: refs.headSha
        });
      }

      return enrichedFile;
    })
  );
}


export async function postPullRequestReview({ owner, repo, pullNumber, event, body }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set — cannot post GitHub review');
  }

  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event,
    body
  });

  return {
    reviewId: data.id,
    htmlUrl: data.html_url
  };
}

export async function postPullRequestComment({ owner, repo, pullNumber, body }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set — cannot post GitHub comment');
  }

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body
  });

  return {
    commentId: data.id,
    htmlUrl: data.html_url
  };
}

export async function createDraftRelease({ owner, repo, tagName, targetCommitish, name, body }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set — cannot create GitHub release');
  }

  if (!tagName) {
    throw new Error('tagName is required to create a GitHub release draft');
  }

  const { data } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tagName,
    target_commitish: targetCommitish,
    name: name || tagName,
    body,
    draft: true,
    prerelease: false
  });

  return {
    releaseId: data.id,
    htmlUrl: data.html_url,
    uploadUrl: data.upload_url
  };
}

export function buildReviewBody({ summary, issues, riskScore }) {
  const HIGH = issues.filter((i) => i.severity === 'HIGH');
  const MEDIUM = issues.filter((i) => i.severity === 'MEDIUM');
  const LOW = issues.filter((i) => i.severity === 'LOW');

  const severityIcon = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' };

  function renderIssues(list) {
    return list
      .map((i) => {
        const fix = i.suggestion || '';
        return (
          `- **[${i.category}] ${i.type}** in \`${i.file || 'unknown'}\`\n` +
          `  > ${i.message}\n` +
          (fix ? `  > 💡 _${fix}_\n` : '')
        );
      })
      .join('\n');
  }

  const sections = [];

  if (HIGH.length) {
    sections.push(`### 🔴 HIGH Severity (${HIGH.length})\n\n${renderIssues(HIGH)}`);
  }
  if (MEDIUM.length) {
    sections.push(`### 🟡 MEDIUM Severity (${MEDIUM.length})\n\n${renderIssues(MEDIUM)}`);
  }
  if (LOW.length) {
    sections.push(`### 🔵 LOW Severity (${LOW.length})\n\n${renderIssues(LOW)}`);
  }

  return [
    `## 🤖 AI Code Review — Changes Requested`,
    ``,
    `> **Risk Score: ${riskScore}** — This PR has been automatically flagged because its risk score exceeds the merge threshold.`,
    `> Please address the issues below before merging.`,
    ``,
    `**Summary:** ${summary.totalIssues} issue(s) found across ${summary.filesAffected.length} file(s).`,
    ``,
    sections.join('\n\n'),
    ``,
    `---`,
    `_This review was posted automatically by the AI Code Review Assistant. ` +
    `Fix the issues above and re-run the analysis to clear this review._`
  ].join('\n');
}

/**
 * Get branch and head info for a PR.
 */
export async function getPullRequestBranch({ owner, repo, pullNumber }) {
  const { headRef, headSha } = await getPullRequestRefs({ owner, repo, pullNumber });
  return {
    ref: headRef,
    sha: headSha
  };
}

export async function applyPullRequestFix({ owner, repo, pullNumber, filename, oldSnippet, newSnippet }) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is not set');
  }

  const { ref } = await getPullRequestBranch({ owner, repo, pullNumber });

  const { data: fileData } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filename,
    ref
  });

  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');

  const normalizedOldSnippet = normalizeSnippet(oldSnippet);
  const replacementSnippet = extractReplacementSnippet(newSnippet);

  if (!normalizedOldSnippet) {
    throw new Error(`No source code snippet was available for ${filename}, so the fix cannot be applied automatically.`);
  }

  if (!replacementSnippet) {
    throw new Error(`No replacement code was available for ${filename}, so the fix cannot be applied automatically.`);
  }

  const match = findSnippetMatch(content, normalizedOldSnippet);
  if (!match) {
    throw new Error(`Could not find the exact code snippet in ${filename} to apply the fix.`);
  }

  const newContent =
    content.slice(0, match.start) +
    applyIndentation(replacementSnippet, match.indent) +
    content.slice(match.end);

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filename,
    message: `🤖 AI Fix: Address issue in ${filename}`,
    content: Buffer.from(newContent).toString('base64'),
    sha: fileData.sha,
    branch: ref
  });

  return { ok: true, filename };
}

function normalizeSnippet(snippet) {
  if (!snippet || typeof snippet !== 'string') return null;
  return snippet.replace(/\r\n/g, '\n').trim();
}

function extractReplacementSnippet(snippet) {
  const normalized = normalizeSnippet(snippet);
  if (!normalized) return null;

  const afterMarker = normalized.match(/(?:^|\n)(?:\/\/|#)\s*After[^\n]*\n([\s\S]+)$/);
  if (afterMarker?.[1]) {
    return afterMarker[1].trim();
  }

  return normalized;
}

function findSnippetMatch(content, snippet) {
  if (content.includes(snippet)) {
    const start = content.indexOf(snippet);
    return {
      start,
      end: start + snippet.length,
      indent: getLineIndent(content, start)
    };
  }

  const targetLines = snippet.split('\n').map((line) => line.trim());
  const contentLines = content.split('\n');

  for (let startLine = 0; startLine <= contentLines.length - targetLines.length; startLine += 1) {
    const slice = contentLines.slice(startLine, startLine + targetLines.length);
    const matches = slice.every((line, index) => line.trim() === targetLines[index]);

    if (!matches) continue;

    const start = contentLines
      .slice(0, startLine)
      .reduce((total, line) => total + line.length + 1, 0);
    const matchedText = slice.join('\n');

    return {
      start,
      end: start + matchedText.length,
      indent: slice[0].match(/^\s*/)?.[0] || ''
    };
  }

  return null;
}

function getLineIndent(content, index) {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const line = content.slice(lineStart, content.indexOf('\n', index) === -1 ? content.length : content.indexOf('\n', index));
  return line.match(/^\s*/)?.[0] || '';
}

function applyIndentation(snippet, indent) {
  const lines = stripCommonIndentation(snippet).split('\n');
  return lines
    .map((line) => (line.trim().length === 0 ? line : `${indent}${line}`))
    .join('\n');
}

function stripCommonIndentation(snippet) {
  const lines = snippet.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.match(/^\s*/) || [''])[0].length);

  const commonIndent = indents.length ? Math.min(...indents) : 0;
  if (commonIndent === 0) return snippet;

  return lines.map((line) => line.slice(commonIndent)).join('\n');
}
