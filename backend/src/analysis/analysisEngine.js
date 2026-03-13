const SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

let issueCounter = 1;

function normalizeFileStatus(status) {
  return status === 'removed' ? 'deleted' : status;
}

function shouldAnalyzeFile(file) {
  return normalizeFileStatus(file.status) !== 'deleted';
}

function getDiffLines(patch, prefix) {
  if (!patch) return [];

  const headerPrefix = prefix.repeat(3);

  return patch
    .split('\n')
    .filter((line) => line.startsWith(prefix) && !line.startsWith(headerPrefix))
    .map((line) => line.slice(1));
}

function getRelevantLines(file) {
  if (!shouldAnalyzeFile(file)) return [];

  const addedLines = getDiffLines(file.patch || '', '+');
  if (addedLines.length > 0) {
    return addedLines;
  }

  if (file.content) {
    return file.content.split('\n');
  }

  return [];
}

function getRelevantContent(file) {
  return getRelevantLines(file).join('\n').trim();
}

/**
 * Extract the first few lines from the analyzable content.
 * Falls back to returning the first N relevant lines if no specific match.
 */
function extractSnippet(file, matchRegex, maxLines = 8) {
  const lines = getRelevantLines(file);
  if (!lines.length) return null;

  // Try to find lines around the first regex match
  if (matchRegex) {
    const matchIdx = lines.findIndex((l) => matchRegex.test(l));
    if (matchIdx !== -1) {
      const start = Math.max(0, matchIdx - 1);
      const end = Math.min(lines.length, matchIdx + maxLines);
      return lines
        .slice(start, end)
        .join('\n')
        .trim();
    }
  }

  // Fallback: return the first maxLines analyzable lines
  return lines
    .filter((l) => l.trim().length > 0)
    .slice(0, maxLines)
    .join('\n')
    .trim() || null;
}

/**
 * Generate a concrete code fix example for a given issue type.
 * Transforms the actual detected snippet when available,
 * otherwise falls back to a language-specific template.
 */
