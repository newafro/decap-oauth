import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.resolve('scripts/check-render-blueprint.mjs');

test('render blueprint matches the New Afro OAuth deployment contract', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS render\.yaml parses as YAML/);
  assert.match(result.stdout, /PASS custom domain includes decap-oauth\.newafro\.com/);
  assert.match(result.stdout, /PASS health check path is \/healthz/);
  assert.match(result.stdout, /PASS GITHUB_OAUTH_SECRET is declared as an operator-supplied secret/);
  assert.doesNotMatch(result.stdout, /client-secret/);
});
