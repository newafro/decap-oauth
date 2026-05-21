import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.resolve('scripts/check-deploy-config.mjs');

function runPreflight(env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ...env,
    },
  });
}

test('deploy preflight explains missing OAuth secrets', () => {
  const result = runPreflight({
    PUBLIC_URL: 'https://decap-oauth.newafro.com',
    GITHUB_REPO_PRIVATE: '0',
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro-decap-oauth.onrender.com',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Missing OAuth secrets next action/);
  assert.match(result.stdout, /- GITHUB_OAUTH_ID/);
  assert.match(result.stdout, /- GITHUB_OAUTH_SECRET/);
  assert.match(result.stdout, /Do not commit OAuth secrets/);
});

test('deploy preflight rejects GitHub Pages as the Render DNS target', () => {
  const result = runPreflight({
    GITHUB_OAUTH_ID: 'client-id',
    GITHUB_OAUTH_SECRET: 'client-secret',
    PUBLIC_URL: 'https://decap-oauth.newafro.com',
    GITHUB_REPO_PRIVATE: '0',
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro.github.io',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /RENDER_CUSTOM_DOMAIN_TARGET must not point to GitHub Pages/);
});

test('deploy preflight prints the exact callback and Namecheap CNAME', () => {
  const result = runPreflight({
    GITHUB_OAUTH_ID: 'client-id',
    GITHUB_OAUTH_SECRET: 'client-secret',
    PUBLIC_URL: 'https://decap-oauth.newafro.com',
    GITHUB_REPO_PRIVATE: '0',
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro-decap-oauth.onrender.com',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Authorization callback URL: https:\/\/decap-oauth\.newafro\.com\/callback\?provider=github/);
  assert.match(result.stdout, /Host:  decap-oauth/);
  assert.match(result.stdout, /Value: newafro-decap-oauth\.onrender\.com/);
  assert.match(result.stdout, /Deploy config is ready for Render\/Namecheap setup/);
});
