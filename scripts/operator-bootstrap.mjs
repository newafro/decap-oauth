import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const itemTitle = process.env.OP_ITEM_TITLE || 'New Afro Decap OAuth';
const publicUrl = String(process.env.PUBLIC_URL || 'https://decap-oauth.newafro.com').trim();
const repoPrivate = String(process.env.GITHUB_REPO_PRIVATE || '0').trim();
const renderTarget = String(process.env.RENDER_CUSTOM_DOMAIN_TARGET || '').trim();
const requiredSecrets = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'];
const placeholders = new Set(['dummy', 'example', 'changeme', 'todo']);
const failures = [];
const warnings = [];

function section(title) {
  console.log(`\n== ${title} ==`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`WARN ${message}`);
}

function valueLooksUsable(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !placeholders.has(normalized.toLowerCase());
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 30000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 10,
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

function printOutput(result) {
  const output = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  if (!output) return;
  console.log(output);
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

function oauthEnvReady() {
  return requiredSecrets.every((name) => valueLooksUsable(process.env[name]));
}

async function readOnePasswordSecrets() {
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

  if (!result.ok) return { ok: false, fieldsByName: new Map() };

  let payload;
  try {
    payload = JSON.parse(result.stdout || 'null');
  } catch {
    return { ok: false, fieldsByName: new Map() };
  }

  const fieldsByName = collectFields(payload);
  for (const name of requiredSecrets) {
    if (!valueLooksUsable(fieldsByName.get(name))) {
      return { ok: false, fieldsByName };
    }
  }

  return { ok: true, fieldsByName };
}

async function ensureOnePasswordItem() {
  section('1Password OAuth Item');
  const existing = await readOnePasswordSecrets();
  if (existing.ok) {
    pass(`1Password item "${itemTitle}" is reachable and has OAuth fields`);
    return existing.fieldsByName;
  }

  warn(`1Password item "${itemTitle}" is missing or incomplete`);

  if (!oauthEnvReady()) {
    fail(`create or update 1Password item "${itemTitle}", or rerun with GITHUB_OAUTH_ID and GITHUB_OAUTH_SECRET env vars`);
    return new Map();
  }

  const create = await run(process.execPath, ['scripts/create-1password-oauth-item.mjs'], {
    timeout: 30000,
  });
  printOutput(create);

  if (!create.ok) {
    fail(`could not create 1Password item "${itemTitle}"`);
    return new Map();
  }

  const created = await readOnePasswordSecrets();
  if (!created.ok) {
    fail(`created "${itemTitle}" but could not reread its OAuth fields`);
    return new Map();
  }

  pass(`1Password item "${itemTitle}" is ready`);
  return created.fieldsByName;
}

async function syncGitHubSecrets() {
  section('GitHub Actions Secrets');
  const sync = await run(process.execPath, ['scripts/sync-github-secrets-from-1password.mjs'], {
    timeout: 30000,
  });
  printOutput(sync);

  if (sync.ok) {
    pass('GitHub Actions OAuth secrets are synced from 1Password');
  } else {
    fail('could not sync GitHub Actions OAuth secrets from 1Password');
  }
}

async function checkRenderConfig(fieldsByName) {
  section('Render And Namecheap Preflight');

  if (!renderTarget) {
    warn('RENDER_CUSTOM_DOMAIN_TARGET is not set yet');
    console.log('Next: deploy the Render service, add custom domain decap-oauth.newafro.com, copy the exact DNS target, then rerun:');
    console.log('RENDER_CUSTOM_DOMAIN_TARGET=[exact Render target] npm run setup:operator');
    return;
  }

  const deployConfig = await run(process.execPath, ['scripts/check-deploy-config.mjs'], {
    timeout: 30000,
    env: {
      GITHUB_OAUTH_ID: fieldsByName.get('GITHUB_OAUTH_ID') || process.env.GITHUB_OAUTH_ID,
      GITHUB_OAUTH_SECRET: fieldsByName.get('GITHUB_OAUTH_SECRET') || process.env.GITHUB_OAUTH_SECRET,
      PUBLIC_URL: publicUrl,
      GITHUB_REPO_PRIVATE: repoPrivate,
      RENDER_CUSTOM_DOMAIN_TARGET: renderTarget,
    },
  });
  printOutput(deployConfig);

  if (deployConfig.ok) {
    pass('Render/Namecheap deploy config is ready');
  } else {
    fail('Render/Namecheap deploy config is not ready');
  }
}

console.log('New Afro OAuth operator bootstrap');
console.log(`1Password item: ${itemTitle}`);
console.log('Secret values are never printed.');

const fieldsByName = await ensureOnePasswordItem();
if (!failures.length) await syncGitHubSecrets();
if (!failures.length) await checkRenderConfig(fieldsByName);

section('Summary');
if (warnings.length) {
  console.log('Warnings:');
  for (const message of warnings) console.log(`- ${message}`);
}

if (failures.length) {
  console.log('Required before continuing:');
  for (const message of failures) console.log(`- ${message}`);
  process.exit(1);
}

console.log('Operator bootstrap completed for the available inputs.');
if (!renderTarget) {
  console.log('Render custom-domain DNS is still the next external step.');
}
