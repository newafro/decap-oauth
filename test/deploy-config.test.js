import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    GITHUB_REPO_PRIVATE: '0',
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro-decap-oauth.onrender.com',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /PUBLIC_URL=https:\/\/decap-oauth\.newafro\.com/);
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

test('deploy preflight writes a GitHub step summary without secret values', () => {
  const summaryPath = path.join(mkdtempSync(path.join(tmpdir(), 'newafro-deploy-summary-')), 'summary.md');
  const result = runPreflight({
    GITHUB_OAUTH_ID: 'client-id',
    GITHUB_OAUTH_SECRET: 'client-secret',
    PUBLIC_URL: 'https://decap-oauth.newafro.com',
    GITHUB_REPO_PRIVATE: '0',
    RENDER_CUSTOM_DOMAIN_TARGET: 'newafro-decap-oauth.onrender.com',
    GITHUB_STEP_SUMMARY: summaryPath,
  });
  const summary = readFileSync(summaryPath, 'utf8');

  assert.equal(result.status, 0);
  assert.match(summary, /# New Afro OAuth Deploy Config/);
  assert.match(summary, /Status: READY/);
  assert.match(summary, /Authorization callback URL: https:\/\/decap-oauth\.newafro\.com\/callback\?provider=github/);
  assert.match(summary, /Host: decap-oauth/);
  assert.match(summary, /Value: newafro-decap-oauth\.onrender\.com/);
  assert.doesNotMatch(summary, /client-secret/);
});
