import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const scriptPath = resolve('scripts/print-setup-status.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ signedIn = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-setup-status-test-'));

  await writeExecutable(
    dir,
    'gh',
    `#!/bin/sh
if [ "$1" = "secret" ] && [ "$2" = "list" ]; then
  echo '[]'
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
if [ "$1" = "whoami" ]; then
  if [ "${signedIn ? '1' : '0'}" = "1" ]; then
    echo '{"url":"example.1password.com","email":"operator@example.com"}'
    exit 0
  fi
  echo "account is not signed in" >&2
  exit 1
fi
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
  cat <<'JSON'
{"title":"New Afro Decap OAuth","fields":[{"label":"GITHUB_OAUTH_ID","value":"redacted"},{"label":"GITHUB_OAUTH_SECRET","value":"redacted"},{"label":"PUBLIC_URL","value":"https://decap-oauth.newafro.com"}]}
JSON
  exit 0
fi
echo "unexpected op args: $*" >&2
exit 1
`,
  );

  return dir;
}

function runSetupStatus(toolPath) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toolPath}:${process.env.PATH}`,
      OAUTH_HOST: 'localhost',
      RENDER_SERVICE_URL: 'http://127.0.0.1:1',
    },
  });
}

test('setup status only reports 1Password signed in after op whoami passes', async () => {
  const toolPath = await makeToolPath({ signedIn: true });
  const result = runSetupStatus(toolPath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS 1Password CLI is signed in/);
  assert.match(result.stdout, /PASS 1Password field GITHUB_OAUTH_ID exists/);
  assert.match(result.stdout, /PASS 1Password field GITHUB_OAUTH_SECRET exists/);
});

test('setup status does not report signed in when op whoami fails', async () => {
  const toolPath = await makeToolPath({ signedIn: false });
  const result = runSetupStatus(toolPath);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /WARN 1Password CLI is not signed in in this environment/);
  assert.doesNotMatch(result.stdout, /PASS 1Password CLI is signed in/);
  assert.doesNotMatch(result.stdout, /1Password field GITHUB_OAUTH_ID exists/);
});
