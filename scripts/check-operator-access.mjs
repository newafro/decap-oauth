import { execFile } from 'node:child_process';
import { resolve4, resolveCname } from 'node:dns/promises';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repo = process.env.GITHUB_REPO || 'newafro/decap-oauth';
const host = process.env.OAUTH_HOST || 'decap-oauth.newafro.com';
const requiredSecrets = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'];
const failures = [];
const warnings = [];
const placeholders = new Set(['dummy', 'example', 'changeme', 'todo']);
const githubSecretsUrl = `https://github.com/${repo}/settings/secrets/actions`;
const deployPreflightUrl = `https://github.com/${repo}/actions/workflows/deploy-config-preflight.yml`;
const operatorWorkflowUrl = `https://github.com/${repo}/actions/workflows/operator-access.yml`;
const runbookUrl = `https://github.com/${repo}/blob/main/docs/render-namecheap-runbook.md`;
const renderDeployUrl = `https://render.com/deploy?repo=https://github.com/${repo}`;
const githubOauthAppUrl = 'https://github.com/settings/applications/new';
const renderServiceUrl = process.env.RENDER_SERVICE_URL ?? 'https://newafro-decap-oauth.onrender.com';
const onePasswordItemTitle = 'New Afro Decap OAuth';
const expectedOnePasswordFields = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET', 'PUBLIC_URL'];

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

function writeStepSummary() {
  if (!process.env.GITHUB_STEP_SUMMARY) return;

  const summary = [
    '# New Afro OAuth Operator Preflight',
    '',
    `Repository: ${repo}`,
    `OAuth host: https://${host}`,
    `Status: ${failures.length ? 'BLOCKED' : 'READY'}`,
    '',
  ];

  if (failures.length) {
    summary.push('## Required Before CMS Login/Save', '');
    for (const failure of failures) summary.push(`- ${failure}`);
    summary.push('');
  } else {
    summary.push('## Result', '', '- Operator access checks passed.', '');
  }

  if (warnings.length) {
    summary.push('## Warnings', '');
    for (const warning of warnings) summary.push(`- ${warning}`);
    summary.push('');
  }

  summary.push(
    '## Operator Links',
    '',
    `- GitHub OAuth app setup: ${githubOauthAppUrl}`,
    `- OAuth repo secrets: ${githubSecretsUrl}`,
    `- Render deploy from repo: ${renderDeployUrl}`,
    `- Deploy config preflight: ${deployPreflightUrl}`,
    `- Operator access workflow: ${operatorWorkflowUrl}`,
    `- Render/Namecheap runbook: ${runbookUrl}`,
    '',
    '## Expected Operator Flow',
    '',
    '1. Create or verify the GitHub OAuth app callback: https://decap-oauth.newafro.com/callback?provider=github',
    '2. Run `GITHUB_OAUTH_ID=... GITHUB_OAUTH_SECRET=... npm run setup:operator` from this repo.',
    '3. Deploy this repo on Render and add decap-oauth.newafro.com as a custom domain.',
    '4. Run `RENDER_CUSTOM_DOMAIN_TARGET=[exact Render target] npm run setup:operator`.',
    '5. Add Namecheap CNAME decap-oauth -> exact Render custom-domain DNS target.',
    '6. Rerun this workflow, then run the website CMS readiness check.',
    '',
    'Manual fallback:',
    '',
    '- `npm run create:1password-item` creates the exact 1Password item when OAuth env vars are present.',
    '- `npm run sync:github-secrets` syncs values from 1Password into this repo Actions secrets.',
    '',
  );

  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  } catch (error) {
    console.warn(`Could not write GitHub step summary: ${error.message}`);
  }
}

function env(name) {
  return String(process.env[name] || '').trim();
}

