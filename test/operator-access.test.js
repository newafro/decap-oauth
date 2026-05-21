import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = resolve('scripts/check-operator-access.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ secrets = [], onePasswordItems = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-operator-test-'));
  const secretJson = JSON.stringify(secrets.map((name) => ({ name, updatedAt: '2026-05-21T00:00:00Z' })));
  const itemJson = JSON.stringify(onePasswordItems.map((title) => ({ title, vault: { name: 'Test Vault' } })));

  await writeExecutable(
    dir,
    'gh',
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
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
      PATH: `${toolPath}:${process.env.PATH}`,
      OAUTH_HOST: 'localhost',
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
  assert.match(result.stdout, /FOUND New Afro Decap OAuth/);
  assert.match(result.stdout, /Operator access checks passed/);
});
