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

Keep the item title exact. The operator preflight checks for
`New Afro Decap OAuth` by name before it tries a broader 1Password search, so
this still works when vault-wide item listing is unavailable. The preflight
only prints field names and never prints secret values.

## Deploy On Render

1. Create a Render Blueprint or Web Service from:

   ```text
   https://github.com/newafro/decap-oauth
   ```

2. Use Node 20, `npm ci`, and `npm start`. The committed `render.yaml`
   already contains the expected defaults, declares `decap-oauth.newafro.com`
   as the custom domain, and uses `/healthz` as the Render health check.
3. Add the environment variables from 1Password:

   ```text
   GITHUB_OAUTH_ID
   GITHUB_OAUTH_SECRET
   PUBLIC_URL=https://decap-oauth.newafro.com
   GITHUB_REPO_PRIVATE=0
   ```

4. Confirm Render custom domain:

   ```text
   decap-oauth.newafro.com
   ```

5. Copy the exact DNS target Render gives you. Do not guess it.

If `https://newafro-decap-oauth.onrender.com` resolves but returns `404` with
`x-render-routing: no-server`, Render DNS exists but the New Afro service is
not deployed or that hostname is not attached to the service. Do not use that
as proof that the OAuth proxy is ready. Finish the Render service setup and use
the exact custom-domain target Render shows for `decap-oauth.newafro.com`.

## Preflight Before Namecheap

Before the DNS work, Codex or an operator can check whether this machine has
enough access to finish the setup:

```bash
npm run status:setup
npm run check:operator
```

`npm run status:setup` is an informational one-screen status. It exits green so
it can be shared with the person logged in to Render or Namecheap, while still
listing the blockers. It does not prove CMS login/save readiness.

`npm run check:operator` is the strict gate. It does not print secret values.
It checks public DNS, GitHub CLI access, whether the required GitHub repository
secrets exist, visible 1Password item names, and whether a Render token or CLI
is available. If it fails, fix those operator prerequisites before expecting
CMS login/save to work.

If the exact 1Password item exists and this machine is signed in to GitHub CLI,
sync the OAuth credentials into GitHub repository secrets without printing
their values:

```bash
npm run sync:github-secrets
```

This only sets `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` in
`newafro/decap-oauth`. It does not deploy Render and does not edit Namecheap
DNS.

If the OAuth app values exist but the 1Password item does not, create the item
first without putting the values in command arguments:

```bash
GITHUB_OAUTH_ID=[from GitHub OAuth app] \
GITHUB_OAUTH_SECRET=[from GitHub OAuth app] \
npm run create:1password-item
```

Then run `npm run sync:github-secrets`.

Preferred guided path:

```bash
GITHUB_OAUTH_ID=[from GitHub OAuth app] \
GITHUB_OAUTH_SECRET=[from GitHub OAuth app] \
npm run setup:operator
```

After Render shows the custom-domain DNS target, rerun:

```bash
RENDER_CUSTOM_DOMAIN_TARGET=[exact Render DNS target] npm run setup:operator
```

If a Render API token is available, the helper can try to discover that target:

```bash
RENDER_API_KEY=[Render API token] npm run setup:operator
```

This command creates the exact 1Password item when the OAuth env vars are
provided, syncs the two GitHub Actions secrets from 1Password, and validates
the Render/Namecheap target when `RENDER_CUSTOM_DOMAIN_TARGET` is present. It
does not deploy Render and does not edit Namecheap DNS. It requires a real
`op whoami` sign-in before touching 1Password item data. If 1Password is
unavailable but `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` are provided as
environment variables, it can sync those values directly into GitHub Actions
secrets without printing them.

After adding the GitHub repository secrets and Namecheap DNS, the same
operator access check can be run from GitHub Actions:

```text
https://github.com/newafro/decap-oauth/actions/workflows/operator-access.yml
```

It also runs daily after the live OAuth readiness monitor, so a finished
Render/DNS/secrets setup should turn green without someone remembering the
manual rerun.

That workflow injects the OAuth repository secrets as environment variables
and checks that the public `decap-oauth.newafro.com` DNS is live without
printing secret values. When it fails, read the GitHub Actions job summary
first; it lists the missing item(s), the repo secret settings link, the Render
deploy link, and the exact operator flow.

The deploy-config preflight also writes a GitHub Actions job summary. Read it
before editing Namecheap; it repeats the callback URL and the exact CNAME
record that should be added, without printing OAuth secret values.

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

After saving, run `npm run check:live`. When the record is still missing, the
command prints the authoritative Namecheap SOA serial and the result from
`dns1.registrar-servers.com` / `dns2.registrar-servers.com`. If the serial has
not changed and both servers still show `(none)`, the record was not saved in
the `newafro.com` zone yet.

## Verify

After DNS starts resolving, run:

```bash
npm run check:live
```

Expected: the command passes.

The same public live check can be run from GitHub Actions:

```text
https://github.com/newafro/decap-oauth/actions/workflows/live-readiness.yml
```

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
- the likely Render service URL returns `x-render-routing: no-server`.
- `/healthz` is not `200` with `ok: true`.
- `/healthz` reports a `publicUrl` or `callbackUrl` that is not
  `https://decap-oauth.newafro.com` /
  `https://decap-oauth.newafro.com/callback?provider=github`.
- `/auth?provider=github` does not redirect to GitHub.
- The GitHub redirect URI is not
  `https://decap-oauth.newafro.com/callback?provider=github`.
- The CMS asks an editor to understand Git branches, pull requests, or deploys.
