import { execFile } from 'node:child_process';
import { Resolver, resolve4, resolveCname } from 'node:dns/promises';
import fs from 'node:fs';
import { isIP } from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const host = process.env.OAUTH_HOST || 'decap-oauth.newafro.com';
const zone = process.env.DNS_ZONE || 'newafro.com';
const repo = process.env.GITHUB_REPO || 'newafro/decap-oauth';
const itemTitle = process.env.OP_ITEM_TITLE || 'New Afro Decap OAuth';
const renderServiceUrl = process.env.RENDER_SERVICE_URL || 'https://newafro-decap-oauth.onrender.com';
const nameservers = String(
  process.env.AUTHORITATIVE_DNS_SERVERS || 'dns1.registrar-servers.com,dns2.registrar-servers.com',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const requiredSecrets = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'];
const requiredOnePasswordFields = ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET', 'PUBLIC_URL'];
const callbackUrl = `https://${host}/callback?provider=github`;
const githubOauthAppUrl = 'https://github.com/settings/applications/new';
const githubSecretsUrl = `https://github.com/${repo}/settings/secrets/actions`;
const renderDeployUrl = `https://render.com/deploy?repo=https://github.com/${repo}`;
const setupStatusUrl = `https://github.com/${repo}/actions/workflows/setup-status.yml`;
const liveReadinessUrl = `https://github.com/${repo}/actions/workflows/live-readiness.yml`;
const operatorPreflightUrl = `https://github.com/${repo}/actions/workflows/operator-access.yml`;
const runbookUrl = `https://github.com/${repo}/blob/main/docs/render-namecheap-runbook.md`;
const nameserverAddressCache = new Map();
const blockers = [];
const warnings = [];
const lines = [];

function log(line = '') {
  console.log(line);
  lines.push(line);
}

function section(title) {
  log(`\n## ${title}`);
}

function block(message) {
  blockers.push(message);
  log(`BLOCKED ${message}`);
}

function warn(message) {
  warnings.push(message);
  log(`WARN ${message}`);
}

function pass(message) {
  log(`PASS ${message}`);
}

function fieldValue(value) {
  return String(value || '').trim();
}

function describeOnePasswordAccessFailure(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (
    output.includes('not signed in') ||
    output.includes('not currently signed in') ||
    output.includes('account is not signed in') ||
    output.includes('authorization timeout') ||
    output.includes('signin')
  ) {
    return '1Password CLI is not signed in in this environment';
  }

  if (output.includes('not found') || output.includes('isn\'t an item') || output.includes('could not find')) {
    return `1Password item "${itemTitle}" was not found by exact name`;
  }

  return `1Password item "${itemTitle}" is not visible in this environment`;
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 15000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 10,
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

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function getNameserverAddress(server) {
  if (nameserverAddressCache.has(server)) return nameserverAddressCache.get(server);
  if (isIP(server)) {
    nameserverAddressCache.set(server, server);
    return server;
  }

  try {
    const addresses = await withTimeout(resolve4(server), 5000, `resolve ${server}`);
    const address = addresses[0] || '';
    nameserverAddressCache.set(server, address);
    return address;
  } catch {
    nameserverAddressCache.set(server, '');
    return '';
  }
}

async function resolveAuthoritative(server, method, name) {
  const address = await getNameserverAddress(server);
  if (!address) return [];

  const resolver = new Resolver();
  resolver.setServers([address]);

  try {
    const value = await withTimeout(resolver[method](name), 5000, `${server} ${method} ${name}`);
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

async function checkDns() {
  section(`DNS: ${host}`);
  const [cnames, addresses] = await Promise.all([
    resolveCname(host).catch(() => []),
    resolve4(host).catch(() => []),
  ]);

  if (cnames.length) log(`Public CNAME: ${cnames.join(', ')}`);
  if (addresses.length) log(`Public A: ${addresses.join(', ')}`);

  if (!cnames.length && !addresses.length) {
    block(`${host} has no public DNS result`);
  } else {
    pass(`${host} resolves publicly`);
  }

  log('');
  log('Authoritative Namecheap view:');
  let foundAuthoritativeCname = false;
  for (const server of nameservers) {
    const soaRows = await resolveAuthoritative(server, 'resolveSoa', zone);
    const soa = soaRows[0];
    if (soa?.serial) log(`- ${server} SOA serial: ${soa.serial}`);
    else log(`- ${server} SOA serial: unavailable`);

    const authoritativeCnames = await resolveAuthoritative(server, 'resolveCname', host);
    if (authoritativeCnames.length) {
      foundAuthoritativeCname = true;
      log(`  CNAME ${host}: ${authoritativeCnames.join(', ')}`);
    } else {
      log(`  CNAME ${host}: (none)`);
    }
  }

  if (!foundAuthoritativeCname) {
    log('');
    log('Namecheap record still needed:');
    log('  Type:  CNAME Record');
    log('  Host:  decap-oauth');
    log('  Value: exact Render custom-domain DNS target, without https://');
    log('  TTL:   Automatic');
  }
}

async function checkGitHubSecrets() {
  section('GitHub OAuth Secrets');
  const result = await run('gh', [
    'secret',
    'list',
    '--repo',
    repo,
    '--json',
    'name,updatedAt',
  ]);

  if (!result.ok) {
    warn(`Could not inspect ${repo} repository secrets with the current token`);
    log(`Check manually: https://github.com/${repo}/settings/secrets/actions`);
    return;
  }

  let rows = [];
  try {
    rows = JSON.parse(result.stdout || '[]');
  } catch {
    warn(`Could not parse ${repo} repository secrets`);
    return;
  }

  const present = new Set(rows.map((row) => row.name));
  for (const secret of requiredSecrets) {
    if (present.has(secret)) pass(`${repo} secret ${secret} exists`);
    else block(`${repo} secret ${secret} is missing`);
  }
}

function collectOnePasswordFields(payload) {
  const fields = new Map();
  for (const row of payload?.fields || []) {
    const label = fieldValue(row.label || row.id);
    if (!label) continue;
    fields.set(label, fieldValue(row.value));
  }
  return fields;
}

async function checkOnePassword() {
  section('1Password Item');
  const account = await run('op', ['whoami', '--format=json'], {
    timeout: 10000,
  });

  if (!account.ok) {
    warn(describeOnePasswordAccessFailure(account));
    log('This is fine if the operator sets the GitHub/Render secrets manually.');
    return;
  }

  pass('1Password CLI is signed in');

  const result = await run('op', ['item', 'get', itemTitle, '--format', 'json'], {
    timeout: 10000,
  });

  if (!result.ok) {
    warn(describeOnePasswordAccessFailure(result));
    log('This is fine if the operator sets the GitHub/Render secrets manually.');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    warn(`Could not parse 1Password item "${itemTitle}"`);
    return;
  }

  const fields = collectOnePasswordFields(payload);
  for (const field of requiredOnePasswordFields) {
    if (fields.has(field)) pass(`1Password field ${field} exists`);
    else warn(`1Password field ${field} is missing from "${itemTitle}"`);
  }
}

async function checkRenderProbe() {
  section('Render Service Probe');
  log(`Probe URL: ${renderServiceUrl}`);

  try {
    const response = await fetch(renderServiceUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': 'newafro-oauth-setup-status',
      },
      signal: AbortSignal.timeout(15000),
    });
    log(`HTTP ${response.status}`);
    const renderRouting = response.headers.get('x-render-routing');
    if (renderRouting) log(`x-render-routing: ${renderRouting}`);

    if (renderRouting === 'no-server') {
      block(`${renderServiceUrl} is not attached to a Render service yet`);
    } else if (response.status === 404) {
      warn(`${renderServiceUrl} returned 404; finish Render setup and custom-domain attach`);
    } else {
      pass(`${renderServiceUrl} responds without Render no-server routing`);
    }
  } catch (error) {
    warn(`Render probe failed: ${error.message || error}`);
  }
}

function printNextAction() {
  section('Next Action');
  if (!blockers.length) {
    pass('OAuth setup status has no known blockers. Run npm run check:live and npm run check:operator next.');
    return;
  }

  log('Before CMS login/save can work:');
  for (const blocker of blockers) log(`- ${blocker}`);

  log('');
  log('Operator path:');
  log(`1. Create/verify GitHub OAuth app callback: ${callbackUrl}`);
  log(`   ${githubOauthAppUrl}`);
  log(`2. Add ${requiredSecrets.join(' and ')} to ${githubSecretsUrl}`);
  log(`3. Deploy ${repo} on Render and attach custom domain ${host}.`);
  log(`   ${renderDeployUrl}`);
  log(`4. In Render, set service env vars: ${requiredSecrets.join(', ')}, PUBLIC_URL=https://${host}, GITHUB_REPO_PRIVATE=0.`);
  log('5. Copy Render’s exact custom-domain DNS target.');
  log('6. Add Namecheap CNAME: Host decap-oauth -> exact Render target.');
  log('7. Run npm run check:live and npm run check:operator.');
  log('');
  log('Operator links:');
  log(`- Setup status: ${setupStatusUrl}`);
  log(`- Live readiness: ${liveReadinessUrl}`);
  log(`- Operator preflight: ${operatorPreflightUrl}`);
  log(`- Render/Namecheap runbook: ${runbookUrl}`);
}

function writeStepSummary() {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const summary = [
    '# New Afro OAuth Setup Status',
    '',
    `Status: ${blockers.length ? 'BLOCKED' : 'READY FOR LIVE CHECKS'}`,
    '',
    ...lines,
    '',
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));
}

log('# New Afro OAuth Setup Status');
log('');
log(`OAuth host: https://${host}`);
log(`GitHub callback: ${callbackUrl}`);
log('Purpose: informational status for the operator. This command does not prove CMS login/save readiness.');

await checkDns();
await checkGitHubSecrets();
await checkOnePassword();
await checkRenderProbe();
printNextAction();
writeStepSummary();
