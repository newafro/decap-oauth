import { Resolver, resolve4, resolveCname } from 'node:dns/promises';
import fs from 'node:fs';
import { isIP } from 'node:net';

const host = process.env.OAUTH_HOST || 'decap-oauth.newafro.com';
const dnsZone = process.env.DNS_ZONE || 'newafro.com';
const authoritativeServers = String(
  process.env.AUTHORITATIVE_DNS_SERVERS || 'dns1.registrar-servers.com,dns2.registrar-servers.com',
)
  .split(',')
  .map((server) => server.trim())
  .filter(Boolean);
const diagnosticHosts = String(
  process.env.DNS_DIAGNOSTIC_HOSTS ||
    'decap-oauth.newafro.com.newafro.com,oauth.newafro.com,cms.newafro.com,admin.newafro.com,studio.newafro.com',
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const previewOrigin = process.env.PREVIEW_ORIGIN || 'https://preview.newafro.com';
const operatorWorkflowUrl = 'https://github.com/newafro/decap-oauth/actions/workflows/operator-access.yml';
const failures = [];
const lines = ['# New Afro OAuth proxy live readiness', ''];
const nameserverAddressCache = new Map();

function log(line = '') {
  console.log(line);
  lines.push(line);
}

function fail(message) {
  failures.push(message);
  log(`FAIL ${message}`);
}

function pass(message) {
  log(`PASS ${message}`);
}

function logDnsInstructions() {
  log('');
  log('Required Namecheap record:');
  log('  Type:  CNAME Record');
  log('  Host:  decap-oauth');
  log('  Value: the exact Render custom-domain target, without https://');
  log('  TTL:   Automatic');
  log('');
  log('The record must be in the newafro.com Advanced DNS zone and must not point to GitHub Pages.');
  log('');
  log('After adding OAuth repo secrets and DNS, run the OAuth operator preflight:');
  log(`  ${operatorWorkflowUrl}`);
}

function writeSummary() {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
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

async function resolveWithAuthoritativeServer(server, method, name) {
  const address = await getNameserverAddress(server);
  if (!address) return null;

  const resolver = new Resolver();
  resolver.setServers([address]);

  try {
    return await withTimeout(resolver[method](name), 5000, `${server} ${method} ${name}`);
  } catch {
    return null;
  }
}

async function getNameserverAddress(server) {
  if (nameserverAddressCache.has(server)) return nameserverAddressCache.get(server);
  if (isIP(server)) {
    nameserverAddressCache.set(server, server);
    return server;
  }

  try {
    const addresses = await withTimeout(resolve4(server), 5000, `resolve nameserver ${server}`);
    const address = addresses[0] || '';
    nameserverAddressCache.set(server, address);
    return address;
  } catch {
    nameserverAddressCache.set(server, '');
    return '';
  }
}

async function checkCommonWrongHostRecords() {
  let found = false;

  for (const name of diagnosticHosts) {
    try {
      const cnames = await resolveCname(name);
      if (cnames.length) {
        found = true;
        log(`Possible wrong-host CNAME ${name}: ${cnames.join(', ')}`);
      }
    } catch {}
  }

  if (!found) log('No common wrong-host CNAMEs were found.');
}

async function checkAuthoritativeDns() {
  log(`\n## Authoritative DNS: ${dnsZone}`);
  let foundAuthoritativeCname = false;

  for (const server of authoritativeServers) {
    const soa = await resolveWithAuthoritativeServer(server, 'resolveSoa', dnsZone);
    if (soa?.serial) {
      log(`${server} SOA serial: ${soa.serial}`);
    } else {
      log(`${server} SOA serial: unavailable`);
    }

    const cnames = await resolveWithAuthoritativeServer(server, 'resolveCname', host);
    if (cnames?.length) {
      foundAuthoritativeCname = true;
      log(`${server} CNAME ${host}: ${cnames.join(', ')}`);
    } else {
      log(`${server} CNAME ${host}: (none)`);
    }
  }

  if (!foundAuthoritativeCname) {
    log(`No authoritative CNAME for ${host} was found in the ${dnsZone} zone.`);
    await checkCommonWrongHostRecords();
  }
}

async function checkDns() {
  log(`## DNS: ${host}`);
  let cnames = [];
  let addresses = [];

  try {
    cnames = await resolveCname(host);
  } catch {}

  try {
    addresses = await resolve4(host);
  } catch {}

  if (cnames.length) log(`CNAME ${cnames.join(', ')}`);
  if (addresses.length) log(`A ${addresses.join(', ')}`);

  if (!cnames.length && !addresses.length) {
    fail(`${host} has no public DNS result`);
    return false;
  }

  pass(`${host} resolves`);
  return true;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      redirect: options.redirect || 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'newafro-oauth-live-readiness',
        ...options.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkRoot() {
  log('\n## Root endpoint');
  try {
    const response = await fetchWithTimeout(`https://${host}/`);
    const text = await response.text().catch(() => '');
    log(`${response.status} ${response.url}`);
    if (!response.ok || !text.includes('New Afro Decap OAuth proxy is running.')) {
      fail(`root endpoint is not ready: HTTP ${response.status}`);
      return;
    }
    pass('root endpoint is ready');
  } catch (error) {
    fail(`root endpoint failed: ${error.message}`);
  }
}

async function checkHealth() {
  log('\n## Health endpoint');
  try {
    const response = await fetchWithTimeout(`https://${host}/healthz`, {
      headers: { Origin: previewOrigin },
    });
    const text = await response.text().catch(() => '');
    log(`${response.status} ${response.url}`);

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      fail(`health endpoint did not return JSON: ${text}`);
      return;
    }

    const allowOrigin = response.headers.get('access-control-allow-origin');
    if (!response.ok || payload.ok !== true) {
      fail(`health endpoint is not ready: ${text}`);
      return;
    }
    if (allowOrigin !== '*') {
      fail('health endpoint is missing CORS for the static CMS page');
      return;
    }
    if (payload.publicUrl !== `https://${host}`) {
      fail(`health endpoint reports wrong PUBLIC_URL: ${payload.publicUrl || '(missing)'}`);
      return;
    }
    if (payload.callbackUrl !== `https://${host}/callback?provider=github`) {
      fail(`health endpoint reports wrong callback URL: ${payload.callbackUrl || '(missing)'}`);
      return;
    }
    if (!String(payload.scope || '').split(',').includes('user')) {
      fail(`health endpoint reports OAuth scope without user: ${payload.scope || '(missing)'}`);
      return;
    }

    pass('health endpoint is ready and reports the expected public callback');
  } catch (error) {
    fail(`health endpoint failed: ${error.message}`);
  }
}

async function checkAuth() {
  log('\n## GitHub auth redirect');
  try {
    const response = await fetchWithTimeout(`https://${host}/auth?provider=github`, {
      redirect: 'manual',
    });
    const location = response.headers.get('location') || '';
    log(`${response.status} ${location}`);
    if (response.status !== 302 || !location.startsWith('https://github.com/login/oauth/authorize')) {
      fail('auth endpoint does not redirect to GitHub authorize');
      return;
    }

    const url = new URL(location);
    if (url.searchParams.get('redirect_uri') !== `https://${host}/callback?provider=github`) {
      fail('auth endpoint has the wrong GitHub callback URL');
      return;
    }

    pass('auth endpoint redirects to GitHub OAuth');
  } catch (error) {
    fail(`auth endpoint failed: ${error.message}`);
  }
}

const dnsReady = await checkDns();
if (dnsReady) {
  await checkRoot();
  await checkHealth();
  await checkAuth();
} else {
  log('\nSkipping HTTP checks until DNS exists.');
  await checkAuthoritativeDns();
  logDnsInstructions();
}

log('\n## Summary');
if (failures.length) {
  for (const failure of failures) log(`- ${failure}`);
  log('');
  log('Blocked by https://github.com/newafro/decap-oauth/issues/1');
  writeSummary();
  process.exit(1);
}

log('OAuth proxy is live and ready for Decap CMS.');
writeSummary();
