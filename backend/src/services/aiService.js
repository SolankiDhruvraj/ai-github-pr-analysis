import 'dotenv/config';

// Supports Google Gemini (AIzaSy... keys) via the Generative Language REST API.
// To change the model set GEMINI_MODEL in .env, e.g. gemini-2.0-flash
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

async function callGemini(prompt, retries = 1, timeoutMs = 30000, providedApiKey = null) {
  const apiKey = providedApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[AI] Error: No API key provided for AI service.');
    return null;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    console.log(`[AI] Dispatching fetch to Google API...`);
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (networkErr) {
    if (networkErr.name === 'AbortError') {
      console.error(`[AI] Gemini API request timed out after ${timeoutMs}ms`);
    } else {
      console.error('[AI] Gemini network error:', networkErr.message || networkErr);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle rate-limit: wait for the suggested delay then retry once
  if (response.status === 429 && retries > 0) {
    let waitMs = 5000; // reduced default to 5s for chat responsiveness
    try {
      const errJson = await response.json();
      const retryDelaySec = errJson?.error?.details
        ?.find((d) => d['@type']?.includes('RetryInfo'))
        ?.retryDelay?.replace('s', '');
      if (retryDelaySec) waitMs = (parseInt(retryDelaySec, 10) + 1) * 1000;
    } catch (_) { /* ignore parse errors */ }

    // If waitMs is too long, don't retry in chat context (prevent 503)
    if (waitMs > 65000) {
      console.warn(`Gemini rate limited; requested delay too long (${waitMs}ms).`);
      throw new Error('AI_RATE_LIMIT');
    }

    console.warn(`Gemini rate limited. Retrying in ${waitMs / 1000}s…`);
    await new Promise((r) => setTimeout(r, waitMs));
    return callGemini(prompt, retries - 1, timeoutMs, apiKey);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini API error', response.status, errText);
    throw new Error(`AI API error (${response.status}): ${errText || 'Unknown error'}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!text) {
    throw new Error('AI service returned an empty response. This might be due to safety filters or an internal AI fault.');
  }

  return text;
}

export async function callGeminiRaw(prompt, timeoutMs = 30000, apiKey = null) {
  return callGemini(prompt, 1, timeoutMs, apiKey);
}

export async function enrichIssuesWithAI({ owner, repo, number, files, issues }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !issues?.length) {
    return issues;
  }

  // Only enrich the first 8 issues to keep prompt small (free-tier token limit)
  const issuesToEnrich = issues.slice(0, 8);

  // Compact issue payload — only send the snippet, not full patches
  const issuePayload = issuesToEnrich.map((i) => ({
    id: i.id,
    category: i.category,
    type: i.type,
    file: i.file,
    message: i.message,
    codeSnippet: i.codeSnippet ? i.codeSnippet.slice(0, 300) : null
  }));

  const prompt =
    `You are a senior engineer/architect reviewing PR #${number} in ${owner}/${repo}.\n` +
    `Your goals are:\n` +
    `1. Identify issues and provide 3-12 lines of corrected code (aiFixCode).\n` +
    `2. Style Enforcement: Flag if code doesn't match the surrounding styles (e.g., if the project uses 'async/await' but the author used '.then()', or if naming conventions are inconsistent).\n` +
    `3. Test Generation: For each fix, provide a short 5-10 line unit test (Vitest/Jest) that would verify the fix.\n\n` +
    `For each issue, return ONLY a JSON array (no markdown fences initial/final):\n` +
    `[{ \n` +
    `  "id": "...", \n` +
    `  "aiExplanation": "1-2 sentence explanation including style violations if any", \n` +
    `  "aiFixSuggestion": "one sentence fix description", \n` +
    `  "aiFixCode": "Corrected code snippet, NO markdown fences", \n` +
    `  "aiSuggestedTests": "5-10 lines of unit test code (Vitest/Jest) to verify this fix"\n` +
    `}, ...]\n\n` +
    `If codeSnippet is provided, base the fix on that exact snippet.\n\n` +
    `Issues to analyze:\n${JSON.stringify(issuePayload)}`;

  const content = await callGemini(prompt);
  if (!content) {
    console.warn('Gemini returned no content — AI enrichment skipped.');
    return issues;
  }

  let parsed;
  try {
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    const jsonText = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error('Failed to parse Gemini response as JSON', e.message, '\nRaw:', content.slice(0, 500));
    return issues;
  }

  const map = new Map();
  parsed.forEach((entry) => {
    if (entry?.id) map.set(entry.id, entry);
  });

  return issues.map((issue) => {
    const ai = map.get(issue.id);
    return {
      ...issue,
      aiExplanation: ai?.aiExplanation || null,
      aiFixSuggestion: ai?.aiFixSuggestion || null,
      aiFixCode: ai?.aiFixCode || null,
      aiSuggestedTests: ai?.aiSuggestedTests || null
    };
  });
}
