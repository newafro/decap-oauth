import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { buildAuthorizeUrl, callbackHtml, createHandler, getConfig, healthPayload } from '../src/server.js';

test('buildAuthorizeUrl points GitHub back to the New Afro callback', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'client-id',
      publicUrl: 'https://decap-oauth.newafro.com',
      scope: 'public_repo,user',
      state: 'abc123',
    })
  );

  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://decap-oauth.newafro.com/callback?provider=github');
  assert.equal(url.searchParams.get('scope'), 'public_repo,user');
  assert.equal(url.searchParams.get('state'), 'abc123');
});

test('callbackHtml emits the Decap authorization message format', () => {
  const html = callbackHtml('success', { token: 'token-value' });

  assert.match(html, /authorizing:github/);
  assert.match(html, /authorization:github:success/);
  assert.match(html, /postAuthorization/);
  assert.match(html, /token-value/);
});

test('getConfig supports private repo scope override', () => {
  const config = getConfig({
    GITHUB_OAUTH_ID: 'id',
    GITHUB_OAUTH_SECRET: 'secret',
    PUBLIC_URL: 'https://decap-oauth.newafro.com/',
    GITHUB_REPO_PRIVATE: '1',
    PORT: '9000',
  });

  assert.equal(config.publicUrl, 'https://decap-oauth.newafro.com');
  assert.equal(config.scope, 'repo,user');
  assert.equal(config.port, 9000);
});

test('healthz reports missing configuration', async () => {
  const server = http.createServer((req, res) => {
    createHandler({
      clientId: '',
      clientSecret: '',
      publicUrl: '',
      scope: 'public_repo,user',
      port: 0,
    })(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  const body = await response.json();
  server.close();

  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.deepEqual(body.missing, ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET', 'PUBLIC_URL']);
  assert.equal(body.provider, 'github');
  assert.equal(body.publicUrl, '');
  assert.equal(body.callbackUrl, '');
});

test('healthPayload exposes sanitized deploy metadata', () => {
  const payload = healthPayload({
    clientId: 'id',
    clientSecret: 'secret',
    publicUrl: 'https://decap-oauth.newafro.com',
    scope: 'public_repo,user',
    port: 0,
  });

  assert.deepEqual(payload, {
    ok: true,
    missing: [],
    provider: 'github',
    publicUrl: 'https://decap-oauth.newafro.com',
    callbackUrl: 'https://decap-oauth.newafro.com/callback?provider=github',
    scope: 'public_repo,user',
  });
  assert.equal('clientId' in payload, false);
  assert.equal('clientSecret' in payload, false);
});

test('healthz allows browser readiness checks and reports callback metadata', async () => {
  const server = http.createServer((req, res) => {
    createHandler({
      clientId: 'id',
      clientSecret: 'secret',
      publicUrl: 'https://decap-oauth.newafro.com',
      scope: 'public_repo,user',
      port: 0,
    })(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    headers: {
      Origin: 'https://preview.newafro.com',
    },
  });
  const body = await response.json();
  server.close();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(body.ok, true);
  assert.equal(body.publicUrl, 'https://decap-oauth.newafro.com');
  assert.equal(body.callbackUrl, 'https://decap-oauth.newafro.com/callback?provider=github');
  assert.equal(body.scope, 'public_repo,user');
});
