import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
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

export async function getPullRequestFiles({ owner, repo, pullNumber, maxPages = 10 }) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set in environment');
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
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set — cannot post GitHub review');
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
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set');
  }

  const { ref } = await getPullRequestBranch({ owner, repo, pullNumber });

  const { data: fileData } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filename,
    ref
  });

  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');


  let newContent = content;
  if (oldSnippet && content.includes(oldSnippet)) {
    newContent = content.replace(oldSnippet, newSnippet);
  } else {

    throw new Error(`Could not find the exact code snippet in ${filename} to apply the fix.`);
  }

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
