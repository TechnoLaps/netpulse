/**
 * tokenExtractor.ts
 *
 * Scans a captured request/response for secrets and credentials:
 *   - Authorization: Bearer <jwt|opaque>
 *   - Authorization: Basic <base64>
 *   - x-api-key / api-key / x-auth-token and similar header keys
 *   - Cookie / Set-Cookie session values
 *   - JWTs appearing anywhere in headers or body
 *
 * Also provides a dependency-free JWT decoder (header + payload preview).
 */

import type { CapturedRequest, CapturedResponse, Header } from './types';

export type TokenKind =
  | 'bearer'
  | 'basic'
  | 'api-key'
  | 'cookie'
  | 'jwt'
  | 'custom';

export interface ExtractedToken {
  kind: TokenKind;
  /** Where it was found, e.g. "Authorization header" or "response body". */
  source: string;
  /** Human label shown in UI, e.g. "Bearer token" or header name. */
  label: string;
  /** The raw secret value (what "Copy Token" copies). */
  value: string;
  /** Present when the value is a decodable JWT. */
  jwt?: DecodedJwt;
}

export interface DecodedJwt {
  raw: string;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature: string;
  /** Expiry as epoch millis if an `exp` claim is present. */
  expiresAt?: number;
  isExpired?: boolean;
}

// Header names that commonly carry credentials (lowercased).
const API_KEY_HEADERS = [
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'x-csrf-token',
  'x-xsrf-token',
  'authentication',
  'auth-token',
  'token',
];

// A JWT is three base64url segments separated by dots. Header starts with eyJ (i.e. `{"`).
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/** RFC 4648 base64url decode that works in RN/Hermes (no Buffer). */
export const base64UrlDecode = (input: string): string => {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  // atob is available in Hermes / RN runtime.
  try {
    const bin = globalThis.atob(b64);
    // Reinterpret Latin1 bytes as UTF-8.
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(
      Array.from(bytes)
        .map((b) => '%' + b.toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return '';
  }
};

export const decodeJwt = (raw: string): DecodedJwt | undefined => {
  const parts = raw.split('.');
  if (parts.length < 2) return undefined;
  const safeParse = (seg: string): Record<string, unknown> | null => {
    const json = base64UrlDecode(seg);
    if (!json) return null;
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const header = safeParse(parts[0]);
  const payload = safeParse(parts[1]);
  // Must decode to at least one JSON object to count as a JWT.
  if (!header && !payload) return undefined;

  const decoded: DecodedJwt = {
    raw,
    header,
    payload,
    signature: parts[2] ?? '',
  };
  const exp = payload?.['exp'];
  if (typeof exp === 'number') {
    decoded.expiresAt = exp * 1000;
    decoded.isExpired = exp * 1000 < Date.now();
  }
  return decoded;
};

const findJwtsIn = (text: string): string[] => {
  if (!text) return [];
  const matches = text.match(JWT_RE);
  return matches ? Array.from(new Set(matches)) : [];
};

const scanHeaders = (
  headers: Header[],
  source: string,
  out: ExtractedToken[],
  seen: Set<string>
): void => {
  for (const h of headers) {
    const name = h.name.toLowerCase();
    const value = h.value?.trim() ?? '';
    if (!value) continue;

    if (name === 'authorization') {
      const [scheme, ...rest] = value.split(/\s+/);
      const credential = rest.join(' ');
      const s = scheme?.toLowerCase();
      if (s === 'bearer' && credential) {
        pushToken(out, seen, {
          kind: 'bearer',
          source: `${source} · Authorization`,
          label: 'Bearer token',
          value: credential,
          jwt: decodeJwt(credential),
        });
      } else if (s === 'basic' && credential) {
        pushToken(out, seen, {
          kind: 'basic',
          source: `${source} · Authorization`,
          label: 'Basic credentials',
          value: credential,
        });
      } else {
        pushToken(out, seen, {
          kind: 'custom',
          source: `${source} · Authorization`,
          label: scheme ? `${scheme} credentials` : 'Authorization',
          value: credential || value,
        });
      }
      continue;
    }

    if (name === 'cookie' || name === 'set-cookie') {
      pushToken(out, seen, {
        kind: 'cookie',
        source: `${source} · ${h.name}`,
        label: h.name,
        value,
      });
      // Session cookies sometimes carry JWTs.
      for (const jwt of findJwtsIn(value)) {
        pushToken(out, seen, {
          kind: 'jwt',
          source: `${source} · ${h.name}`,
          label: 'JWT in cookie',
          value: jwt,
          jwt: decodeJwt(jwt),
        });
      }
      continue;
    }

    if (API_KEY_HEADERS.includes(name)) {
      pushToken(out, seen, {
        kind: 'api-key',
        source: `${source} · ${h.name}`,
        label: h.name,
        value,
      });
      continue;
    }
  }
};

const pushToken = (
  out: ExtractedToken[],
  seen: Set<string>,
  token: ExtractedToken
): void => {
  const key = `${token.kind}:${token.value}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(token);
};

/**
 * Extract every credential/secret found in a request (and optional response).
 * Returns a de-duplicated, display-ordered list.
 */
export const extractTokens = (
  request: CapturedRequest,
  response?: CapturedResponse
): ExtractedToken[] => {
  const out: ExtractedToken[] = [];
  const seen = new Set<string>();

  scanHeaders(request.headers, 'request', out, seen);

  // Body-embedded JWTs and obvious token fields (request).
  for (const jwt of findJwtsIn(request.body.text)) {
    pushToken(out, seen, {
      kind: 'jwt',
      source: 'request body',
      label: 'JWT in body',
      value: jwt,
      jwt: decodeJwt(jwt),
    });
  }

  if (response) {
    scanHeaders(response.headers, 'response', out, seen);
    for (const jwt of findJwtsIn(response.body.text)) {
      pushToken(out, seen, {
        kind: 'jwt',
        source: 'response body',
        label: 'JWT in body',
        value: jwt,
        jwt: decodeJwt(jwt),
      });
    }
    // Common token fields in JSON auth responses.
    scanJsonForTokenFields(response.body.text, 'response body', out, seen);
  }

  scanJsonForTokenFields(request.body.text, 'request body', out, seen);

  return out;
};

const TOKEN_FIELD_RE =
  /(access_token|refresh_token|id_token|auth_token|session_token|api_key|apikey)/i;

const scanJsonForTokenFields = (
  text: string,
  source: string,
  out: ExtractedToken[],
  seen: Set<string>
): void => {
  if (!text) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === 'string' && TOKEN_FIELD_RE.test(k) && v.length > 6) {
        const maybeJwt = decodeJwt(v);
        pushToken(out, seen, {
          kind: maybeJwt ? 'jwt' : 'custom',
          source: `${source} · ${k}`,
          label: k,
          value: v,
          jwt: maybeJwt,
        });
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    }
  };
  walk(parsed);
};

/** True if a request/response carries any credential (used by the "Has Auth Token" filter). */
export const hasAuthToken = (
  request: CapturedRequest,
  response?: CapturedResponse
): boolean => extractTokens(request, response).length > 0;
