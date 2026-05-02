import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

/**
 * SSRF-safe fetch.
 *
 * Used by user-controlled URL fetches (statement-import, receipt-OCR
 * adapters, coach tool calls). Blocks:
 *   - Non-https schemes (file://, ftp://, gopher://, javascript:, data:).
 *   - Private/loopback/link-local hostnames (169.254.169.254 cloud metadata,
 *     127.0.0.0/8, 10/8, 172.16/12, 192.168/16, ::1, fe80::/10).
 *   - Hosts not in the allowlist (when one is provided).
 *   - Bodies above maxBytes.
 *   - Redirects to disallowed targets (re-validated at every hop).
 *
 * Implementation: resolve hostname before connecting, then connect by IP.
 * This prevents DNS rebinding from steering us to an internal address
 * after the allowlist check passes.
 */

export interface SafeFetchOptions {
  hostAllowlist?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
}

const PRIVATE_CIDR_RE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,         // link-local + AWS/GCE metadata
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,                 // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];
const PRIVATE_IPV6 = [
  /^::1$/i,
  /^fc/i,                 // fc00::/7 (ULA)
  /^fd/i,
  /^fe80:/i,              // link-local
  /^::ffff:0\./i,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./i,
  /^::ffff:192\.168\./i,
];

const isPrivateIp = (addr: string): boolean => {
  if (addr.includes(':')) return PRIVATE_IPV6.some((re) => re.test(addr));
  return PRIVATE_CIDR_RE.some((re) => re.test(addr));
};

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[]> }> {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024; // 25 MB
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 0;

  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`SSRF guard: scheme ${url.protocol} is not allowed`);
    }
    if (url.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      throw new Error('SSRF guard: plain http:// is forbidden in production');
    }
    if (opts.hostAllowlist && opts.hostAllowlist.length > 0) {
      const host = url.hostname.toLowerCase();
      const ok = opts.hostAllowlist.some((p) => host === p || host.endsWith(`.${p}`));
      if (!ok) throw new Error(`SSRF guard: host ${host} not in allowlist`);
    }

    // Resolve hostname BEFORE connecting; refuse private addresses.
    const lookupResults = await lookup(url.hostname, { all: true });
    if (!lookupResults.length) {
      throw new Error(`SSRF guard: DNS resolution returned no answers for ${url.hostname}`);
    }
    for (const r of lookupResults) {
      if (isPrivateIp(r.address)) {
        throw new Error(`SSRF guard: ${url.hostname} resolves to private address ${r.address}`);
      }
    }
    const targetIp = lookupResults[0].address;

    // Connect by IP, set Host header so TLS SNI + virtual hosting still work.
    const result = await new Promise<{
      status: number;
      body: Buffer;
      headers: Record<string, string | string[]>;
      location?: string;
    }>((resolve, reject) => {
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const port = url.port || (url.protocol === 'https:' ? 443 : 80);
      const req = reqFn(
        {
          hostname: targetIp,
          port: Number(port),
          path: `${url.pathname}${url.search}`,
          method: opts.method ?? 'GET',
          headers: { Host: url.host, 'User-Agent': 'felo-safefetch/1', ...(opts.headers ?? {}) },
          servername: url.hostname,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBytes) {
              req.destroy(new Error(`SSRF guard: body exceeded maxBytes (${maxBytes})`));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks),
              headers: res.headers as Record<string, string | string[]>,
              location: res.headers.location,
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('SSRF guard: timeout')));
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 300 && result.status < 400 && result.location) {
      if (hop >= maxRedirects) {
        throw new Error('SSRF guard: redirect limit exceeded');
      }
      url = new URL(result.location, url);
      continue;
    }
    return { status: result.status, body: result.body, headers: result.headers };
  }
  throw new Error('SSRF guard: redirect loop');
}