function generateFixCode(type, snippet) {
  const s = (snippet || '').trim();

  switch (type) {
    case 'POTENTIAL_NULL_UNDEFINED_ACCESS': {
      if (!s) {
        return `// Before (unsafe)\nconst value = obj.property;\n\n// After (safe)\nconst value = obj?.property;`;
      }
      const fixed = s.replace(/(\b[a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)/g, '$1?.$2');
      return `// Before\n${s}\n\n// After (optional chaining)\n${fixed}`;
    }

    case 'OFF_BY_ONE_LOOP_BOUND': {
      if (!s) {
        return `// Before (off-by-one)\nfor (let i = 0; i <= arr.length; i++) {}\n\n// After\nfor (let i = 0; i < arr.length; i++) {}`;
      }
      return `// Before\n${s}\n\n// After\n${s.replace(/<=/g, '<')}`;
    }

    case 'UNHANDLED_PROMISE': {
      if (!s) {
        return `// Before\nfetch(url).then(res => process(res));\n\n// After\nfetch(url)\n  .then(res => process(res))\n  .catch(err => console.error('Error:', err));`;
      }
      const fixed = s.replace(/\.then\(([^)]+)\)\s*;?$/, '.then($1)\n  .catch(err => console.error(\'Error:\', err));');
      return `// Before\n${s}\n\n// After\n${fixed}`;
    }

    case 'UNSAFE_EVAL': {
      return `// Before (dangerous)\neval(userInput);\n\n// After (safe alternatives)\nconst data = JSON.parse(userInput);  // for data\n// OR define an explicit function map instead of eval`;
    }

    case 'COMMAND_INJECTION_RISK': {
      return `// Before (vulnerable)\nimport { exec } from 'child_process';\nexec(\`ls \${userInput}\`);\n\n// After (argument array — no shell)\nimport { execFile } from 'child_process';\nexecFile('ls', [sanitizedPath], (err, stdout) => {\n  if (err) throw err;\n  console.log(stdout);\n});`;
    }

    case 'SQL_INJECTION_RISK': {
      return `// Before (vulnerable)\ndb.query(\`SELECT * FROM users WHERE id = \${userId}\`);\n\n// After (parameterized)\ndb.query('SELECT * FROM users WHERE id = $1', [userId]);`;
    }

    case 'HARDCODED_SECRET': {
      return `// Before (never commit secrets)\nconst apiKey = 'sk-abc123secret';\n\n// After\nconst apiKey = process.env.API_KEY;\nif (!apiKey) throw new Error('API_KEY env var is not set');`;
    }

    case 'XSS_RISK': {
      return `// Before (XSS risk)\nelement.innerHTML = req.body.userContent;\n\n// After — use textContent for plain text\nelement.textContent = req.body.userContent;\n\n// OR sanitize if HTML is needed\nimport DOMPurify from 'dompurify';\nelement.innerHTML = DOMPurify.sanitize(req.body.userContent);`;
    }

    case 'DEEP_NESTED_LOOPS': {
      return `// Before (O(n³))\nfor (const a of listA)\n  for (const b of listB)\n    for (const c of listC)\n      process(a, b, c);\n\n// After — use a Set/Map to flatten\nconst bSet = new Set(listB.map(b => b.id));\nfor (const a of listA)\n  for (const c of listC)\n    if (bSet.has(c.bId)) process(a, c);`;
    }

    case 'BLOCKING_CALL_IN_LOOP': {
      return `// Before (blocking per item)\nfor (const item of items) {\n  const data = fs.readFileSync(item.path);\n  process(data);\n}\n\n// After (batch async)\nconst buffers = await Promise.all(\n  items.map(item => fs.promises.readFile(item.path))\n);\nbuffers.forEach(data => process(data));`;
    }

    case 'LARGE_FUNCTION': {
      return `// Before: one large function\nfunction doEverything(data) {\n  // 100+ lines…\n}\n\n// After: small focused helpers\nfunction validate(data) { /* … */ }\nfunction transform(data) { /* … */ }\nfunction persist(result) { /* … */ }\n\nasync function doEverything(data) {\n  const valid = validate(data);\n  const result = transform(valid);\n  await persist(result);\n}`;
    }

    case 'DEEP_NESTING': {
      return `// Before (deeply nested)\nif (a) {\n  if (b) {\n    if (c) { doWork(); }\n  }\n}\n\n// After (early returns)\nif (!a) return;\nif (!b) return;\nif (!c) return;\ndoWork();`;
    }

    case 'MANY_FUNCTION_PARAMETERS': {
      return `// Before\nfunction createUser(name, email, age, role, status) { /* … */ }\n\n// After (options object)\nfunction createUser({ name, email, age, role, status }) { /* … */ }`;
    }

    case 'HIGH_CYCLOMATIC_COMPLEXITY': {
      return `// Before (many if/else branches)\nfunction handle(type) {\n  if (type === 'A') { /* … */ }\n  else if (type === 'B') { /* … */ }\n  else if (type === 'C') { /* … */ }\n}\n\n// After (strategy/lookup map)\nconst handlers = { A: handleA, B: handleB, C: handleC };\nfunction handle(type) {\n  const fn = handlers[type];\n  if (!fn) throw new Error(\`Unknown type: \${type}\`);\n  return fn();\n}`;
    }

    case 'DEPENDENCY_CHANGES': {
      return `# Run in CI before merging:\nnpm audit --audit-level=high\n\n# Or use Snyk:\nnpx snyk test`;
    }

    case 'MISSING_INPUT_VALIDATION': {
      return `import { z } from 'zod';\n\nconst bodySchema = z.object({\n  name: z.string().min(1).max(100),\n  email: z.string().email(),\n});\n\nrouter.post('/endpoint', (req, res) => {\n  const result = bodySchema.safeParse(req.body);\n  if (!result.success) {\n    return res.status(400).json({ errors: result.error.errors });\n  }\n  const { name, email } = result.data; // type-safe\n  // … rest of handler\n});`;
    }

    case 'MISSING_TRY_CATCH': {
      if (!s) {
        return `// Before\nasync function load(url) {\n  const res = await fetch(url);\n  return res.json();\n}\n\n// After\nasync function load(url) {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n    return await res.json();\n  } catch (err) {\n    console.error('load() failed:', err);\n    throw err;\n  }\n}`;
      }
      const indented = s.split('\n').map(l => '  ' + l).join('\n');
      return `// Before\n${s}\n\n// After\ntry {\n${indented}\n} catch (err) {\n  console.error('Operation failed:', err);\n  throw err;\n}`;
    }

    case 'SILENT_CATCH': {
      if (!s) {
        return `// Before\ntry { riskyOp(); } catch () {}\n\n// After\ntry {\n  riskyOp();\n} catch (err) {\n  console.error('riskyOp failed:', err);\n  // throw err; // re-throw if callers need to know\n}`;
      }
      const fixed = s.replace(/catch\s*\(\s*\)\s*\{[^}]*\}/, 'catch (err) {\n  console.error(\'Error:\', err);\n}');
      return `// Before\n${s}\n\n// After\n${fixed}`;
    }

    case 'CODE_DUPLICATION': {
      return `// Before (duplicated logic)\nfunction calcTaxA(price) { return price * 0.18; }\nfunction calcTaxB(amount) { return amount * 0.18; }\n\n// After (single utility)\nconst TAX_RATE = 0.18;\nfunction calculateTax(value, rate = TAX_RATE) {\n  return value * rate;\n}`;
    }

    default:
      return s ? `// Detected code:\n${s}\n\n// TODO: apply fix for ${type}` : null;
  }
}

