import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthorizeUrl, callbackHtml, getConfig } from '../src/server.js';

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
