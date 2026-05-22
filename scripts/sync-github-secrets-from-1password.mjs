import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repo = process.env.GITHUB_REPO || 'newafro/decap-oauth';
const itemTitle = process.env.OP_ITEM_TITLE || 'New Afro Decap OAuth';
const requiredSecrets = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'];
const placeholders = new Set(['dummy', 'example', 'changeme', 'todo']);
const failures = [];

function section(title) {
  console.log(`\n== ${title} ==`);
}

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function valueLooksUsable(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !placeholders.has(normalized.toLowerCase());
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 20000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    return {
      ok: true,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}

function collectFields(payload) {
  const byName = new Map();

  function add(name, value) {
    if (!name) return;
    byName.set(String(name), String(value || ''));
  }

  const rows = Array.isArray(payload) ? payload : payload?.fields;
  if (Array.isArray(rows)) {
    for (const field of rows) {
      add(field.label || field.id, field.value);
    }
  }

  if (payload && !Array.isArray(payload) && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') add(key, value);
    }
  }

  return byName;
}

async function readOnePasswordSecrets() {
  section('Read 1Password Item');
  const fields = requiredSecrets.map((secret) => `label=${secret}`).join(',');
  const result = await run('op', [
    'item',
    'get',
    itemTitle,
    '--fields',
    fields,
    '--format',
    'json',
    '--reveal',
  ]);

  if (!result.ok) {
    fail(`could not read 1Password item "${itemTitle}"`);
    console.log(`Create or rename the item to "${itemTitle}" with fields ${requiredSecrets.join(', ')}.`);
    return new Map();
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout || 'null');
  } catch {
    fail(`could not parse 1Password fields from "${itemTitle}"`);
    return new Map();
  }

  const fieldsByName = collectFields(payload);
  for (const name of requiredSecrets) {
    if (valueLooksUsable(fieldsByName.get(name))) {
      pass(`1Password field ${name} is present`);
    } else {
      fail(`1Password field ${name} is missing or looks like a placeholder`);
    }
  }

  return fieldsByName;
}

async function setGitHubSecret(name, value) {
  return await new Promise((resolve) => {
    const child = spawn('gh', ['secret', 'set', name, '--repo', repo, '--app', 'actions'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      resolve({ ok: false, stdout, stderr: error.message });
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });

    child.stdin.end(value);
  });
}

async function syncSecrets(fieldsByName) {
  section('Sync GitHub Secrets');
  const auth = await run('gh', ['auth', 'status']);
  if (!auth.ok) {
    fail('gh CLI is not authenticated');
    return;
  }

  pass('gh CLI is authenticated');

  for (const name of requiredSecrets) {
    const value = String(fieldsByName.get(name) || '').trim();
    if (!valueLooksUsable(value)) continue;

    const result = await setGitHubSecret(name, value);
    if (result.ok) {
      pass(`set ${repo} Actions secret ${name}`);
    } else {
      fail(`could not set ${repo} Actions secret ${name}`);
    }
  }
}

console.log('New Afro OAuth GitHub secret sync');
console.log(`Repository: ${repo}`);
console.log(`1Password item: ${itemTitle}`);
console.log('Secret values are never printed.');

const fieldsByName = await readOnePasswordSecrets();
if (!failures.length) await syncSecrets(fieldsByName);

section('Summary');
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}

console.log('GitHub OAuth secrets are synced from 1Password.');