function hasUsableSecretEnv(name) {
  const value = env(name);
  return Boolean(value) && !placeholders.has(value.toLowerCase());
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 15000,
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    return await fetch(url, {
      method: options.method || 'GET',
      redirect: options.redirect || 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'newafro-oauth-operator-preflight',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkDns() {
  section(`DNS: ${host}`);
  let cnames = [];
  let addresses = [];

  try {
    cnames = await resolveCname(host);
  } catch {}

  try {
    addresses = await resolve4(host);
  } catch {}

  if (cnames.length) console.log(`CNAME ${cnames.join(', ')}`);
  if (addresses.length) console.log(`A ${addresses.join(', ')}`);

  if (!cnames.length && !addresses.length) {
    fail(`${host} has no public DNS result`);
    return;
  }

  pass(`${host} resolves publicly`);
}

async function checkGitHub() {
  section('GitHub access');
  const envSecrets = new Set(requiredSecrets.filter((name) => env(name)));
  const usableEnvSecrets = new Set(requiredSecrets.filter((name) => hasUsableSecretEnv(name)));

  for (const name of envSecrets) {
    if (usableEnvSecrets.has(name)) {
      pass(`${name} runtime env var is present`);
    } else {
      fail(`${name} runtime env var still looks like a placeholder`);
    }
  }

  if (process.env.GITHUB_ACTIONS === 'true' && usableEnvSecrets.size < requiredSecrets.length) {
    for (const name of requiredSecrets) {
      if (!usableEnvSecrets.has(name)) {
        fail(`${name} GitHub Actions secret is missing or unavailable to this workflow`);
      }
    }
    console.log(`Add the missing repository secret(s) in ${repo} settings, then rerun this workflow.`);
    return;
  }

  const auth = await run('gh', ['auth', 'status']);
  if (!auth.ok) {
    if (usableEnvSecrets.size === requiredSecrets.length) {
      warn('gh CLI is not authenticated or unavailable; skipping repository secret metadata because runtime secret env vars are present');
      return;
    }

    fail('gh CLI is not authenticated or unavailable and required OAuth secret env vars are not all present');
    console.log('Install/authenticate GitHub CLI, run from GitHub Actions with repo secrets, or finish the setup in GitHub UI.');
    return;
  }

  pass('gh CLI is authenticated');

  if (usableEnvSecrets.size === requiredSecrets.length && process.env.GITHUB_ACTIONS === 'true') {
    console.log('Running in GitHub Actions with required OAuth secret env vars present; repository secret metadata listing is not required.');
    return;
  }

  const secrets = await run('gh', [
    'secret',
    'list',
    '--repo',
    repo,
    '--json',
    'name,updatedAt',
  ]);

  if (!secrets.ok) {
    fail(`could not list repository secrets for ${repo}`);
    return;
  }

  let secretRows = [];
  try {
    secretRows = JSON.parse(secrets.stdout || '[]');
  } catch {
    fail(`could not parse repository secrets for ${repo}`);
    return;
  }

  const present = new Set(secretRows.map((secret) => secret.name));
  for (const name of requiredSecrets) {
    if (usableEnvSecrets.has(name)) {
      pass(`${name} runtime env var is present`);
    } else if (present.has(name)) {
      pass(`${repo} secret ${name} exists`);
    } else {
      fail(`${repo} secret ${name} is missing`);
    }
  }
}

async function checkOnePassword() {
  section('1Password access');
  const accounts = await run('op', ['account', 'list', '--format=json'], {
    timeout: 10000,
  });

  if (!accounts.ok) {
    warn('op CLI is unavailable, locked, or not signed in');
    console.log('This is okay if an operator will paste values into Render/GitHub manually.');
    return;
  }

  pass('op CLI is signed in');

  const exactItem = await run('op', ['item', 'get', onePasswordItemTitle, '--format=json'], {
    timeout: 15000,
  });

  if (exactItem.ok) {
    try {
      const item = JSON.parse(exactItem.stdout || '{}');
      const vault = item.vault?.name || item.vault?.id || 'unknown vault';
      const fields = new Set(
        (item.fields || [])
          .map((field) => field.label || field.id)
          .filter(Boolean),
      );

      pass(`1Password item "${onePasswordItemTitle}" is reachable (${vault})`);
      for (const field of expectedOnePasswordFields) {
        if (fields.has(field)) {
          pass(`1Password item has ${field} field`);
        } else {
          warn(`1Password item "${onePasswordItemTitle}" is missing visible field ${field}`);
        }
      }
      return;
    } catch {
      warn(`could not parse 1Password item "${onePasswordItemTitle}"`);
    }
  } else {
    warn(`1Password item "${onePasswordItemTitle}" was not found by exact name`);
  }

  const items = await run('op', ['item', 'list', '--format=json'], {
    timeout: 20000,
  });

  if (!items.ok) {
    warn(`could not list 1Password items; create or rename the item to "${onePasswordItemTitle}" with fields ${expectedOnePasswordFields.join(', ')}`);
    return;
  }

  let rows = [];
  try {
    rows = JSON.parse(items.stdout || '[]');
  } catch {
    warn('could not parse 1Password item list');
    return;
  }

  const matches = rows.filter((item) =>
    /new afro|newafro|decap|oauth|render|namecheap/i.test(item.title || ''),
  );

  if (!matches.length) {
    warn('no obvious New Afro OAuth/Render/Namecheap item found in 1Password');
    console.log(`Expected item name: ${onePasswordItemTitle}`);
    return;
  }

  for (const item of matches.slice(0, 10)) {
    const vault = item.vault?.name || item.vault?.id || 'unknown vault';
    console.log(`FOUND ${item.title} (${vault})`);
  }
}

async function checkRenderAccess() {
  section('Render access');
  const renderCli = await run('render', ['--version'], { timeout: 5000 });
  const hasRenderToken = Boolean(process.env.RENDER_API_KEY || process.env.RENDER_TOKEN);

  if (renderCli.ok) {
    pass('render CLI is available');
  } else {
    warn('render CLI is not available');
  }

  if (hasRenderToken) {
    pass('Render API token env var is present');
  } else {
    warn('no RENDER_API_KEY or RENDER_TOKEN env var is present');
  }

  console.log('Browser-based Render setup is fine, but Codex cannot deploy Render unattended without a token or logged-in CLI.');

  if (!renderServiceUrl) {
    warn('Render service URL probe is disabled');
    return;
  }

  console.log(`Render service probe: ${renderServiceUrl}`);
  try {
    const response = await fetchWithTimeout(renderServiceUrl, { method: 'HEAD' });
    const renderRouting = response.headers.get('x-render-routing') || '';
    console.log(`${response.status} ${renderServiceUrl}`);
    if (renderRouting) console.log(`x-render-routing: ${renderRouting}`);

    if (response.status === 404 && renderRouting === 'no-server') {
      warn(`${renderServiceUrl} resolves but Render reports no-server; finish the Render service setup and use the exact custom-domain target`);
    } else if (response.ok) {
      pass(`${renderServiceUrl} responds`);
    } else {
      warn(`${renderServiceUrl} returned HTTP ${response.status}; confirm the Render service is deployed and attached to the expected hostname`);
    }
  } catch (error) {
    warn(`could not reach ${renderServiceUrl}: ${error.message}`);
  }
}

console.log('New Afro OAuth operator access preflight');
console.log(`Repository: ${repo}`);
console.log(`OAuth host: ${host}`);

await checkDns();
await checkGitHub();
await checkOnePassword();
await checkRenderAccess();

section('Next action');
if (failures.length) {
  console.log('Required before CMS login/save can be verified:');
  for (const failure of failures) console.log(`- ${failure}`);
  console.log('');
  console.log('Expected operator flow:');
  console.log('1. Create/verify the GitHub OAuth app callback.');
  console.log('2. Run: GITHUB_OAUTH_ID=... GITHUB_OAUTH_SECRET=... npm run setup:operator');
  console.log('3. Deploy this repo on Render and add decap-oauth.newafro.com as a custom domain.');
  console.log('4. Run: RENDER_CUSTOM_DOMAIN_TARGET=[exact Render target] npm run setup:operator');
  console.log('5. Add Namecheap CNAME decap-oauth -> Render exact DNS target.');
  console.log('');
  console.log('Operator links:');
  console.log(`- GitHub OAuth app setup: ${githubOauthAppUrl}`);
  console.log(`- OAuth repo secrets: ${githubSecretsUrl}`);
  console.log(`- Render deploy from repo: ${renderDeployUrl}`);
  console.log(`- Deploy config preflight: ${deployPreflightUrl}`);
  console.log(`- Render/Namecheap runbook: ${runbookUrl}`);
  console.log('');
  console.log('Manual fallback: npm run create:1password-item, then npm run sync:github-secrets.');
  writeStepSummary();
  process.exit(1);
}

if (warnings.length) {
  console.log('No required checks failed, but review warnings before expecting unattended Codex deployment.');
}

console.log('Operator access checks passed.');
writeStepSummary();