function makeIssue(partial) {
  const base = {
    id: `ISSUE_${issueCounter++}`,
    severity: SEVERITY.LOW,
    codeSnippet: null,
    ...partial
  };

  // Auto-generate fix code if not explicitly provided
  if (!Object.prototype.hasOwnProperty.call(partial, 'fixCode')) {
    base.fixCode = generateFixCode(base.type, base.codeSnippet);
  }

  return base;
}

function detectBugAndLogicIssues(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  // Safe objects that should never be flagged for property access:
  // built-ins, Node modules, common framework objects, well-known APIs
  const SAFE_OBJECTS = new Set([
    // JS built-ins
    'console', 'Math', 'Object', 'Array', 'JSON', 'Promise', 'Error',
    'Symbol', 'Number', 'String', 'Boolean', 'Date', 'RegExp', 'Map',
    'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl', 'globalThis',
    // Node.js globals & common modules
    'process', 'module', 'exports', 'require', 'Buffer', '__dirname', '__filename',
    'fs', 'path', 'http', 'https', 'url', 'os', 'crypto', 'stream', 'events',
    'child_process', 'util', 'querystring', 'readline',
    // Express / server objects
    'app', 'router', 'express', 'req', 'res', 'next', 'server',
    // Common ORMs / libraries
    'prisma', 'db', 'sequelize', 'mongoose', 'knex', 'redis',
    'octokit', 'axios', 'fetch', 'graphql', 'apollo',
    // Test globals
    'describe', 'it', 'test', 'expect', 'jest', 'vi', 'beforeEach', 'afterEach',
  ]);

  const addedLines = analyzableContent.split('\n');

  // Pattern 1: deep chain — obj.prop.subprop (two or more dots) without optional chaining
  // e.g. user.address.city  →  risky if user could be null
  const deepChainRegex = /\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)/;

  // Pattern 2: function-return access — someCall().property without optional chaining
  // e.g. getUser().name  →  risky if getUser() returns null
  const returnAccessRegex = /\b[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*\.\s*[a-zA-Z_$][\w$]+/;

  const riskyLines = addedLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
    // Skip lines that already use optional chaining
    if (trimmed.includes('?.')) return false;

    const hasDeepChain = deepChainRegex.test(trimmed);
    const hasReturnAccess = returnAccessRegex.test(trimmed);

    if (!hasDeepChain && !hasReturnAccess) return false;

    // Extract the root object name and skip if it's a known-safe object
    const rootMatch = trimmed.match(/\b([a-zA-Z_$][\w$]*)\./);
    if (rootMatch && SAFE_OBJECTS.has(rootMatch[1])) return false;

    return true;
  });

  if (riskyLines.length > 0) {
    issues.push(
      makeIssue({
        category: 'BUG_LOGIC',
        type: 'POTENTIAL_NULL_UNDEFINED_ACCESS',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          `Potential null/undefined dereference: \`${riskyLines[0].trim().slice(0, 80)}\` — ` +
          'property access on a value that may be null or undefined.',
        suggestion:
          'Use optional chaining (obj?.prop) or add an explicit null check before accessing.',
        codeSnippet: riskyLines.slice(0, 5).join('\n')
      })
    );
  }

  if (/\b(for|while)\s*\([^<>=]*<=\s*length\b/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'BUG_LOGIC',
        type: 'OFF_BY_ONE_LOOP_BOUND',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Loop condition uses <= length and may be off-by-one and access out-of-bounds.',
        suggestion: 'Use < length instead of <= length for zero-based arrays.',
        codeSnippet: extractSnippet(file, /\b(for|while)\s*\([^<>=]*<=\s*length\b/)
      })
    );
  }

  if (/\.then\(/.test(analyzableContent) && !/\.catch\(/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'BUG_LOGIC',
        type: 'UNHANDLED_PROMISE',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Promise chain uses .then without .catch. Rejections may be unhandled.',
        suggestion: 'Add a .catch handler or use try/catch with async/await.',
        codeSnippet: extractSnippet(file, /\.then\(/)
      })
    );
  }

  return issues;
}

