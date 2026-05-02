import { safeFetch } from './safe-fetch';

/**
 * SSRF guard tests. We don't need a real HTTP server — the safety checks
 * happen before the socket is opened, so we just assert the right errors
 * surface for the right inputs.
 */
describe('safeFetch — SSRF guard', () => {
  it('rejects file:// scheme', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/scheme.*not allowed/);
  });

  it('rejects javascript: scheme', async () => {
    await expect(safeFetch('javascript:alert(1)')).rejects.toThrow(/scheme.*not allowed/);
  });

  it('rejects http:// in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(safeFetch('http://example.com')).rejects.toThrow(/plain http/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('rejects loopback hostname', async () => {
    await expect(safeFetch('https://127.0.0.1/')).rejects.toThrow(/private address/);
  });

  it('rejects AWS metadata endpoint', async () => {
    await expect(safeFetch('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private address/,
    );
  });

  it('rejects RFC1918 host', async () => {
    await expect(safeFetch('https://10.0.0.1/')).rejects.toThrow(/private address/);
  });

  it('rejects IPv6 loopback', async () => {
    await expect(safeFetch('https://[::1]/')).rejects.toThrow(/private address|EAI_AGAIN|ENOTFOUND/);
  });

  it('rejects host outside allowlist', async () => {
    await expect(
      safeFetch('https://evil.example.com/', { hostAllowlist: ['supabase.co'] }),
    ).rejects.toThrow(/not in allowlist/);
  });

  it('accepts subdomain of allowlisted host (allowlist gate)', async () => {
    // Resolves DNS — accept either network failure or success, but NOT
    // the "not in allowlist" error.
    try {
      await safeFetch('https://nonexistent.supabase.co/', {
        hostAllowlist: ['supabase.co'],
        timeoutMs: 1500,
      });
    } catch (err) {
      expect(String((err as Error).message)).not.toMatch(/not in allowlist/);
    }
  });
});
