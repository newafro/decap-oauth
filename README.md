# New Afro Decap OAuth Proxy

Small GitHub OAuth proxy for New Afro Studio / Decap CMS.

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

Create a GitHub OAuth app:

```text
Application name: New Afro Studio CMS
Homepage URL: https://newafro.com
Authorization callback URL: https://decap-oauth.newafro.com/callback
```

Store the generated values in the deploy host:

```text
GITHUB_OAUTH_ID
GITHUB_OAUTH_SECRET
```

## Render Deploy

This repository includes `render.yaml`.

1. Create a Render Blueprint from this repository.
2. Set `GITHUB_OAUTH_ID` and `GITHUB_OAUTH_SECRET`.
3. Add custom domain `decap-oauth.newafro.com`.
4. Render will show the DNS target.
5. In Namecheap, add the CNAME Render asks for.

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
- `/auth?provider=github` returns `302` to `github.com/login/oauth/authorize`.
- `https://preview.newafro.com/admin/` can complete GitHub login.
