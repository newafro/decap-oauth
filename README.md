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
Authorization callback URL: https://decap-oauth.newafro.com/callback
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

## Render Deploy

This repository includes `render.yaml`.

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

After deployment:

```bash
curl -I https://decap-oauth.newafro.com/
curl -I "https://decap-oauth.newafro.com/auth?provider=github"
```

Expected:

- `/` returns `200`.
- `/healthz` returns `200` and includes CORS headers so the static CMS page can
  check whether sign-in is ready before editors try to log in.
- `/auth?provider=github` returns `302` to `github.com/login/oauth/authorize`.
- `https://preview.newafro.com/admin/` can complete GitHub login.

## Required Editor Access

Editors authenticate as themselves through GitHub. Each editor must have write
access to `newafro/website`; otherwise login can succeed but saves will fail.
