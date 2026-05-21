# Render And Namecheap Runbook

Use this when finishing the New Afro CMS OAuth setup. It is written for the
operator who has access to GitHub OAuth apps, Render, Namecheap, and
1Password.

## Goal

Make this URL work:

```text
https://decap-oauth.newafro.com
```

The first designer CMS login test must wait until this runbook passes.

## Required Values

Create or verify the GitHub OAuth app with these exact values:

```text
Application name: New Afro Studio CMS
Homepage URL: https://newafro.com
Authorization callback URL: https://decap-oauth.newafro.com/callback?provider=github
```

Store these values in 1Password:

```text
Item: New Afro Decap OAuth
GITHUB_OAUTH_ID=[from GitHub OAuth app]
GITHUB_OAUTH_SECRET=[from GitHub OAuth app]
PUBLIC_URL=https://decap-oauth.newafro.com
GITHUB_REPO_PRIVATE=0
```

Use `GITHUB_REPO_PRIVATE=1` only if `newafro/website` is made private.

## Deploy On Render

1. Create a Render Blueprint or Web Service from:

   ```text
   https://github.com/newafro/decap-oauth
   ```

2. Use Node 20, `npm ci`, and `npm start`. The committed `render.yaml`
   already contains the expected defaults.
3. Add the environment variables from 1Password:

   ```text
   GITHUB_OAUTH_ID
   GITHUB_OAUTH_SECRET
   PUBLIC_URL=https://decap-oauth.newafro.com
   GITHUB_REPO_PRIVATE=0
   ```

4. Add Render custom domain:

   ```text
   decap-oauth.newafro.com
   ```

5. Copy the exact DNS target Render gives you. Do not guess it.

## Preflight Before Namecheap

Before the DNS work, Codex or an operator can check whether this machine has
enough access to finish the setup:

```bash
npm run check:operator
```

This command does not print secret values. It checks public DNS, GitHub CLI
access, whether the required GitHub repository secrets exist, visible
1Password item names, and whether a Render token or CLI is available. If it
fails, fix those operator prerequisites before expecting CMS login/save to
work.

After adding the GitHub repository secrets and Namecheap DNS, the same
operator access check can be run from GitHub Actions:

```text
https://github.com/newafro/decap-oauth/actions/workflows/operator-access.yml
```

That workflow injects the OAuth repository secrets as environment variables
and checks that the public `decap-oauth.newafro.com` DNS is live without
printing secret values.

Preferred no-local-secrets path:

1. Add `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` as repository secrets in
   `newafro/decap-oauth`.
2. Open:

   ```text
   https://github.com/newafro/decap-oauth/actions/workflows/deploy-config-preflight.yml
   ```

3. Run the workflow with:

   ```text
   render_custom_domain_target=[exact Render DNS target]
   github_repo_private=0
   ```

4. Continue only if the workflow passes.

Local alternative:

```bash
GITHUB_OAUTH_ID=[from GitHub OAuth app] \
GITHUB_OAUTH_SECRET=[from GitHub OAuth app] \
PUBLIC_URL=https://decap-oauth.newafro.com \
GITHUB_REPO_PRIVATE=0 \
RENDER_CUSTOM_DOMAIN_TARGET=[exact Render DNS target] \
npm run check:deploy-config
```

## Add Namecheap DNS

In the `newafro.com` Namecheap Advanced DNS zone, add exactly:

```text
Type:  CNAME Record
Host:  decap-oauth
Value: [exact Render DNS target, no https://]
TTL:   Automatic
```

Do not use:

```text
Host:  decap-oauth.newafro.com
Value: https://...
Value: newafro.github.io
```

## Verify

After DNS starts resolving, run:

```bash
npm run check:live
```

Expected: the command passes.

Then verify the website side from `newafro/website`:

```bash
npm run check:cms-readiness
npm run smoke:public
./scripts/check-pages-readiness.sh
```

The first real designer CMS test can start only when all of those checks pass.

## Stop Conditions

Stop and fix the setup before onboarding anyone if:

- `decap-oauth.newafro.com` has no DNS result.
- `/healthz` is not `200` with `ok: true`.
- `/healthz` reports a `publicUrl` or `callbackUrl` that is not
  `https://decap-oauth.newafro.com` /
  `https://decap-oauth.newafro.com/callback?provider=github`.
- `/auth?provider=github` does not redirect to GitHub.
- The GitHub redirect URI is not
  `https://decap-oauth.newafro.com/callback?provider=github`.
- The CMS asks an editor to understand Git branches, pull requests, or deploys.
