import crypto from 'node:crypto';
import http from 'node:http';

const DEFAULT_SCOPE = 'public_repo,user';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export function getConfig(env = process.env) {
  const publicUrl = env.PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  return {
    clientId: env.GITHUB_OAUTH_ID || env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_SECRET || env.GITHUB_CLIENT_SECRET,
    publicUrl: publicUrl ? publicUrl.replace(/\/$/, '') : '',
    scope: env.GITHUB_REPO_PRIVATE === '1' ? 'repo,user' : env.GITHUB_OAUTH_SCOPE || DEFAULT_SCOPE,
    port: Number(env.PORT || 8787),
  };
}

function textResponse(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function htmlResponse(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    ...headers,
  });
  res.end(body);
}

function readCookie(header, name) {
  const cookies = new Map(
    String(header || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
  return cookies.get(name);
}

export function buildAuthorizeUrl({ clientId, publicUrl, scope, state }) {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${publicUrl}/callback?provider=github`);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export function callbackHtml(status, payload) {
  const message = `authorization:github:${status}:${JSON.stringify(payload)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>New Afro CMS Authorization</title>
    <script>
      const message = ${JSON.stringify(message)};
      const receiveMessage = () => {
        window.opener.postMessage(message, '*');
        window.removeEventListener('message', receiveMessage, false);
      };
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    </script>
  </head>
  <body>
    <p>Authorizing New Afro Studio...</p>
  </body>
</html>`;
}

async function exchangeCodeForToken({ clientId, clientSecret, code, publicUrl }) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${publicUrl}/callback?provider=github`,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    const error = data.error_description || data.error || `GitHub returned ${response.status}`;
    throw new Error(error);
  }

  return data.access_token;
}

function assertConfigured(config) {
  const missing = [];
  if (!config.clientId) missing.push('GITHUB_OAUTH_ID');
  if (!config.clientSecret) missing.push('GITHUB_OAUTH_SECRET');
  if (!config.publicUrl) missing.push('PUBLIC_URL');
  return missing;
}

export function createHandler(config = getConfig()) {
  return async function handleRequest(req, res) {
    const url = new URL(req.url, config.publicUrl || `http://${req.headers.host}`);

    if (url.pathname === '/') {
      textResponse(res, 200, 'New Afro Decap OAuth proxy is running.');
      return;
    }

    if (url.pathname === '/healthz') {
      const missing = assertConfigured(config);
      res.writeHead(missing.length === 0 ? 200 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: missing.length === 0, missing }));
      return;
    }

    const missing = assertConfigured(config);
    if (missing.length > 0) {
      textResponse(res, 500, `OAuth proxy is missing configuration: ${missing.join(', ')}`);
      return;
    }

    if (url.pathname === '/auth') {
      if (url.searchParams.get('provider') !== 'github') {
        textResponse(res, 400, 'Invalid provider.');
        return;
      }

      const state = crypto.randomBytes(16).toString('hex');
      const location = buildAuthorizeUrl({
        clientId: config.clientId,
        publicUrl: config.publicUrl,
        scope: config.scope,
        state,
      });

      res.writeHead(302, {
        Location: location,
        'Set-Cookie': `oauth_state=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/callback`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    if (url.pathname === '/callback') {
      if (url.searchParams.get('provider') !== 'github') {
        textResponse(res, 400, 'Invalid provider.');
        return;
      }

      const expectedState = readCookie(req.headers.cookie, 'oauth_state');
      const receivedState = url.searchParams.get('state');
      if (!expectedState || expectedState !== receivedState) {
        htmlResponse(res, 400, callbackHtml('error', { error: 'OAuth state mismatch. Please try again.' }));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        htmlResponse(res, 400, callbackHtml('error', { error: 'Missing GitHub authorization code.' }));
        return;
      }

      try {
        const token = await exchangeCodeForToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          code,
          publicUrl: config.publicUrl,
        });
        htmlResponse(res, 200, callbackHtml('success', { token }), {
          'Set-Cookie': 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/callback',
        });
      } catch (error) {
        htmlResponse(res, 502, callbackHtml('error', { error: error.message }));
      }
      return;
    }

    textResponse(res, 404, 'Not found.');
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();
  const server = http.createServer((req, res) => {
    createHandler(config)(req, res).catch((error) => {
      textResponse(res, 500, error.message || 'Unexpected error.');
    });
  });

  server.listen(config.port, () => {
    console.log(`New Afro Decap OAuth proxy listening on :${config.port}`);
  });
}
