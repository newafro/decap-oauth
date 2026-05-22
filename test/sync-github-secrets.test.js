import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = resolve('scripts/sync-github-secrets-from-1password.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ itemExists = true, placeholder = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-secret-sync-test-'));
  const oauthId = placeholder ? 'dummy' : 'client-id-from-op';
  const oauthSecret = placeholder ? 'todo' : 'client-secret-from-op';
  const itemJson = JSON.stringify([
    { label: 'GITHUB_OAUTH_ID', value: oauthId },
    { label: 'GITHUB_OAUTH_SECRET', value: oauthSecret },
  ]);

  await writeExecutable(
    dir,
    'op',
    `#!/bin/sh
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
  if [ "${itemExists ? '1' : '0'}" = "0" ]; then
    echo "item not found" >&2
    exit 1
  fi
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
    'gh',
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "github.com"
  exit 0
fi
if [ "$1" = "secret" ] && [ "$2" = "set" ]; then
  value="$(cat)"
  case "$3:$value" in
    GITHUB_OAUTH_ID:client-id-from-op|GITHUB_OAUTH_SECRET:client-secret-from-op)
      echo "set $3"
      exit 0
      ;;
  esac
  echo "unexpected secret payload for $3" >&2
  exit 1
fi
echo "unexpected gh args: $*" >&2
exit 1
`,
  );

  return dir;
}

function runSync(toolPath, env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toolPath}:${process.env.PATH}`,
      ...env,
    },
  });
}

test('syncs OAuth secrets from exact 1Password item into GitHub secrets', async () => {
  const toolPath = await makeToolPath();
  const result = runSync(toolPath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS 1Password field GITHUB_OAUTH_ID is present/);
  assert.match(result.stdout, /PASS set newafro\/decap-oauth Actions secret GITHUB_OAUTH_ID/);
  assert.match(result.stdout, /PASS set newafro\/decap-oauth Actions secret GITHUB_OAUTH_SECRET/);
  assert.match(result.stdout, /Secret values are never printed/);
  assert.doesNotMatch(result.stdout, /client-id-from-op/);
  assert.doesNotMatch(result.stdout, /client-secret-from-op/);
});

test('fails without printing values when 1Password item is missing', async () => {
  const toolPath = await makeToolPath({ itemExists: false });
  const result = runSync(toolPath);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /could not read 1Password item "New Afro Decap OAuth"/);
  assert.match(result.stdout, /Create or rename the item/);
});

test('rejects placeholder 1Password field values', async () => {
  const toolPath = await makeToolPath({ placeholder: true });
  const result = runSync(toolPath);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /GITHUB_OAUTH_ID is missing or looks like a placeholder/);
  assert.match(result.stdout, /GITHUB_OAUTH_SECRET is missing or looks like a placeholder/);
  assert.doesNotMatch(result.stdout, /dummy/);
  assert.doesNotMatch(result.stdout, /todo/);
});
