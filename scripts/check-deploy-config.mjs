const expectedHost = process.env.OAUTH_HOST || 'decap-oauth.newafro.com';
const expectedPublicUrl = `https://${expectedHost}`;
const githubCallbackUrl = `${expectedPublicUrl}/callback?provider=github`;
const failures = [];
const warnings = [];
const missingSecrets = [];

function env(name) {
  return String(process.env[name] || '').trim();
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function checkRequiredSecret(name) {
  const value = env(name);
  if (!value) {
    missingSecrets.push(name);
    fail(`${name} is missing`);
    return;
  }

  if (['dummy', 'example', 'changeme', 'todo'].includes(value.toLowerCase())) {
    fail(`${name} still looks like a placeholder`);
  }
}

function normalizePublicUrl(value) {
  return value.replace(/\/$/, '');
}

function printHeader(title) {
  console.log(`\n== ${title} ==`);
}

const publicUrl = normalizePublicUrl(env('PUBLIC_URL') || env('RENDER_EXTERNAL_URL'));
const repoPrivate = env('GITHUB_REPO_PRIVATE') || '0';
const renderTarget = env('RENDER_CUSTOM_DOMAIN_TARGET');

console.log('New Afro Decap OAuth deploy config preflight');

printHeader('Required runtime env');
checkRequiredSecret('GITHUB_OAUTH_ID');
checkRequiredSecret('GITHUB_OAUTH_SECRET');

if (!publicUrl) {
  fail('PUBLIC_URL is missing');
} else if (publicUrl !== expectedPublicUrl) {
  fail(`PUBLIC_URL must be ${expectedPublicUrl}, got ${publicUrl}`);
}

if (!['0', '1'].includes(repoPrivate)) {
  fail(`GITHUB_REPO_PRIVATE must be 0 or 1, got ${repoPrivate}`);
}

console.log(`PUBLIC_URL=${publicUrl || '(missing)'}`);
console.log(`GITHUB_REPO_PRIVATE=${repoPrivate}`);
console.log(`GitHub OAuth callback URL=${githubCallbackUrl}`);

printHeader('GitHub OAuth app');
console.log('Use these exact values in GitHub OAuth app settings:');
console.log('Application name: New Afro Studio CMS');
console.log('Homepage URL: https://newafro.com');
console.log(`Authorization callback URL: ${githubCallbackUrl}`);

printHeader('Namecheap DNS');
if (!renderTarget) {
  warn('RENDER_CUSTOM_DOMAIN_TARGET is not set, so the exact Namecheap value cannot be printed yet.');
  console.log('Add the custom domain in Render first, then rerun with:');
  console.log('RENDER_CUSTOM_DOMAIN_TARGET=[exact Render DNS target] npm run check:deploy-config');
} else {
  if (renderTarget.startsWith('http://') || renderTarget.startsWith('https://')) {
    fail('RENDER_CUSTOM_DOMAIN_TARGET must not include http:// or https://');
  }

  if (renderTarget === expectedHost) {
    fail(`RENDER_CUSTOM_DOMAIN_TARGET must be the Render target, not ${expectedHost}`);
  }

  if (renderTarget === 'newafro.github.io' || renderTarget === 'newafro.github.io.') {
    fail('RENDER_CUSTOM_DOMAIN_TARGET must not point to GitHub Pages');
  }

  if (!renderTarget.includes('.')) {
    fail('RENDER_CUSTOM_DOMAIN_TARGET does not look like a DNS hostname');
  }

  if (!renderTarget.endsWith('.onrender.com') && !renderTarget.endsWith('.onrender.com.')) {
    warn('RENDER_CUSTOM_DOMAIN_TARGET does not end with .onrender.com; confirm this is the exact Render custom-domain target.');
  }

  console.log('Add this record in the newafro.com Namecheap Advanced DNS zone:');
  console.log('Type:  CNAME Record');
  console.log('Host:  decap-oauth');
  console.log(`Value: ${renderTarget}`);
  console.log('TTL:   Automatic');
}

printHeader('Summary');
if (warnings.length) {
  for (const message of warnings) console.log(`WARN ${message}`);
}

if (missingSecrets.length) {
  console.log('\nMissing OAuth secrets next action:');
  console.log('Add these as local environment variables or as repository secrets in newafro/decap-oauth:');
  for (const name of missingSecrets) console.log(`- ${name}`);
  console.log('Do not commit OAuth secrets to the repository.');
}

if (failures.length) {
  for (const message of failures) console.log(`FAIL ${message}`);
  process.exit(1);
}

console.log('Deploy config is ready for Render/Namecheap setup.');
