/**
 * exporters.ts
 *
 * Serializes captured traffic into portable formats:
 *   - HAR 1.2 (http archive) — opens in Chrome DevTools, Charles, Proxyman, etc.
 *   - Postman Collection v2.1 — importable into Postman / Insomnia.
 *
 * All functions are pure and return strings, so the caller can write them to a
 * file (expo-file-system) and share them (expo-sharing).
 */

import type {
  CapturedRequest,
  Header,
  QueryParam,
  TrafficEntry,
} from './types';
import { generateCurl } from './curlGenerator';

// ---------------------------------------------------------------------------
// HAR 1.2
// ---------------------------------------------------------------------------

const toHarHeaders = (headers: Header[]) =>
  headers.map((h) => ({ name: h.name, value: h.value }));

const toHarQuery = (params: QueryParam[]) =>
  params.map((q) => ({ name: q.name, value: q.value }));

const mimeOf = (req: CapturedRequest): string =>
  req.body.mimeType ??
  (req.body.kind === 'json'
    ? 'application/json'
    : req.body.kind === 'form'
      ? 'application/x-www-form-urlencoded'
      : 'text/plain');

const harEntry = (e: TrafficEntry) => {
  const reqBodyPresent = e.request.body.kind !== 'none' && !!e.request.body.text;
  const resBodyText = e.response?.body.text ?? '';
  return {
    startedDateTime: new Date(e.startedAt).toISOString(),
    time: e.durationMs ?? 0,
    _sourceApp: e.sourceApp,
    _sourceAppLabel: e.sourceAppLabel,
    _tlsDecrypted: e.tlsDecrypted,
    request: {
      method: e.request.method,
      url: e.request.url,
      httpVersion: e.request.httpVersion ?? 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(e.request.headers),
      queryString: toHarQuery(e.request.queryParams),
      headersSize: -1,
      bodySize: e.request.body.sizeBytes,
      ...(reqBodyPresent
        ? {
            postData: {
              mimeType: mimeOf(e.request),
              text: e.request.body.text,
            },
          }
        : {}),
    },
    response: {
      status: e.response?.statusCode ?? 0,
      statusText: e.response?.statusText ?? '',
      httpVersion: e.response?.httpVersion ?? 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(e.response?.headers ?? []),
      content: {
        size: e.response?.body.sizeBytes ?? 0,
        mimeType: e.response?.body.mimeType ?? 'application/json',
        text: resBodyText,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: e.response?.body.sizeBytes ?? 0,
    },
    cache: {},
    timings: {
      send: 0,
      wait: e.durationMs ?? 0,
      receive: 0,
    },
  };
};

export const toHar = (entries: TrafficEntry[]): string => {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'NetPulse Inspector', version: '1.0.0' },
      entries: entries.map(harEntry),
    },
  };
  return JSON.stringify(har, null, 2);
};

// ---------------------------------------------------------------------------
// Postman Collection v2.1
// ---------------------------------------------------------------------------

const parseUrlForPostman = (urlStr: string) => {
  // Lightweight parse so we don't depend on a URL polyfill being installed.
  const [beforeHash] = urlStr.split('#');
  const [origin, query = ''] = beforeHash.split('?');
  const m = /^([a-z]+):\/\/([^/]+)(\/[^?]*)?$/i.exec(origin);
  const protocol = m?.[1] ?? 'https';
  const hostPort = m?.[2] ?? '';
  const rawPath = m?.[3] ?? '/';
  const [host, port] = hostPort.split(':');
  const pathSegments = rawPath.split('/').filter(Boolean);
  const queryItems = query
    ? query.split('&').map((kv) => {
        const [key, value = ''] = kv.split('=');
        return { key: decodeURIComponent(key), value: decodeURIComponent(value) };
      })
    : [];
  return {
    raw: urlStr,
    protocol,
    host: host ? host.split('.') : [],
    ...(port ? { port } : {}),
    path: pathSegments,
    ...(queryItems.length ? { query: queryItems } : {}),
  };
};

const postmanBody = (req: CapturedRequest) => {
  if (req.body.kind === 'none' || !req.body.text) return undefined;
  if (req.body.kind === 'form') {
    const urlencoded = req.body.text.split('&').map((kv) => {
      const [key, value = ''] = kv.split('=');
      return {
        key: decodeURIComponent(key),
        value: decodeURIComponent(value),
        type: 'text',
      };
    });
    return { mode: 'urlencoded', urlencoded };
  }
  return {
    mode: 'raw',
    raw: req.body.text,
    options: {
      raw: { language: req.body.kind === 'json' ? 'json' : 'text' },
    },
  };
};

const postmanItem = (e: TrafficEntry) => ({
  name: `${e.request.method} ${e.path}`,
  request: {
    method: e.request.method,
    header: e.request.headers.map((h) => ({ key: h.name, value: h.value })),
    ...(postmanBody(e.request) ? { body: postmanBody(e.request) } : {}),
    url: parseUrlForPostman(e.request.url),
    description: `Captured from ${e.sourceAppLabel} (${e.sourceApp}) at ${new Date(
      e.startedAt
    ).toISOString()}`,
  },
  response: [],
});

export const toPostmanCollection = (
  entries: TrafficEntry[],
  name = 'NetPulse Capture'
): string => {
  const collection = {
    info: {
      name,
      _postman_id: `netpulse-${Date.now()}`,
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Exported from NetPulse Inspector',
    },
    item: entries.map(postmanItem),
  };
  return JSON.stringify(collection, null, 2);
};

// ---------------------------------------------------------------------------
// cURL bundle (all requests as a shell script)
// ---------------------------------------------------------------------------

export const toCurlBundle = (entries: TrafficEntry[]): string => {
  const header = '#!/usr/bin/env bash\n# Exported from NetPulse Inspector\n\n';
  return (
    header +
    entries
      .map(
        (e) =>
          `# ${e.sourceAppLabel} — ${e.request.method} ${e.host}${e.path}\n` +
          generateCurl(e.request, { multiline: true })
      )
      .join('\n\n')
  );
};

export type ExportFormat = 'har' | 'postman' | 'curl';

export interface ExportResult {
  content: string;
  filename: string;
  mimeType: string;
}

export const exportTraffic = (
  entries: TrafficEntry[],
  format: ExportFormat
): ExportResult => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  switch (format) {
    case 'har':
      return {
        content: toHar(entries),
        filename: `netpulse-${stamp}.har`,
        mimeType: 'application/json',
      };
    case 'postman':
      return {
        content: toPostmanCollection(entries),
        filename: `netpulse-${stamp}.postman_collection.json`,
        mimeType: 'application/json',
      };
    case 'curl':
      return {
        content: toCurlBundle(entries),
        filename: `netpulse-${stamp}.sh`,
        mimeType: 'text/x-shellscript',
      };
  }
};
