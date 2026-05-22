# New Afro Decap OAuth Proxy

Small GitHub OAuth proxy for New Afro Studio / Decap CMS.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/newafro/decap-oauth)

The website CMS is static, so it cannot safely exchange a GitHub OAuth code for
an access token in the browser. This service handles only that handshake and
returns the token to Decap CMS using Decap's expected popup message format.

## Live Target

```text
https://decap-oauth.newafro.com
```

The website expects:

```yaml
backend:
  name: github
  repo: newafro/website
  branch: staging
  base_url: https://decap-oauth.newafro.com
  auth_endpoint: /auth
```

## Required GitHub OAuth App

Create a GitHub OAuth app from the GitHub account or organization that should
own New Afro website admin access:

```text
Application name: New Afro Studio CMS
Homepage URL: https://newafro.com
Authorization callback URL: https://decap-oauth.newafro.com/callback?provider=github
```

GitHub URL:

```text
https://github.com/settings/applications/new
```

Store the generated values in the deploy host:

```text
GITHUB_OAUTH_ID
GITHUB_OAUTH_SECRET
```

Store the same values in 1Password:

```text
Item: New Afro Decap OAuth
Fields:
- GITHUB_OAUTH_ID
- GITHUB_OAUTH_SECRET
- PUBLIC_URL=https://decap-oauth.newafro.com
```

Use the exact item title `New Afro Decap OAuth`. The operator preflight looks
up that item directly and reports only field names, never secret values.

## Render Deploy

This repository includes `render.yaml`.

For the focused operator checklist, use
[`docs/render-namecheap-runbook.md`](docs/render-namecheap-runbook.md).

Before expecting Codex to finish the setup unattended, check whether the local
machine has the required operator handles:

```bash
npm run check:operator
```

This checks DNS, GitHub repository secrets, visible 1Password item names, and
Render access without printing secret values.

If the 1Password item exists locally and the GitHub CLI is authenticated, Codex
can sync the OAuth values into GitHub Actions repository secrets without
printing the values:

```bash
npm run sync:github-secrets
```

This reads `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` from the exact
`New Afro Decap OAuth` 1Password item and sets them on `newafro/decap-oauth`.
It does not deploy Render or edit Namecheap DNS.

If the GitHub OAuth app values exist but the 1Password item does not, create
the item without putting secret values in command arguments:

```bash
GITHUB_OAUTH_ID=[from GitHub OAuth app] \
GITHUB_OAUTH_SECRET=[from GitHub OAuth app] \
npm run create:1password-item
```

Then run `npm run sync:github-secrets`.

1. Click **Deploy to Render** above, or create a Render Blueprint from this repository.
2. Set `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` from the GitHub OAuth app.
3. Confirm these environment values:

   ```text
   PUBLIC_URL=https://decap-oauth.newafro.com
   GITHUB_REPO_PRIVATE=0
   ```

   `newafro/website` is currently public, so `GITHUB_REPO_PRIVATE=0` keeps the
   GitHub permission prompt narrower. If the website repository is made
   private later, change this to `GITHUB_REPO_PRIVATE=1` before onboarding
   editors.

4. Add custom domain `decap-oauth.newafro.com`.
5. Render will show the DNS target.
6. In Namecheap, add the CNAME Render asks for:

   ```text
   Type:  CNAME
   Host:  decap-oauth
   Value: [exact Render DNS target]
   TTL:   Automatic
   ```

The exact CNAME target comes from Render after the custom domain is added. Do
not guess it.

If `https://newafro-decap-oauth.onrender.com` resolves but returns `404` with
`x-render-routing: no-server`, that only proves Render DNS exists. It does not
prove the New Afro OAuth service is deployed or attached to that hostname.
Finish the Render service setup and use the exact custom-domain target Render
shows for `decap-oauth.newafro.com`.

Before changing Namecheap, run the deploy-config preflight with the exact
Render target:

```bash
GITHUB_OAUTH_ID=[from GitHub OAuth app] \
GITHUB_OAUTH_SECRET=[from GitHub OAuth app] \
PUBLIC_URL=https://decap-oauth.newafro.com \
GITHUB_REPO_PRIVATE=0 \
RENDER_CUSTOM_DOMAIN_TARGET=[exact Render DNS target] \
npm run check:deploy-config
```

The command prints the exact Namecheap record and fails if a common mistake is
present, for example using `newafro.github.io`, including `https://`, setting
the wrong `PUBLIC_URL`, or leaving OAuth credentials blank.

You can also run the same preflight in GitHub Actions after storing
`GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET` as repository secrets:

```text
https://github.com/newafro/decap-oauth/actions/workflows/deploy-config-preflight.yml
```

Use the exact Render custom-domain DNS target as the workflow input. The
workflow prints the Namecheap `decap-oauth` CNAME value without exposing the
OAuth secret.

After the secrets and DNS are in place, the operator access preflight can also
be run from GitHub:

```text
https://github.com/newafro/decap-oauth/actions/workflows/operator-access.yml
```

It also runs daily after the live OAuth readiness monitor, so the team gets a
fresh pass/fail signal once Render, DNS, and repository secrets are in place.

It verifies the DNS and that the workflow can read the OAuth repository
secrets without printing their values.

## Local Test

```bash
PUBLIC_URL=http://127.0.0.1:8787 \
GITHUB_OAUTH_ID=dummy \
GITHUB_OAUTH_SECRET=dummy \
npm start
```

Then open:

```text
http://127.0.0.1:8787/
```

## Verification

After deployment and DNS propagation, run the same gate used by GitHub Actions:

```bash
npm run check:live
```

Expected: the command passes. If DNS is still missing, it exits non-zero with:

```text
decap-oauth.newafro.com has no public DNS result
```

For manual spot checks:

```bash
curl -I https://decap-oauth.newafro.com/
curl -I https://decap-oauth.newafro.com/healthz
curl -I "https://decap-oauth.newafro.com/auth?provider=github"
```

Expected:

- `/` returns `200`.
- `/healthz` returns `200` and includes CORS headers so the static CMS page can
  check whether sign-in is ready before editors try to log in. It also returns
  sanitized deploy metadata (`publicUrl`, `callbackUrl`, and `scope`) so
  operators can catch a wrong Render `PUBLIC_URL` without exposing OAuth
  secrets.
- `/auth?provider=github` returns `302` to `github.com/login/oauth/authorize`.
- `https://preview.newafro.com/admin/` can complete GitHub login.

## Required Editor Access

Editors authenticate as themselves through GitHub. Each editor must have write
access to `newafro/website`; otherwise login can succeed but saves will fail.
