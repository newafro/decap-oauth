import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const itemTitle = process.env.OP_ITEM_TITLE || 'New Afro Decap OAuth';
const vault = String(process.env.OP_VAULT || '').trim();
const publicUrl = String(process.env.PUBLIC_URL || 'https://decap-oauth.newafro.com').trim();
const repoPrivate = String(process.env.GITHUB_REPO_PRIVATE || '0').trim();
const oauthId = String(process.env.GITHUB_OAUTH_ID || '').trim();
const oauthSecret = String(process.env.GITHUB_OAUTH_SECRET || '').trim();
const placeholders = new Set(['dummy', 'example', 'changeme', 'todo']);
const failures = [];

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

function checkInputs() {
  section('Required Inputs');

  if (valueLooksUsable(oauthId)) {
    pass('GITHUB_OAUTH_ID env var is present');
  } else {
    fail('GITHUB_OAUTH_ID env var is missing or looks like a placeholder');
  }

  if (valueLooksUsable(oauthSecret)) {
    pass('GITHUB_OAUTH_SECRET env var is present');
  } else {
    fail('GITHUB_OAUTH_SECRET env var is missing or looks like a placeholder');
  }

  if (publicUrl === 'https://decap-oauth.newafro.com') {
    pass('PUBLIC_URL is correct');
  } else {
    fail(`PUBLIC_URL must be https://decap-oauth.newafro.com, got ${publicUrl || '(missing)'}`);
  }

  if (['0', '1'].includes(repoPrivate)) {
    pass(`GITHUB_REPO_PRIVATE is ${repoPrivate}`);
  } else {
    fail(`GITHUB_REPO_PRIVATE must be 0 or 1, got ${repoPrivate || '(missing)'}`);
  }
}

function buildItemPayload() {
  return {
    title: itemTitle,
    category: 'API_CREDENTIAL',
    tags: ['newafro', 'decap-oauth', 'cms'],
    notesPlain: [
      'GitHub OAuth app for New Afro Decap CMS.',
      'Homepage URL: https://newafro.com',
      'Callback URL: https://decap-oauth.newafro.com/callback?provider=github',
      'Do not commit these values to the repository.',
    ].join('\n'),
    fields: [
      {
        id: 'GITHUB_OAUTH_ID',
        label: 'GITHUB_OAUTH_ID',
        type: 'CONCEALED',
        value: oauthId,
      },
      {
        id: 'GITHUB_OAUTH_SECRET',
        label: 'GITHUB_OAUTH_SECRET',
        type: 'CONCEALED',
        value: oauthSecret,
      },
      {
        id: 'PUBLIC_URL',
        label: 'PUBLIC_URL',
        type: 'STRING',
        value: publicUrl,
      },
      {
        id: 'GITHUB_REPO_PRIVATE',
        label: 'GITHUB_REPO_PRIVATE',
        type: 'STRING',
        value: repoPrivate,
      },
    ],
  };
}

async function ensureOnePasswordSignedIn() {
  section('1Password Sign-In');
  const account = await run('op', ['whoami', '--format=json'], {
    timeout: 10000,
  });

  if (account.ok) {
    pass('1Password CLI is signed in');
    return true;
  }

  fail('1Password CLI is not signed in; run op signin or add the OAuth secrets manually');
  return false;
}

async function ensureItemDoesNotExist() {
  section('Existing 1Password Item');
  const args = ['item', 'get', itemTitle, '--format=json'];
  if (vault) args.push('--vault', vault);

  const existing = await run('op', args, { timeout: 15000 });
  if (existing.ok) {
    fail(`1Password item "${itemTitle}" already exists; update it in 1Password or run npm run sync:github-secrets`);
    return;
  }

  pass(`1Password item "${itemTitle}" does not already exist or is not reachable`);
}

async function createItem() {
  section('Create 1Password Item');
  const args = ['item', 'create'];
  if (vault) args.push('--vault', vault);
  args.push('-');

  const child = spawn('op', args, {
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

  const closed = new Promise((resolve) => {
    child.on('error', (error) => {
      resolve({ ok: false, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });

  child.stdin.end(`${JSON.stringify(buildItemPayload())}\n`);
  const result = await closed;

  if (result.ok) {
    pass(`created 1Password item "${itemTitle}"`);
  } else {
    fail(`could not create 1Password item "${itemTitle}"`);
  }
}

console.log('New Afro OAuth 1Password item bootstrap');
console.log(`1Password item: ${itemTitle}`);
if (vault) console.log(`Vault: ${vault}`);
console.log('Secret values are never printed.');

checkInputs();
if (!failures.length) await ensureOnePasswordSignedIn();
if (!failures.length) await ensureItemDoesNotExist();
if (!failures.length) await createItem();

section('Summary');
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}

console.log('1Password OAuth item is ready. Next run: npm run sync:github-secrets');