function detectSecurityIssues(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  if (/\beval\s*\(/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'SECURITY',
        type: 'UNSAFE_EVAL',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message: 'Use of eval() is dangerous and can lead to code injection.',
        suggestion: 'Avoid eval(). Use safer alternatives like JSON.parse or functions.',
        codeSnippet: extractSnippet(file, /\beval\s*\(/)
      })
    );
  }

  if (/\b(exec|spawn|execFile)\s*\(/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'SECURITY',
        type: 'COMMAND_INJECTION_RISK',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message:
          'Use of child_process with dynamic input can lead to command injection.',
        suggestion:
          'Avoid shell interpolation. Use argument arrays and validate user input.',
        codeSnippet: extractSnippet(file, /\b(exec|spawn|execFile)\s*\(/)
      })
    );
  }

  if (/\b(db|query|execute|sql)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'SECURITY',
        type: 'SQL_INJECTION_RISK',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message:
          'SQL query built via string interpolation with variables; susceptible to SQL injection.',
        suggestion: 'Use parameterized queries or ORM query builders.',
        codeSnippet: extractSnippet(file, /\b(db|query|execute|sql)\s*\(/)
      })
    );
  }

  if (/(secret|password|token|apikey).*['"][a-zA-Z0-9_-]+['"]/i.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'SECURITY',
        type: 'HARDCODED_SECRET',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message:
          'Possible hardcoded secret detected. Secrets should not be committed to source control.',
        suggestion: 'Move secrets to environment variables or a secret manager.',
        codeSnippet: extractSnippet(file, /(secret|password|token|apiKey).*['"][^'"]+['"]$/i)
      })
    );
  }

  if (/innerHTML\s*=\s*[^;]+(req\.|request\.|body|query|params)/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'SECURITY',
        type: 'XSS_RISK',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message:
          'Assignment to innerHTML using untrusted input may lead to XSS vulnerabilities.',
        suggestion:
          'Sanitize user input or use textContent/escaping instead of innerHTML.',
        codeSnippet: extractSnippet(file, /innerHTML\s*=/)
      })
    );
  }

  return issues;
}

