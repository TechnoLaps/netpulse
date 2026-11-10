/**
 * Shared domain types for NetPulse Inspector.
 *
 * These types model a single intercepted HTTP(S) transaction. They are emitted
 * either by the Mock Traffic Generator (JS) or, on a device build, by the native
 * VpnService interceptor bridge (see modules/vpn-interceptor).
 */

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/** A single HTTP header. Kept as an ordered list so duplicates (e.g. Set-Cookie) survive. */
export interface Header {
  name: string;
  value: string;
}

export interface QueryParam {
  name: string;
  value: string;
}

export type BodyKind = 'json' | 'form' | 'text' | 'binary' | 'none';

export interface MessageBody {
  kind: BodyKind;
  /** Raw text payload (for json/form/text). Empty for binary/none. */
  text: string;
  /** Declared or sniffed mime type, e.g. application/json. */
  mimeType?: string;
  /** Size in bytes of the on-the-wire body. */
  sizeBytes: number;
}

export interface InstalledApp {
  /** Android application id, e.g. com.example.app */
  packageName: string;
  label: string;
  /** Optional data URI or remote URL for the launcher icon. */
  icon?: string;
  system: boolean;
}

export interface CapturedRequest {
  method: HttpMethod;
  url: string; // full absolute URL
  httpVersion?: string;
  headers: Header[];
  queryParams: QueryParam[];
  body: MessageBody;
}

export interface CapturedResponse {
  statusCode: number;
  statusText: string;
  httpVersion?: string;
  headers: Header[];
  body: MessageBody;
}

export interface TrafficEntry {
  id: string;
  /** Epoch millis when the request started. */
  startedAt: number;
  /** Round-trip time in milliseconds (undefined while in-flight). */
  durationMs?: number;
  /** Package name of the app that originated the call (from VpnService uid lookup). */
  sourceApp: string;
  sourceAppLabel: string;
  host: string;
  path: string;
  scheme: 'http' | 'https';
  request: CapturedRequest;
  /** Undefined while the response has not arrived yet. */
  response?: CapturedResponse;
  /** True when the request/response was captured via a decrypted TLS MITM. */
  tlsDecrypted: boolean;
}

export type FilterMethod = HttpMethod | 'ALL';
export type FilterStatus = 'ALL' | '2xx' | '3xx' | '4xx' | '5xx';

export interface TrafficFilters {
  search: string;
  method: FilterMethod;
  status: FilterStatus;
  app: string | 'ALL';
  hasAuthToken: boolean;
}
