/**
 * curlGenerator.ts
 *
 * Converts a captured transaction into a ready-to-run cURL command.
 * Handles method, full URL (with query), all headers, auth tokens (carried in
 * headers), and an escaped JSON / form / raw body. Output is POSIX-shell safe.
 */

import type { CapturedRequest, TrafficEntry } from './types';

export interface CurlOptions {
  /** Emit each flag on its own line with `\` continuations (default true). */
  multiline?: boolean;
  /** Add --compressed (default true). */
  compressed?: boolean;
  /** Add -i to include response headers (default false). */
  includeResponseHeaders?: boolean;
  /** Redact secret-looking header values instead of printing them (default false). */
  redactSecrets?: boolean;
}

// Headers that curl manages itself or that reflect transport, not intent.
const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding', // curl sets this via --compressed
  ':method',
  ':path',
  ':authority',
  ':scheme',
]);

const SECRET_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
]);

/** Single-quote a string for POSIX sh: wrap in '…' and escape embedded quotes. */
export const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

const buildHeaderFlags = (
  request: CapturedRequest,
  redact: boolean
): string[] => {
  const flags: string[] = [];
  for (const h of request.headers) {
    const lower = h.name.toLowerCase();
    if (SKIP_HEADERS.has(lower)) continue;
    let value = h.value;
    if (redact && SECRET_HEADERS.has(lower)) {
      value = '<REDACTED>';
    }
    flags.push(`-H ${shellQuote(`${h.name}: ${value}`)}`);
  }
  return flags;
};

const buildBodyFlag = (request: CapturedRequest): string | null => {
  const { body } = request;
  if (body.kind === 'none' || !body.text) return null;
  if (body.kind === 'binary') {
    return `--data-binary ${shellQuote('<binary ' + body.sizeBytes + ' bytes omitted>')}`;
  }
  // --data-raw preserves the payload exactly (no @file interpretation, no % decoding).
  return `--data-raw ${shellQuote(body.text)}`;
};

/**
 * Build a cURL command string from a captured request.
 */
export const generateCurl = (
  request: CapturedRequest,
  options: CurlOptions = {}
): string => {
  const {
    multiline = true,
    compressed = true,
    includeResponseHeaders = false,
    redactSecrets = false,
  } = options;

  const parts: string[] = [`curl -X ${request.method}`];

  if (includeResponseHeaders) parts.push('-i');

  parts.push(...buildHeaderFlags(request, redactSecrets));

  const bodyFlag = buildBodyFlag(request);
  if (bodyFlag) parts.push(bodyFlag);

  if (compressed) parts.push('--compressed');

  parts.push(shellQuote(request.url));

  if (multiline) {
    return parts.join(' \\\n  ');
  }
  return parts.join(' ');
};

/** Convenience wrapper that accepts a whole TrafficEntry. */
export const generateCurlForEntry = (
  entry: TrafficEntry,
  options?: CurlOptions
): string => generateCurl(entry.request, options);
