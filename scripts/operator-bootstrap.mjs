import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const itemTitle = process.env.OP_ITEM_TITLE || 'New Afro Decap OAuth';
const repo = process.env.GITHUB_REPO || 'newafro/decap-oauth';
const publicUrl = String(process.env.PUBLIC_URL || 'https://decap-oauth.newafro.com').trim();
const repoPrivate = String(process.env.GITHUB_REPO_PRIVATE || '0').trim();
const renderTargetFromEnv = String(process.env.RENDER_CUSTOM_DOMAIN_TARGET || '').trim();
const renderApiBaseUrl = String(process.env.RENDER_API_BASE_URL || 'https://api.render.com/v1').replace(/\/$/, '');
const renderApiToken = String(process.env.RENDER_API_KEY || process.env.RENDER_TOKEN || '').trim();
const renderServiceName = String(process.env.RENDER_SERVICE_NAME || 'newafro-decap-oauth').trim();
const renderServiceId = String(process.env.RENDER_SERVICE_ID || '').trim();
const oauthHost = String(process.env.OAUTH_HOST || 'decap-oauth.newafro.com').trim();
const requiredSecrets = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'];
const placeholders = new Set(['dummy', 'example', 'changeme', 'todo']);
const failures = [];
const warnings = [];
let effectiveRenderTarget = renderTargetFromEnv;

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

async function renderApi(path) {
  const response = await fetch(`${renderApiBaseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${renderApiToken}`,
      'User-Agent': 'newafro-oauth-operator-bootstrap',
    },
  });
  const text = await response.text().catch(() => '');
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {}
  }

  return { ok: response.ok, status: response.status, payload, text };
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

function unwrapService(row) {
  return row?.service || row;
}

function getServiceId(row) {
  const service = unwrapService(row);
  return service?.id || row?.id || '';
}

function getServiceName(row) {
  const service = unwrapService(row);
  return service?.name || row?.name || '';
}

function getServiceUrlHost(row) {
  const service = unwrapService(row);
  const candidates = [
    service?.serviceDetails?.url,
    service?.details?.url,
    service?.url,
    row?.serviceDetails?.url,
    row?.url,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const host = new URL(candidate).host;
      if (host.endsWith('.onrender.com')) return host;
    } catch {
      const value = String(candidate).replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (value.endsWith('.onrender.com')) return value;
    }
  }

  return '';
}

function getCustomDomainTarget(payload, serviceRow) {
  const row = payload?.customDomain || payload?.domain || payload;
  const candidates = [
    row?.dnsTarget,
    row?.server,
    row?.target,
    row?.recordValue,
    row?.dnsRecord?.value,
    row?.verification?.dnsTarget,
    row?.verification?.recordValue,
    row?.verification?.dnsRecord?.value,
    row?.verification?.value,
    getServiceUrlHost(serviceRow),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (value.endsWith('.onrender.com')) return value;
  }

  return '';
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

function fieldsFromEnv() {
  const fieldsByName = new Map();
  for (const name of requiredSecrets) fieldsByName.set(name, process.env[name]);
  return fieldsByName;
}

async function readOnePasswordSecrets() {
  const account = await run('op', ['whoami', '--format=json'], {
    timeout: 10000,
  });
  if (!account.ok) {
    if (oauthEnvReady()) {
      warn('1Password CLI is not signed in; using OAuth env vars for GitHub secret sync');
      return { ok: true, fieldsByName: fieldsFromEnv(), source: 'env' };
    }

    fail('1Password CLI is not signed in; run op signin or rerun with GITHUB_OAUTH_ID and GITHUB_OAUTH_SECRET env vars');
    return { ok: false, fieldsByName: new Map(), authFailed: true };
  }

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
  if (existing.authFailed) return new Map();

  if (existing.ok) {
    if (existing.source === 'env') {
      pass('OAuth env vars are available for GitHub secret sync');
    } else {
      pass(`1Password item "${itemTitle}" is reachable and has OAuth fields`);
    }
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

function setGitHubSecret(name, value) {
  return new Promise((resolve) => {
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

async function syncGitHubSecrets(fieldsByName) {
  section('GitHub Actions Secrets');
  const auth = await run('gh', ['auth', 'status']);
  if (!auth.ok) {
    fail('gh CLI is not authenticated');
    return;
  }

  pass('gh CLI is authenticated');

  let setCount = 0;
  for (const name of requiredSecrets) {
    const value = String(fieldsByName.get(name) || '').trim();
    if (!valueLooksUsable(value)) continue;

    const result = await setGitHubSecret(name, value);
    if (result.ok) {
      setCount += 1;
      pass(`set ${repo} Actions secret ${name}`);
    } else {
      fail(`could not set ${repo} Actions secret ${name}`);
    }
  }

  if (setCount === requiredSecrets.length) {
    pass('GitHub Actions OAuth secrets are synced');
  }
}

async function discoverRenderTarget() {
  if (!renderApiToken) {
    warn('RENDER_API_KEY or RENDER_TOKEN is not set, so the Render custom-domain target cannot be discovered automatically');
    return '';
  }

  section('Render API Discovery');
  let serviceRow = null;
  let serviceId = renderServiceId;

  if (serviceId) {
    pass(`using Render service id from RENDER_SERVICE_ID`);
  } else {
    const query = new URLSearchParams({ name: renderServiceName, limit: '20' });
    const services = await renderApi(`/services?${query.toString()}`);
    if (!services.ok) {
      fail(`could not list Render services by name ${renderServiceName}: HTTP ${services.status}`);
      return '';
    }

    const rows = unwrapRows(services.payload);
    serviceRow = rows.find((row) => getServiceName(row) === renderServiceName) || rows[0] || null;
    serviceId = serviceRow ? getServiceId(serviceRow) : '';

    if (!serviceId) {
      fail(`could not find Render service id for ${renderServiceName}`);
      return '';
    }

    pass(`found Render service ${renderServiceName}`);
  }

  const domain = await renderApi(
    `/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(oauthHost)}`,
  );
  if (!domain.ok) {
    if (domain.status === 404) {
      fail(`Render custom domain ${oauthHost} is not attached to service ${serviceId}`);
    } else {
      fail(`could not retrieve Render custom domain ${oauthHost}: HTTP ${domain.status}`);
    }
    return '';
  }

  pass(`Render custom domain ${oauthHost} is attached`);
  const target = getCustomDomainTarget(domain.payload, serviceRow);
  if (!target) {
    warn(`could not discover the Render DNS target from the API response; copy it from Render and set RENDER_CUSTOM_DOMAIN_TARGET`);
    return '';
  }

  pass(`discovered Render DNS target for ${oauthHost}`);
  return target;
}

async function checkRenderConfig(fieldsByName) {
  section('Render And Namecheap Preflight');

  const renderTarget = renderTargetFromEnv || await discoverRenderTarget();
  if (renderTarget) effectiveRenderTarget = renderTarget;

  if (!renderTarget) {
    warn('RENDER_CUSTOM_DOMAIN_TARGET is not set and automatic Render API discovery did not produce a target');
    console.log('Next: deploy the Render service, add custom domain decap-oauth.newafro.com, copy the exact DNS target, then rerun:');
    console.log('RENDER_CUSTOM_DOMAIN_TARGET=[exact Render target] npm run setup:operator');
    console.log('');
    console.log('If a Render API token is available, Codex can try to discover the target with:');
    console.log('RENDER_API_KEY=[token] npm run setup:operator');
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
if (!failures.length) await syncGitHubSecrets(fieldsByName);
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
if (!effectiveRenderTarget) {
  console.log('Render custom-domain DNS is still the next external step.');
}
