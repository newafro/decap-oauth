import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = resolve('scripts/create-1password-oauth-item.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ itemExists = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-op-create-test-'));

  await writeExecutable(
    dir,
    'op',
    `#!/bin/sh
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
  if [ "${itemExists ? '1' : '0'}" = "1" ]; then
    echo '{"title":"New Afro Decap OAuth"}'
    exit 0
  fi
  echo "item not found" >&2
  exit 1
fi
if [ "$1" = "item" ] && [ "$2" = "create" ]; then
  payload="$(cat)"
  case "$payload" in
    *client-id-from-env*client-secret-from-env*https://decap-oauth.newafro.com*)
      echo '{"title":"New Afro Decap OAuth"}'
      exit 0
      ;;
  esac
  echo "unexpected item payload" >&2
  exit 1
fi
echo "unexpected op args: $*" >&2
exit 1
`,
  );

  return dir;
}

function runCreate(toolPath, env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toolPath}:${process.env.PATH}`,
      GITHUB_OAUTH_ID: 'client-id-from-env',
      GITHUB_OAUTH_SECRET: 'client-secret-from-env',
      ...env,
    },
  });
}

test('creates exact 1Password item from env without printing secret values', async () => {
  const toolPath = await makeToolPath();
  const result = runCreate(toolPath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS GITHUB_OAUTH_ID env var is present/);
  assert.match(result.stdout, /PASS GITHUB_OAUTH_SECRET env var is present/);
  assert.match(result.stdout, /PASS created 1Password item "New Afro Decap OAuth"/);
  assert.match(result.stdout, /Secret values are never printed/);
  assert.doesNotMatch(result.stdout, /client-id-from-env/);
  assert.doesNotMatch(result.stdout, /client-secret-from-env/);
});

test('refuses placeholder OAuth values before calling op create', async () => {
  const toolPath = await makeToolPath();
  const result = runCreate(toolPath, {
    GITHUB_OAUTH_ID: 'dummy',
    GITHUB_OAUTH_SECRET: 'todo',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /GITHUB_OAUTH_ID env var is missing or looks like a placeholder/);
  assert.match(result.stdout, /GITHUB_OAUTH_SECRET env var is missing or looks like a placeholder/);
  assert.doesNotMatch(result.stdout, /dummy/);
  assert.doesNotMatch(result.stdout, /todo/);
});

test('does not overwrite an existing 1Password OAuth item', async () => {
  const toolPath = await makeToolPath({ itemExists: true });
  const result = runCreate(toolPath);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /already exists/);
  assert.match(result.stdout, /sync:github-secrets/);
});