function detectPerformanceIssues(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  const nestedLoopRegex =
    /\b(for|while)\b[\s\S]{0,120}\b(for|while)\b[\s\S]{0,120}\b(for|while)\b/;
  if (nestedLoopRegex.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'PERFORMANCE',
        type: 'DEEP_NESTED_LOOPS',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Deeply nested loops detected, which may have O(n²) or worse complexity.',
        suggestion:
          'Consider refactoring algorithms or using more efficient data structures.',
        codeSnippet: extractSnippet(file, /\b(for|while)\b/)
      })
    );
  }

  if (/for\s*\([^)]*\)\s*{[\s\S]{0,80}\b(await|fs\.(readFileSync|writeFileSync)|execSync)\b/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'PERFORMANCE',
        type: 'BLOCKING_CALL_IN_LOOP',
        severity: SEVERITY.HIGH,
        file: file.filename,
        message:
          'Blocking/synchronous operations detected inside a loop. This can severely impact performance.',
        suggestion:
          'Move blocking operations outside the loop or use batched/async alternatives.',
        codeSnippet: extractSnippet(file, /\b(await|readFileSync|writeFileSync|execSync)\b/)
      })
    );
  }

  return issues;
}

function detectCodeSmells(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  const longFunctionRegex =
    /function\s+[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*{([\s\S]{400,})}/;
  if (longFunctionRegex.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'CODE_SMELL',
        type: 'LARGE_FUNCTION',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Very large function detected in patch, which may be hard to read and maintain.',
        suggestion:
          'Extract smaller helper functions and reduce the size of this function.',
        codeSnippet: extractSnippet(file, /\bfunction\s+[a-zA-Z_$][\w$]*\s*\(/)
      })
    );
  }

  const deepNestingRegex = /{[\s\S]{0,40}{[\s\S]{0,40}{[\s\S]{0,40}{/;
  if (deepNestingRegex.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'CODE_SMELL',
        type: 'DEEP_NESTING',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Deeply nested blocks detected, which can hurt readability and maintainability.',
        suggestion:
          'Refactor nested logic into early returns or smaller functions.',
        codeSnippet: extractSnippet(file, null)
      })
    );
  }

  if (/(function|const|let|var)\s+[a-zA-Z_$][\w$]*\s*\([^)]{80,}\)/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'CODE_SMELL',
        type: 'MANY_FUNCTION_PARAMETERS',
        severity: SEVERITY.LOW,
        file: file.filename,
        message: 'Function with many parameters detected.',
        suggestion:
          'Prefer using an options object or smaller focused functions instead of many parameters.',
        codeSnippet: extractSnippet(file, /(function|const|let|var)\s+[a-zA-Z_$][\w$]*\s*\([^)]{80,}\)/)
      })
    );
  }

  return issues;
}

function detectCyclomaticComplexity(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  const branchKeywords =
    /\b(if|for|while|case|catch|&&|\|\||\?|switch)\b/g;
  const matches = analyzableContent.match(branchKeywords);
  const complexity = (matches?.length || 0) + 1;

  if (complexity > 15) {
    issues.push(
      makeIssue({
        category: 'COMPLEXITY',
        type: 'HIGH_CYCLOMATIC_COMPLEXITY',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message: `Function or block with high inferred cyclomatic complexity (~${complexity}).`,
        suggestion:
          'Break complex logic into smaller functions and reduce branching where possible.',
        codeSnippet: extractSnippet(file, /\b(if|for|while|switch|case|catch)\b/)
      })
    );
  }

  return issues;
}

function detectDependencyVulnerabilities(file) {
  const issues = [];
  if (!shouldAnalyzeFile(file)) return issues;

  if (
    file.filename.endsWith('package.json') ||
    file.filename.endsWith('package-lock.json') ||
    file.filename.endsWith('pnpm-lock.yaml')
  ) {
    issues.push(
      makeIssue({
        category: 'DEPENDENCY',
        type: 'DEPENDENCY_CHANGES',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Dependencies changed in this PR. Run dependency vulnerability scanners (npm audit, Snyk, etc.).',
        suggestion:
          'Ensure npm audit (or similar) runs in CI and review any reported CVEs for these changes.'
      })
    );
  }

  return issues;
}

