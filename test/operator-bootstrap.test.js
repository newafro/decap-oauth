import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = resolve('scripts/operator-bootstrap.mjs');

async function writeExecutable(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  await chmod(file, 0o755);
  return file;
}

async function makeToolPath({ itemExists = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-operator-bootstrap-test-'));
  const stateFile = join(dir, 'item-created');
  const itemFieldsJson = JSON.stringify([
    { label: 'GITHUB_OAUTH_ID', value: 'client-id-from-op' },
    { label: 'GITHUB_OAUTH_SECRET', value: 'client-secret-from-op' },
  ]);

  await writeExecutable(
    dir,
    'op',
    `#!/bin/sh
item_exists() {
  if [ "${itemExists ? '1' : '0'}" = "1" ] || [ -f "${stateFile}" ]; then
    return 0
  fi
  return 1
}
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
  case "$*" in
    *--fields*)
      if item_exists; then
        cat <<'JSON'
${itemFieldsJson}
JSON
        exit 0
      fi
      exit 1
      ;;
  esac
  if item_exists; then
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
      touch "${stateFile}"
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

function runBootstrap(toolPath, env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${toolPath}:${process.env.PATH}`,
      ...env,
    },
  });
}

async function startRenderApiServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'newafro-render-api-test-'));
  const requestsFile = join(dir, 'requests.txt');
  const serverFile = join(dir, 'server.mjs');

  writeFileSync(
    serverFile,
    `import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const requestsFile = process.argv[2];
const server = createServer((request, response) => {
  appendFileSync(requestsFile, \`\${request.url}\\n\`);
  response.setHeader('Content-Type', 'application/json');

  if (request.url.startsWith('/services?')) {
    response.end(JSON.stringify({
      data: [{
        service: {
          id: 'srv-newafro',
          name: 'newafro-decap-oauth',
          serviceDetails: {
            url: 'https://newafro-decap-oauth.onrender.com',
          },
        },
      }],
    }));
    return;
  }

  if (request.url === '/services/srv-newafro/custom-domains/decap-oauth.newafro.com') {
    response.end(JSON.stringify({
      customDomain: {
        name: 'decap-oauth.newafro.com',
        dnsTarget: 'newafro-decap-oauth-custom.onrender.com',
      },
    }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ message: 'not found' }));
});

server.listen(0, '127.0.0.1', () => {
  console.log(server.address().port);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
`,
  );

  const child = spawn(process.execPath, [serverFile, requestsFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));

  const port = await new Promise((resolvePort, rejectPort) => {
    const timeout = setTimeout(() => rejectPort(new Error('Render API test server did not start')), 5000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      rejectPort(new Error(`Render API test server exited before listening with code ${code}`));
    });
    child.stdout.once('data', (chunk) => {
      clearTimeout(timeout);
      resolvePort(String(chunk).trim());
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: () => readFileSync(requestsFile, 'utf8').trim().split('\n').filter(Boolean),
  };
}

test('syncs secrets and validates deploy config from 1Password fields', async () => {
  const toolPath = await makeToolPath();
  const result = runBootstrap(toolPath, {
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro-decap-oauth.onrender.com',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS 1Password item "New Afro Decap OAuth" is reachable/);
  assert.match(result.stdout, /PASS GitHub Actions OAuth secrets are synced from 1Password/);
  assert.match(result.stdout, /PASS Render\/Namecheap deploy config is ready/);
  assert.doesNotMatch(result.stdout, /client-id-from-op/);
  assert.doesNotMatch(result.stdout, /client-secret-from-op/);
});

test('discovers Render target through API token when explicit target is absent', async (t) => {
  const toolPath = await makeToolPath();
  const renderApi = await startRenderApiServer(t);
  const result = runBootstrap(toolPath, {
    RENDER_API_BASE_URL: renderApi.baseUrl,
    RENDER_API_KEY: 'render-token-for-test',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS found Render service newafro-decap-oauth/);
  assert.match(result.stdout, /PASS Render custom domain decap-oauth\.newafro\.com is attached/);
  assert.match(result.stdout, /PASS discovered Render DNS target for decap-oauth\.newafro\.com/);
  assert.match(result.stdout, /Value: newafro-decap-oauth-custom\.onrender\.com/);
  assert.doesNotMatch(result.stdout, /Render custom-domain DNS is still the next external step/);
  assert.doesNotMatch(result.stdout, /render-token-for-test/);
  assert.deepEqual(renderApi.requests(), [
    '/services?name=newafro-decap-oauth&limit=20',
    '/services/srv-newafro/custom-domains/decap-oauth.newafro.com',
  ]);
});

test('creates missing 1Password item when OAuth env vars are supplied', async () => {
  const toolPath = await makeToolPath({ itemExists: false });
  const result = runBootstrap(toolPath, {
    GITHUB_OAUTH_ID: 'client-id-from-env',
    GITHUB_OAUTH_SECRET: 'client-secret-from-env',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /created 1Password item "New Afro Decap OAuth"/);
  assert.match(result.stdout, /PASS 1Password item "New Afro Decap OAuth" is ready/);
  assert.match(result.stdout, /Render custom-domain DNS is still the next external step/);
  assert.doesNotMatch(result.stdout, /client-id-from-env/);
  assert.doesNotMatch(result.stdout, /client-secret-from-env/);
});

test('fails safely when item and OAuth env vars are missing', async () => {
  const toolPath = await makeToolPath({ itemExists: false });
  const result = runBootstrap(toolPath);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing or incomplete/);
  assert.match(result.stdout, /rerun with GITHUB_OAUTH_ID and GITHUB_OAUTH_SECRET/);
});
