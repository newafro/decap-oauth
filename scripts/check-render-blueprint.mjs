import fs from 'node:fs';
import YAML from 'yaml';

const blueprintPath = 'render.yaml';
const expectedServiceName = 'newafro-decap-oauth';
const expectedHost = 'decap-oauth.newafro.com';
const expectedPublicUrl = `https://${expectedHost}`;
const failures = [];

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must be ${expected}, got ${actual || '(missing)'}`);
  } else {
    pass(`${label} is ${expected}`);
  }
}

function envByKey(service) {
  return new Map((service?.envVars || []).map((row) => [row.key, row]));
}

console.log('New Afro Render Blueprint preflight');

let blueprint;
try {
  blueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
  pass(`${blueprintPath} parses as YAML`);
} catch (error) {
  fail(`${blueprintPath} does not parse as YAML: ${error.message}`);
  blueprint = {};
}

const services = Array.isArray(blueprint?.services) ? blueprint.services : [];
const service = services.find((candidate) => candidate?.name === expectedServiceName);

if (!service) {
  fail(`Blueprint must define service ${expectedServiceName}`);
} else {
  pass(`Blueprint defines service ${expectedServiceName}`);
  assertEqual(service.type, 'web', 'service type');
  assertEqual(service.runtime, 'node', 'service runtime');
  assertEqual(service.plan, 'free', 'service plan');
  assertEqual(service.buildCommand, 'npm ci', 'build command');
  assertEqual(service.startCommand, 'npm start', 'start command');
  assertEqual(service.autoDeployTrigger, 'checksPass', 'auto deploy trigger');
  assertEqual(service.healthCheckPath, '/healthz', 'health check path');

  if (Array.isArray(service.domains) && service.domains.includes(expectedHost)) {
    pass(`custom domain includes ${expectedHost}`);
  } else {
    fail(`custom domain must include ${expectedHost}`);
  }

  const env = envByKey(service);
  assertEqual(env.get('NODE_VERSION')?.value, 20, 'NODE_VERSION');
  assertEqual(env.get('PUBLIC_URL')?.value, expectedPublicUrl, 'PUBLIC_URL');
  assertEqual(env.get('GITHUB_REPO_PRIVATE')?.value, '0', 'GITHUB_REPO_PRIVATE');

  for (const secretKey of ['GITHUB_OAUTH_ID', 'GITHUB_OAUTH_SECRET']) {
    const row = env.get(secretKey);
    if (!row) {
      fail(`${secretKey} must be declared in render.yaml`);
    } else if (row.sync !== false || 'value' in row) {
      fail(`${secretKey} must use sync: false and must not have a committed value`);
    } else {
      pass(`${secretKey} is declared as an operator-supplied secret`);
    }
  }
}

if (failures.length) {
  console.log('\nRender Blueprint preflight failed.');
  process.exit(1);
}

console.log('\nRender Blueprint is ready for the New Afro OAuth service.');
