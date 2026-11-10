/**
 * mockData.ts
 *
 * Realistic mock traffic so the whole UI — feed, filters, token extraction,
 * JWT decoding, cURL + HAR + Postman export — can be exercised in Expo Go
 * without the native VpnService interceptor.
 *
 * Presets cover: Auth/JWT, REST CRUD, GraphQL, and error responses (401/500).
 */

import type {
  CapturedRequest,
  CapturedResponse,
  HttpMethod,
  InstalledApp,
  MessageBody,
  TrafficEntry,
} from './types';

let counter = 0;
const nextId = (): string =>
  `evt_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export const MOCK_APPS: InstalledApp[] = [
  { packageName: 'com.padelfinder.app', label: 'Padel Finder', system: false },
  { packageName: 'com.shoply.market', label: 'Shoply', system: false },
  { packageName: 'com.chatter.social', label: 'Chatter', system: false },
  { packageName: 'com.fintrack.wallet', label: 'FinTrack', system: false },
  { packageName: 'com.android.chrome', label: 'Chrome', system: true },
];

// A long-lived, structurally valid demo JWT (HS256). Signature is fake — payload decodes.
const demoJwt = (() => {
  const b64url = (obj: unknown): string => {
    const json = JSON.stringify(obj);
    // btoa is available in the RN runtime.
    const b64 = globalThis.btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'usr_9f2a7c41',
    name: 'Demo Player',
    email: 'player@example.com',
    role: 'member',
    iat: now,
    exp: now + 3600,
    iss: 'https://auth.padelfinder.app',
  };
  const sig = 'sHbq3p0N1l5dR2vQxZt7KpYl8mWc4nXf0aB9cD2eF3g';
  return `${b64url(header)}.${b64url(payload)}.${sig}`;
})();

const body = (
  kind: MessageBody['kind'],
  text: string,
  mimeType?: string
): MessageBody => ({
  kind,
  text,
  mimeType,
  sizeBytes: text ? new TextEncoder().encode(text).length : 0,
});

interface Preset {
  app: InstalledApp;
  scheme: 'https';
  host: string;
  path: string;
  method: HttpMethod;
  request: Omit<CapturedRequest, 'method' | 'url'>;
  response: CapturedResponse;
  durationMs: number;
}

const jsonHeaders = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'Accept', value: 'application/json' },
];

const presets: Preset[] = [
  // 1. Auth login → issues Bearer JWT
  {
    app: MOCK_APPS[0],
    scheme: 'https',
    host: 'api.padelfinder.app',
    path: '/v1/auth/login',
    method: 'POST',
    durationMs: 412,
    request: {
      headers: [
        ...jsonHeaders,
        { name: 'User-Agent', value: 'PadelFinder/1.31.928 (Android 14)' },
        { name: 'X-Device-Id', value: 'a1b2c3d4-e5f6-7890' },
      ],
      queryParams: [],
      body: body(
        'json',
        JSON.stringify({ email: 'player@example.com', password: 'hunter2' }, null, 2)
      ),
    },
    response: {
      statusCode: 200,
      statusText: 'OK',
      headers: [
        ...jsonHeaders,
        {
          name: 'Set-Cookie',
          value: `session=${demoJwt}; HttpOnly; Secure; SameSite=Lax`,
        },
      ],
      body: body(
        'json',
        JSON.stringify(
          {
            access_token: demoJwt,
            refresh_token: 'rt_7f9c2a4e8b1d6f3a0c5e9b2d',
            token_type: 'Bearer',
            expires_in: 3600,
            user: { id: 'usr_9f2a7c41', name: 'Demo Player' },
          },
          null,
          2
        )
      ),
    },
  },
  // 2. Authenticated GET with Bearer token
  {
    app: MOCK_APPS[0],
    scheme: 'https',
    host: 'api.padelfinder.app',
    path: '/v1/courts/nearby',
    method: 'GET',
    durationMs: 188,
    request: {
      headers: [
        { name: 'Authorization', value: `Bearer ${demoJwt}` },
        { name: 'Accept', value: 'application/json' },
      ],
      queryParams: [
        { name: 'lat', value: '25.2048' },
        { name: 'lng', value: '55.2708' },
        { name: 'radius', value: '5000' },
      ],
      body: body('none', ''),
    },
    response: {
      statusCode: 200,
      statusText: 'OK',
      headers: jsonHeaders,
      body: body(
        'json',
        JSON.stringify(
          {
            courts: [
              { id: 'crt_01', name: 'Downtown Padel', distance_m: 820 },
              { id: 'crt_02', name: 'Marina Club', distance_m: 2400 },
            ],
            total: 2,
          },
          null,
          2
        )
      ),
    },
  },
  // 3. REST create (POST) with x-api-key
  {
    app: MOCK_APPS[1],
    scheme: 'https',
    host: 'api.shoply.market',
    path: '/v2/cart/items',
    method: 'POST',
    durationMs: 276,
    request: {
      headers: [
        ...jsonHeaders,
        { name: 'x-api-key', value: 'sk_live_5f8Hq2Lp9Rz3Wc7Nv1Tb4Mx' },
      ],
      queryParams: [],
      body: body(
        'json',
        JSON.stringify({ sku: 'SHOE-42-BLK', qty: 1 }, null, 2)
      ),
    },
    response: {
      statusCode: 201,
      statusText: 'Created',
      headers: jsonHeaders,
      body: body(
        'json',
        JSON.stringify({ cart_id: 'cart_88a1', items: 3, subtotal: 219.0 }, null, 2)
      ),
    },
  },
  // 4. REST update (PUT form-encoded)
  {
    app: MOCK_APPS[2],
    scheme: 'https',
    host: 'api.chatter.social',
    path: '/v1/profile',
    method: 'PUT',
    durationMs: 331,
    request: {
      headers: [
        { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
        { name: 'Authorization', value: `Bearer ${demoJwt}` },
      ],
      queryParams: [],
      body: body(
        'form',
        'display_name=Demo%20Player&bio=Padel%20%26%20code&visibility=public'
      ),
    },
    response: {
      statusCode: 200,
      statusText: 'OK',
      headers: jsonHeaders,
      body: body('json', JSON.stringify({ updated: true }, null, 2)),
    },
  },
  // 5. GraphQL query
  {
    app: MOCK_APPS[2],
    scheme: 'https',
    host: 'gql.chatter.social',
    path: '/graphql',
    method: 'POST',
    durationMs: 205,
    request: {
      headers: [
        ...jsonHeaders,
        { name: 'Authorization', value: `Bearer ${demoJwt}` },
      ],
      queryParams: [],
      body: body(
        'json',
        JSON.stringify(
          {
            query:
              'query Feed($first:Int!){ feed(first:$first){ id author { name } text } }',
            variables: { first: 10 },
            operationName: 'Feed',
          },
          null,
          2
        )
      ),
    },
    response: {
      statusCode: 200,
      statusText: 'OK',
      headers: jsonHeaders,
      body: body(
        'json',
        JSON.stringify(
          { data: { feed: [{ id: 'p1', author: { name: 'Ada' }, text: 'gm' }] } },
          null,
          2
        )
      ),
    },
  },
  // 6. 401 Unauthorized (expired token)
  {
    app: MOCK_APPS[3],
    scheme: 'https',
    host: 'api.fintrack.wallet',
    path: '/v1/transactions',
    method: 'GET',
    durationMs: 97,
    request: {
      headers: [
        { name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.expired.sig' },
        { name: 'Accept', value: 'application/json' },
      ],
      queryParams: [{ name: 'page', value: '1' }],
      body: body('none', ''),
    },
    response: {
      statusCode: 401,
      statusText: 'Unauthorized',
      headers: [
        ...jsonHeaders,
        { name: 'WWW-Authenticate', value: 'Bearer error="invalid_token"' },
      ],
      body: body(
        'json',
        JSON.stringify({ error: 'invalid_token', message: 'Token has expired' }, null, 2)
      ),
    },
  },
  // 7. 500 Server error (DELETE)
  {
    app: MOCK_APPS[1],
    scheme: 'https',
    host: 'api.shoply.market',
    path: '/v2/cart/items/SHOE-42-BLK',
    method: 'DELETE',
    durationMs: 1204,
    request: {
      headers: [
        { name: 'x-api-key', value: 'sk_live_5f8Hq2Lp9Rz3Wc7Nv1Tb4Mx' },
      ],
      queryParams: [],
      body: body('none', ''),
    },
    response: {
      statusCode: 500,
      statusText: 'Internal Server Error',
      headers: jsonHeaders,
      body: body(
        'json',
        JSON.stringify({ error: 'internal_error', trace_id: 'tr_9b2f' }, null, 2)
      ),
    },
  },
];

const buildUrl = (p: Preset): string => {
  const qs = p.request.queryParams.length
    ? '?' +
      p.request.queryParams
        .map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`)
        .join('&')
    : '';
  return `${p.scheme}://${p.host}${p.path}${qs}`;
};

const toEntry = (p: Preset): TrafficEntry => ({
  id: nextId(),
  startedAt: Date.now(),
  durationMs: p.durationMs + Math.round((Math.random() - 0.5) * 60),
  sourceApp: p.app.packageName,
  sourceAppLabel: p.app.label,
  host: p.host,
  path: p.path,
  scheme: p.scheme,
  tlsDecrypted: true,
  request: { method: p.method, url: buildUrl(p), ...p.request },
  response: p.response,
});

/** One random realistic transaction, optionally limited to a set of packages. */
export const generateMockEntry = (allowedPackages?: string[]): TrafficEntry => {
  const pool =
    allowedPackages && allowedPackages.length
      ? presets.filter((p) => allowedPackages.includes(p.app.packageName))
      : presets;
  const source = pool.length ? pool : presets;
  const picked = source[Math.floor(Math.random() * source.length)];
  return toEntry(picked);
};

/** The full preset suite at once (useful for seeding / demos). */
export const generateMockBurst = (allowedPackages?: string[]): TrafficEntry[] => {
  const pool =
    allowedPackages && allowedPackages.length
      ? presets.filter((p) => allowedPackages.includes(p.app.packageName))
      : presets;
  return (pool.length ? pool : presets).map(toEntry);
};