function detectInputValidationIssues(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  if (
    /(req\.body|req\.query|req\.params|ctx\.request\.body)/.test(analyzableContent) &&
    !/(zod|joi|yup|celebrate|express-validator)/.test(analyzableContent)
  ) {
    issues.push(
      makeIssue({
        category: 'INPUT_VALIDATION',
        type: 'MISSING_INPUT_VALIDATION',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Request data is used but no explicit validation library usage detected nearby.',
        suggestion:
          'Validate incoming data using a schema validation library (zod, joi, yup, etc.).',
        codeSnippet: extractSnippet(file, /(req\.body|req\.query|req\.params)/)
      })
    );
  }

  return issues;
}

function detectErrorHandlingIssues(file) {
  const issues = [];
  const analyzableContent = getRelevantContent(file);
  if (!analyzableContent) return issues;

  if (/\basync\s+function[\s\S]+await[\s\S]+{[\s\S]+}\s*$/.test(analyzableContent) && !/try\s*{[\s\S]*catch\s*\(/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'ERROR_HANDLING',
        type: 'MISSING_TRY_CATCH',
        severity: SEVERITY.MEDIUM,
        file: file.filename,
        message:
          'Async function with await detected but no try/catch in the patched code.',
        suggestion:
          'Wrap critical await calls in try/catch and propagate or log errors appropriately.',
        codeSnippet: extractSnippet(file, /\bawait\b/)
      })
    );
  }

  if (/catch\s*\(\s*\)\s*{[^}]*}/.test(analyzableContent)) {
    issues.push(
      makeIssue({
        category: 'ERROR_HANDLING',
        type: 'SILENT_CATCH',
        severity: SEVERITY.LOW,
        file: file.filename,
        message:
          'Catch block appears to ignore the error (empty or no logging/handling).',
        suggestion:
          'Log or rethrow errors in catch blocks to avoid silent failures.',
        codeSnippet: extractSnippet(file, /catch\s*\(/)
      })
    );
  }

  return issues;
}

function detectCodeDuplication(files) {
  const issues = [];
  const snippetMap = new Map();

  files.forEach((file) => {
    if (!shouldAnalyzeFile(file)) return;

    const lines = getRelevantLines(file)
      .map((line) => line.trim())
      .filter((line) => line.length > 20);

    lines.forEach((line) => {
      const key = line;
      if (!snippetMap.has(key)) {
        snippetMap.set(key, new Set());
      }
      snippetMap.get(key).add(file.filename);
    });
  });

  snippetMap.forEach((fileSet, code) => {
    if (fileSet.size > 1) {
      const filesArray = Array.from(fileSet);
      issues.push(
        makeIssue({
          category: 'DUPLICATION',
          type: 'CODE_DUPLICATION',
          severity: SEVERITY.LOW,
          file: filesArray.join(', '),
          message:
            'Similar or identical code snippet detected across multiple files in this PR.',
          suggestion:
            'Extract the shared logic into a common helper or utility function.',
          sample: code.slice(0, 200)
        })
      );
    }
  });

  return issues;
}

export function runAllAnalyses(files) {
  const perFileIssues = [];

  files.forEach((file) => {
    perFileIssues.push(
      ...detectBugAndLogicIssues(file),
      ...detectSecurityIssues(file),
      ...detectPerformanceIssues(file),
      ...detectCodeSmells(file),
      ...detectCyclomaticComplexity(file),
      ...detectDependencyVulnerabilities(file),
      ...detectInputValidationIssues(file),
      ...detectErrorHandlingIssues(file)
    );
  });

  const duplicationIssues = detectCodeDuplication(files);
  const allIssues = [...perFileIssues, ...duplicationIssues];

  const severityCounts = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0
  };
  const filesAffected = new Set();

  allIssues.forEach((issue) => {
    severityCounts[issue.severity] += 1;
    if (issue.file) {
      issue.file.split(',').forEach((f) => filesAffected.add(f.trim()));
    }
  });

  const totalIssues = allIssues.length;
  const riskScore =
    severityCounts.HIGH * 3 + severityCounts.MEDIUM * 2 + severityCounts.LOW;

  const summary = {
    totalIssues,
    severityDistribution: severityCounts,
    filesAffected: Array.from(filesAffected),
    riskScore
  };

  return {
    issues: allIssues,
    summary
  };
}
