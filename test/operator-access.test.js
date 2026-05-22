import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = resolve('scripts/check-operator-access.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ secrets = [], onePasswordItems = [], ghAuth = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-operator-test-'));
  const secretJson = JSON.stringify(secrets.map((name) => ({ name, updatedAt: '2026-05-21T00:00:00Z' })));
  const itemJson = JSON.stringify(onePasswordItems.map((title) => ({ title, vault: { name: 'Test Vault' } })));
  const exactItemCases = onePasswordItems.map((title) => {
    const item = JSON.stringify({
      title,
      vault: { name: 'Test Vault' },
      fields: [
        { label: 'GITHUB_OAUTH_ID', value: 'redacted' },
        { label: 'GITHUB_OAUTH_SECRET', value: 'redacted' },
        { label: 'PUBLIC_URL', value: 'https://decap-oauth.newafro.com' },
      ],
    });

    return `if [ "$3" = "${title}" ]; then
  cat <<'JSON'
${item}
JSON
  exit 0
fi`;
  }).join('\n');

  await writeExecutable(
    dir,
    'gh',
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ "${ghAuth ? '0' : '1'}" = "1" ]; then
    echo "not authenticated" >&2
    exit 1
  fi
  echo "github.com"
  exit 0
fi
if [ "$1" = "secret" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
${secretJson}
JSON
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`,
  );

  await writeExecutable(
    dir,
    'op',
    `#!/bin/sh
if [ "$1" = "account" ] && [ "$2" = "list" ]; then
  echo '[{"url":"example.1password.com","email":"operator@example.com"}]'
  exit 0
fi
if [ "$1" = "item" ] && [ "$2" = "list" ]; then
  cat <<'JSON'
${itemJson}
JSON
  exit 0
fi
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
${exactItemCases}
  echo "item not found" >&2
  exit 1
fi
echo "unexpected op args: $*" >&2
exit 1
`,
  );

  await writeExecutable(
    dir,
    'render',
    `#!/bin/sh
echo "render-test 0.0.0"
exit 0
`,
  );

  return dir;
}

function runOperator(toolPath, env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'false',
      PATH: `${toolPath}:${process.env.PATH}`,
      OAUTH_HOST: 'localhost',
      RENDER_SERVICE_URL: '',
      ...env,
    },
  });
}

test('operator preflight fails with missing GitHub OAuth secrets', async () => {
  const toolPath = await makeToolPath({
    secrets: [],
    onePasswordItems: ['New Afro Decap OAuth'],
  });

  const result = runOperator(toolPath);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /PASS localhost resolves publicly/);
  assert.match(result.stdout, /FAIL newafro\/decap-oauth secret GITHUB_OAUTH_ID is missing/);
  assert.match(result.stdout, /FAIL newafro\/decap-oauth secret GITHUB_OAUTH_SECRET is missing/);
  assert.match(result.stdout, /Expected operator flow/);
  assert.match(result.stdout, /npm run setup:operator/);
  assert.match(result.stdout, /Manual fallback: npm run create:1password-item, then npm run sync:github-secrets/);
});

test('operator preflight passes when DNS and GitHub secrets are present', async () => {
  const toolPath = await makeToolPath({
    secrets: ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'],
    onePasswordItems: ['New Afro Decap OAuth'],
  });

  const result = runOperator(toolPath, {
    RENDER_API_KEY: 'test-render-token',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS localhost resolves publicly/);
  assert.match(result.stdout, /PASS newafro\/decap-oauth secret GITHUB_OAUTH_ID exists/);
  assert.match(result.stdout, /PASS newafro\/decap-oauth secret GITHUB_OAUTH_SECRET exists/);
  assert.match(result.stdout, /PASS 1Password item "New Afro Decap OAuth" is reachable/);
  assert.match(result.stdout, /PASS 1Password item has GITHUB_OAUTH_ID field/);
  assert.match(result.stdout, /PASS 1Password item has GITHUB_OAUTH_SECRET field/);
  assert.match(result.stdout, /Operator access checks passed/);
});

test('operator preflight checks the exact 1Password item before broad listing', async () => {
  const toolPath = await makeToolPath({
    secrets: ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET'],
    onePasswordItems: ['New Afro Decap OAuth'],
  });

  await writeExecutable(
    toolPath,
    'op',
    `#!/bin/sh
if [ "$1" = "account" ] && [ "$2" = "list" ]; then
  echo '[{"url":"example.1password.com","email":"operator@example.com"}]'
  exit 0
fi
if [ "$1" = "item" ] && [ "$2" = "get" ] && [ "$3" = "New Afro Decap OAuth" ]; then
  cat <<'JSON'
{"title":"New Afro Decap OAuth","vault":{"name":"Test Vault"},"fields":[{"label":"GITHUB_OAUTH_ID"},{"label":"GITHUB_OAUTH_SECRET"},{"label":"PUBLIC_URL"}]}
JSON
  exit 0
fi
if [ "$1" = "item" ] && [ "$2" = "list" ]; then
  echo "listing disabled" >&2
  exit 1
fi
echo "unexpected op args: $*" >&2
exit 1
`,
  );

  const result = runOperator(toolPath, {
    RENDER_API_KEY: 'test-render-token',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS 1Password item "New Afro Decap OAuth" is reachable/);
  assert.doesNotMatch(result.stdout, /could not list 1Password items/);
});

test('operator preflight can use runtime secret env vars in GitHub Actions', async () => {
  const toolPath = await makeToolPath({
    secrets: [],
    onePasswordItems: ['New Afro Decap OAuth'],
    ghAuth: false,
  });

  const result = runOperator(toolPath, {
    GITHUB_ACTIONS: 'true',
    GITHUB_OAUTH_ID: 'client-id',
    GITHUB_OAUTH_SECRET: 'client-secret',
    RENDER_API_KEY: 'test-render-token',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS GITHUB_OAUTH_ID runtime env var is present/);
  assert.match(result.stdout, /PASS GITHUB_OAUTH_SECRET runtime env var is present/);
  assert.match(result.stdout, /skipping repository secret metadata because runtime secret env vars are present/);
  assert.match(result.stdout, /Operator access checks passed/);
});

test('operator preflight names missing GitHub Actions secrets directly', async () => {
  const toolPath = await makeToolPath({
    secrets: [],
    onePasswordItems: ['New Afro Decap OAuth'],
    ghAuth: false,
  });

  const result = runOperator(toolPath, {
    GITHUB_ACTIONS: 'true',
    RENDER_API_KEY: 'test-render-token',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL GITHUB_OAUTH_ID GitHub Actions secret is missing or unavailable to this workflow/);
  assert.match(result.stdout, /FAIL GITHUB_OAUTH_SECRET GitHub Actions secret is missing or unavailable to this workflow/);
  assert.match(result.stdout, /Add the missing repository secret\(s\) in newafro\/decap-oauth settings/);
});

test('operator preflight writes a GitHub step summary with setup links', async () => {
  const toolPath = await makeToolPath({
    secrets: [],
    onePasswordItems: ['New Afro Decap OAuth'],
  });
  const summaryPath = join(mkdtempSync(join(tmpdir(), 'newafro-operator-summary-')), 'summary.md');

  const result = runOperator(toolPath, {
    GITHUB_STEP_SUMMARY: summaryPath,
  });
  const summary = readFileSync(summaryPath, 'utf8');

  assert.equal(result.status, 1);
  assert.match(summary, /# New Afro OAuth Operator Preflight/);
  assert.match(summary, /Status: BLOCKED/);
  assert.match(summary, /newafro\/decap-oauth secret GITHUB_OAUTH_ID is missing/);
  assert.match(summary, /newafro\/decap-oauth secret GITHUB_OAUTH_SECRET is missing/);
  assert.match(summary, /https:\/\/github.com\/newafro\/decap-oauth\/settings\/secrets\/actions/);
  assert.match(summary, /https:\/\/render.com\/deploy\?repo=https:\/\/github.com\/newafro\/decap-oauth/);
  assert.match(summary, /npm run setup:operator/);
  assert.match(summary, /Manual fallback/);
  assert.match(summary, /npm run create:1password-item/);
  assert.match(summary, /npm run sync:github-secrets/);
  assert.match(summary, /Namecheap CNAME decap-oauth -> exact Render custom-domain DNS target/);
});

test('operator preflight warns when Render reports no-server', async () => {
  const toolPath = await makeToolPath({
    secrets: [],
    onePasswordItems: ['New Afro Decap OAuth'],
  });
  const serverDir = mkdtempSync(join(tmpdir(), 'newafro-render-server-'));
  const serverPath = join(serverDir, 'server.mjs');
  writeFileSync(
    serverPath,
    `import { createServer } from 'node:http';
const server = createServer((_req, res) => {
  res.writeHead(404, {
    'content-type': 'text/plain',
    'x-render-routing': 'no-server',
  });
  res.end('Not Found');
});
server.listen(0, '127.0.0.1', () => {
  console.log(server.address().port);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
  );
  const server = spawn(process.execPath, [serverPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolvePort, rejectPort) => {
    server.stdout.once('data', (chunk) => resolvePort(String(chunk).trim()));
    server.once('error', rejectPort);
  });

  try {
    const result = runOperator(toolPath, {
      RENDER_SERVICE_URL: `http://127.0.0.1:${port}`,
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /x-render-routing: no-server/);
    assert.match(result.stdout, /Render reports no-server/);
    assert.match(result.stdout, /finish the Render service setup/);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolveClose) => server.once('exit', resolveClose));
  }
});
